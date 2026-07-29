import { expect, test } from "bun:test";
import { get } from "svelte/store";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import type { WorkspaceEvent } from "$lib/workspace-events";
import {
	createEmptyWorkspacePersistenceRecord,
	InMemoryWorkspacePersistence,
	WorkspacePersistenceError,
	WorkspaceQueueRecoveryError,
} from "$lib/workspace-persistence";
import {
	commitBrowserWorkspaceAction,
	getBrowserWorkspacePersistence,
	getBrowserWorkspacePersistenceRecord,
	getBrowserWorkspaceQueueMetrics,
	initializeBrowserWorkspacePersistence,
	refreshBrowserWorkspacePersistence,
	setBrowserWorkspacePersistenceForTest,
} from "$lib/workspace-persistence-browser";
import {
	defaultWorkspaceSyncStatus,
	workspaceSyncStatus,
} from "$lib/workspace-sync-status";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
} from "$lib/workspace-v2-state";

const NOW = "2026-07-23T08:00:00.000Z";
const GIST_ID = "gist-1";
const WORKSPACE_ID = `gist:${GIST_ID}`;

function workspaceDocument(): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision: 1,
		updatedAt: NOW,
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
	};
}

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();

	get length(): number {
		return this.values.size;
	}

	clear(): void {
		this.values.clear();
	}

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (error) {
		return error as Error;
	}
	throw new Error("Expected promise to reject");
}

class OneTimeRecoveredPersistence extends InMemoryWorkspacePersistence {
	private rejectNextRead = true;

	override async read() {
		if (this.rejectNextRead) {
			this.rejectNextRead = false;
			throw new WorkspaceQueueRecoveryError();
		}
		return super.read();
	}
}

class OneTimeUnrecoverablePersistence extends InMemoryWorkspacePersistence {
	readAttempts = 0;

	override async read() {
		this.readAttempts += 1;
		if (this.readAttempts === 1) {
			throw new WorkspacePersistenceError(
				"corrupt-data",
				"Workspace persistence root is invalid",
			);
		}
		return super.read();
	}
}

class ControllableReadFailurePersistence extends InMemoryWorkspacePersistence {
	private remainingReadFailures = 0;

	failNextReads(count: number): void {
		this.remainingReadFailures = count;
	}

	override async read() {
		if (this.remainingReadFailures > 0) {
			this.remainingReadFailures -= 1;
			throw new WorkspacePersistenceError(
				"transaction-aborted",
				"Injected post-commit cache refresh failure",
			);
		}
		return super.read();
	}
}

class DefiniteCommitFailurePersistence extends ControllableReadFailurePersistence {
	override async commitAutomaticAction(
		_input: Parameters<
			InMemoryWorkspacePersistence["commitAutomaticAction"]
		>[0],
	): Promise<never> {
		this.failNextReads(2);
		throw new WorkspacePersistenceError(
			"quota-exceeded",
			"Injected definite commit rejection",
		);
	}
}

test("browser persistence initializes once, hydrates, and exposes a stable adapter", async () => {
	const record = createEmptyWorkspacePersistenceRecord();
	record.snapshot = createDefaultWorkspaceState(NOW);
	const persistence = new InMemoryWorkspacePersistence(record);
	const storage = new MemoryStorage();
	setBrowserWorkspacePersistenceForTest(persistence);
	let hydrationCount = 0;

	const [first, second] = await Promise.all([
		initializeBrowserWorkspacePersistence({
			storage,
			hydrate: () => {
				hydrationCount += 1;
			},
		}),
		initializeBrowserWorkspacePersistence({
			storage,
			hydrate: () => {
				hydrationCount += 100;
			},
		}),
	]);

	expect(first).toEqual(second);
	expect(hydrationCount).toBe(1);
	expect(first.migration.phase).toBe("confirmed");
	expect(getBrowserWorkspacePersistence()).toBe(persistence);
	expect(getBrowserWorkspacePersistenceRecord()?.snapshot).toEqual(
		record.snapshot,
	);
	expect((await refreshBrowserWorkspacePersistence()).snapshot).toEqual(
		record.snapshot,
	);
	setBrowserWorkspacePersistenceForTest(null);
});

test("initialization failure enters invalid-local-storage without a legacy fallback", async () => {
	const persistence = new InMemoryWorkspacePersistence();
	persistence.setFault("before-transaction", "upgrade-failed");
	const storage = new MemoryStorage();
	workspaceSyncStatus.set(defaultWorkspaceSyncStatus);
	setBrowserWorkspacePersistenceForTest(persistence);

	const error = await captureError(
		initializeBrowserWorkspacePersistence({ storage }),
	);
	expect(error.message).toContain("Injected persistence failure");
	expect(get(workspaceSyncStatus).phase).toBe("invalid-local-storage");
	expect(get(workspaceSyncStatus).lifecycle).toBe("invalid-local-state");
	expect(getBrowserWorkspacePersistenceRecord()).toBeNull();
	expect(storage.length).toBe(0);
	expect(
		await captureError(initializeBrowserWorkspacePersistence({ storage })),
	).toBe(error);
	setBrowserWorkspacePersistenceForTest(null);
});

