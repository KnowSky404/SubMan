import type { AppState } from "$lib/models";
import {
	broadcastWorkspaceEvent,
	type WorkspaceEvent,
} from "$lib/workspace-events";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import {
	type BrowserWorkspacePersistence,
	IndexedDbWorkspacePersistence,
	migrateLegacyWorkspacePersistence,
	validateWorkspacePersistenceRecord,
	type WorkspaceMutationDraft,
	type WorkspacePersistenceRecord,
	WorkspaceQueueRecoveryError,
} from "$lib/workspace-persistence";
import {
	dispatchWorkspaceSyncEvent,
	type WorkspaceQueueMetrics,
} from "$lib/workspace-sync-status";
import type { WorkspaceV2LocalState } from "$lib/workspace-v2-state";

type InitializeOptions = {
	storage?: Storage;
	hydrate?: (snapshot: AppState) => void;
};

export type BrowserWorkspaceCommitResult = {
	binding: WorkspaceV2LocalState | null;
	mutation: WorkspaceMutation | null;
	queue: WorkspaceQueueMetrics;
	record: WorkspacePersistenceRecord;
};

let productionPersistence: IndexedDbWorkspacePersistence | null = null;
let persistenceOverride: BrowserWorkspacePersistence | null = null;
let initializePromise: Promise<WorkspacePersistenceRecord> | null = null;
let currentRecord: WorkspacePersistenceRecord | null = null;

function persistence(): BrowserWorkspacePersistence {
	if (persistenceOverride) return persistenceOverride;
	productionPersistence ??= new IndexedDbWorkspacePersistence();
	return productionPersistence;
}

function metricsFor(record: WorkspacePersistenceRecord): WorkspaceQueueMetrics {
	const activeWorkspaceId = record.binding?.workspaceId ?? null;
	const queues = Object.values(record.workspaces);
	const activeQueueCount = activeWorkspaceId
		? (record.workspaces[activeWorkspaceId]?.mutations.length ?? 0)
		: 0;
	return {
		activeQueueCount,
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

function storageFailure(error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);
	const code =
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
			? error.code
			: "workspace_persistence_failed";
	dispatchWorkspaceSyncEvent({
		type: "STORAGE_QUARANTINED",
		kind: error instanceof WorkspaceQueueRecoveryError ? "queue" : "state",
		queue: currentRecord ? metricsFor(currentRecord) : emptyQueueMetrics(),
		error: {
			code,
			message,
			disposition: "queue-corruption",
		},
	});
	throw error;
}

function retryableInitializationFailure(error: unknown): boolean {
	return error instanceof WorkspaceQueueRecoveryError;
}

function emptyQueueMetrics(): WorkspaceQueueMetrics {
	return {
		activeQueueCount: 0,
		totalQueueCount: 0,
		orphanedWorkspaceCount: 0,
		blockedMutationCount: 0,
		deadLetterCount: 0,
	};
}

async function readAndCache(): Promise<WorkspacePersistenceRecord> {
	const publicRecord = await persistence().read();
	const record = validateWorkspacePersistenceRecord({
		...publicRecord,
		quarantinePayloads: {},
	});
	currentRecord = record;
	return record;
}

export function setBrowserWorkspacePersistenceForTest(
	override: BrowserWorkspacePersistence | null,
): void {
	productionPersistence?.close();
	productionPersistence = null;
	persistenceOverride = override;
	initializePromise = null;
	currentRecord = null;
}

export async function initializeBrowserWorkspacePersistence(
	options: InitializeOptions = {},
): Promise<WorkspacePersistenceRecord> {
	if (initializePromise) return initializePromise;
	const attempt = (async () => {
		try {
			const storage = options.storage ?? localStorage;
			await migrateLegacyWorkspacePersistence(persistence(), storage);
		} catch (error) {
			return storageFailure(error);
		}
		try {
			const record = await readAndCache();
			if (record.snapshot) options.hydrate?.(record.snapshot);
			return record;
		} catch (error) {
			return storageFailure(error);
		}
	})();
	const cached = attempt.catch((error) => {
		if (retryableInitializationFailure(error) && initializePromise === cached) {
			initializePromise = null;
		}
		throw error;
	});
	initializePromise = cached;
	return initializePromise;
}

export async function refreshBrowserWorkspacePersistence(): Promise<WorkspacePersistenceRecord> {
	try {
		return await readAndCache();
	} catch (error) {
		return storageFailure(error);
	}
}

export function getBrowserWorkspacePersistence(): BrowserWorkspacePersistence {
	if (!initializePromise) {
		throw new Error("Browser Workspace persistence is not initialized");
	}
	return persistence();
}

export function getBrowserWorkspacePersistenceRecord(): WorkspacePersistenceRecord | null {
	return currentRecord ? structuredClone(currentRecord) : null;
}

export function getBrowserWorkspaceBinding(): WorkspaceV2LocalState | null {
	return currentRecord?.binding ? structuredClone(currentRecord.binding) : null;
}

export function getBrowserWorkspaceQueueMetrics(): WorkspaceQueueMetrics {
	return currentRecord ? metricsFor(currentRecord) : emptyQueueMetrics();
}

export async function commitBrowserWorkspaceAction(input: {
	snapshot: AppState;
	mutation: WorkspaceMutationDraft | null;
	broadcast?: (event: WorkspaceEvent) => void;
}): Promise<BrowserWorkspaceCommitResult> {
	if (!initializePromise) {
		throw new Error("Browser Workspace persistence is not initialized");
	}
	await initializePromise;
	const binding = currentRecord?.binding ?? null;
	let mutation: WorkspaceMutation | null = null;
	try {
		if (binding?.syncMode === "automatic") {
			if (!input.mutation) {
				throw new Error("Automatic Workspace actions require a mutation");
			}
			mutation = await persistence().commitAutomaticAction({
				snapshot: input.snapshot,
				binding,
				mutation: input.mutation,
			});
		} else {
			await persistence().commitLocalAction({
				snapshot: input.snapshot,
				binding,
			});
		}
		const record = await readAndCache();
		if (mutation && binding) {
			(input.broadcast ?? broadcastWorkspaceEvent)({
				type: "mutation-queue-changed",
				gistId: binding.gistId,
				fileName: binding.fileName,
				mutationId: mutation.mutationId,
				queueAction: "enqueued",
			});
		}
		return {
			binding: record.binding,
			mutation,
			queue: metricsFor(record),
			record,
		};
	} catch (error) {
		return storageFailure(error);
	}
}
