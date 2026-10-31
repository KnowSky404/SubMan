import type { AppState } from "$lib/models";
import { getSyncStateSignature } from "$lib/serialization";
import {
	type BrowserWorkspaceSnapshot,
	migrateBrowserWorkspace,
	persistBrowserWorkspaceSnapshot,
	reconcileBrowserWorkspace,
} from "$lib/workspace-browser-session-v2";
import { getWorkspaceBusinessData, WORKSPACE_FILE } from "$lib/workspace-data";
import { exportWorkspaceDiagnosticsFromPersistence } from "$lib/workspace-diagnostics";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import { broadcastWorkspaceEvent } from "$lib/workspace-events";
import {
	requireWorkspaceIdentity,
	withWorkspaceBinding,
} from "$lib/workspace-identity";
import {
	mergeWorkspaceData,
	projectLocalWorkspaceAgainstTombstones,
	type WorkspaceMergeNotice,
} from "$lib/workspace-merge";
import { parseWorkspaceMutation } from "$lib/workspace-mutation";
import type { WorkspaceOperationResult } from "$lib/workspace-operation-result";
import {
	type BrowserWorkspacePersistence,
	inspectWorkspacePersistenceRecord,
	WorkspaceBindingLockedError,
	WorkspaceConcurrentUpdateError,
	type WorkspacePersistenceRecord,
	type WorkspaceQueueInspection,
	type WorkspaceResetExpectation,
} from "$lib/workspace-persistence";
import {
	getBrowserWorkspacePersistence,
	initializeBrowserWorkspacePersistence,
	refreshBrowserWorkspacePersistence,
	resetBrowserWorkspacePersistence,
} from "$lib/workspace-persistence-browser";
import {
	discardInspectedWorkspaceQueue,
	rebindInspectedWorkspace,
	refreshWorkspaceQueueInspection,
} from "$lib/workspace-queue-inspector";
import { deriveWorkspaceQueueMetrics } from "$lib/workspace-queue-metrics";
import { bindWorkspaceOnly } from "$lib/workspace-session";
import { dispatchWorkspaceSyncEvent } from "$lib/workspace-sync-status";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	type WorkspaceV2LocalState,
} from "$lib/workspace-v2-state";

export type WorkspaceSettingsConflict = {
	gistId: string;
	remoteDocument: WorkspaceDocumentV2;
	remoteState: AppState;
	remoteSignature: string;
	localSignature: string;
};

export type WorkspaceSettingsView = {
	record: WorkspacePersistenceRecord;
	inspection: WorkspaceQueueInspection;
};

export type WorkspaceManualPullDecision =
	| { status: "already-synced" }
	| { status: "confirm-pull" };

export type WorkspaceManualPushDecision =
	| { status: "already-synced" }
	| { status: "confirm-push" }
	| { status: "needs-review"; conflict: WorkspaceSettingsConflict };

export type WorkspaceRepairDecision =
	| { status: "domain-blocked" }
	| { status: "already-synced"; clearMetadata: boolean }
	| { status: "state-conflict" };

type ControllerDependencies = {
	getState: () => AppState;
	setState: (state: AppState) => void;
	persistence?: BrowserWorkspacePersistence;
	fetchImpl?: typeof fetch;
	dispatchSyncEvent?: typeof dispatchWorkspaceSyncEvent;
};

type ConflictResolution =
	| {
			status: "resolved";
			notices: WorkspaceMergeNotice[];
			operation: WorkspaceOperationResult | null;
	  }
	| { status: "needs-choice"; notices: WorkspaceMergeNotice[] };

