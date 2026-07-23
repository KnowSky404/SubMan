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
import type { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import { deliverQueuedWorkspaceMutation } from "$lib/workspace-mutation-sync";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	type WorkspaceV2LocalState,
	type WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

export type BrowserWorkspaceSnapshot = {
	origin: "v1" | "v2" | "bootstrap";
	document: WorkspaceDocumentV2;
	state: AppState;
};

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

export function persistBrowserWorkspaceSnapshot(
	snapshot: BrowserWorkspaceSnapshot,
	gistId: string,
	syncMode: WorkspaceV2LocalState["syncMode"],
	dependencies: {
		stateStore: WorkspaceV2StateStore;
		getState: () => AppState;
		setState: (state: AppState) => void;
	},
): void {
	const binding = createWorkspaceV2LocalState(gistId, {
		baseline: snapshot.document,
		syncMode,
	});
	dependencies.stateStore.write(binding);
	dependencies.setState(
		hydrateAppStateFromWorkspaceDocument(
			dependencies.getState(),
			snapshot.document,
			gistId,
		),
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
	dependencies: {
		queue: WorkspaceMutationQueue;
		stateStore: WorkspaceV2StateStore;
		getState: () => AppState;
		setState: (state: AppState) => void;
		fetchImpl?: typeof fetch;
		mutationId?: () => string;
		now?: () => string;
	},
): Promise<AppState> {
	const workspaceId = `gist:${input.gistId}`;
	let baseline = validateWorkspaceDocumentV2(input.baseline, {
		expectedWorkspaceId: workspaceId,
	});
	let pending = dependencies.queue.list(workspaceId);
	if (pending.length > 0 && !input.replacePending) {
		while (pending.length > 0) {
			const result = await deliverQueuedWorkspaceMutation(
				{
					queue: dependencies.queue,
					stateStore: dependencies.stateStore,
					githubToken: input.token,
					getState: dependencies.getState,
					setState: dependencies.setState,
					fetchImpl: dependencies.fetchImpl,
				},
				{ allowManual: true },
			);
			if (result.status !== "committed") {
				throw new Error(`Pending Workspace delivery failed: ${result.status}`);
			}
			pending = dependencies.queue.list(workspaceId);
		}
		const committed = dependencies.stateStore.read();
		if (!committed?.baseline || committed.workspaceId !== workspaceId) {
			throw new Error("Committed Workspace state is unavailable");
		}
		baseline = committed.baseline;
		if (
			getWorkspaceContentSignature(baseline) ===
			getWorkspaceContentSignature({
				...baseline,
				data: getWorkspaceBusinessData(input.resolvedState),
			})
		) {
			dependencies.stateStore.write({
				...committed,
				syncMode: input.syncMode,
				conflictBaseline: null,
			});
			return dependencies.getState();
		}
	}
	if (input.replacePending) {
		for (const mutation of pending) {
			await dependencies.queue.remove(mutation.mutationId);
		}
	}
	dependencies.stateStore.write(
		createWorkspaceV2LocalState(input.gistId, {
			baseline,
			syncMode: input.syncMode,
		}),
	);
	dependencies.setState({
		...input.resolvedState,
		activeGistId: input.gistId,
		activeGistFile: WORKSPACE_FILE,
	});
	const mutationId = (dependencies.mutationId ?? crypto.randomUUID)();
	const createdAt = (dependencies.now ?? (() => new Date().toISOString()))();
	const mutation = await dependencies.queue.enqueueNext(
		workspaceId,
		baseline.revision,
		(expectedRevision) =>
			parseWorkspaceMutation({
				mutationId,
				workspaceId,
				expectedRevision,
				source: "browser",
				createdAt,
				kind: "workspace.reconcile",
				payload: {
					baselineRevision: baseline.revision,
					data: getWorkspaceBusinessData(input.resolvedState),
				},
			}),
	);
	while (
		dependencies.queue
			.list(workspaceId)
			.some((queued) => queued.mutationId === mutation.mutationId)
	) {
		const result = await deliverQueuedWorkspaceMutation(
			{
				queue: dependencies.queue,
				stateStore: dependencies.stateStore,
				githubToken: input.token,
				getState: dependencies.getState,
				setState: dependencies.setState,
				fetchImpl: dependencies.fetchImpl,
			},
			{ allowManual: true },
		);
		if (result.status !== "committed") {
			throw new Error(`Workspace reconciliation failed: ${result.status}`);
		}
	}
	const committed = dependencies.stateStore.read();
	if (!committed || committed.workspaceId !== workspaceId) {
		throw new Error("Committed Workspace state is unavailable");
	}
	dependencies.stateStore.write({ ...committed, syncMode: input.syncMode });
	return dependencies.getState();
}

export async function submitBrowserWorkspaceMutation(
	input: {
		token: string;
		kind: WorkspaceMutation["kind"];
		payload: unknown;
	},
	dependencies: {
		queue: WorkspaceMutationQueue;
		stateStore: WorkspaceV2StateStore;
		getState: () => AppState;
		setState: (state: AppState) => void;
		fetchImpl?: typeof fetch;
		mutationId?: () => string;
		now?: () => string;
		allowManual?: boolean;
	},
): Promise<AppState> {
	const binding = dependencies.stateStore.read();
	if (!binding || binding.revision === null || binding.baseline === null) {
		throw new Error("Workspace V2 is not initialized");
	}
	requireWorkspaceIdentity(dependencies.getState(), binding);
	if (binding.syncMode === "paused-conflict") {
		throw new Error("Workspace synchronization is paused by a conflict");
	}
	if (binding.syncMode === "manual" && !dependencies.allowManual) {
		throw new Error("Push local Workspace changes before publishing");
	}
	const mutationId = (dependencies.mutationId ?? crypto.randomUUID)();
	const createdAt = (dependencies.now ?? (() => new Date().toISOString()))();
	await dependencies.queue.enqueueNext(
		binding.workspaceId,
		binding.revision,
		(expectedRevision) =>
			parseWorkspaceMutation({
				mutationId,
				workspaceId: binding.workspaceId,
				expectedRevision,
				source: "browser",
				createdAt,
				kind: input.kind,
				payload: input.payload,
			}),
	);
	while (
		dependencies.queue
			.list(binding.workspaceId)
			.some((mutation) => mutation.mutationId === mutationId)
	) {
		const result = await deliverQueuedWorkspaceMutation(
			{
				queue: dependencies.queue,
				stateStore: dependencies.stateStore,
				githubToken: input.token,
				getState: dependencies.getState,
				setState: dependencies.setState,
				fetchImpl: dependencies.fetchImpl,
			},
			{ allowManual: true },
		);
		if (result.status !== "committed") {
			throw new Error(`Workspace mutation failed: ${result.status}`);
		}
	}
	return dependencies.getState();
}

export async function commitQueuedBrowserWorkspaceMutation(
	input: { token: string; mutationId: string },
	dependencies: {
		queue: WorkspaceMutationQueue;
		stateStore: WorkspaceV2StateStore;
		getState: () => AppState;
		setState: (state: AppState) => void;
		fetchImpl?: typeof fetch;
	},
): Promise<AppState> {
	const binding = dependencies.stateStore.read();
	if (!binding || binding.revision === null || binding.baseline === null) {
		throw new Error("Workspace V2 is not initialized");
	}
	requireWorkspaceIdentity(dependencies.getState(), binding);
	while (
		dependencies.queue
			.list(binding.workspaceId)
			.some((mutation) => mutation.mutationId === input.mutationId)
	) {
		const result = await deliverQueuedWorkspaceMutation(
			{
				queue: dependencies.queue,
				stateStore: dependencies.stateStore,
				githubToken: input.token,
				getState: dependencies.getState,
				setState: dependencies.setState,
				fetchImpl: dependencies.fetchImpl,
			},
			{ allowManual: true },
		);
		if (result.status !== "committed") {
			throw new Error(`Workspace mutation failed: ${result.status}`);
		}
	}
	return dependencies.getState();
}
