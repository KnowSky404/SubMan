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
import { checkWorkspaceIdentity } from "$lib/workspace-identity";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import {
	updateWorkspaceSyncStatus,
	type WorkspacePersistenceLifecycle,
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

function mapEnqueueResult(
	result: BrowserMutationEnqueueResult,
): WorkspaceActionResult {
	switch (result.status) {
		case "queued":
			updateWorkspaceSyncStatus({
				lifecycle: "queued",
				mode: "automatic",
				recentError: null,
			});
			return { status: "queued", mutationId: result.mutation.mutationId };
		case "manual":
			updateWorkspaceSyncStatus({
				lifecycle: "manual-local-only",
				mode: "manual",
			});
			return { status: "manual-local-only" };
		case "paused-conflict":
			updateWorkspaceSyncStatus({
				lifecycle: "paused-conflict",
				mode: "paused-conflict",
				repairRequired: true,
			});
			return { status: "paused-conflict" };
		case "uninitialized":
			updateWorkspaceSyncStatus({
				lifecycle: "invalid-local-state",
				repairRequired: true,
				recentError: "Workspace baseline is not initialized",
			});
			return {
				status: "invalid-local-state",
				error: "Workspace baseline is not initialized",
			};
		case "local-only":
			updateWorkspaceSyncStatus({ lifecycle: "local-saved", mode: "local" });
			return { status: "local-saved" };
	}
}

function disconnectedActionResult(
	binding: ReturnType<WorkspaceV2StateStore["read"]>,
): WorkspaceActionResult {
	if (binding) {
		updateWorkspaceSyncStatus({
			lifecycle: "auth-required",
			mode: "disconnected",
		});
		return { status: "auth-required" };
	}
	updateWorkspaceSyncStatus({ lifecycle: "local-saved", mode: "local" });
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
		updateWorkspaceSyncStatus({
			lifecycle: "local-saved",
			recentError: null,
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
						updateWorkspaceSyncStatus({
							lifecycle: "permanent-error",
							recentError: message,
							repairRequired: true,
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

export function removeAggregate(ruleId: string): WorkspaceActionHandle {
	return runWorkspaceAction("aggregate.delete", { id: ruleId }, (state) => ({
		...state,
		aggregates: state.aggregates.filter((item) => item.id !== ruleId),
		publishTargets: state.publishTargets.filter(
			(target) => target.ruleId !== ruleId,
		),
		clientExports: state.clientExports.filter(
			(profile) => profile.ruleId !== ruleId,
		),
		lastUpdated: nowIso(),
	}));
}

export function upsertPublishTarget(
	target: AggregatePublishTarget,
): WorkspaceActionHandle {
	return runWorkspaceAction("publish-target.upsert", { target }, (state) => {
		const index = state.publishTargets.findIndex(
			(item) => item.id === target.id,
		);
		if (index >= 0) {
			const publishTargets = [...state.publishTargets];
			publishTargets[index] = target;
			return { ...state, publishTargets, lastUpdated: nowIso() };
		}
		return {
			...state,
			publishTargets: [target, ...state.publishTargets],
			lastUpdated: nowIso(),
		};
	});
}

export function removePublishTarget(targetId: string): WorkspaceActionHandle {
	return runWorkspaceAction(
		"publish-target.delete",
		{ id: targetId },
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
	return runWorkspaceAction("client-export.upsert", { profile }, (state) => {
		const index = state.clientExports.findIndex(
			(item) => item.id === profile.id,
		);
		if (index >= 0) {
			const clientExports = [...state.clientExports];
			clientExports[index] = profile;
			return { ...state, clientExports, lastUpdated: nowIso() };
		}
		return {
			...state,
			clientExports: [profile, ...state.clientExports],
			lastUpdated: nowIso(),
		};
	});
}

export function removeClientExport(profileId: string): WorkspaceActionHandle {
	return runWorkspaceAction(
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
		updateWorkspaceSyncStatus({ lifecycle: "local-saved" });
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
