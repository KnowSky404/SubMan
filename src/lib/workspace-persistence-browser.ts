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
	WorkspaceConcurrentUpdateError,
	type WorkspaceMutationDraft,
	WorkspacePersistenceError,
	type WorkspacePersistenceRecord,
	WorkspaceQueueRecoveryError,
} from "$lib/workspace-persistence";
import { deriveWorkspaceQueueMetrics } from "$lib/workspace-queue-metrics";
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
	acknowledgement: "confirmed" | "uncertain";
	binding: WorkspaceV2LocalState | null;
	mutation: WorkspaceMutation | null;
	queue: WorkspaceQueueMetrics;
	record: WorkspacePersistenceRecord | null;
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
		queue: currentRecord
			? deriveWorkspaceQueueMetrics(currentRecord)
			: emptyQueueMetrics(),
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

function definitelyRejectedBeforeCommit(error: unknown): boolean {
	return error instanceof WorkspacePersistenceError;
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

async function readAndCacheAfterCommit(): Promise<WorkspacePersistenceRecord | null> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			return await readAndCache();
		} catch {
			// Re-read once before admitting that commit acknowledgement is uncertain.
		}
	}
	return null;
}

function draftMutation(
	draft: WorkspaceMutationDraft | null,
	binding: WorkspaceV2LocalState | null,
): WorkspaceMutation | null {
	return draft
		? ({
				...draft,
				expectedRevision: binding?.revision ?? 0,
			} as WorkspaceMutation)
		: null;
}

function mutationFromRecord(
	record: WorkspacePersistenceRecord,
	mutationId: string,
): WorkspaceMutation | null {
	for (const queue of Object.values(record.workspaces)) {
		const mutation = queue.mutations.find(
			(candidate) => candidate.mutationId === mutationId,
		);
		if (mutation) return mutation;
	}
	return null;
}

function commitIsDurable(
	record: WorkspacePersistenceRecord,
	input: { snapshot: AppState; mutation: WorkspaceMutationDraft | null },
): WorkspaceMutation | null | false {
	if (input.mutation) {
		const persisted = mutationFromRecord(record, input.mutation.mutationId);
		if (persisted) return persisted;
		if (
			record.binding?.baseline?.lastMutationId === input.mutation.mutationId
		) {
			return draftMutation(input.mutation, record.binding);
		}
		return false;
	}
	return JSON.stringify(record.snapshot) === JSON.stringify(input.snapshot)
		? null
		: false;
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

export async function refreshBrowserWorkspacePersistenceAfterDurableCommit(): Promise<WorkspacePersistenceRecord | null> {
	return readAndCacheAfterCommit();
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
	return currentRecord
		? deriveWorkspaceQueueMetrics(currentRecord)
		: emptyQueueMetrics();
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
	let committedCore = false;
	try {
		if (binding?.syncMode === "automatic") {
			if (!input.mutation) {
				throw new Error("Automatic Workspace actions require a mutation");
			}
			mutation = await persistence().commitAutomaticAction({
				snapshot: input.snapshot,
				binding,
				mutation: input.mutation,
				expectedSnapshot: currentRecord?.snapshot ?? null,
			});
		} else {
			await persistence().commitLocalAction({
				snapshot: input.snapshot,
				binding,
				expectedSnapshot: currentRecord?.snapshot ?? null,
			});
		}
		committedCore = true;
	} catch (error) {
		if (error instanceof WorkspaceConcurrentUpdateError) throw error;
		if (definitelyRejectedBeforeCommit(error)) return storageFailure(error);
		const record = await readAndCacheAfterCommit();
		if (record) {
			const durableMutation = commitIsDurable(record, input);
			if (durableMutation !== false) {
				mutation = durableMutation;
				committedCore = true;
			} else {
				return storageFailure(error);
			}
		} else {
			return {
				acknowledgement: "uncertain",
				binding,
				mutation: mutation ?? draftMutation(input.mutation, binding),
				queue: currentRecord
					? deriveWorkspaceQueueMetrics(currentRecord)
					: emptyQueueMetrics(),
				record: null,
			};
		}
	}
	if (committedCore) {
		const record = await readAndCacheAfterCommit();
		if (!record) {
			return {
				acknowledgement: "uncertain",
				binding,
				mutation: mutation ?? draftMutation(input.mutation, binding),
				queue: currentRecord
					? deriveWorkspaceQueueMetrics(currentRecord)
					: emptyQueueMetrics(),
				record: null,
			};
		}
		if (mutation && binding) {
			try {
				(input.broadcast ?? broadcastWorkspaceEvent)({
					type: "mutation-queue-changed",
					gistId: binding.gistId,
					fileName: binding.fileName,
					mutationId: mutation.mutationId,
					queueAction: "enqueued",
				});
			} catch {
				// Broadcast is a wake-up hint; IndexedDB remains authoritative.
			}
		}
		return {
			acknowledgement: "confirmed",
			binding: record.binding,
			mutation,
			queue: deriveWorkspaceQueueMetrics(record),
			record,
		};
	}
	throw new Error("Workspace commit did not produce a result");
}
