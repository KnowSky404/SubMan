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
import { showToast } from "$lib/stores/toast";
import { nowIso } from "$lib/utils/time";
import {
	createDefaultWorkspaceState,
	getWorkspaceBusinessData,
	reconcileWorkspaceState,
} from "$lib/workspace-data";
import { validateWorkspaceOutputFileName } from "$lib/workspace-document";
import { checkWorkspaceIdentity } from "$lib/workspace-identity";
import {
	parseWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import {
	getConflictingOutputOwners,
	isCurrentPublishTargetOutputPublished,
} from "$lib/workspace-output";
import type { WorkspaceMutationDraft } from "$lib/workspace-persistence";
import {
	type BrowserWorkspaceCommitResult,
	commitBrowserWorkspaceAction,
	getBrowserWorkspaceBinding,
	initializeBrowserWorkspacePersistence,
} from "$lib/workspace-persistence-browser";
import {
	dispatchWorkspaceSyncEvent,
	type WorkspacePersistenceLifecycle,
} from "$lib/workspace-sync-status";
import type { WorkspaceV2LocalState } from "$lib/workspace-v2-state";

export const defaultState: AppState = createDefaultWorkspaceState(nowIso());
export const appState = writable<AppState>(defaultState);

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

const VALIDATION_MUTATION_ID = "00000000-0000-4000-8000-000000000000";
const VALIDATION_TIMESTAMP = "2000-01-01T00:00:00.000Z";
const LOCAL_VALIDATION_WORKSPACE_ID = "gist:local-validation";
let actionTail: Promise<void> = Promise.resolve();

export async function initializeAppStatePersistence(): Promise<void> {
	if (!browser) return;
	await initializeBrowserWorkspacePersistence({
		storage: localStorage,
		hydrate: (snapshot) => appState.set(snapshot),
	});
}

function serializedAction<T>(action: () => Promise<T>): Promise<T> {
	const result = actionTail.then(action, action);
	actionTail = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

function createMutationDraft(
	kind: WorkspaceMutation["kind"],
	payload: unknown,
	binding: WorkspaceV2LocalState | null,
	options: { mutationId?: string; createdAt?: string } = {},
): WorkspaceMutationDraft {
	const mutation = parseWorkspaceMutation({
		mutationId: options.mutationId ?? VALIDATION_MUTATION_ID,
		workspaceId: binding?.workspaceId ?? LOCAL_VALIDATION_WORKSPACE_ID,
		expectedRevision: binding?.revision ?? 0,
		source: "browser",
		createdAt: options.createdAt ?? VALIDATION_TIMESTAMP,
		kind,
		payload,
	});
	const { expectedRevision: _allocatedByPersistence, ...draft } = mutation;
	return draft;
}

function resultForCommit(
	result: BrowserWorkspaceCommitResult,
): WorkspaceActionResult {
	if (result.mutation) {
		dispatchWorkspaceSyncEvent({
			type: "MUTATION_ENQUEUED",
			queue: result.queue,
			mutation: {
				mutationId: result.mutation.mutationId,
				kind: result.mutation.kind,
			},
		});
		return { status: "queued", mutationId: result.mutation.mutationId };
	}
	if (result.binding?.syncMode === "manual") {
		dispatchWorkspaceSyncEvent({
			type: "LOCAL_COMMITTED",
			mode: "manual",
			queue: result.queue,
		});
		return { status: "manual-local-only" };
	}
	if (result.binding?.syncMode === "paused-conflict") {
		dispatchWorkspaceSyncEvent({
			type: "SYNC_CONTEXT_LOADED",
			mode: "paused-conflict",
			authenticated: false,
			revision: result.binding.revision,
			queue: result.queue,
			blockedMutation: null,
		});
		return { status: "paused-conflict" };
	}
	dispatchWorkspaceSyncEvent({
		type: "LOCAL_COMMITTED",
		mode: "local",
		queue: result.queue,
	});
	return { status: "local-saved" };
}

type PreparedAction = { next: AppState; payload: unknown };

function runPreparedWorkspaceAction(
	kind: WorkspaceMutation["kind"],
	prepare: (
		state: AppState,
		binding: WorkspaceV2LocalState | null,
		createdAt: string,
	) => PreparedAction,
): WorkspaceActionHandle {
	try {
		const binding = browser ? getBrowserWorkspaceBinding() : null;
		const preliminary = prepare(get(appState), binding, VALIDATION_TIMESTAMP);
		createMutationDraft(kind, preliminary.payload, binding);
	} catch (error) {
		notifyRejectedWorkspaceMutation(error);
		return rejectedActionHandle(error);
	}

	if (!browser) {
		try {
			const prepared = prepare(get(appState), null, nowIso());
			appState.set(prepared.next);
			dispatchWorkspaceSyncEvent({
				type: "LOCAL_COMMITTED",
				mode: "local",
				queue: {
					activeQueueCount: 0,
					totalQueueCount: 0,
					orphanedWorkspaceCount: 0,
					blockedMutationCount: 0,
					deadLetterCount: 0,
				},
			});
			return {
				accepted: true,
				localStatus: "local-saved",
				completion: Promise.resolve({ status: "local-saved" }),
			};
		} catch (error) {
			return rejectedActionHandle(error);
		}
	}

	const completion = serializedAction(
		async (): Promise<WorkspaceActionResult> => {
			try {
				await initializeAppStatePersistence();
				const binding = getBrowserWorkspaceBinding();
				const current = get(appState);
				if (checkWorkspaceIdentity(current, binding).status === "mismatch") {
					throw new Error("Workspace identity requires repair");
				}
				const createdAt = nowIso();
				const prepared = prepare(current, binding, createdAt);
				const next = { ...prepared.next, lastUpdated: createdAt };
				const validatedDraft = createMutationDraft(
					kind,
					prepared.payload,
					binding,
					{ mutationId: crypto.randomUUID(), createdAt },
				);
				const committed = await commitBrowserWorkspaceAction({
					snapshot: next,
					mutation: binding?.syncMode === "automatic" ? validatedDraft : null,
				});
				appState.set(next);
				return resultForCommit(committed);
			} catch (error) {
				notifyRejectedWorkspaceMutation(error);
				return {
					status: "rejected",
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);
	return { accepted: true, localStatus: "local-saved", completion };
}

function runWorkspaceAction(
	kind: WorkspaceMutation["kind"],
	payload: unknown | ((createdAt: string) => unknown),
	update: (state: AppState, createdAt: string) => AppState,
): WorkspaceActionHandle {
	return runPreparedWorkspaceAction(kind, (state, _binding, createdAt) => ({
		next: update(state, createdAt),
		payload: typeof payload === "function" ? payload(createdAt) : payload,
	}));
}

function runDeferredWorkspaceAction(
	kind: WorkspaceMutation["kind"],
	payload: unknown | ((createdAt: string) => unknown),
	update: (state: AppState, createdAt: string) => AppState,
): WorkspaceActionHandle {
	return runWorkspaceAction(kind, payload, update);
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
		(createdAt: string) => ({
			operation: "replace",
			node: { ...node, updatedAt: createdAt },
		}),
		(state, createdAt) => {
			const committedNode = { ...node, updatedAt: createdAt };
			const index = state.nodes.findIndex((item) => item.id === node.id);
			if (index >= 0) {
				const nodes = [...state.nodes];
				nodes[index] = committedNode;
				return { ...state, nodes, lastUpdated: createdAt };
			}
			return {
				...state,
				nodes: [committedNode, ...state.nodes],
				lastUpdated: createdAt,
			};
		},
	);
}

export function removeNode(nodeId: string): WorkspaceActionHandle {
	return runWorkspaceAction(
		"node.delete",
		{ id: nodeId },
		(state, createdAt) => {
			return reconcileWorkspaceState(
				{
					...state,
					nodes: state.nodes.filter((node) => node.id !== nodeId),
					lastUpdated: createdAt,
				},
				createdAt,
			);
		},
	);
}

export function upsertSubscription(
	subscription: SubscriptionItem,
): WorkspaceActionHandle {
	return runWorkspaceAction(
		"subscription.upsert",
		(createdAt: string) => ({
			subscription: { ...subscription, updatedAt: createdAt },
		}),
		(state, createdAt) => {
			const committedSubscription = { ...subscription, updatedAt: createdAt };
			const index = state.subscriptions.findIndex(
				(item) => item.id === subscription.id,
			);
			if (index >= 0) {
				const subscriptions = [...state.subscriptions];
				subscriptions[index] = committedSubscription;
				return { ...state, subscriptions, lastUpdated: createdAt };
			}
			return {
				...state,
				subscriptions: [committedSubscription, ...state.subscriptions],
				lastUpdated: createdAt,
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
		(state, createdAt) => {
			return reconcileWorkspaceState(
				{
					...state,
					subscriptions: state.subscriptions.filter(
						(item) => item.id !== subscriptionId,
					),
					lastUpdated: createdAt,
				},
				createdAt,
			);
		},
	);
}

export function upsertAggregate(rule: AggregateRule): WorkspaceActionHandle {
	return runWorkspaceAction(
		"aggregate.upsert",
		(createdAt: string) => ({ aggregate: { ...rule, updatedAt: createdAt } }),
		(state, createdAt) => {
			const committedRule = { ...rule, updatedAt: createdAt };
			const index = state.aggregates.findIndex((item) => item.id === rule.id);
			if (index >= 0) {
				const aggregates = [...state.aggregates];
				aggregates[index] = committedRule;
				return { ...state, aggregates, lastUpdated: createdAt };
			}
			return {
				...state,
				aggregates: [committedRule, ...state.aggregates],
				lastUpdated: createdAt,
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
		(state, createdAt) => ({
			...state,
			aggregates: state.aggregates.filter((item) => item.id !== ruleId),
			publishTargets: state.publishTargets.filter(
				(target) => target.ruleId !== ruleId,
			),
			clientExports: state.clientExports.filter(
				(profile) => profile.ruleId !== ruleId,
			),
			lastUpdated: createdAt,
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
		(createdAt: string) => ({
			target: { ...requested, updatedAt: createdAt },
			...options,
		}),
		(state, createdAt) => {
			const committedTarget = { ...requested, updatedAt: createdAt };
			assertLocalOutputOwnerAvailable(state, {
				kind: "publish-target",
				id: committedTarget.id,
				fileName,
			});
			const index = state.publishTargets.findIndex(
				(item) => item.id === committedTarget.id,
			);
			if (index >= 0) {
				const existing = state.publishTargets[index];
				if (!existing) throw new Error("Publish target not found");
				const outputChanged =
					existing.fileName !== fileName ||
					existing.ruleId !== committedTarget.ruleId;
				let merged: AggregatePublishTarget = {
					...existing,
					...committedTarget,
					lastPublishedAt: existing.lastPublishedAt,
					lastPublishedUrl: existing.lastPublishedUrl,
					lastPublishTransitionAt: existing.lastPublishTransitionAt,
					lastPublishTransitionFromFileName:
						existing.lastPublishTransitionFromFileName,
					lastPublishTransitionToFileName:
						existing.lastPublishTransitionToFileName,
					lastPublishTransitionOutcome: existing.lastPublishTransitionOutcome,
					updatedAt: outputChanged ? createdAt : existing.updatedAt,
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
						lastPublishTransitionAt: createdAt,
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
				return { ...state, publishTargets, lastUpdated: createdAt };
			}
			return {
				...state,
				publishTargets: [committedTarget, ...state.publishTargets],
				lastUpdated: createdAt,
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
		(state, createdAt) => ({
			...state,
			publishTargets: state.publishTargets.filter(
				(item) => item.id !== targetId,
			),
			lastUpdated: createdAt,
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
		(createdAt: string) => ({
			profile: { ...requested, updatedAt: createdAt },
		}),
		(state, createdAt) => {
			const existing = state.clientExports.find(
				(item) => item.id === requested.id,
			);
			const outputChanged = Boolean(
				existing &&
					(existing.fileName !== requested.fileName ||
						existing.ruleId !== requested.ruleId ||
						JSON.stringify(existing.options) !==
							JSON.stringify(requested.options)),
			);
			const committedProfile = {
				...requested,
				lastGeneratedAt:
					existing && !outputChanged ? existing.lastGeneratedAt : null,
				lastPublishedAt:
					existing && !outputChanged ? existing.lastPublishedAt : null,
				lastPublishedUrl:
					existing && !outputChanged ? existing.lastPublishedUrl : null,
				updatedAt: createdAt,
			};
			assertLocalOutputOwnerAvailable(state, {
				kind: "client-export",
				id: committedProfile.id,
				fileName,
			});
			const index = state.clientExports.findIndex(
				(item) => item.id === committedProfile.id,
			);
			if (index >= 0) {
				const clientExports = [...state.clientExports];
				clientExports[index] = committedProfile;
				return { ...state, clientExports, lastUpdated: createdAt };
			}
			return {
				...state,
				clientExports: [committedProfile, ...state.clientExports],
				lastUpdated: createdAt,
			};
		},
	);
}

export function removeClientExport(profileId: string): WorkspaceActionHandle {
	return runDeferredWorkspaceAction(
		"client-export.delete",
		{ id: profileId },
		(state, createdAt) => ({
			...state,
			clientExports: state.clientExports.filter(
				(item) => item.id !== profileId,
			),
			lastUpdated: createdAt,
		}),
	);
}

export function replaceState(next: AppState): WorkspaceActionHandle {
	return runPreparedWorkspaceAction(
		"workspace.reconcile",
		(current, binding, createdAt) => {
			const state = {
				...defaultState,
				...next,
				activeGistId: current.activeGistId,
				activeGistFile: current.activeGistFile,
				lastUpdated: createdAt,
			};
			return {
				next: state,
				payload: {
					baselineRevision: binding?.revision ?? 0,
					data: getWorkspaceBusinessData(state),
				},
			};
		},
	);
}