test("a durable queue recovery can be retried in the same browser session", async () => {
	const record = createEmptyWorkspacePersistenceRecord();
	record.quarantines.push({
		id: "queue:gist:gist-1:recovered",
		source: `queue:${WORKSPACE_ID}`,
		reason: "invalid-persisted-queue",
		bytes: 128,
		createdAt: NOW,
	});
	const persistence = new OneTimeRecoveredPersistence(record);
	const storage = new MemoryStorage();
	workspaceSyncStatus.set(defaultWorkspaceSyncStatus);
	setBrowserWorkspacePersistenceForTest(persistence);

	const error = await captureError(
		initializeBrowserWorkspacePersistence({ storage }),
	);
	expect((error as WorkspacePersistenceError).code).toBe("corrupt-data");
	expect(get(workspaceSyncStatus).phase).toBe("invalid-local-storage");
	expect(get(workspaceSyncStatus).recoveryNotice).toBe("queue-quarantined");
	expect(get(workspaceSyncStatus).recentError?.code).toBe("corrupt-data");

	const recovered = await initializeBrowserWorkspacePersistence({ storage });
	expect(recovered.quarantines).toEqual(record.quarantines);
	expect(getBrowserWorkspacePersistenceRecord()?.quarantines).toEqual(
		record.quarantines,
	);
	expect(getBrowserWorkspaceQueueMetrics().totalQueueCount).toBe(0);
	expect(
		(await getBrowserWorkspacePersistence().inspectQueues()).workspaces,
	).toEqual([]);
	setBrowserWorkspacePersistenceForTest(null);
});

test("unrecoverable corrupt data remains cached and fail-closed", async () => {
	const persistence = new OneTimeUnrecoverablePersistence();
	const storage = new MemoryStorage();
	workspaceSyncStatus.set(defaultWorkspaceSyncStatus);
	setBrowserWorkspacePersistenceForTest(persistence);

	const first = await captureError(
		initializeBrowserWorkspacePersistence({ storage }),
	);
	const second = await captureError(
		initializeBrowserWorkspacePersistence({ storage }),
	);
	expect(second).toBe(first);
	expect(persistence.readAttempts).toBe(1);
	expect(get(workspaceSyncStatus).recoveryNotice).toBe("state-quarantined");
	setBrowserWorkspacePersistenceForTest(null);
});

test("browser queue metrics preserve dead-letter counts", async () => {
	const document = workspaceDocument();
	const record = createEmptyWorkspacePersistenceRecord();
	record.binding = createWorkspaceV2LocalState(GIST_ID, { baseline: document });
	record.workspaces[WORKSPACE_ID] = {
		workspaceId: WORKSPACE_ID,
		mutations: [],
		delivery: {
			retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
			blocked: null,
			deadLetters: [
				{
					mutationId: "b0000000-0000-4000-8000-000000000099",
					kind: "workspace.reconcile",
					code: "mutation_id_reused",
					disposition: "queue-corruption",
					messageKey: "workspace.queue-corruption",
					createdAt: NOW,
					blockedAt: NOW,
					payloadBytes: 128,
				},
			],
		},
	};
	setBrowserWorkspacePersistenceForTest(
		new InMemoryWorkspacePersistence(record),
	);
	await initializeBrowserWorkspacePersistence({ storage: new MemoryStorage() });

	expect(getBrowserWorkspaceQueueMetrics().deadLetterCount).toBe(1);
	setBrowserWorkspacePersistenceForTest(null);
});

test("automatic actions broadcast only after the queue transaction commits", async () => {
	const document = workspaceDocument();
	const binding = createWorkspaceV2LocalState(GIST_ID, { baseline: document });
	const record = createEmptyWorkspacePersistenceRecord();
	record.binding = binding;
	record.snapshot = hydrateAppStateFromWorkspaceDocument(
		createDefaultWorkspaceState(NOW),
		document,
		GIST_ID,
	);
	const persistence = new InMemoryWorkspacePersistence(record);
	const storage = new MemoryStorage();
	setBrowserWorkspacePersistenceForTest(persistence);
	await initializeBrowserWorkspacePersistence({ storage });
	const events: WorkspaceEvent[] = [];
	const input = {
		snapshot: { ...record.snapshot, lastUpdated: NOW },
		mutation: {
			mutationId: "b0000000-0000-4000-8000-000000000001",
			workspaceId: WORKSPACE_ID,
			source: "browser" as const,
			createdAt: NOW,
			kind: "workspace.reconcile" as const,
			payload: { baselineRevision: 1, data: document.data },
		},
		broadcast: (event: WorkspaceEvent) => events.push(event),
	};

	const committed = await commitBrowserWorkspaceAction(input);
	expect(committed.queue.activeQueueCount).toBe(1);
	expect(events).toEqual([
		{
			type: "mutation-queue-changed",
			gistId: GIST_ID,
			fileName: "subman.json",
			mutationId: input.mutation.mutationId,
			queueAction: "enqueued",
		},
	]);

	await persistence.discardWorkspaceQueue({
		workspaceId: WORKSPACE_ID,
		snapshot: record.snapshot ?? undefined,
		binding,
	});
	await refreshBrowserWorkspacePersistence();
	persistence.setFault("after-queue");
	const error = await captureError(commitBrowserWorkspaceAction(input));
	expect(error.message).toContain("Injected persistence failure");
	expect(events).toHaveLength(1);
	expect((await persistence.read()).workspaces[WORKSPACE_ID]).toBe(undefined);
	setBrowserWorkspacePersistenceForTest(null);
});