export function createWorkspaceSettingsController(
	dependencies: ControllerDependencies,
) {
	let view: WorkspaceSettingsView | null = null;
	const dispatch = dependencies.dispatchSyncEvent ?? dispatchWorkspaceSyncEvent;

	function persistence(): BrowserWorkspacePersistence {
		return dependencies.persistence ?? getBrowserWorkspacePersistence();
	}

	function sessionDependencies() {
		return {
			...(dependencies.persistence
				? { persistence: dependencies.persistence }
				: {}),
			getState: dependencies.getState,
			setState: dependencies.setState,
			...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
		};
	}

	async function readRecord(): Promise<WorkspacePersistenceRecord> {
		return dependencies.persistence
			? dependencies.persistence.read()
			: refreshBrowserWorkspacePersistence();
	}

	async function refresh(): Promise<WorkspaceSettingsView> {
		const record = await readRecord();
		const inspection = await refreshWorkspaceQueueInspection(persistence());
		view = { record, inspection };
		return view;
	}

	function resetExpectation(
		record: WorkspacePersistenceRecord,
	): WorkspaceResetExpectation {
		const workspaceId =
			record.binding?.workspaceId ??
			(record.snapshot?.activeGistId
				? `gist:${record.snapshot.activeGistId}`
				: null);
		return structuredClone({
			snapshot: record.snapshot,
			binding: record.binding,
			queue: workspaceId ? (record.workspaces[workspaceId] ?? null) : null,
		});
	}

	function requireExpectedRecord(
		record: WorkspacePersistenceRecord,
		expected: WorkspaceResetExpectation,
	): void {
		if (JSON.stringify(resetExpectation(record)) !== JSON.stringify(expected)) {
			throw new WorkspaceConcurrentUpdateError();
		}
	}

	async function prepareDeviceReset(): Promise<WorkspaceResetExpectation> {
		return resetExpectation(await readRecord());
	}

	async function resetDevice(
		expected: WorkspaceResetExpectation,
	): Promise<WorkspaceSettingsView> {
		const record = dependencies.persistence
			? await dependencies.persistence.resetWorkspace({ expected })
			: await resetBrowserWorkspacePersistence(expected);
		view = { record, inspection: inspectWorkspacePersistenceRecord(record) };
		try {
			if (record.snapshot) dependencies.setState(record.snapshot);
		} catch {
			// Hydration failure cannot undo the committed reset.
		}
		try {
			dispatch({
				type: "WORKSPACE_DISCONNECTED",
				queue: deriveWorkspaceQueueMetrics(record),
			});
		} catch {
			// Presentation failure cannot turn the reset into a rejected transaction.
		}
		try {
			broadcastWorkspaceEvent({
				type: "device-reset",
				gistId: null,
				fileName: null,
			});
		} catch {
			// The committed record remains authoritative when peer notification fails.
		}
		return structuredClone(view);
	}

	async function requireBoundWorkspace(
		gistId: string,
	): Promise<WorkspaceSettingsView> {
		const current = await refresh();
		if (
			current.record.binding &&
			current.record.binding.workspaceId !== `gist:${gistId}`
		) {
			throw new WorkspaceBindingLockedError();
		}
		return current;
	}

	async function initialize(): Promise<WorkspaceSettingsView> {
		if (dependencies.persistence) {
			return refresh();
		}
		await initializeBrowserWorkspacePersistence({
			hydrate: dependencies.setState,
		});
		return refresh();
	}

	function currentView(): WorkspaceSettingsView | null {
		return view ? structuredClone(view) : null;
	}

	function binding(): WorkspaceV2LocalState | null {
		return view?.record.binding ? structuredClone(view.record.binding) : null;
	}

	function syncMode(): "automatic" | "manual" {
		return binding()?.syncMode === "manual" ? "manual" : "automatic";
	}

	function createConflict(
		document: WorkspaceDocumentV2,
		gistId: string,
	): WorkspaceSettingsConflict {
		const current = dependencies.getState();
		const remoteState = hydrateAppStateFromWorkspaceDocument(
			current,
			document,
			gistId,
		);
		return {
			gistId,
			remoteDocument: document,
			remoteState,
			remoteSignature: getSyncStateSignature(remoteState),
			localSignature: getSyncStateSignature(current),
		};
	}

	function evaluateManualPull(
		snapshot: BrowserWorkspaceSnapshot,
		gistId: string,
	): WorkspaceManualPullDecision {
		const conflict = createConflict(snapshot.document, gistId);
		return conflict.remoteSignature === conflict.localSignature
			? { status: "already-synced" }
			: { status: "confirm-pull" };
	}

	function evaluateManualPush(
		snapshot: BrowserWorkspaceSnapshot,
		gistId: string,
	): WorkspaceManualPushDecision {
		const conflict = createConflict(snapshot.document, gistId);
		if (conflict.remoteSignature === conflict.localSignature) {
			return { status: "already-synced" };
		}
		const currentBinding = binding();
		if (
			!currentBinding ||
			currentBinding.workspaceId !== `gist:${gistId}` ||
			currentBinding.revision !== snapshot.document.revision
		) {
			return { status: "needs-review", conflict };
		}
		return { status: "confirm-push" };
	}

	function evaluateRepair(
		snapshot: BrowserWorkspaceSnapshot,
		gistId: string,
	): WorkspaceRepairDecision {
		const workspace = view?.inspection.workspaces.find(
			(item) => item.workspaceId === `gist:${gistId}`,
		);
		if (workspace?.blocked?.disposition === "domain-conflict") {
			return { status: "domain-blocked" };
		}
		const conflict = createConflict(snapshot.document, gistId);
		if (conflict.remoteSignature === conflict.localSignature) {
			return {
				status: "already-synced",
				clearMetadata: Boolean(
					workspace &&
						(workspace.mutations.length > 0 ||
							workspace.deadLetters.length > 0 ||
							workspace.blocked !== null),
				),
			};
		}
		return { status: "state-conflict" };
	}

	function persistedConflict(
		persistedView: WorkspaceSettingsView | null = view,
	): WorkspaceSettingsConflict | null {
		if (!persistedView) return null;
		const persistedBinding = persistedView.record.binding;
		const activeQueue = persistedBinding
			? persistedView.record.workspaces[persistedBinding.workspaceId]
			: undefined;
		if (
			persistedBinding?.syncMode !== "paused-conflict" ||
			!persistedBinding.baseline ||
			activeQueue?.delivery.blocked?.disposition !== "state-conflict"
		) {
			return null;
		}
		return createConflict(persistedBinding.baseline, persistedBinding.gistId);
	}

	async function commitPausedConflict(input: {
		document: WorkspaceDocumentV2;
		gistId: string;
		conflictBaseline: WorkspaceDocumentV2 | null;
	}): Promise<WorkspaceSettingsConflict> {
		const conflict = createConflict(input.document, input.gistId);
		const paused = createWorkspaceV2LocalState(input.gistId, {
			baseline: input.document,
			conflictBaseline: input.conflictBaseline,
			syncMode: "paused-conflict",
		});
		const current = await requireBoundWorkspace(input.gistId);
		const persistedQueue = current.record.workspaces[paused.workspaceId];
		if (
			(persistedQueue?.delivery.blocked &&
				persistedQueue.delivery.blocked.disposition !== "state-conflict") ||
			(persistedQueue?.delivery.deadLetters.length ?? 0) > 0
		) {
			throw new Error("Workspace queue requires repair before connection");
		}
		const createdAt = new Date().toISOString();
		const snapshot = {
			...withWorkspaceBinding(dependencies.getState(), paused),
			lastUpdated: createdAt,
		};
		const mutation = parseWorkspaceMutation({
			mutationId: crypto.randomUUID(),
			workspaceId: paused.workspaceId,
			expectedRevision: input.document.revision,
			source: "browser",
			createdAt,
			kind: "workspace.reconcile",
			payload: {
				baselineRevision: input.document.revision,
				data: getWorkspaceBusinessData(snapshot),
			},
		});
		await persistence().repairWorkspaceQueue({
			snapshot,
			binding: paused,
			mutations: [mutation],
			expected: {
				snapshot: current.record.snapshot,
				binding: current.record.binding,
				queue: persistedQueue ?? null,
			},
			blocked: {
				mutationId: mutation.mutationId,
				kind: mutation.kind,
				code: "revision_conflict",
				disposition: "state-conflict",
				messageKey: "workspace.state-conflict",
				createdAt: mutation.createdAt,
				blockedAt: new Date().toISOString(),
			},
		});
		dependencies.setState(snapshot);
		await refresh();
		return conflict;
	}

	function dispatchPersistedState(
		type: "WORKSPACE_BOUND" | "REPAIR_SUCCEEDED",
	): void {
		const current = view?.record;
		const currentBinding = current?.binding;
		if (!current || !currentBinding) return;
		const blocked =
			current.workspaces[currentBinding.workspaceId]?.delivery.blocked;
		dispatch({
			type,
			mode: currentBinding.syncMode === "manual" ? "manual" : "automatic",
			revision: currentBinding.revision,
			queue: deriveWorkspaceQueueMetrics(current),
			...(type === "WORKSPACE_BOUND" && blocked
				? {
						blockedMutation: {
							mutationId: blocked.mutationId,
							kind: blocked.kind,
							code: blocked.code,
							disposition: blocked.disposition,
							message: blocked.messageKey ?? blocked.code,
						},
					}
				: {}),
		});
	}

	async function persistSnapshot(
		snapshot: BrowserWorkspaceSnapshot,
		gistId: string,
		mode: "automatic" | "manual",
	): Promise<AppState> {
		await requireBoundWorkspace(gistId);
		const state = await persistBrowserWorkspaceSnapshot(
			snapshot,
			gistId,
			mode,
			sessionDependencies(),
		);
		await refresh();
		return state;
	}

	function requireIdleCloudQueue(
		record: WorkspacePersistenceRecord,
		gistId: string,
	): void {
		const queue = record.workspaces[`gist:${gistId}`];
		if (queue?.delivery.blocked || queue?.delivery.deadLetters.length) {
			throw new Error("Workspace queue requires repair before connection");
		}
		if (queue?.mutations.length) {
			throw new Error(
				"Pending cloud changes must finish syncing before refreshing cloud data.",
			);
		}
	}

	async function refreshCloud(
		snapshot: BrowserWorkspaceSnapshot,
		gistId: string,
		expected?: WorkspaceResetExpectation,
	): Promise<AppState> {
		const current = await requireBoundWorkspace(gistId);
		if (expected) requireExpectedRecord(current.record, expected);
		if (snapshot.origin !== "v2") {
			throw new Error("Upgrade this Workspace to continue.");
		}
		if (
			current.record.binding?.revision !== null &&
			current.record.binding?.revision !== undefined &&
			snapshot.document.revision < current.record.binding.revision
		) {
			throw new WorkspaceConcurrentUpdateError();
		}
		requireIdleCloudQueue(current.record, gistId);
		const nextBinding = createWorkspaceV2LocalState(gistId, {
			baseline: snapshot.document,
			syncMode: "automatic",
		});
		const state = hydrateAppStateFromWorkspaceDocument(
			dependencies.getState(),
			snapshot.document,
			gistId,
		);
		await persistence().repairWorkspaceQueue({
			snapshot: state,
			binding: nextBinding,
			mutations: [],
			expected: expected ?? {
				snapshot: current.record.snapshot,
				binding: current.record.binding,
				queue: current.record.workspaces[nextBinding.workspaceId] ?? null,
			},
		});
		dependencies.setState(state);
		await refresh();
		dispatchPersistedState("WORKSPACE_BOUND");
		return state;
	}

	async function reconcile(input: {
		token: string;
		gistId: string;
		baseline: WorkspaceDocumentV2;
		resolvedState: AppState;
		syncMode: "automatic" | "manual";
		replacePending?: boolean;
		expected?: WorkspaceResetExpectation;
	}): Promise<WorkspaceOperationResult> {
		await requireBoundWorkspace(input.gistId);
		const result = await reconcileBrowserWorkspace(
			input,
			sessionDependencies(),
		);
		await refresh();
		return result;
	}

	async function connect(input: {
		token: string;
		gistId: string;
		created: boolean;
		snapshot: BrowserWorkspaceSnapshot;
		previousBinding: WorkspaceV2LocalState | null;
		expected?: WorkspaceResetExpectation;
	}): Promise<
		| {
				status: "created" | "synced";
				operation: WorkspaceOperationResult | null;
		  }
		| { status: "conflict"; conflict: WorkspaceSettingsConflict }
		| { status: "migration-required" }
	> {
		const current = await requireBoundWorkspace(input.gistId);
		if (input.expected) requireExpectedRecord(current.record, input.expected);
		if (input.snapshot.origin === "v1") return { status: "migration-required" };
		requireIdleCloudQueue(current.record, input.gistId);
		if (input.created || input.snapshot.origin === "bootstrap") {
			const operation = await reconcile({
				token: input.token,
				gistId: input.gistId,
				baseline: input.snapshot.document,
				resolvedState: hydrateAppStateFromWorkspaceDocument(
					dependencies.getState(),
					input.snapshot.document,
					input.gistId,
				),
				syncMode: "automatic",
				expected: input.expected ?? resetExpectation(current.record),
			});
			if (operation.status === "remote-committed") {
				dispatchPersistedState("WORKSPACE_BOUND");
			}
			return { status: "created", operation };
		}

		await refreshCloud(
			input.snapshot,
			input.gistId,
			input.expected ?? resetExpectation(current.record),
		);
		return { status: "synced", operation: null };
	}

	async function migrateLegacy(input: {
		token: string;
		gistId: string;
		snapshot: BrowserWorkspaceSnapshot;
		retryMutationId?: string;
		expected?: WorkspaceResetExpectation;
	}): Promise<WorkspaceOperationResult> {
		await requireBoundWorkspace(input.gistId);
		const operation = await migrateBrowserWorkspace(
			input,
			sessionDependencies(),
		);
		await refresh();
		if (operation.status === "remote-committed")
			dispatchPersistedState("WORKSPACE_BOUND");
		return operation;
	}

	async function bindOnly(conflict: WorkspaceSettingsConflict): Promise<void> {
		const current = await requireBoundWorkspace(conflict.gistId);
		const nextBinding = createWorkspaceV2LocalState(conflict.gistId, {
			baseline: conflict.remoteDocument,
			syncMode: "manual",
		});
		const snapshot = bindWorkspaceOnly(
			dependencies.getState(),
			conflict.gistId,
			WORKSPACE_FILE,
		);
		const persistedQueue = current.record.workspaces[nextBinding.workspaceId];
		if (
			(persistedQueue?.delivery.blocked &&
				persistedQueue.delivery.blocked.disposition !== "state-conflict") ||
			(persistedQueue?.delivery.deadLetters.length ?? 0) > 0
		) {
			throw new Error("Workspace queue requires repair before binding");
		}
		if (
			getSyncStateSignature(snapshot) !==
			getSyncStateSignature(conflict.remoteState)
		) {
			const createdAt = new Date().toISOString();
			const queuedSnapshot = { ...snapshot, lastUpdated: createdAt };
			const mutation = parseWorkspaceMutation({
				mutationId: crypto.randomUUID(),
				workspaceId: nextBinding.workspaceId,
				expectedRevision: conflict.remoteDocument.revision,
				source: "browser",
				createdAt,
				kind: "workspace.reconcile",
				payload: {
					baselineRevision: conflict.remoteDocument.revision,
					data: getWorkspaceBusinessData(snapshot),
				},
			});
			await persistence().repairWorkspaceQueue({
				snapshot: queuedSnapshot,
				binding: nextBinding,
				mutations: [mutation],
				expected: {
					snapshot: current.record.snapshot,
					binding: current.record.binding,
					queue: persistedQueue ?? null,
				},
			});
			dependencies.setState(queuedSnapshot);
			await refresh();
		} else {
			await persistence().repairWorkspaceQueue({
				snapshot,
				binding: nextBinding,
				mutations: [],
				expected: {
					snapshot: current.record.snapshot,
					binding: current.record.binding,
					queue: persistedQueue ?? null,
				},
			});
			dependencies.setState(snapshot);
			await refresh();
		}
		dispatchPersistedState("WORKSPACE_BOUND");
	}

	async function resolveConflict(input: {
		token: string;
		conflict: WorkspaceSettingsConflict;
		action: "local" | "remote" | "merge";
		baselineMode?: "conflict" | "current";
		syncMode?: "automatic" | "manual";
	}): Promise<ConflictResolution> {
		await requireBoundWorkspace(input.conflict.gistId);
		if (input.action === "remote") {
			await persistSnapshot(
				{
					origin: "v2",
					document: input.conflict.remoteDocument,
					state: input.conflict.remoteState,
				},
				input.conflict.gistId,
				input.syncMode ?? "automatic",
			);
			dispatchPersistedState("REPAIR_SUCCEEDED");
			return { status: "resolved", notices: [], operation: null };
		}

		let state: AppState;
		let notices: WorkspaceMergeNotice[];
		if (input.action === "local") {
			const projected = projectLocalWorkspaceAgainstTombstones(
				getWorkspaceBusinessData(dependencies.getState()),
				input.conflict.remoteDocument,
			);
			state = {
				...dependencies.getState(),
				...projected.data,
				activeGistId: input.conflict.gistId,
				activeGistFile: WORKSPACE_FILE,
			};
			notices = projected.notices;
		} else {
			const currentBinding = binding();
			const merged = mergeWorkspaceData({
				local: getWorkspaceBusinessData(dependencies.getState()),
				remote: input.conflict.remoteDocument,
				baseline:
					input.baselineMode === "current"
						? (currentBinding?.baseline ?? null)
						: (currentBinding?.conflictBaseline ?? null),
			});
			if (merged.status === "needs-choice") {
				return { status: "needs-choice", notices: merged.notices };
			}
			state = {
				...dependencies.getState(),
				...merged.data,
				activeGistId: input.conflict.gistId,
				activeGistFile: WORKSPACE_FILE,
			};
			notices = merged.notices;
		}

		const operation = await reconcile({
			token: input.token,
			gistId: input.conflict.gistId,
			baseline: input.conflict.remoteDocument,
			resolvedState: state,
			syncMode: input.syncMode ?? "automatic",
			replacePending: true,
		});
		if (operation.status === "remote-committed") {
			dispatchPersistedState("REPAIR_SUCCEEDED");
		}
		return { status: "resolved", notices, operation };
	}

	function requireIdentity(): { workspaceId: string; gistId: string } {
		return requireWorkspaceIdentity(dependencies.getState(), binding());
	}

	async function pendingCount(workspaceId: string): Promise<number> {
		const next = await refresh();
		return (
			next.inspection.workspaces.find(
				(workspace) => workspace.workspaceId === workspaceId,
			)?.mutations.length ?? 0
		);
	}

	async function exportDiagnostics(): Promise<string> {
		return exportWorkspaceDiagnosticsFromPersistence(persistence());
	}

	function disconnect(): void {
		const current = view?.record;
		const queue = current
			? deriveWorkspaceQueueMetrics(current)
			: {
					activeQueueCount: 0,
					totalQueueCount: 0,
					orphanedWorkspaceCount: 0,
					blockedMutationCount: 0,
					deadLetterCount: 0,
				};
		dispatch(
			queue.totalQueueCount > 0
				? { type: "AUTH_LOST", queue }
				: { type: "WORKSPACE_DISCONNECTED", queue },
		);
	}

	async function discardQueue(workspaceId: string): Promise<{
		discardedCount: number;
		itemCount: number;
		active: boolean;
		view: WorkspaceSettingsView;
	}> {
		const current = await refresh();
		const workspace = current.inspection.workspaces.find(
			(item) => item.workspaceId === workspaceId,
		);
		if (!workspace) throw new Error("Workspace queue is unavailable");
		const itemCount = workspace.mutations.length + workspace.deadLetters.length;
		const expected = {
			snapshot: current.record.snapshot,
			binding: current.record.binding,
			queue: current.record.workspaces[workspaceId] ?? null,
		};
		let result: Awaited<ReturnType<typeof discardInspectedWorkspaceQueue>>;
		if (workspace.active) {
			const currentBinding = current.record.binding;
			if (
				!currentBinding?.baseline ||
				currentBinding.workspaceId !== workspaceId
			) {
				throw new Error("Active Workspace baseline is unavailable");
			}
			const realignedBinding = createWorkspaceV2LocalState(
				currentBinding.gistId,
				{
					baseline: currentBinding.baseline,
					syncMode:
						currentBinding.syncMode === "manual" ? "manual" : "automatic",
				},
			);
			const realignedSnapshot = hydrateAppStateFromWorkspaceDocument(
				dependencies.getState(),
				currentBinding.baseline,
				currentBinding.gistId,
			);
			result = await discardInspectedWorkspaceQueue(persistence(), {
				workspaceId,
				expected,
				realignment: {
					snapshot: realignedSnapshot,
					binding: realignedBinding,
				},
			});
			dependencies.setState(realignedSnapshot);
		} else {
			result = await discardInspectedWorkspaceQueue(persistence(), {
				workspaceId,
				expected,
			});
		}
		const next = await refresh();
		if (workspace.active) dispatchPersistedState("REPAIR_SUCCEEDED");
		return {
			discardedCount: result.discardedCount,
			itemCount,
			active: workspace.active,
			view: next,
		};
	}

	async function rebindOrphan(input: {
		workspaceId: string;
		snapshot: BrowserWorkspaceSnapshot;
	}): Promise<WorkspaceSettingsView> {
		const gistId = input.workspaceId.slice("gist:".length);
		const current = await requireBoundWorkspace(gistId);
		const workspace = current.inspection.workspaces.find(
			(item) => item.workspaceId === input.workspaceId,
		);
		if (!workspace || workspace.active || workspace.mutations.length > 0) {
			throw new Error("Workspace queue cannot be rebound safely");
		}
		const nextBinding = createWorkspaceV2LocalState(gistId, {
			baseline: input.snapshot.document,
			syncMode: "automatic",
		});
		await rebindInspectedWorkspace(persistence(), {
			workspaceId: input.workspaceId,
			snapshot: input.snapshot.state,
			binding: nextBinding,
		});
		dependencies.setState(input.snapshot.state);
		const next = await refresh();
		dispatchPersistedState("WORKSPACE_BOUND");
		return next;
	}

	async function pauseForRepair(
		document: WorkspaceDocumentV2,
		gistId: string,
	): Promise<WorkspaceSettingsConflict> {
		const currentBinding = binding();
		const conflict = await commitPausedConflict({
			document,
			gistId,
			conflictBaseline:
				currentBinding?.workspaceId === `gist:${gistId}`
					? (currentBinding.conflictBaseline ?? currentBinding.baseline)
					: null,
		});
		const paused = (view as WorkspaceSettingsView).record.binding;
		if (!paused) throw new Error("Paused Workspace binding is unavailable");
		dispatch({
			type: "SYNC_CONTEXT_LOADED",
			mode: "paused-conflict",
			authenticated: true,
			revision: paused.revision,
			queue: deriveWorkspaceQueueMetrics(
				(view as WorkspaceSettingsView).record,
			),
			blockedMutation: null,
		});
		return conflict;
	}

	return {
		initialize,
		prepareDeviceReset,
		resetDevice,
		refresh,
		currentView,
		binding,
		syncMode,
		createConflict,
		evaluateManualPull,
		evaluateManualPush,
		evaluateRepair,
		persistedConflict,
		connect,
		migrateLegacy,
		bindOnly,
		resolveConflict,
		reconcile,
		persistSnapshot,
		refreshCloud,
		requireIdentity,
		pendingCount,
		exportDiagnostics,
		disconnect,
		discardQueue,
		rebindOrphan,
		pauseForRepair,
		dispatchPersistedState,
	};
}
