import { get } from "svelte/store";
import { getGistFileContent } from "$lib/gist";
import type { AppState, GistMeta } from "$lib/models";
import { getWorkspaceBusinessData, WORKSPACE_FILE } from "$lib/workspace-data";
import {
	getWorkspaceContentSignature,
	migrateWorkspaceDocumentV1ToV2,
	parseWorkspaceDocument,
	validateWorkspaceDocumentV2,
	WORKSPACE_BOOTSTRAP_FILE_NAME,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import {
	broadcastWorkspaceEvent,
	type WorkspaceEvent,
} from "$lib/workspace-events";
import { requireWorkspaceIdentity } from "$lib/workspace-identity";
import {
	parseWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import {
	rejectedWorkspaceOperation,
	type WorkspaceOperationResult,
} from "$lib/workspace-operation-result";
import {
	type BrowserWorkspacePersistence,
	WorkspaceConcurrentUpdateError,
	type WorkspaceMutationDraft,
	type WorkspacePersistenceRecord,
} from "$lib/workspace-persistence";
import {
	getBrowserWorkspacePersistence,
	initializeBrowserWorkspacePersistence,
	refreshBrowserWorkspacePersistence,
	refreshBrowserWorkspacePersistenceAfterDurableCommit,
} from "$lib/workspace-persistence-browser";
import {
	dispatchPersistedWorkspaceMutation,
	type WorkspacePersistenceDispatchResult,
} from "$lib/workspace-persistence-dispatcher";
import { deriveWorkspaceQueueMetrics } from "$lib/workspace-queue-metrics";
import {
	dispatchWorkspaceSyncEvent,
	type WorkspaceBlockedMutation,
	type WorkspaceSyncError,
	type WorkspaceSyncEvent,
} from "$lib/workspace-sync-status";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	type WorkspaceV2LocalState,
} from "$lib/workspace-v2-state";

export type BrowserWorkspaceSnapshot = {
	origin: "v1" | "v2" | "bootstrap";
	document: WorkspaceDocumentV2;
	state: AppState;
};

type BrowserWorkspaceSessionDependencies = {
	persistence?: BrowserWorkspacePersistence;
	getState?: () => AppState;
	setState?: (state: AppState) => void;
	fetchImpl?: typeof fetch;
	mutationId?: () => string;
	now?: () => string;
	allowManual?: boolean;
	broadcast?: (event: WorkspaceEvent) => void;
	dispatchSyncEvent?: (event: WorkspaceSyncEvent) => boolean;
};

function broadcast(
	dependencies: BrowserWorkspaceSessionDependencies,
	event: WorkspaceEvent,
): void {
	(dependencies.broadcast ?? broadcastWorkspaceEvent)(event);
}

function dispatchSyncEvent(
	dependencies: BrowserWorkspaceSessionDependencies,
	event: WorkspaceSyncEvent,
): boolean {
	return (dependencies.dispatchSyncEvent ?? dispatchWorkspaceSyncEvent)(event);
}

async function withStateAccess(
	dependencies: BrowserWorkspaceSessionDependencies,
): Promise<BrowserWorkspaceSessionDependencies> {
	if (dependencies.getState && dependencies.setState) return dependencies;
	const { appState } = await import("$lib/stores/app");
	return {
		...dependencies,
		getState: dependencies.getState ?? (() => get(appState)),
		setState: dependencies.setState ?? ((state) => appState.set(state)),
	};
}

function currentState(
	dependencies: BrowserWorkspaceSessionDependencies,
): AppState {
	if (!dependencies.getState) throw new Error("Workspace state is unavailable");
	return dependencies.getState();
}

function publishState(
	dependencies: BrowserWorkspaceSessionDependencies,
	state: AppState,
): void {
	if (!dependencies.setState) throw new Error("Workspace state is unavailable");
	dependencies.setState(state);
}

async function persistenceFor(
	dependencies: BrowserWorkspaceSessionDependencies,
): Promise<BrowserWorkspacePersistence> {
	if (dependencies.persistence) return dependencies.persistence;
	await initializeBrowserWorkspacePersistence();
	return getBrowserWorkspacePersistence();
}

async function readPersistence(
	dependencies: BrowserWorkspaceSessionDependencies,
	persistence: BrowserWorkspacePersistence,
): Promise<WorkspacePersistenceRecord> {
	return dependencies.persistence
		? persistence.read()
		: refreshBrowserWorkspacePersistence();
}

async function hydrateAfterDurableCommit(
	dependencies: BrowserWorkspaceSessionDependencies,
	persistence: BrowserWorkspacePersistence,
): Promise<WorkspacePersistenceRecord | null> {
	const record = dependencies.persistence
		? await persistence.read().catch(() => null)
		: await refreshBrowserWorkspacePersistenceAfterDurableCommit();
	if (record?.snapshot) {
		try {
			publishState(dependencies, record.snapshot);
		} catch {
			return null;
		}
	}
	return record;
}

function persistedMutation(
	record: WorkspacePersistenceRecord,
	mutationId: string,
): { workspaceId: string; mutation: WorkspaceMutation } | null {
	for (const queue of Object.values(record.workspaces)) {
		const mutation = queue.mutations.find(
			(candidate) => candidate.mutationId === mutationId,
		);
		if (mutation) return { workspaceId: queue.workspaceId, mutation };
	}
	return null;
}

function uncertainOperation(
	mutationId: string | null,
	dependencies: BrowserWorkspaceSessionDependencies,
	code: string,
): WorkspaceOperationResult {
	return {
		status: "commit-acknowledgement-uncertain",
		durable: "uncertain",
		mutationId,
		state: currentState(dependencies),
		code,
	};
}

function persistedBlockedMutation(
	record: WorkspacePersistenceRecord,
): WorkspaceBlockedMutation | null {
	const activeQueue = record.binding
		? record.workspaces[record.binding.workspaceId]
		: undefined;
	const blocked = activeQueue?.delivery.blocked;
	return blocked
		? {
				mutationId: blocked.mutationId,
				kind: blocked.kind,
				code: blocked.code,
				disposition: blocked.disposition,
				message: blocked.messageKey ?? blocked.code,
			}
		: null;
}

function reportPersistedSyncContext(
	record: WorkspacePersistenceRecord,
	authenticated: boolean,
	dependencies: BrowserWorkspaceSessionDependencies,
): void {
	dispatchSyncEvent(dependencies, {
		type: "SYNC_CONTEXT_LOADED",
		mode: record.binding?.syncMode ?? "disconnected",
		authenticated,
		revision: record.binding?.revision ?? null,
		queue: deriveWorkspaceQueueMetrics(record),
		blockedMutation: persistedBlockedMutation(record),
	});
}

function reportDeliveryFailure(
	result: Exclude<WorkspacePersistenceDispatchResult, { status: "committed" }>,
	record: WorkspacePersistenceRecord,
	mutation: WorkspaceMutation,
	dependencies: BrowserWorkspaceSessionDependencies,
): void {
	const queue = deriveWorkspaceQueueMetrics(record);
	const activeQueue = record.binding
		? record.workspaces[record.binding.workspaceId]
		: undefined;
	const blockedMutation = persistedBlockedMutation(record);
	const disposition =
		blockedMutation?.disposition ??
		(result.status === "deferred" ||
		activeQueue?.delivery.retry.nextAttemptAt != null
			? "retryable-upstream"
			: null) ??
		(result.status === "conflict" ||
		result.status === "retryable-error" ||
		result.status === "permanent-error"
			? result.disposition
			: null);
	const code =
		blockedMutation?.code ??
		activeQueue?.delivery.retry.lastErrorCode ??
		("code" in result && result.code
			? result.code
			: disposition === "retryable-upstream"
				? "workspace_sync_retry"
				: "workspace_sync_failed");
	const error: WorkspaceSyncError = {
		code,
		message: blockedMutation?.message ?? code,
		disposition: disposition ?? "operator-repair",
	};

	if (disposition === "retryable-upstream") {
		const retry = activeQueue?.delivery.retry;
		const nextAttemptAt =
			retry?.nextAttemptAt ??
			(result.status === "deferred" ? result.nextAttemptAt : Date.now());
		dispatchSyncEvent(dependencies, {
			type: "SYNC_STARTED",
			trigger: "explicit",
			queue,
			mutation: {
				mutationId: mutation.mutationId,
				kind: mutation.kind,
			},
		});
		dispatchSyncEvent(dependencies, {
			type: "SYNC_RETRY_SCHEDULED",
			queue,
			error,
			blockedMutation,
			retry: {
				attempt: Math.max(1, retry?.attempt ?? 1),
				nextAttemptAt,
				retryAfterMs: Math.max(0, nextAttemptAt - Date.now()),
				lastErrorCode: retry?.lastErrorCode ?? code,
			},
		});
		broadcastQueueChanged(record, mutation, dependencies);
		return;
	}
	if (disposition === "state-conflict") {
		dispatchSyncEvent(dependencies, {
			type: "STATE_CONFLICT",
			queue,
			error,
			blockedMutation,
		});
		if (record.binding) {
			broadcast(dependencies, {
				type: "paused-conflict",
				gistId: record.binding.gistId,
				fileName: record.binding.fileName,
				mutationId: mutation.mutationId,
				document: record.binding.baseline ?? undefined,
			});
		}
		return;
	}
	if (disposition === "domain-conflict") {
		dispatchSyncEvent(dependencies, {
			type: "DOMAIN_BLOCKED",
			queue,
			error,
			blockedMutation,
		});
		broadcastQueueChanged(record, mutation, dependencies);
		return;
	}
	if (disposition === "auth-required") {
		dispatchSyncEvent(dependencies, { type: "AUTH_LOST", queue, error });
		broadcastQueueChanged(record, mutation, dependencies);
		return;
	}
	if (disposition === "queue-corruption") {
		dispatchSyncEvent(dependencies, {
			type: "QUEUE_CORRUPTED",
			queue,
			error,
			blockedMutation,
		});
		broadcastQueueChanged(record, mutation, dependencies);
		return;
	}
	dispatchSyncEvent(dependencies, {
		type: "OPERATOR_REPAIR_REQUIRED",
		queue,
		error,
		blockedMutation,
	});
	broadcastQueueChanged(record, mutation, dependencies);
}

function broadcastQueueChanged(
	record: WorkspacePersistenceRecord,
	mutation: WorkspaceMutation,
	dependencies: BrowserWorkspaceSessionDependencies,
): void {
	const binding = record.binding;
	if (!binding) return;
	broadcast(dependencies, {
		type: "mutation-queue-changed",
		gistId: binding.gistId,
		fileName: binding.fileName,
		mutationId: mutation.mutationId,
	});
}

function emptyDocument(gistId: string, now: string): WorkspaceDocumentV2 {
	return validateWorkspaceDocumentV2({
		version: 2,
		schemaVersion: 2,
		workspaceId: `gist:${gistId}`,
		revision: 0,
		updatedAt: now,
		lastMutationId: null,
		data: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	});
}

function mutationDraft(
	binding: WorkspaceV2LocalState,
	kind: WorkspaceMutation["kind"],
	payload: unknown,
	dependencies: BrowserWorkspaceSessionDependencies,
): WorkspaceMutationDraft {
	const mutation = parseWorkspaceMutation({
		mutationId: dependencies.mutationId
			? dependencies.mutationId()
			: crypto.randomUUID(),
		workspaceId: binding.workspaceId,
		expectedRevision: binding.revision ?? 0,
		source: "browser",
		createdAt: (dependencies.now ?? (() => new Date().toISOString()))(),
		kind,
		payload,
	});
	const { expectedRevision: _allocatedByPersistence, ...draft } = mutation;
	return draft;
}

async function dispatchUntilMutationSettles(
	mutationId: string,
	token: string,
	dependencies: BrowserWorkspaceSessionDependencies,
	persistence: BrowserWorkspacePersistence,
	_prefix: string,
): Promise<WorkspaceOperationResult> {
	while (true) {
		let before: WorkspacePersistenceRecord;
		try {
			before = await readPersistence(dependencies, persistence);
		} catch {
			return uncertainOperation(
				mutationId,
				dependencies,
				"workspace_settlement_read_failed",
			);
		}
		const persistedTarget = persistedMutation(before, mutationId);
		const deadLetter = Object.values(before.workspaces)
			.flatMap((queue) => queue.delivery.deadLetters)
			.find((entry) => entry.mutationId === mutationId);
		const binding = before.binding;
		if (!binding) {
			const state = before.snapshot ?? currentState(dependencies);
			if (deadLetter) {
				return {
					status: "conflict-or-blocked",
					durable: true,
					mutationId,
					state,
					code: deadLetter.code,
					disposition: deadLetter.disposition,
					messageKey: deadLetter.messageKey,
				};
			}
			return persistedTarget
				? {
						status: "peer-owned",
						durable: true,
						mutationId,
						state,
					}
				: uncertainOperation(
						mutationId,
						dependencies,
						"workspace_binding_unavailable",
					);
		}
		if (!persistedTarget) {
			if (before.snapshot) {
				try {
					publishState(dependencies, before.snapshot);
				} catch {
					return uncertainOperation(
						mutationId,
						dependencies,
						"workspace_state_hydration_failed",
					);
				}
			}
			const state = before.snapshot ?? currentState(dependencies);
			if (deadLetter) {
				return {
					status: "conflict-or-blocked",
					durable: true,
					mutationId,
					state,
					code: deadLetter.code,
					disposition: deadLetter.disposition,
					messageKey: deadLetter.messageKey,
				};
			}
			if (
				binding.baseline?.lastMutationId === mutationId &&
				binding.revision === binding.baseline.revision
			) {
				return {
					status: "remote-committed",
					durable: true,
					mutationId,
					state,
					revision: binding.revision,
				};
			}
			return {
				status: "commit-acknowledgement-uncertain",
				durable: "uncertain",
				mutationId,
				state,
				code: "mutation_settlement_unproven",
			};
		}
		if (persistedTarget.workspaceId !== binding.workspaceId) {
			return {
				status: "peer-owned",
				durable: true,
				mutationId,
				state: before.snapshot ?? currentState(dependencies),
			};
		}
		const pending = before.workspaces[binding.workspaceId]?.mutations ?? [];
		const mutation = pending[0];
		if (!mutation) {
			return uncertainOperation(
				mutationId,
				dependencies,
				"workspace_queue_unavailable",
			);
		}
		let result: WorkspacePersistenceDispatchResult;
		try {
			result = await dispatchPersistedWorkspaceMutation({
				persistence,
				githubToken: token,
				allowManual: true,
				fetchImpl: dependencies.fetchImpl,
			});
		} catch {
			return uncertainOperation(
				mutationId,
				dependencies,
				"workspace_delivery_acknowledgement_failed",
			);
		}
		const after = await hydrateAfterDurableCommit(dependencies, persistence);
		if (!after) {
			return uncertainOperation(
				mutationId,
				dependencies,
				"workspace_post_delivery_read_failed",
			);
		}
		reportPersistedSyncContext(after, Boolean(token), dependencies);
		const stillPending = persistedMutation(after, mutationId) !== null;
		if (result.status === "committed") {
			if (after.binding) {
				try {
					broadcast(dependencies, {
						type: "workspace-v2-committed",
						gistId: after.binding.gistId,
						fileName: after.binding.fileName,
						mutationId: mutation.mutationId,
						document: after.binding.baseline ?? undefined,
						status: "committed",
					});
				} catch {
					// Broadcast is only a peer wake-up hint.
				}
			}
			if (!stillPending) {
				const state = after.snapshot ?? currentState(dependencies);
				return {
					status: "remote-committed",
					durable: true,
					mutationId,
					state,
					revision: after.binding?.revision ?? mutation.expectedRevision + 1,
				};
			}
			continue;
		}
		if (result.status === "busy" || result.status === "stale") {
			if (!stillPending) continue;
			return {
				status: "peer-owned",
				durable: true,
				mutationId,
				state: after.snapshot ?? currentState(dependencies),
			};
		}
		if (result.status === "empty" && !stillPending) {
			continue;
		}
		reportDeliveryFailure(result, after, mutation, dependencies);
		const state = after.snapshot ?? currentState(dependencies);
		const activeQueue = after.binding
			? after.workspaces[after.binding.workspaceId]
			: undefined;
		const retry = activeQueue?.delivery.retry;
		if (
			result.status === "deferred" ||
			result.status === "retryable-error" ||
			("disposition" in result && result.disposition === "retryable-upstream")
		) {
			return {
				status: "retry-scheduled",
				durable: true,
				mutationId,
				state,
				attempt: Math.max(1, retry?.attempt ?? 1),
				nextAttemptAt:
					retry?.nextAttemptAt ??
					(result.status === "deferred" ? result.nextAttemptAt : Date.now()),
				lastErrorCode:
					retry?.lastErrorCode ??
					(result.status === "retryable-error"
						? (result.code ?? "workspace_sync_retry")
						: "workspace_sync_retry"),
			};
		}
		const blocked = activeQueue?.delivery.blocked;
		if (blocked) {
			return {
				status: "conflict-or-blocked",
				durable: true,
				mutationId: blocked.mutationId,
				state,
				code: blocked.code,
				disposition: blocked.disposition,
				messageKey: blocked.messageKey,
			};
		}
		if (
			(result.status === "conflict" || result.status === "permanent-error") &&
			result.disposition !== "retryable-upstream"
		) {
			return {
				status: "conflict-or-blocked",
				durable: true,
				mutationId,
				state,
				code: result.code ?? "workspace_sync_failed",
				disposition: result.disposition,
				messageKey: null,
			};
		}
		return {
			status: "conflict-or-blocked",
			durable: true,
			mutationId,
			state,
			code: "workspace_sync_blocked",
			disposition: "operator-repair",
			messageKey: null,
		};
	}
}

export async function readBrowserWorkspaceSnapshot(
	token: string,
	gist: GistMeta,
	current: AppState,
	options: {
		readContent?: typeof getGistFileContent;
		now?: () => string;
	} = {},
): Promise<BrowserWorkspaceSnapshot> {
	const readContent = options.readContent ?? getGistFileContent;
	const hasWorkspaceFile = gist.files.some(
		(file) => file.filename === WORKSPACE_FILE,
	);
	let origin: BrowserWorkspaceSnapshot["origin"];
	let document: WorkspaceDocumentV2;
	if (hasWorkspaceFile) {
		const parsed = parseWorkspaceDocument(
			await readContent(token, gist.id, WORKSPACE_FILE),
			{ expectedWorkspaceId: `gist:${gist.id}` },
		);
		if (parsed.schemaVersion === 2) {
			origin = "v2";
			document = parsed.document;
		} else {
			origin = "v1";
			document = migrateWorkspaceDocumentV1ToV2(parsed.document, {
				gistId: gist.id,
				now: (options.now ?? (() => new Date().toISOString()))(),
			}).document;
		}
	} else if (
		gist.files.some((file) => file.filename === WORKSPACE_BOOTSTRAP_FILE_NAME)
	) {
		origin = "bootstrap";
		document = emptyDocument(
			gist.id,
			(options.now ?? (() => new Date().toISOString()))(),
		);
	} else {
		throw new Error("Workspace configuration was not found");
	}
	return {
		origin,
		document,
		state: hydrateAppStateFromWorkspaceDocument(current, document, gist.id),
	};
}

export async function persistBrowserWorkspaceSnapshot(
	snapshot: BrowserWorkspaceSnapshot,
	gistId: string,
	syncMode: WorkspaceV2LocalState["syncMode"],
	dependencies: BrowserWorkspaceSessionDependencies = {},
): Promise<AppState> {
	dependencies = await withStateAccess(dependencies);
	const persistence = await persistenceFor(dependencies);
	const record = await readPersistence(dependencies, persistence);
	const binding = createWorkspaceV2LocalState(gistId, {
		baseline: snapshot.document,
		syncMode,
	});
	const state = hydrateAppStateFromWorkspaceDocument(
		currentState(dependencies),
		snapshot.document,
		gistId,
	);
	if (record.binding?.workspaceId === binding.workspaceId) {
		await persistence.discardWorkspaceQueue({
			workspaceId: binding.workspaceId,
			snapshot: state,
			binding,
		});
	} else {
		await persistence.rebindWorkspace({ snapshot: state, binding });
	}
	publishState(dependencies, state);
	await readPersistence(dependencies, persistence);
	return state;
}

async function reconcileBrowserWorkspaceInternal(
	input: {
		token: string;
		gistId: string;
		baseline: WorkspaceDocumentV2;
		resolvedState: AppState;
		syncMode: Exclude<WorkspaceV2LocalState["syncMode"], "paused-conflict">;
		replacePending?: boolean;
	},
	dependencies: BrowserWorkspaceSessionDependencies = {},
): Promise<WorkspaceOperationResult> {
	dependencies = await withStateAccess(dependencies);
	const persistence = await persistenceFor(dependencies);
	const workspaceId = `gist:${input.gistId}`;
	let baseline = validateWorkspaceDocumentV2(input.baseline, {
		expectedWorkspaceId: workspaceId,
	});
	let record = await readPersistence(dependencies, persistence);
	let pending = record.workspaces[workspaceId]?.mutations ?? [];

	if (pending.length > 0 && !input.replacePending) {
		if (record.binding?.workspaceId !== workspaceId) {
			throw new Error("Pending Workspace queue is not active");
		}
		const lastPendingId = pending.at(-1)?.mutationId;
		if (!lastPendingId)
			throw new Error("Pending Workspace queue is unavailable");
		const pendingResult = await dispatchUntilMutationSettles(
			lastPendingId,
			input.token,
			dependencies,
			persistence,
			"Pending Workspace delivery failed",
		);
		if (pendingResult.status !== "remote-committed") return pendingResult;
		const refreshed = await hydrateAfterDurableCommit(
			dependencies,
			persistence,
		);
		if (!refreshed) {
			return uncertainOperation(
				lastPendingId,
				dependencies,
				"workspace_post_delivery_read_failed",
			);
		}
		record = refreshed;
		const committed = record.binding;
		if (!committed?.baseline || committed.workspaceId !== workspaceId) {
			throw new Error("Committed Workspace state is unavailable");
		}
		baseline = committed.baseline;
		pending = record.workspaces[workspaceId]?.mutations ?? [];
		if (pending.length > 0) {
			throw new Error("Pending Workspace delivery did not settle");
		}
		if (
			getWorkspaceContentSignature(baseline) ===
			getWorkspaceContentSignature({
				...baseline,
				data: getWorkspaceBusinessData(input.resolvedState),
			})
		) {
			const binding = createWorkspaceV2LocalState(input.gistId, {
				baseline,
				syncMode: input.syncMode,
			});
			const state = hydrateAppStateFromWorkspaceDocument(
				input.resolvedState,
				baseline,
				input.gistId,
			);
			let rebindError: unknown = null;
			try {
				await persistence.rebindWorkspace({ snapshot: state, binding });
			} catch (error) {
				rebindError = error;
			}
			const rebound = await hydrateAfterDurableCommit(
				dependencies,
				persistence,
			);
			if (!rebound) {
				return uncertainOperation(
					baseline.lastMutationId,
					dependencies,
					"workspace_rebind_acknowledgement_failed",
				);
			}
			if (
				rebound.binding?.workspaceId !== binding.workspaceId ||
				rebound.binding.revision !== binding.revision ||
				getWorkspaceContentSignature(rebound.binding.baseline ?? baseline) !==
					getWorkspaceContentSignature(baseline)
			) {
				return rebindError
					? rejectedWorkspaceOperation(rebindError, baseline.lastMutationId)
					: uncertainOperation(
							baseline.lastMutationId,
							dependencies,
							"workspace_rebind_settlement_unproven",
						);
			}
			return {
				status: "remote-committed",
				durable: true,
				mutationId: baseline.lastMutationId,
				state,
				revision: baseline.revision,
			};
		}
	}

	const binding = createWorkspaceV2LocalState(input.gistId, {
		baseline,
		syncMode: input.syncMode,
	});
	const resolvedState: AppState = {
		...input.resolvedState,
		activeGistId: input.gistId,
		activeGistFile: WORKSPACE_FILE,
	};
	const draft = mutationDraft(
		binding,
		"workspace.reconcile",
		{
			baselineRevision: baseline.revision,
			data: getWorkspaceBusinessData(resolvedState),
		},
		dependencies,
	);
	const state = { ...resolvedState, lastUpdated: draft.createdAt };
	const mutation = parseWorkspaceMutation({
		...draft,
		expectedRevision: baseline.revision,
	});
	let repairError: unknown = null;
	try {
		await persistence.repairWorkspaceQueue({
			snapshot: state,
			binding,
			mutations: [mutation],
			expected: {
				snapshot: record.snapshot,
				binding: record.binding,
				queue: record.workspaces[workspaceId] ?? null,
			},
		});
	} catch (error) {
		repairError = error;
	}
	const repaired = await hydrateAfterDurableCommit(dependencies, persistence);
	if (!repaired) {
		return uncertainOperation(
			mutation.mutationId,
			dependencies,
			"workspace_reconcile_acknowledgement_failed",
		);
	}
	if (!persistedMutation(repaired, mutation.mutationId)) {
		return repairError
			? rejectedWorkspaceOperation(repairError, mutation.mutationId)
			: uncertainOperation(
					mutation.mutationId,
					dependencies,
					"workspace_reconcile_settlement_unproven",
				);
	}
	return dispatchUntilMutationSettles(
		mutation.mutationId,
		input.token,
		dependencies,
		persistence,
		"Workspace reconciliation failed",
	);
}

export async function reconcileBrowserWorkspace(
	input: {
		token: string;
		gistId: string;
		baseline: WorkspaceDocumentV2;
		resolvedState: AppState;
		syncMode: Exclude<WorkspaceV2LocalState["syncMode"], "paused-conflict">;
		replacePending?: boolean;
	},
	dependencies: BrowserWorkspaceSessionDependencies = {},
): Promise<WorkspaceOperationResult> {
	try {
		return await reconcileBrowserWorkspaceInternal(input, dependencies);
	} catch (error) {
		return rejectedWorkspaceOperation(error);
	}
}

export async function submitBrowserWorkspaceMutation(
	input: {
		token: string;
		kind: WorkspaceMutation["kind"];
		payload: unknown;
	},
	dependencies: BrowserWorkspaceSessionDependencies = {},
): Promise<WorkspaceOperationResult> {
	let mutationId: string | null = null;
	try {
		dependencies = await withStateAccess(dependencies);
		const persistence = await persistenceFor(dependencies);
		mutationId = dependencies.mutationId
			? dependencies.mutationId()
			: crypto.randomUUID();
		const createdAt = (dependencies.now ?? (() => new Date().toISOString()))();
		let workspaceId: string | null = null;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const record = await readPersistence(dependencies, persistence);
			const binding = record.binding;
			if (!binding || binding.revision === null || binding.baseline === null) {
				return rejectedWorkspaceOperation(
					new Error("Workspace V2 is not initialized"),
					mutationId,
				);
			}
			workspaceId ??= binding.workspaceId;
			if (binding.workspaceId !== workspaceId) {
				return rejectedWorkspaceOperation(
					new WorkspaceConcurrentUpdateError(),
					mutationId,
				);
			}
			requireWorkspaceIdentity(currentState(dependencies), binding);
			if (binding.syncMode === "paused-conflict") {
				return rejectedWorkspaceOperation(
					new Error("Workspace synchronization is paused by a conflict"),
					mutationId,
				);
			}
			if (binding.syncMode === "manual" && !dependencies.allowManual) {
				return rejectedWorkspaceOperation(
					new Error("Push local Workspace changes before publishing"),
					mutationId,
				);
			}
			const parsed = parseWorkspaceMutation({
				mutationId,
				workspaceId: binding.workspaceId,
				expectedRevision: binding.revision,
				source: "browser",
				createdAt,
				kind: input.kind,
				payload: input.payload,
			});
			const { expectedRevision: _allocatedByPersistence, ...draft } = parsed;
			try {
				await persistence.commitExplicitAction({ binding, mutation: draft });
			} catch (error) {
				const recovered = await hydrateAfterDurableCommit(
					dependencies,
					persistence,
				);
				if (recovered && persistedMutation(recovered, mutationId)) break;
				if (!recovered) {
					return uncertainOperation(
						mutationId,
						dependencies,
						"workspace_explicit_commit_acknowledgement_failed",
					);
				}
				if (error instanceof WorkspaceConcurrentUpdateError && attempt === 0) {
					continue;
				}
				return rejectedWorkspaceOperation(error, mutationId);
			}
			break;
		}
		return dispatchUntilMutationSettles(
			mutationId,
			input.token,
			dependencies,
			persistence,
			"Workspace mutation failed",
		);
	} catch (error) {
		return rejectedWorkspaceOperation(error, mutationId);
	}
}

export async function commitQueuedBrowserWorkspaceMutation(
	input: { token: string; mutationId: string },
	dependencies: BrowserWorkspaceSessionDependencies = {},
): Promise<WorkspaceOperationResult> {
	try {
		dependencies = await withStateAccess(dependencies);
		const persistence = await persistenceFor(dependencies);
		return dispatchUntilMutationSettles(
			input.mutationId,
			input.token,
			dependencies,
			persistence,
			"Workspace mutation failed",
		);
	} catch (error) {
		return rejectedWorkspaceOperation(error, input.mutationId);
	}
}