test("post-commit cache refresh failure never reports the durable action as rejected", async () => {
	workspaceSyncStatus.set(defaultWorkspaceSyncStatus);
	const document = workspaceDocument();
	const binding = createWorkspaceV2LocalState(GIST_ID, { baseline: document });
	const record = createEmptyWorkspacePersistenceRecord();
	record.binding = binding;
	record.snapshot = hydrateAppStateFromWorkspaceDocument(
		createDefaultWorkspaceState(NOW),
		document,
		GIST_ID,
	);
	const persistence = new ControllableReadFailurePersistence(record);
	setBrowserWorkspacePersistenceForTest(persistence);
	await initializeBrowserWorkspacePersistence({ storage: new MemoryStorage() });
	const input = {
		snapshot: { ...record.snapshot, lastUpdated: NOW },
		mutation: {
			mutationId: "b0000000-0000-4000-8000-000000000101",
			workspaceId: WORKSPACE_ID,
			source: "browser" as const,
			createdAt: NOW,
			kind: "workspace.reconcile" as const,
			payload: { baselineRevision: 1, data: document.data },
		},
	};

	persistence.failNextReads(1);
	const recovered = await commitBrowserWorkspaceAction(input);
	expect(recovered.acknowledgement).toBe("confirmed");
	expect(recovered.mutation?.mutationId).toBe(input.mutation.mutationId);

	await persistence.discardWorkspaceQueue({
		workspaceId: WORKSPACE_ID,
		snapshot: record.snapshot ?? undefined,
		binding,
	});
	await refreshBrowserWorkspacePersistence();
	const uncertainInput = {
		...input,
		mutation: {
			...input.mutation,
			mutationId: "b0000000-0000-4000-8000-000000000102",
		},
	};
	persistence.failNextReads(2);
	const uncertain = await commitBrowserWorkspaceAction(uncertainInput);
	expect(uncertain.acknowledgement).toBe("uncertain");
	expect(uncertain.mutation?.mutationId).toBe(
		uncertainInput.mutation.mutationId,
	);
	expect(get(workspaceSyncStatus).phase).not.toBe("invalid-local-storage");
	expect(
		(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations[0]
			?.mutationId,
	).toBe(uncertainInput.mutation.mutationId);
	setBrowserWorkspacePersistenceForTest(null);
});

test("a definite transaction failure remains rejected when verification reads fail", async () => {
	workspaceSyncStatus.set(defaultWorkspaceSyncStatus);
	const document = workspaceDocument();
	const record = createEmptyWorkspacePersistenceRecord();
	record.binding = createWorkspaceV2LocalState(GIST_ID, { baseline: document });
	record.snapshot = hydrateAppStateFromWorkspaceDocument(
		createDefaultWorkspaceState(NOW),
		document,
		GIST_ID,
	);
	const persistence = new DefiniteCommitFailurePersistence(record);
	setBrowserWorkspacePersistenceForTest(persistence);
	await initializeBrowserWorkspacePersistence({ storage: new MemoryStorage() });

	const error = await captureError(
		commitBrowserWorkspaceAction({
			snapshot: { ...record.snapshot, lastUpdated: NOW },
			mutation: {
				mutationId: "b0000000-0000-4000-8000-000000000103",
				workspaceId: WORKSPACE_ID,
				source: "browser",
				createdAt: NOW,
				kind: "workspace.reconcile",
				payload: { baselineRevision: 1, data: document.data },
			},
		}),
	);
	expect((error as WorkspacePersistenceError).code).toBe("quota-exceeded");
	expect(get(workspaceSyncStatus).phase).toBe("invalid-local-storage");
	await captureError(persistence.read());
	await captureError(persistence.read());
	expect(
		(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations ?? [],
	).toEqual([]);
	setBrowserWorkspacePersistenceForTest(null);
});
