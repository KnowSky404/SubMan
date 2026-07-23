import { get } from "svelte/store";
import { browser } from "$app/environment";
import type { AppState } from "$lib/models";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { subscribeWorkspaceEvents } from "$lib/workspace-events";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import {
	applyCommittedWorkspaceEvent,
	deliverQueuedWorkspaceMutation,
} from "$lib/workspace-mutation-sync";
import {
	dispatchWorkspaceSyncEvent,
	type WorkspaceBlockedMutation,
	type WorkspaceQueueMetrics,
	type WorkspaceSyncError,
	workspaceSyncStatus,
} from "$lib/workspace-sync-status";
import {
	type WorkspaceV2LocalState,
	WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

export function startWorkspaceMutationSync(
	options: {
		enabled?: boolean;
		delayMs?: number;
		retryDelayMs?: number;
		queue?: WorkspaceMutationQueue;
		stateStore?: WorkspaceV2StateStore;
		fetchImpl?: typeof fetch;
		getState?: () => AppState;
		setState?: (state: AppState) => void;
		subscribeAuth?: (
			listener: (state: { token: string | null }) => void,
		) => () => void;
		subscribeEvents?: typeof subscribeWorkspaceEvents;
	} = {},
): () => void {
	if (!(options.enabled ?? browser)) return () => {};
	const queue = options.queue ?? new WorkspaceMutationQueue();
	const stateStore = options.stateStore ?? new WorkspaceV2StateStore();
	const delayMs = options.delayMs ?? 250;
	const retryDelayMs = options.retryDelayMs ?? 5_000;
	const getState = options.getState ?? (() => get(appState));
	const setState =
		options.setState ?? ((state: AppState) => appState.set(state));
	let githubToken: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let running = false;
	let stopped = false;
	let retryAttempt = 0;

	const dependencies = () => ({
		queue,
		stateStore,
		githubToken,
		getState,
		setState,
		fetchImpl: options.fetchImpl,
	});

	function queueMetrics(
		binding: WorkspaceV2LocalState | null,
		blockedMutationCount = 0,
	): WorkspaceQueueMetrics {
		const mutations = queue.list();
		const activeQueueCount = binding
			? mutations.filter((item) => item.workspaceId === binding.workspaceId)
					.length
			: 0;
		const orphanedWorkspaceCount = new Set(
			mutations
				.filter((item) => item.workspaceId !== binding?.workspaceId)
				.map((item) => item.workspaceId),
		).size;
		return {
			activeQueueCount,
			totalQueueCount: mutations.length,
			orphanedWorkspaceCount,
			blockedMutationCount,
		};
	}

	function syncError(
		code: string,
		message: string,
		disposition: WorkspaceSyncError["disposition"],
	): WorkspaceSyncError {
		return { code, message, disposition };
	}

	function blockedMutation(
		binding: WorkspaceV2LocalState | null,
		error: WorkspaceSyncError,
	): WorkspaceBlockedMutation | null {
		const mutation = binding ? queue.peek(binding.workspaceId) : null;
		return mutation
			? {
					mutationId: mutation.mutationId,
					kind: mutation.kind,
					code: error.code,
					disposition: error.disposition,
					message: error.message,
				}
			: null;
	}

	function reportContext(binding: WorkspaceV2LocalState | null): void {
		dispatchWorkspaceSyncEvent({
			type: "SYNC_CONTEXT_LOADED",
			mode: binding?.syncMode ?? "disconnected",
			authenticated: Boolean(githubToken),
			revision: binding?.revision ?? null,
			queue: queueMetrics(binding),
			blockedMutation: null,
		});
	}

	function schedule(delay = delayMs): void {
		if (stopped || running || timer) return;
		let binding: WorkspaceV2LocalState | null;
		let hasPending = false;
		try {
			binding = stateStore.read();
			hasPending = Boolean(binding && queue.peek(binding.workspaceId));
		} catch {
			dispatchWorkspaceSyncEvent({
				type: "STORAGE_QUARANTINED",
				kind: "state",
				queue: {
					activeQueueCount: 0,
					totalQueueCount: 0,
					orphanedWorkspaceCount: 0,
					blockedMutationCount: 0,
				},
				error: syncError(
					"workspace_state_unreadable",
					"Workspace synchronization state could not be read",
					"queue-corruption",
				),
			});
			return;
		}
		reportContext(binding);
		if (
			!githubToken ||
			!binding ||
			binding.syncMode !== "automatic" ||
			!hasPending ||
			get(workspaceSyncStatus).repairRequired
		) {
			return;
		}
		timer = setTimeout(run, delay);
	}

	async function run(): Promise<void> {
		timer = null;
		if (stopped || running) return;
		const startingBinding = stateStore.read();
		const startingMutation = startingBinding
			? queue.peek(startingBinding.workspaceId)
			: null;
		if (
			!githubToken ||
			!startingBinding ||
			startingBinding.syncMode !== "automatic" ||
			!startingMutation ||
			get(workspaceSyncStatus).repairRequired
		) {
			reportContext(startingBinding);
			return;
		}
		const accepted = dispatchWorkspaceSyncEvent({
			type: "SYNC_STARTED",
			queue: queueMetrics(startingBinding),
			mutation: {
				mutationId: startingMutation.mutationId,
				kind: startingMutation.kind,
			},
		});
		if (!accepted) return;
		running = true;
		let nextDelay: number | null = null;
		try {
			const result = await deliverQueuedWorkspaceMutation(dependencies());
			const binding = stateStore.read();
			if (result.status === "empty" || result.status === "blocked") {
				retryAttempt = 0;
				reportContext(binding);
			}
			if (result.status === "committed") {
				nextDelay = 0;
				retryAttempt = 0;
				dispatchWorkspaceSyncEvent({
					type: "SYNC_COMMITTED",
					queue: queueMetrics(binding),
					revision: binding?.revision ?? null,
				});
			}
			if (result.status === "retryable-error") {
				nextDelay = retryDelayMs;
				retryAttempt += 1;
				const error = syncError(
					result.code ?? "workspace_sync_retry",
					"Workspace synchronization failed and will retry",
					result.disposition,
				);
				dispatchWorkspaceSyncEvent({
					type: "SYNC_RETRY_SCHEDULED",
					queue: queueMetrics(binding),
					error,
					blockedMutation: blockedMutation(binding, error),
					retry: {
						attempt: retryAttempt,
						nextAttemptAt: Date.now() + retryDelayMs,
						retryAfterMs: retryDelayMs,
						lastErrorCode: error.code,
					},
				});
			}
			if (result.status === "permanent-error") {
				const error = syncError(
					result.code ?? "workspace_sync_failed",
					result.code ?? "Workspace synchronization needs repair",
					result.disposition,
				);
				const blocked = blockedMutation(binding, error);
				const metrics = queueMetrics(binding, blocked ? 1 : 0);
				if (result.disposition === "auth-required") {
					dispatchWorkspaceSyncEvent({
						type: "AUTH_LOST",
						queue: metrics,
						error,
					});
				} else if (result.disposition === "domain-conflict") {
					dispatchWorkspaceSyncEvent({
						type: "DOMAIN_BLOCKED",
						queue: metrics,
						error,
						blockedMutation: blocked,
					});
				} else if (result.disposition === "queue-corruption") {
					dispatchWorkspaceSyncEvent({
						type: "QUEUE_CORRUPTED",
						queue: metrics,
						error,
						blockedMutation: blocked,
					});
				} else {
					dispatchWorkspaceSyncEvent({
						type: "OPERATOR_REPAIR_REQUIRED",
						queue: metrics,
						error,
						blockedMutation: blocked,
					});
				}
			}
			if (result.status === "conflict") {
				const error = syncError(
					result.code,
					"Workspace state changed and requires conflict resolution",
					result.disposition,
				);
				const blocked = blockedMutation(binding, error);
				dispatchWorkspaceSyncEvent({
					type: "STATE_CONFLICT",
					queue: queueMetrics(binding, blocked ? 1 : 0),
					error,
					blockedMutation: blocked,
				});
			}
		} catch {
			nextDelay = retryDelayMs;
			retryAttempt += 1;
			const binding = stateStore.read();
			const error = syncError(
				"workspace_sync_exception",
				"Workspace synchronization failed and will retry",
				"retryable-upstream",
			);
			dispatchWorkspaceSyncEvent({
				type: "SYNC_RETRY_SCHEDULED",
				queue: queueMetrics(binding),
				error,
				blockedMutation: blockedMutation(binding, error),
				retry: {
					attempt: retryAttempt,
					nextAttemptAt: Date.now() + retryDelayMs,
					retryAfterMs: retryDelayMs,
					lastErrorCode: error.code,
				},
			});
		} finally {
			running = false;
			if (nextDelay !== null) schedule(nextDelay);
		}
	}

	const authUnsub = (options.subscribeAuth ?? authState.subscribe)((state) => {
		githubToken = state.token;
		if (!githubToken && timer) {
			clearTimeout(timer);
			timer = null;
		}
		schedule();
	});
	const eventsUnsub = (options.subscribeEvents ?? subscribeWorkspaceEvents)(
		(event) => {
			if (event.type === "workspace-v2-committed") {
				applyCommittedWorkspaceEvent(event, dependencies());
			}
			if (
				event.type === "mutation-queue-changed" ||
				event.type === "workspace-v2-committed"
			) {
				schedule();
			}
		},
	);
	schedule();

	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
		authUnsub();
		eventsUnsub();
	};
}
