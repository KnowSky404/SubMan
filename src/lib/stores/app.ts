import { get, writable } from "svelte/store";
import { browser } from "$app/environment";
import type {
	AggregatePublishTarget,
	AggregateRule,
	AppState,
	ClientExportProfile,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";
import { authState } from "$lib/stores/auth";
import { nowIso } from "$lib/utils/time";
import { workspaceCloudStatus } from "$lib/workspace-cloud-status";
import {
	createDefaultWorkspaceState,
	reconcileWorkspaceState,
} from "$lib/workspace-data";
import { validateWorkspaceOutputFileName } from "$lib/workspace-document";
import { checkWorkspaceIdentity } from "$lib/workspace-identity";
import {
	parseWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import {
	rejectedWorkspaceOperation,
	type WorkspaceOperationResult,
} from "$lib/workspace-operation-result";
import {
	getConflictingOutputOwners,
	isCurrentPublishTargetOutputPublished,
} from "$lib/workspace-output";
import {
	WorkspaceConcurrentUpdateError,
	type WorkspaceMutationDraft,
} from "$lib/workspace-persistence";
import {
	type BrowserWorkspaceCommitResult,
	commitBrowserWorkspaceAction,
	getBrowserWorkspaceBinding,
	initializeBrowserWorkspacePersistence,
	refreshBrowserWorkspacePersistence,
} from "$lib/workspace-persistence-browser";
import { dispatchWorkspaceSyncEvent } from "$lib/workspace-sync-status";
import type { WorkspaceV2LocalState } from "$lib/workspace-v2-state";

export const defaultState: AppState = createDefaultWorkspaceState(nowIso());
export const appState = writable<AppState>(defaultState);

export type WorkspaceActionResult = WorkspaceOperationResult;

export type WorkspaceActionHandle = {
	submitted: boolean;
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
	fallbackState: AppState,
): WorkspaceActionResult {
	const state = result.record?.snapshot ?? fallbackState;
	if (result.acknowledgement === "uncertain") {
		return {
			status: "commit-acknowledgement-uncertain",
			durable: "uncertain",
			mutationId: result.mutation?.mutationId ?? null,
			state,
			code: "workspace_commit_acknowledgement_uncertain",
		};
	}
	if (result.mutation) {
		try {
			dispatchWorkspaceSyncEvent({
				type: "MUTATION_ENQUEUED",
				queue: result.queue,
				mutation: {
					mutationId: result.mutation.mutationId,
					kind: result.mutation.kind,
				},
			});
		} catch {
			// The durable queue remains authoritative if status presentation fails.
		}
		return {
			status: "local-durable-queued",
			durable: true,
			mutationId: result.mutation.mutationId,
			state,
		};
	}
	return rejectedWorkspaceOperation(
		new Error("Cloud changes require a durable synchronization request"),
	);
}

function cloudActionError(code: string, message: string): Error {
	return Object.assign(new Error(message), { code });
}

function requireCloudAction(binding: WorkspaceV2LocalState | null): string {
	const token = get(authState).token;
	if (!browser || !token) {
		throw cloudActionError(
			"workspace_auth_required",
			"Connect GitHub before changing cloud data.",
		);
	}
	if (get(workspaceCloudStatus).phase !== "ready") {
		throw cloudActionError(
			"workspace_cloud_not_ready",
			"Load the latest cloud data before editing.",
		);
	}
	if (!binding || binding.revision === null || !binding.baseline) {
		throw cloudActionError(
			"workspace_connection_required",
			"Connect a cloud Workspace before editing.",
		);
	}
	if (binding.syncMode !== "automatic") {
		throw cloudActionError(
			"workspace_sync_required",
			"Refresh cloud synchronization before editing.",
		);
	}
	return token;
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
		const binding = getBrowserWorkspaceBinding();
		requireCloudAction(binding);
		const preliminary = prepare(get(appState), binding, VALIDATION_TIMESTAMP);
		createMutationDraft(kind, preliminary.payload, binding);
	} catch (error) {
		return rejectedActionHandle(error);
	}

	const completion = serializedAction(
		async (): Promise<WorkspaceActionResult> => {
			const mutationId = crypto.randomUUID();
			const createdAt = nowIso();
			try {
				await initializeAppStatePersistence();
				for (let attempt = 0; attempt < 2; attempt += 1) {
					const record = await refreshBrowserWorkspacePersistence();
					const current = record.snapshot ?? get(appState);
					if (record.snapshot) appState.set(record.snapshot);
					const binding = record.binding;
					const token = requireCloudAction(binding);
					const queue = binding ? record.workspaces[binding.workspaceId] : null;
					if (
						queue &&
						(queue.mutations.length > 0 ||
							queue.delivery.blocked ||
							queue.delivery.deadLetters.length > 0)
					) {
						throw cloudActionError(
							"workspace_sync_pending",
							"Wait for the pending cloud change to synchronize before editing again.",
						);
					}
					if (checkWorkspaceIdentity(current, binding).status === "mismatch") {
						throw new Error("Workspace identity requires repair");
					}
					const prepared = prepare(current, binding, createdAt);
					const next = { ...prepared.next, lastUpdated: createdAt };
					const validatedDraft = createMutationDraft(
						kind,
						prepared.payload,
						binding,
						{ mutationId, createdAt },
					);
					try {
						const committed = await commitBrowserWorkspaceAction({
							snapshot: next,
							mutation: validatedDraft,
						});
						const result = resultForCommit(committed, next);
						try {
							appState.set(committed.record?.snapshot ?? next);
						} catch {
							return {
								status: "commit-acknowledgement-uncertain",
								durable: "uncertain",
								mutationId,
								state: committed.record?.snapshot ?? next,
								code: "workspace_state_hydration_failed",
							};
						}
						if (result.status !== "local-durable-queued") return result;
						try {
							const { commitQueuedBrowserWorkspaceMutation } = await import(
								"$lib/workspace-browser-session-v2"
							);
							if (get(authState).token !== token) return result;
							const delivery = await commitQueuedBrowserWorkspaceMutation({
								token,
								mutationId: result.mutationId,
							});
							return delivery.status === "rejected-before-durable-commit"
								? result
								: delivery;
						} catch {
							return result;
						}
					} catch (error) {
						if (
							!(error instanceof WorkspaceConcurrentUpdateError) ||
							attempt > 0
						) {
							throw error;
						}
					}
				}
				throw new WorkspaceConcurrentUpdateError();
			} catch (error) {
				return rejectedWorkspaceOperation(error, mutationId);
			}
		},
	);
	return { submitted: true, completion };
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
		submitted: false,
		completion: Promise.resolve(rejectedWorkspaceOperation(error)),
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
