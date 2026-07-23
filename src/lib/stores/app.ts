import { get, writable } from "svelte/store";
import { browser } from "$app/environment";
import { t } from "$lib/i18n";
import type {
	AggregatePublishTarget,
	AggregateRule,
	AppState,
	ClientExportProfile,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";
import { authState } from "$lib/stores/auth";
import { showToast } from "$lib/stores/toast";
import { nowIso } from "$lib/utils/time";
import {
	type BrowserMutationEnqueueResult,
	enqueueAutomaticWorkspaceMutation,
	enqueueAutomaticWorkspaceReconcile,
	validateAutomaticWorkspaceMutationDraft,
	validateAutomaticWorkspaceReconcile,
} from "$lib/workspace-browser-mutation";
import {
	createDefaultWorkspaceState,
	reconcileWorkspaceState,
} from "$lib/workspace-data";
import { validateWorkspaceOutputFileName } from "$lib/workspace-document";
import { checkWorkspaceIdentity } from "$lib/workspace-identity";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import {
	getConflictingOutputOwners,
	isCurrentPublishTargetOutputPublished,
} from "$lib/workspace-output";
import {
	dispatchWorkspaceSyncEvent,
	type WorkspacePersistenceLifecycle,
	type WorkspaceQueueMetrics,
	type WorkspaceSyncError,
	workspaceSyncStatus,
} from "$lib/workspace-sync-status";
import { WorkspaceV2StateStore } from "$lib/workspace-v2-state";

const STORAGE_KEY = "subman:state:v1";

export const defaultState: AppState = createDefaultWorkspaceState(nowIso());

function loadInitialState(): AppState {
	if (!browser) {
		return defaultState;
	}

	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) {
		return defaultState;
	}

	try {
		const parsed = JSON.parse(raw) as AppState;
		return { ...defaultState, ...parsed };
	} catch {
		return defaultState;
	}
}

export const appState = writable<AppState>(loadInitialState());

if (browser) {
	appState.subscribe((value) => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	});
}

export type WorkspaceActionResult = {
	status: WorkspacePersistenceLifecycle | "rejected";
	mutationId?: string;
	error?: string;
};

export type WorkspaceActionHandle =
	| {
			accepted: true;
			localStatus: "local-saved";
			completion: Promise<WorkspaceActionResult>;
	  }
	| {
			accepted: false;
			localStatus: "rejected";
			completion: Promise<WorkspaceActionResult>;
	  };

function currentQueueMetrics(activeDelta = 0): WorkspaceQueueMetrics {
	const status = get(workspaceSyncStatus);
	const activeQueueCount = Math.max(0, status.activeQueueCount + activeDelta);
	return {
		activeQueueCount,
		totalQueueCount: Math.max(activeQueueCount, status.totalQueueCount),
		orphanedWorkspaceCount: status.orphanedWorkspaceCount,
		blockedMutationCount: status.blockedMutationCount,
	};
}

function currentActionMode(): "local" | "automatic" | "manual" {
	if (!browser) return "local";
	const mode = new WorkspaceV2StateStore().read()?.syncMode;
	return mode === "manual" ? "manual" : mode ? "automatic" : "local";
}

function operatorError(code: string, message: string): WorkspaceSyncError {
	return { code, message, disposition: "operator-repair" };
}

function mapEnqueueResult(
	result: BrowserMutationEnqueueResult,
): WorkspaceActionResult {
	switch (result.status) {
		case "queued":
			dispatchWorkspaceSyncEvent({
				type: "MUTATION_ENQUEUED",
				queue: currentQueueMetrics(1),
				mutation: {
					mutationId: result.mutation.mutationId,
					kind: result.mutation.kind,
				},
			});
			return { status: "queued", mutationId: result.mutation.mutationId };
		case "manual":
			dispatchWorkspaceSyncEvent({
				type: "LOCAL_COMMITTED",
				mode: "manual",
				queue: currentQueueMetrics(),
			});
			return { status: "manual-local-only" };
		case "paused-conflict":
			dispatchWorkspaceSyncEvent({
				type: "SYNC_CONTEXT_LOADED",
				mode: "paused-conflict",
				authenticated: true,
				revision: get(workspaceSyncStatus).lastCommittedRevision,
				queue: currentQueueMetrics(),
				blockedMutation: null,
			});
			return { status: "paused-conflict" };
		case "uninitialized":
			dispatchWorkspaceSyncEvent({
				type: "OPERATOR_REPAIR_REQUIRED",
				queue: currentQueueMetrics(),
				error: operatorError(
					"workspace_baseline_uninitialized",
					"Workspace baseline is not initialized",
				),
				blockedMutation: null,
			});
			return {
				status: "invalid-local-state",
				error: "Workspace baseline is not initialized",
			};
		case "local-only":
			dispatchWorkspaceSyncEvent({
				type: "LOCAL_COMMITTED",
				mode: "local",
				queue: currentQueueMetrics(),
			});
			return { status: "local-saved" };
	}
}

