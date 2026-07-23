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
import { updateWorkspaceSyncStatus } from "$lib/workspace-sync-status";
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

	const dependencies = () => ({
		queue,
		stateStore,
		githubToken,
		getState,
		setState,
		fetchImpl: options.fetchImpl,
	});

	function schedule(delay = delayMs): void {
		if (stopped || running || timer) return;
		let binding: WorkspaceV2LocalState | null;
		let hasPending = false;
		let queueCount = 0;
		try {
			binding = stateStore.read();
			queueCount = queue.list().length;
			hasPending = Boolean(binding && queue.peek(binding.workspaceId));
		} catch {
			updateWorkspaceSyncStatus({
				lifecycle: "invalid-local-state",
				recentError: "Workspace synchronization state could not be read",
				repairRequired: true,
				retrying: false,
			});
			return;
		}
		const mode = binding?.syncMode ?? "disconnected";
		updateWorkspaceSyncStatus({
			mode,
			queueCount,
			lastCommittedRevision: binding?.revision ?? null,
			...(binding?.syncMode === "paused-conflict"
				? { lifecycle: "paused-conflict" as const, repairRequired: true }
				: !githubToken && queueCount > 0
					? { lifecycle: "auth-required" as const }
					: binding?.syncMode === "manual"
						? { lifecycle: "manual-local-only" as const }
						: hasPending
							? { lifecycle: "queued" as const }
							: {}),
		});
		if (
			!githubToken ||
			!binding ||
			binding.syncMode !== "automatic" ||
			!hasPending
		) {
			return;
		}
		timer = setTimeout(run, delay);
	}

	async function run(): Promise<void> {
		timer = null;
		if (stopped || running) return;
		running = true;
		let nextDelay: number | null = null;
		updateWorkspaceSyncStatus({
			lifecycle: "syncing",
			retrying: false,
			recentError: null,
		});
		try {
			const result = await deliverQueuedWorkspaceMutation(dependencies());
			const binding = stateStore.read();
			const queueCount = queue.list().length;
			if (result.status === "committed") {
				nextDelay = 0;
				updateWorkspaceSyncStatus({
					lifecycle: "committed",
					queueCount,
					lastCommittedRevision: binding?.revision ?? null,
					retrying: false,
					recentError: null,
				});
			}
			if (result.status === "retryable-error") {
				nextDelay = retryDelayMs;
				updateWorkspaceSyncStatus({
					lifecycle: "retrying",
					queueCount,
					retrying: true,
					recentError: "Workspace synchronization failed and will retry",
				});
			}
			if (result.status === "permanent-error") {
				updateWorkspaceSyncStatus({
					lifecycle: "permanent-error",
					queueCount,
					retrying: false,
					recentError: result.code ?? "Workspace synchronization needs repair",
					repairRequired: true,
				});
			}
			if (result.status === "conflict") {
				updateWorkspaceSyncStatus({
					lifecycle: "paused-conflict",
					mode: "paused-conflict",
					queueCount,
					retrying: false,
					repairRequired: true,
				});
			}
		} catch {
			nextDelay = retryDelayMs;
			updateWorkspaceSyncStatus({
				lifecycle: "retrying",
				retrying: true,
				recentError: "Workspace synchronization failed and will retry",
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
