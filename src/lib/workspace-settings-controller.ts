import type { AppState } from "$lib/models";
import { getSyncStateSignature } from "$lib/serialization";
import {
	type BrowserWorkspaceSnapshot,
	persistBrowserWorkspaceSnapshot,
	reconcileBrowserWorkspace,
} from "$lib/workspace-browser-session-v2";
import { getWorkspaceBusinessData, WORKSPACE_FILE } from "$lib/workspace-data";
import { exportWorkspaceDiagnosticsFromPersistence } from "$lib/workspace-diagnostics";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
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
import type {
	BrowserWorkspacePersistence,
	WorkspacePersistenceRecord,
	WorkspaceQueueInspection,
} from "$lib/workspace-persistence";
import {
	getBrowserWorkspacePersistence,
	initializeBrowserWorkspacePersistence,
	refreshBrowserWorkspacePersistence,
} from "$lib/workspace-persistence-browser";
import {
	discardInspectedWorkspaceQueue,
	rebindInspectedWorkspace,
	refreshWorkspaceQueueInspection,
} from "$lib/workspace-queue-inspector";
import { bindWorkspaceOnly } from "$lib/workspace-session";
import {
	dispatchWorkspaceSyncEvent,
	type WorkspaceQueueMetrics,
} from "$lib/workspace-sync-status";
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

type ControllerDependencies = {
	getState: () => AppState;
	setState: (state: AppState) => void;
	persistence?: BrowserWorkspacePersistence;
	dispatchSyncEvent?: typeof dispatchWorkspaceSyncEvent;
};

type ConflictResolution =
	| { status: "resolved"; notices: WorkspaceMergeNotice[] }
	| { status: "needs-choice"; notices: WorkspaceMergeNotice[] };

function metrics(record: WorkspacePersistenceRecord): WorkspaceQueueMetrics {
	const activeWorkspaceId = record.binding?.workspaceId ?? null;
	const queues = Object.values(record.workspaces);
	return {
		activeQueueCount: activeWorkspaceId
			? (record.workspaces[activeWorkspaceId]?.mutations.length ?? 0)
			: 0,
		totalQueueCount: queues.reduce(
			(total, queue) => total + queue.mutations.length,
			0,
		),
		orphanedWorkspaceCount: queues.filter(
			(queue) =>
				queue.workspaceId !== activeWorkspaceId && queue.mutations.length > 0,
		).length,
		blockedMutationCount: queues.filter(
			(queue) => queue.delivery.blocked !== null,
		).length,
		deadLetterCount: queues.reduce(
			(total, queue) => total + queue.delivery.deadLetters.length,
			0,
		),
	};
}

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
		const current = await refresh();
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
		dispatch({
			type,
			mode: currentBinding.syncMode === "manual" ? "manual" : "automatic",
			revision: currentBinding.revision,
			queue: metrics(current),
		});
	}

	async function persistSnapshot(
		snapshot: BrowserWorkspaceSnapshot,
		gistId: string,
		mode: "automatic" | "manual",
	): Promise<AppState> {
		const state = await persistBrowserWorkspaceSnapshot(
			snapshot,
			gistId,
			mode,
			sessionDependencies(),
		);
		await refresh();
		return state;
	}

	async function reconcile(input: {
		token: string;
		gistId: string;
		baseline: WorkspaceDocumentV2;
		resolvedState: AppState;
		syncMode: "automatic" | "manual";
		replacePending?: boolean;
	}): Promise<AppState> {
		const state = await reconcileBrowserWorkspace(input, sessionDependencies());
		await refresh();
		return state;
	}

	async function connect(input: {
		token: string;
		gistId: string;
		created: boolean;
		snapshot: BrowserWorkspaceSnapshot;
		previousBinding: WorkspaceV2LocalState | null;
	}): Promise<
		| { status: "created" | "synced" }
		| { status: "conflict"; conflict: WorkspaceSettingsConflict }
	> {
		if (input.created || input.snapshot.origin === "bootstrap") {
			await reconcile({
				token: input.token,
				gistId: input.gistId,
				baseline: input.snapshot.document,
				resolvedState: dependencies.getState(),
				syncMode: "automatic",
			});
			dispatchPersistedState("WORKSPACE_BOUND");
			return { status: "created" };
		}

		const conflict = createConflict(input.snapshot.document, input.gistId);
		if (conflict.remoteSignature === conflict.localSignature) {
			if (input.snapshot.origin === "v2") {
				await persistSnapshot(input.snapshot, input.gistId, "automatic");
			} else {
				await reconcile({
					token: input.token,
					gistId: input.gistId,
					baseline: input.snapshot.document,
					resolvedState: input.snapshot.state,
					syncMode: "automatic",
				});
			}
			dispatchPersistedState("WORKSPACE_BOUND");
			return { status: "synced" };
		}

		await commitPausedConflict({
			document: input.snapshot.document,
			gistId: input.gistId,
			conflictBaseline:
				input.previousBinding?.workspaceId === `gist:${input.gistId}`
					? (input.previousBinding.conflictBaseline ??
						input.previousBinding.baseline)
					: null,
		});
		return { status: "conflict", conflict };
	}

	async function bindOnly(conflict: WorkspaceSettingsConflict): Promise<void> {
		const nextBinding = createWorkspaceV2LocalState(conflict.gistId, {
			baseline: conflict.remoteDocument,
			syncMode: "manual",
		});
		const snapshot = bindWorkspaceOnly(
			dependencies.getState(),
			conflict.gistId,
			WORKSPACE_FILE,
		);
		const current = await refresh();
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
			});
			dependencies.setState(queuedSnapshot);
			await refresh();
		} else {
			await persistence().repairWorkspaceQueue({
				snapshot,
				binding: nextBinding,
				mutations: [],
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
			return { status: "resolved", notices: [] };
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

		await reconcile({
			token: input.token,
			gistId: input.conflict.gistId,
			baseline: input.conflict.remoteDocument,
			resolvedState: state,
			syncMode: input.syncMode ?? "automatic",
			replacePending: true,
		});
		dispatchPersistedState("REPAIR_SUCCEEDED");
		return { status: "resolved", notices };
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
			? metrics(current)
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
				realignment: {
					snapshot: realignedSnapshot,
					binding: realignedBinding,
				},
			});
			dependencies.setState(realignedSnapshot);
		} else {
			result = await discardInspectedWorkspaceQueue(persistence(), {
				workspaceId,
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
		const current = await refresh();
		const workspace = current.inspection.workspaces.find(
			(item) => item.workspaceId === input.workspaceId,
		);
		if (!workspace || workspace.active || workspace.mutations.length > 0) {
			throw new Error("Workspace queue cannot be rebound safely");
		}
		const gistId = input.workspaceId.slice("gist:".length);
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
			queue: metrics((view as WorkspaceSettingsView).record),
			blockedMutation: null,
		});
		return conflict;
	}

	return {
		initialize,
		refresh,
		currentView,
		binding,
		syncMode,
		createConflict,
		persistedConflict,
		connect,
		bindOnly,
		resolveConflict,
		reconcile,
		persistSnapshot,
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