function disconnectedActionResult(
	binding: ReturnType<WorkspaceV2StateStore["read"]>,
): WorkspaceActionResult {
	if (binding) {
		dispatchWorkspaceSyncEvent({
			type: "AUTH_LOST",
			queue: currentQueueMetrics(),
		});
		return { status: "auth-required" };
	}
	dispatchWorkspaceSyncEvent({
		type: "LOCAL_COMMITTED",
		mode: "local",
		queue: currentQueueMetrics(),
	});
	return { status: "local-saved" };
}

function runWorkspaceAction(
	kind: WorkspaceMutation["kind"],
	payload: unknown,
	update: (state: AppState) => AppState,
): WorkspaceActionHandle {
	const draft = { kind, payload };
	try {
		if (browser) {
			const binding = new WorkspaceV2StateStore().read();
			const identity = checkWorkspaceIdentity(get(appState), binding);
			if (identity.status === "mismatch") {
				throw new Error("Workspace identity requires repair");
			}
			validateAutomaticWorkspaceMutationDraft(draft);
		}
		const next = update(get(appState));
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		appState.set(next);
		dispatchWorkspaceSyncEvent({
			type: "LOCAL_COMMITTED",
			mode: currentActionMode(),
			queue: currentQueueMetrics(),
		});
	} catch (error) {
		notifyRejectedWorkspaceMutation(error);
		const result = {
			status: "rejected" as const,
			error: error instanceof Error ? error.message : String(error),
		};
		return {
			accepted: false,
			localStatus: "rejected",
			completion: Promise.resolve(result),
		};
	}

	const binding = browser ? new WorkspaceV2StateStore().read() : null;
	const completion = browser
		? !get(authState).token
			? Promise.resolve(disconnectedActionResult(binding))
			: enqueueAutomaticWorkspaceMutation(draft)
					.then(mapEnqueueResult)
					.catch((error) => {
						const message =
							error instanceof Error ? error.message : String(error);
						dispatchWorkspaceSyncEvent({
							type: "OPERATOR_REPAIR_REQUIRED",
							queue: currentQueueMetrics(),
							error: operatorError("mutation_enqueue_failed", message),
							blockedMutation: null,
						});
						showToast(
							get(t)(
								"Saved locally; Workspace synchronization needs repair: {error}",
								{
									error: message,
								},
							),
							"error",
							6_000,
						);
						return { status: "permanent-error" as const, error: message };
					})
		: Promise.resolve({ status: "local-saved" as const });
	return { accepted: true, localStatus: "local-saved", completion };
}

