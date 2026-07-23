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
import { requireWorkspaceIdentity } from "$lib/workspace-identity";
import {
	parseWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import type {
	BrowserWorkspacePersistence,
	WorkspaceMutationDraft,
	WorkspacePersistenceRecord,
} from "$lib/workspace-persistence";
import {
	getBrowserWorkspacePersistence,
	initializeBrowserWorkspacePersistence,
	refreshBrowserWorkspacePersistence,
} from "$lib/workspace-persistence-browser";
import {
	dispatchPersistedWorkspaceMutation,
	type WorkspacePersistenceDispatchResult,
} from "$lib/workspace-persistence-dispatcher";
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
};

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

async function hydrateFromPersistence(
	dependencies: BrowserWorkspaceSessionDependencies,
	persistence: BrowserWorkspacePersistence,
): Promise<WorkspacePersistenceRecord> {
	const record = await readPersistence(dependencies, persistence);
	if (record.snapshot) publishState(dependencies, record.snapshot);
	return record;
}

function deliveryFailure(
	prefix: string,
	result: Exclude<WorkspacePersistenceDispatchResult, { status: "committed" }>,
): Error {
	return new Error(
		`${prefix}: ${result.status}${"code" in result && result.code ? ` (${result.code})` : ""}`,
	);
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
	prefix: string,
): Promise<AppState> {
	while (true) {
		const before = await readPersistence(dependencies, persistence);
		const binding = before.binding;
		if (!binding) throw new Error("Workspace V2 is not initialized");
		const pending = before.workspaces[binding.workspaceId]?.mutations ?? [];
		if (!pending.some((mutation) => mutation.mutationId === mutationId)) {
			if (before.snapshot) publishState(dependencies, before.snapshot);
			return before.snapshot ?? currentState(dependencies);
		}
		const result = await dispatchPersistedWorkspaceMutation({
			persistence,
			githubToken: token,
			allowManual: true,
			fetchImpl: dependencies.fetchImpl,
		});
		const after = await hydrateFromPersistence(dependencies, persistence);
		const stillPending = Boolean(
			after.binding &&
				after.workspaces[after.binding.workspaceId]?.mutations.some(
					(mutation) => mutation.mutationId === mutationId,
				),
		);
		if (result.status === "committed") {
			if (!stillPending) return after.snapshot ?? currentState(dependencies);
			continue;
		}
		if (
			!stillPending &&
			(result.status === "busy" || result.status === "stale")
		) {
			return after.snapshot ?? currentState(dependencies);
		}
		throw deliveryFailure(prefix, result);
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
): Promise<AppState> {
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
		await dispatchUntilMutationSettles(
			lastPendingId,
			input.token,
			dependencies,
			persistence,
			"Pending Workspace delivery failed",
		);
		record = await readPersistence(dependencies, persistence);
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
			await persistence.rebindWorkspace({ snapshot: state, binding });
			publishState(dependencies, state);
			await readPersistence(dependencies, persistence);
			return state;
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
	await persistence.repairWorkspaceQueue({
		snapshot: state,
		binding,
		mutations: [mutation],
	});
	publishState(dependencies, state);
	await readPersistence(dependencies, persistence);
	return dispatchUntilMutationSettles(
		mutation.mutationId,
		input.token,
		dependencies,
		persistence,
		"Workspace reconciliation failed",
	);
}

export async function submitBrowserWorkspaceMutation(
	input: {
		token: string;
		kind: WorkspaceMutation["kind"];
		payload: unknown;
	},
	dependencies: BrowserWorkspaceSessionDependencies = {},
): Promise<AppState> {
	dependencies = await withStateAccess(dependencies);
	const persistence = await persistenceFor(dependencies);
	const record = await readPersistence(dependencies, persistence);
	const binding = record.binding;
	if (!binding || binding.revision === null || binding.baseline === null) {
		throw new Error("Workspace V2 is not initialized");
	}
	requireWorkspaceIdentity(currentState(dependencies), binding);
	if (binding.syncMode === "paused-conflict") {
		throw new Error("Workspace synchronization is paused by a conflict");
	}
	if (binding.syncMode === "manual" && !dependencies.allowManual) {
		throw new Error("Push local Workspace changes before publishing");
	}
	const mutation = await persistence.commitExplicitAction({
		binding,
		mutation: mutationDraft(binding, input.kind, input.payload, dependencies),
	});
	await readPersistence(dependencies, persistence);
	return dispatchUntilMutationSettles(
		mutation.mutationId,
		input.token,
		dependencies,
		persistence,
		"Workspace mutation failed",
	);
}

export async function commitQueuedBrowserWorkspaceMutation(
	input: { token: string; mutationId: string },
	dependencies: BrowserWorkspaceSessionDependencies = {},
): Promise<AppState> {
	dependencies = await withStateAccess(dependencies);
	const persistence = await persistenceFor(dependencies);
	const record = await readPersistence(dependencies, persistence);
	const binding = record.binding;
	if (!binding || binding.revision === null || binding.baseline === null) {
		throw new Error("Workspace V2 is not initialized");
	}
	requireWorkspaceIdentity(currentState(dependencies), binding);
	return dispatchUntilMutationSettles(
		input.mutationId,
		input.token,
		dependencies,
		persistence,
		"Workspace mutation failed",
	);
}