function runDeferredWorkspaceAction(
	kind: WorkspaceMutation["kind"],
	payload: unknown,
	update: (state: AppState) => AppState,
): WorkspaceActionHandle {
	const draft = { kind, payload };
	let next: AppState;
	try {
		if (browser) {
			const binding = new WorkspaceV2StateStore().read();
			const identity = checkWorkspaceIdentity(get(appState), binding);
			if (identity.status === "mismatch") {
				throw new Error("Workspace identity requires repair");
			}
			validateAutomaticWorkspaceMutationDraft(draft);
		}
		next = update(get(appState));
	} catch (error) {
		notifyRejectedWorkspaceMutation(error);
		return rejectedActionHandle(error);
	}

	const completion = (async (): Promise<WorkspaceActionResult> => {
		try {
			const binding = browser ? new WorkspaceV2StateStore().read() : null;
			let result: WorkspaceActionResult;
			if (!browser) {
				result = { status: "local-saved" };
			} else if (!get(authState).token) {
				result = disconnectedActionResult(binding);
			} else {
				result = mapEnqueueResult(
					await enqueueAutomaticWorkspaceMutation(draft),
				);
			}
			if (result.status === "invalid-local-state") {
				return result;
			}
			if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			appState.set(next);
			return result;
		} catch (error) {
			notifyRejectedWorkspaceMutation(error);
			return {
				status: "rejected",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	})();

	return { accepted: true, localStatus: "local-saved", completion };
}

function rejectedActionHandle(error: unknown): WorkspaceActionHandle {
	return {
		accepted: false,
		localStatus: "rejected",
		completion: Promise.resolve({
			status: "rejected",
			error: error instanceof Error ? error.message : String(error),
		}),
	};
}

function assertLocalOutputOwnerAvailable(
	state: AppState,
	owner: {
		kind: "publish-target" | "client-export";
		id: string;
		fileName: string;
	},
): void {
	const conflicts = getConflictingOutputOwners(state, owner);
	if (conflicts.length === 0) return;
	throw new Error(
		`Output file ${owner.fileName} is already owned by ${conflicts
			.map((conflict) => `${conflict.kind}:${conflict.name}`)
			.join(", ")}`,
	);
}

function notifyRejectedWorkspaceMutation(error: unknown): void {
	showToast(
		get(t)("Workspace change was not saved: {error}", {
			error: error instanceof Error ? error.message : String(error),
		}),
		"error",
		6_000,
	);
}

export function upsertNode(node: NodeItem): WorkspaceActionHandle {
	return runWorkspaceAction(
		"node.upsert",
		{ operation: "replace", node },
		(state) => {
			const index = state.nodes.findIndex((item) => item.id === node.id);
			if (index >= 0) {
				const nodes = [...state.nodes];
				nodes[index] = node;
				return { ...state, nodes, lastUpdated: nowIso() };
			}
			return { ...state, nodes: [node, ...state.nodes], lastUpdated: nowIso() };
		},
	);
}

export function removeNode(nodeId: string): WorkspaceActionHandle {
	return runWorkspaceAction("node.delete", { id: nodeId }, (state) => {
		const now = nowIso();
		return reconcileWorkspaceState(
			{
				...state,
				nodes: state.nodes.filter((node) => node.id !== nodeId),
				lastUpdated: now,
			},
			now,
		);
	});
}

export function upsertSubscription(
	subscription: SubscriptionItem,
): WorkspaceActionHandle {
	return runWorkspaceAction(
		"subscription.upsert",
		{ subscription },
		(state) => {
			const index = state.subscriptions.findIndex(
				(item) => item.id === subscription.id,
			);
			if (index >= 0) {
				const subscriptions = [...state.subscriptions];
				subscriptions[index] = subscription;
				return { ...state, subscriptions, lastUpdated: nowIso() };
			}
			return {
				...state,
				subscriptions: [subscription, ...state.subscriptions],
				lastUpdated: nowIso(),
			};
		},
	);
}

export function removeSubscription(
	subscriptionId: string,
): WorkspaceActionHandle {
	return runWorkspaceAction(
		"subscription.delete",
		{ id: subscriptionId },
		(state) => {
			const now = nowIso();
			return reconcileWorkspaceState(
				{
					...state,
					subscriptions: state.subscriptions.filter(
						(item) => item.id !== subscriptionId,
					),
					lastUpdated: now,
				},
				now,
			);
		},
	);
}

export function upsertAggregate(rule: AggregateRule): WorkspaceActionHandle {
	return runWorkspaceAction(
		"aggregate.upsert",
		{ aggregate: rule },
		(state) => {
			const index = state.aggregates.findIndex((item) => item.id === rule.id);
			if (index >= 0) {
				const aggregates = [...state.aggregates];
				aggregates[index] = rule;
				return { ...state, aggregates, lastUpdated: nowIso() };
			}
			return {
				...state,
				aggregates: [rule, ...state.aggregates],
				lastUpdated: nowIso(),
			};
		},
	);
}

export function removeAggregate(
	ruleId: string,
	options: { cleanupUnreferencedOutputs?: boolean } = {},
): WorkspaceActionHandle {
	return runDeferredWorkspaceAction(
		"aggregate.delete",
		{ id: ruleId, ...options },
		(state) => ({
			...state,
			aggregates: state.aggregates.filter((item) => item.id !== ruleId),
			publishTargets: state.publishTargets.filter(
				(target) => target.ruleId !== ruleId,
			),
			clientExports: state.clientExports.filter(
				(profile) => profile.ruleId !== ruleId,
			),
			lastUpdated: nowIso(),
		}),
	);
}

export function upsertPublishTarget(
	target: AggregatePublishTarget,
	options: { previousFileCleanup?: "keep" | "delete-if-unreferenced" } = {},
): WorkspaceActionHandle {
	let fileName: string;
	try {
		fileName = validateWorkspaceOutputFileName(target.fileName);
	} catch (error) {
		notifyRejectedWorkspaceMutation(error);
		return rejectedActionHandle(error);
	}
	const requested = { ...target, fileName };
	return runWorkspaceAction(
		"publish-target.upsert",
		{ target: requested, ...options },
		(state) => {
			assertLocalOutputOwnerAvailable(state, {
				kind: "publish-target",
				id: requested.id,
				fileName,
			});
			const index = state.publishTargets.findIndex(
				(item) => item.id === requested.id,
			);
			if (index >= 0) {
				const existing = state.publishTargets[index];
				if (!existing) throw new Error("Publish target not found");
				const outputChanged =
					existing.fileName !== fileName ||
					existing.ruleId !== requested.ruleId;
				let merged: AggregatePublishTarget = {
					...existing,
					...requested,
					lastPublishedAt: existing.lastPublishedAt,
					lastPublishedUrl: existing.lastPublishedUrl,
					lastPublishTransitionAt: existing.lastPublishTransitionAt,
					lastPublishTransitionFromFileName:
						existing.lastPublishTransitionFromFileName,
					lastPublishTransitionToFileName:
						existing.lastPublishTransitionToFileName,
					lastPublishTransitionOutcome: existing.lastPublishTransitionOutcome,
					updatedAt: outputChanged ? requested.updatedAt : existing.updatedAt,
				};
				if (existing.fileName !== fileName) {
					const otherOwners = getConflictingOutputOwners(state, {
						kind: "publish-target",
						id: existing.id,
						fileName: existing.fileName,
					});
					const cleanup = options.previousFileCleanup ?? "keep";
					merged = {
						...merged,
						lastPublishTransitionAt: requested.updatedAt,
						lastPublishTransitionFromFileName: existing.fileName,
						lastPublishTransitionToFileName: fileName,
						lastPublishTransitionOutcome:
							cleanup === "keep"
								? "kept_manual"
								: otherOwners.length > 0
									? "kept_shared"
									: isCurrentPublishTargetOutputPublished(existing)
										? "auto_deleted"
										: "kept_external",
					};
				}
				const publishTargets = [...state.publishTargets];
				publishTargets[index] = merged;
				return { ...state, publishTargets, lastUpdated: nowIso() };
			}
			return {
				...state,
				publishTargets: [requested, ...state.publishTargets],
				lastUpdated: nowIso(),
			};
		},
	);
}

export function removePublishTarget(
	targetId: string,
	options: { cleanupUnreferencedOutputs?: boolean } = {},
): WorkspaceActionHandle {
	return runDeferredWorkspaceAction(
		"publish-target.delete",
		{ id: targetId, ...options },
		(state) => ({
			...state,
			publishTargets: state.publishTargets.filter(
				(item) => item.id !== targetId,
			),
			lastUpdated: nowIso(),
		}),
	);
}

export function upsertClientExport(
	profile: ClientExportProfile,
): WorkspaceActionHandle {
	let fileName: string;
	try {
		fileName = validateWorkspaceOutputFileName(profile.fileName);
	} catch (error) {
		notifyRejectedWorkspaceMutation(error);
		return rejectedActionHandle(error);
	}
	const requested = { ...profile, fileName };
	return runWorkspaceAction(
		"client-export.upsert",
		{ profile: requested },
		(state) => {
			assertLocalOutputOwnerAvailable(state, {
				kind: "client-export",
				id: requested.id,
				fileName,
			});
			const index = state.clientExports.findIndex(
				(item) => item.id === requested.id,
			);
			if (index >= 0) {
				const clientExports = [...state.clientExports];
				clientExports[index] = requested;
				return { ...state, clientExports, lastUpdated: nowIso() };
			}
			return {
				...state,
				clientExports: [requested, ...state.clientExports],
				lastUpdated: nowIso(),
			};
		},
	);
}

export function removeClientExport(profileId: string): WorkspaceActionHandle {
	return runDeferredWorkspaceAction(
		"client-export.delete",
		{ id: profileId },
		(state) => ({
			...state,
			clientExports: state.clientExports.filter(
				(item) => item.id !== profileId,
			),
			lastUpdated: nowIso(),
		}),
	);
}

export function replaceState(next: AppState): WorkspaceActionHandle {
	const current = get(appState);
	const state = {
		...defaultState,
		...next,
		activeGistId: current.activeGistId,
		activeGistFile: current.activeGistFile,
		lastUpdated: nowIso(),
	};
	if (browser) {
		try {
			validateAutomaticWorkspaceReconcile(state);
		} catch (error) {
			notifyRejectedWorkspaceMutation(error);
			return {
				accepted: false,
				localStatus: "rejected",
				completion: Promise.resolve({
					status: "rejected",
					error: error instanceof Error ? error.message : String(error),
				}),
			};
		}
	}
	try {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		appState.set(state);
		dispatchWorkspaceSyncEvent({
			type: "LOCAL_COMMITTED",
			mode: currentActionMode(),
			queue: currentQueueMetrics(),
		});
	} catch (error) {
		notifyRejectedWorkspaceMutation(error);
		return {
			accepted: false,
			localStatus: "rejected",
			completion: Promise.resolve({
				status: "rejected",
				error: error instanceof Error ? error.message : String(error),
			}),
		};
	}
	const completion = browser
		? get(authState).token
			? enqueueAutomaticWorkspaceReconcile(state).then(mapEnqueueResult)
			: Promise.resolve(
					disconnectedActionResult(new WorkspaceV2StateStore().read()),
				)
		: Promise.resolve({ status: "local-saved" as const });
	return { accepted: true, localStatus: "local-saved", completion };
}
