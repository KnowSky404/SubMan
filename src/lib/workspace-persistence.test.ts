import { describe, expect, it } from "bun:test";
import type { AppState } from "$lib/models";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import {
	type BrowserWorkspacePersistence,
	classifyWorkspacePersistenceError,
	createEmptyWorkspacePersistenceRecord,
	IndexedDbWorkspacePersistenceBackend,
	InMemoryWorkspacePersistence,
	LEGACY_APP_STATE_KEY,
	LEGACY_MUTATION_QUEUE_KEY,
	LEGACY_WORKSPACE_STATE_KEY,
	migrateLegacyWorkspacePersistence,
	TransactionalWorkspacePersistence,
	validateWorkspaceMutationSequence,
	validateWorkspacePersistenceRecord,
	type WorkspaceLeaseFence,
	WorkspacePersistenceError,
	type WorkspacePersistenceFaultPoint,
	type WorkspacePersistenceRecord,
	workspaceDispatcherLeaseName,
} from "$lib/workspace-persistence";
import {
	createWorkspaceV2LocalState,
	type WorkspaceV2LocalState,
} from "$lib/workspace-v2-state";

const NOW = "2026-07-23T10:00:00.000Z";
const NOW_2 = "2026-07-23T10:00:01.000Z";
const GIST_ID = "gist-1";
const WORKSPACE_ID = `gist:${GIST_ID}`;
const OTHER_GIST_ID = "gist-2";
const OTHER_WORKSPACE_ID = `gist:${OTHER_GIST_ID}`;
const MUTATION_ID = "b0000000-0000-4000-8000-000000000001";
const MUTATION_ID_2 = "b0000000-0000-4000-8000-000000000002";
const MUTATION_ID_3 = "b0000000-0000-4000-8000-000000000003";
const TOKEN_CANARY = "credential-canary-do-not-persist";

async function captureError(
	promise: Promise<unknown>,
): Promise<Error & { code?: string }> {
	try {
		await promise;
	} catch (error) {
		return error as Error & { code?: string };
	}
	throw new Error("Expected promise to reject");
}

function captureThrown(run: () => unknown): Error & { code?: string } {
	try {
		run();
	} catch (error) {
		return error as Error & { code?: string };
	}
	throw new Error("Expected function to throw");
}

function document(
	revision = 0,
	workspaceId = WORKSPACE_ID,
): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId,
		revision,
		updatedAt: NOW,
		lastMutationId: revision === 0 ? null : MUTATION_ID,
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

function binding(revision = 0, gistId = GIST_ID): WorkspaceV2LocalState {
	return createWorkspaceV2LocalState(gistId, {
		baseline: document(revision, `gist:${gistId}`),
		syncMode: "automatic",
	});
}

function snapshot(marker = "initial", gistId = GIST_ID): AppState {
	return {
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
		gists: [],
		activeGistId: gistId,
		activeGistFile: "subman.json",
		lastUpdated: `${NOW}:${marker}`,
	};
}

function committedSnapshot(gistId = GIST_ID): AppState {
	return { ...snapshot("committed", gistId), lastUpdated: NOW };
}

function automaticPersistence(
	nowMs?: () => number,
): InMemoryWorkspacePersistence {
	const record = createEmptyWorkspacePersistenceRecord();
	record.snapshot = committedSnapshot();
	record.binding = binding();
	return new InMemoryWorkspacePersistence(record, nowMs);
}

function manualBinding(revision = 0): WorkspaceV2LocalState {
	return createWorkspaceV2LocalState(GIST_ID, {
		baseline: document(revision),
		syncMode: "manual",
	});
}

function manualPersistence(): InMemoryWorkspacePersistence {
	const record = createEmptyWorkspacePersistenceRecord();
	record.snapshot = committedSnapshot();
	record.binding = manualBinding();
	return new InMemoryWorkspacePersistence(record);
}

function mutation(
	mutationId = MUTATION_ID,
	expectedRevision = 0,
	workspaceId = WORKSPACE_ID,
): WorkspaceMutation {
	return {
		mutationId,
		workspaceId,
		expectedRevision,
		source: "browser",
		createdAt: NOW,
		kind: "node.delete",
		payload: { id: `node-${mutationId.at(-1)}` },
	};
}

function reconcileMutation(
	mutationId = MUTATION_ID,
	expectedRevision = 0,
	workspaceId = WORKSPACE_ID,
	createdAt = NOW,
): WorkspaceMutation {
	return {
		mutationId,
		workspaceId,
		expectedRevision,
		source: "browser",
		createdAt,
		kind: "workspace.reconcile",
		payload: {
			baselineRevision: expectedRevision,
			data: {
				nodes: [],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			},
		},
	};
}

function mutationDraft(value: WorkspaceMutation) {
	const { expectedRevision: _allocatedByPersistence, ...draft } = value;
	return draft;
}

async function acquireFence(
	persistence: BrowserWorkspacePersistence,
	workspaceId = WORKSPACE_ID,
	ownerId = "tab-a",
	now = Date.now(),
): Promise<WorkspaceLeaseFence> {
	const acquired = await persistence.acquireLease({
		name: workspaceDispatcherLeaseName(workspaceId),
		ownerId,
		now,
		ttlMs: 100,
	});
	if (!acquired.acquired) throw new Error("Expected lease acquisition");
	return { ownerId, fencingToken: acquired.lease.fencingToken };
}

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();
	failRemoveKey: string | null = null;

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
		if (key === this.failRemoveKey)
			throw new Error("legacy removal interrupted");
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

type FakeIdbRequest = {
	result: unknown;
	error: DOMException | null;
	onsuccess: (() => void) | null;
	onerror: (() => void) | null;
};

class DeterministicIdbDatabase {
	readonly values = new Map<IDBValidKey, unknown>();
	readonly stores = new Set<string>();
	writeTail: Promise<void> = Promise.resolve();
	onversionchange: (() => void) | null = null;

	readonly objectStoreNames = {
		contains: (name: string) => this.stores.has(name),
	};

	createObjectStore(name: string): IDBObjectStore {
		this.stores.add(name);
		return {} as IDBObjectStore;
	}

	transaction(_name: string, mode: IDBTransactionMode): IDBTransaction {
		return new DeterministicIdbTransaction(
			this,
			mode,
		) as unknown as IDBTransaction;
	}

	close(): void {}
}

class DeterministicIdbTransaction {
	error: DOMException | null = null;
	oncomplete: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	private aborted = false;
	private pendingPut: { key: IDBValidKey; value: unknown } | null = null;

	constructor(
		private readonly database: DeterministicIdbDatabase,
		private readonly mode: IDBTransactionMode,
	) {}

	objectStore(_name: string): IDBObjectStore {
		return {
			get: (key: IDBValidKey) => this.get(key),
			put: (value: unknown, key: IDBValidKey) => this.put(value, key),
		} as unknown as IDBObjectStore;
	}

	abort(): void {
		if (this.aborted) return;
		this.aborted = true;
		queueMicrotask(() => this.onabort?.());
	}

	private get(key: IDBValidKey): IDBRequest {
		const request: FakeIdbRequest = {
			result: undefined,
			error: null,
			onsuccess: null,
			onerror: null,
		};
		const run = () => {
			if (this.aborted) return;
			request.result = structuredClone(this.database.values.get(key));
			request.onsuccess?.();
			queueMicrotask(() => {
				if (this.aborted) return;
				if (this.pendingPut) {
					this.database.values.set(
						this.pendingPut.key,
						structuredClone(this.pendingPut.value),
					);
				}
				this.oncomplete?.();
			});
		};
		if (this.mode === "readwrite") {
			const previous = this.database.writeTail;
			let release = () => {};
			this.database.writeTail = new Promise<void>((resolve) => {
				release = resolve;
			});
			void previous.then(() => {
				run();
				queueMicrotask(release);
			});
		} else {
			queueMicrotask(run);
		}
		return request as unknown as IDBRequest;
	}

	private put(value: unknown, key: IDBValidKey): IDBRequest {
		this.pendingPut = { key, value: structuredClone(value) };
		return {
			result: key,
			error: null,
			onsuccess: null,
			onerror: null,
		} as unknown as IDBRequest;
	}
}

class DeterministicIdbFactory {
	private readonly databases = new Map<string, DeterministicIdbDatabase>();

	open(name: string): IDBOpenDBRequest {
		const request = {
			result: undefined as unknown as IDBDatabase,
			error: null as DOMException | null,
			transaction: { abort: () => {} },
			onupgradeneeded: null as (() => void) | null,
			onsuccess: null as (() => void) | null,
			onerror: null as (() => void) | null,
			onblocked: null as (() => void) | null,
		};
		queueMicrotask(() => {
			const existing = this.databases.get(name);
			const database = existing ?? new DeterministicIdbDatabase();
			this.databases.set(name, database);
			request.result = database as unknown as IDBDatabase;
			if (!existing) request.onupgradeneeded?.();
			request.onsuccess?.();
		});
		return request as unknown as IDBOpenDBRequest;
	}
}

function seedLegacy(storage: Storage): void {
	storage.setItem(LEGACY_APP_STATE_KEY, JSON.stringify(snapshot("legacy")));
	storage.setItem(
		LEGACY_WORKSPACE_STATE_KEY,
		JSON.stringify({ envelopeVersion: 1, state: binding() }),
	);
	storage.setItem(
		LEGACY_MUTATION_QUEUE_KEY,
		JSON.stringify({ version: 2, mutations: [mutation()] }),
	);
}

describe("transactional Workspace persistence", () => {
	it("rolls back snapshot, binding, and queue at every pre-commit fault", async () => {
		const points: WorkspacePersistenceFaultPoint[] = [
			"before-transaction",
			"after-snapshot",
			"after-binding",
			"after-queue",
			"before-commit",
		];
		for (const point of points) {
			const persistence = automaticPersistence();
			persistence.setFault(point);
			const error = await captureError(
				persistence.commitAutomaticAction({
					snapshot: committedSnapshot(),
					binding: binding(),
					mutation: reconcileMutation(),
				}),
			);
			expect(error.code).toBe("transaction-aborted");
			const stored = await persistence.read();
			expect(stored.snapshot).toEqual(committedSnapshot());
			expect(stored.binding).toEqual(binding());
			expect(stored.workspaces).toEqual({});
		}
	});

	it("recovers a committed transaction when the caller stops before memory update", async () => {
		const persistence = automaticPersistence();
		persistence.setFault("after-commit");
		const error = await captureError(
			persistence.commitAutomaticAction({
				snapshot: committedSnapshot(),
				binding: binding(),
				mutation: reconcileMutation(),
			}),
		);
		expect(error.code).toBe("transaction-aborted");

		const restarted = new InMemoryWorkspacePersistence(
			await persistence.read(),
		);
		const restored = await restarted.read();
		expect(restored.snapshot?.lastUpdated).toBe(NOW);
		expect(restored.workspaces[WORKSPACE_ID]?.mutations).toEqual([
			reconcileMutation(),
		]);
	});

	it("persists local and paused actions without generating a mutation", async () => {
		const persistence = manualPersistence();
		const manual = manualBinding();
		await persistence.commitLocalAction({
			snapshot: snapshot("manual"),
			binding: manual,
		});
		const stored = await persistence.read();
		expect(stored.snapshot?.lastUpdated).toContain("manual");
		expect(stored.binding?.syncMode).toBe("manual");
		expect(stored.workspaces).toEqual({});
	});

	it("rejects local commits for automatic bindings", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		expect(
			(
				await captureError(
					persistence.commitLocalAction({
						snapshot: snapshot("automatic"),
						binding: binding(),
					}),
				)
			).code,
		).toBe("corrupt-data");
	});

	it("classifies large-payload quota failure without a partial snapshot or queue", async () => {
		const persistence = automaticPersistence();
		persistence.setFault("before-commit", "quota-exceeded");
		const error = await captureError(
			persistence.commitAutomaticAction({
				snapshot: committedSnapshot(),
				binding: binding(),
				mutation: reconcileMutation(),
			}),
		);
		expect(error.code).toBe("quota-exceeded");
		const stored = await persistence.read();
		expect(stored.snapshot).toEqual(committedSnapshot());
		expect(stored.binding).toEqual(binding());
		expect(stored.workspaces).toEqual({});
	});

	it("commits delivery state and dequeue atomically", async () => {
		const persistence = automaticPersistence();
		await persistence.commitAutomaticAction({
			snapshot: committedSnapshot(),
			binding: binding(),
			mutation: reconcileMutation(),
		});
		const fence = await acquireFence(persistence);
		persistence.setFault("after-queue");
		const error = await captureError(
			persistence.commitDeliverySuccess({
				snapshot: committedSnapshot(),
				binding: binding(1),
				mutationId: MUTATION_ID,
				fence,
			}),
		);
		expect(error.code).toBe("transaction-aborted");
		let stored = await persistence.read();
		expect(stored.binding?.revision).toBe(0);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toHaveLength(1);

		await persistence.commitDeliverySuccess({
			snapshot: committedSnapshot(),
			binding: binding(1),
			mutationId: MUTATION_ID,
			fence,
		});
		stored = await persistence.read();
		expect(stored.binding?.revision).toBe(1);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([]);
	});

	it("pauses a state conflict without advancing the queue head", async () => {
		const persistence = automaticPersistence();
		await persistence.commitAutomaticAction({
			snapshot: committedSnapshot(),
			binding: binding(),
			mutation: reconcileMutation(),
		});
		const fence = await acquireFence(persistence);

		await persistence.commitDeliveryConflict({
			workspaceId: WORKSPACE_ID,
			mutationId: MUTATION_ID,
			document: document(3),
			metadata: {
				mutationId: MUTATION_ID,
				kind: "workspace.reconcile",
				code: "revision_conflict",
				disposition: "state-conflict",
				messageKey: "workspace.state-conflict",
				createdAt: NOW,
				blockedAt: NOW,
			},
			fence,
		});

		const stored = await persistence.read();
		expect(stored.binding?.syncMode).toBe("paused-conflict");
		expect(stored.binding?.revision).toBe(3);
		expect(stored.binding?.conflictBaseline?.revision).toBe(0);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations[0]?.mutationId).toBe(
			MUTATION_ID,
		);
		expect(stored.workspaces[WORKSPACE_ID]?.delivery.blocked?.code).toBe(
			"revision_conflict",
		);
		expect(stored.leases).toEqual({});
	});

	it("rejects stale fences and unproven delivery commits", async () => {
		let nowMs = 100;
		const persistence = automaticPersistence(() => nowMs);
		await persistence.commitAutomaticAction({
			snapshot: committedSnapshot(),
			binding: binding(),
			mutation: reconcileMutation(),
		});
		const staleFence = await acquireFence(
			persistence,
			WORKSPACE_ID,
			"tab-a",
			nowMs,
		);
		expect(
			(
				await captureError(
					persistence.commitDeliverySuccess({
						snapshot: committedSnapshot(),
						binding: binding(),
						mutationId: MUTATION_ID,
						fence: staleFence,
					}),
				)
			).code,
		).toBe("corrupt-data");
		expect(
			(
				await captureError(
					persistence.commitDeliverySuccess({
						snapshot: snapshot("not-committed"),
						binding: binding(1),
						mutationId: MUTATION_ID,
						fence: staleFence,
					}),
				)
			).code,
		).toBe("corrupt-data");

		nowMs = 201;
		const currentFence = await acquireFence(
			persistence,
			WORKSPACE_ID,
			"tab-b",
			201,
		);
		expect(
			(
				await captureError(
					persistence.commitDeliverySuccess({
						snapshot: committedSnapshot(),
						binding: binding(1),
						mutationId: MUTATION_ID,
						fence: staleFence,
					}),
				)
			).code,
		).toBe("corrupt-data");
		await persistence.commitDeliverySuccess({
			snapshot: committedSnapshot(),
			binding: binding(1),
			mutationId: MUTATION_ID,
			fence: currentFence,
		});
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations,
		).toEqual([]);
	});

	it("rejects delivery after another Workspace becomes active", async () => {
		const nowMs = 100;
		const persistence = automaticPersistence(() => nowMs);
		await persistence.commitAutomaticAction({
			snapshot: committedSnapshot(),
			binding: binding(),
			mutation: reconcileMutation(),
		});
		const staleFence = await acquireFence(
			persistence,
			WORKSPACE_ID,
			"tab-a",
			nowMs,
		);
		await persistence.rebindWorkspace({
			snapshot: committedSnapshot(OTHER_GIST_ID),
			binding: binding(0, OTHER_GIST_ID),
		});
		expect(
			await persistence.renewLease({
				name: workspaceDispatcherLeaseName(WORKSPACE_ID),
				ownerId: staleFence.ownerId,
				fencingToken: staleFence.fencingToken,
				now: nowMs,
				ttlMs: 100,
			}),
		).toBeNull();

		const currentOrphanFence = await acquireFence(
			persistence,
			WORKSPACE_ID,
			"tab-b",
			nowMs,
		);
		const before = await persistence.read();
		const error = await captureError(
			persistence.commitDeliverySuccess({
				snapshot: committedSnapshot(),
				binding: binding(1),
				mutationId: MUTATION_ID,
				fence: currentOrphanFence,
			}),
		);
		expect(error.code).toBe("corrupt-data");
		const after = await persistence.read();
		expect(after.snapshot).toEqual(before.snapshot);
		expect(after.binding).toEqual(before.binding);
		expect(after.workspaces).toEqual(before.workspaces);
	});

	it("replays the remaining queue after committing its head", async () => {
		const persistence = automaticPersistence();
		await persistence.commitAutomaticAction({
			snapshot: committedSnapshot(),
			binding: binding(),
			mutation: reconcileMutation(),
		});
		await persistence.commitAutomaticAction({
			snapshot: { ...committedSnapshot(), lastUpdated: NOW_2 },
			binding: binding(),
			mutation: reconcileMutation(MUTATION_ID_2, 1, WORKSPACE_ID, NOW_2),
		});
		const fence = await acquireFence(persistence);
		await persistence.commitDeliverySuccess({
			snapshot: { ...committedSnapshot(), lastUpdated: NOW_2 },
			binding: binding(1),
			mutationId: MUTATION_ID,
			fence,
		});
		const stored = await persistence.read();
		expect(stored.binding?.revision).toBe(1);
		expect(stored.snapshot?.lastUpdated).toBe(NOW_2);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([
			reconcileMutation(MUTATION_ID_2, 1, WORKSPACE_ID, NOW_2),
		]);
	});

	it("accepts an explicitly queued manual delivery", async () => {
		const record = createEmptyWorkspacePersistenceRecord();
		record.snapshot = committedSnapshot();
		record.binding = createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(),
			syncMode: "manual",
		});
		record.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [reconcileMutation()],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: null,
				deadLetters: [],
			},
		};
		const persistence = new InMemoryWorkspacePersistence(record);
		const fence = await acquireFence(persistence);
		const manualCommitted = createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(1),
			syncMode: "manual",
		});
		await persistence.commitDeliverySuccess({
			snapshot: committedSnapshot(),
			binding: manualCommitted,
			mutationId: MUTATION_ID,
			fence,
		});
		expect((await persistence.read()).binding?.syncMode).toBe("manual");
	});

	it("rejects an automatic snapshot that differs from queue replay", async () => {
		const persistence = automaticPersistence();
		expect(
			(
				await captureError(
					persistence.commitAutomaticAction({
						snapshot: snapshot("mismatch"),
						binding: binding(),
						mutation: reconcileMutation(),
					}),
				)
			).code,
		).toBe("corrupt-data");
		expect((await persistence.read()).workspaces).toEqual({});
	});

	it("allocates automatic revisions transactionally instead of trusting callers", async () => {
		const persistence = automaticPersistence();
		const [first, second] = await Promise.all([
			persistence.commitAutomaticAction({
				snapshot: committedSnapshot(),
				binding: binding(),
				mutation: mutationDraft(reconcileMutation()),
			}),
			persistence.commitAutomaticAction({
				snapshot: committedSnapshot(),
				binding: binding(),
				mutation: mutationDraft(reconcileMutation(MUTATION_ID_2)),
			}),
		]);
		expect([first.expectedRevision, second.expectedRevision]).toEqual([0, 1]);
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations.map(
				(entry) => entry.expectedRevision,
			),
		).toEqual([0, 1]);
	});

	it("rejects a stale automatic binding without changing persisted state", async () => {
		const persistence = automaticPersistence();
		await persistence.rebindWorkspace({
			snapshot: committedSnapshot(),
			binding: binding(1),
		});
		const before = await persistence.read();

		const error = await captureError(
			persistence.commitAutomaticAction({
				snapshot: committedSnapshot(),
				binding: binding(),
				mutation: reconcileMutation(),
			}),
		);

		expect(error.code).toBe("corrupt-data");
		const after = await persistence.read();
		expect(after.snapshot).toEqual(before.snapshot);
		expect(after.binding).toEqual(before.binding);
		expect(after.workspaces).toEqual(before.workspaces);
	});

	it("rejects a stale local binding without changing persisted state", async () => {
		const persistence = manualPersistence();
		await persistence.rebindWorkspace({
			snapshot: committedSnapshot(),
			binding: manualBinding(1),
		});
		const before = await persistence.read();

		const error = await captureError(
			persistence.commitLocalAction({
				snapshot: snapshot("stale-local"),
				binding: manualBinding(),
			}),
		);

		expect(error.code).toBe("corrupt-data");
		const after = await persistence.read();
		expect(after.snapshot).toEqual(before.snapshot);
		expect(after.binding).toEqual(before.binding);
		expect(after.workspaces).toEqual(before.workspaces);
	});

	it("rejects duplicate IDs, revision gaps, and credential-shaped extensions", () => {
		expect(() =>
			validateWorkspaceMutationSequence([mutation(), mutation(MUTATION_ID, 1)]),
		).toThrow("unique");
		expect(() =>
			validateWorkspaceMutationSequence([
				mutation(),
				mutation(MUTATION_ID_2, 2),
			]),
		).toThrow("contiguous");
		expect(() =>
			validateWorkspacePersistenceRecord({
				...createEmptyWorkspacePersistenceRecord(),
				githubToken: TOKEN_CANARY,
			}),
		).toThrow("unsupported fields");
	});

	it("rejects migration phases with missing or premature evidence", () => {
		const notStarted = createEmptyWorkspacePersistenceRecord();
		notStarted.migration = {
			...notStarted.migration,
			startedAt: NOW,
			updatedAt: NOW,
		};
		expect(() => validateWorkspacePersistenceRecord(notStarted)).toThrow(
			"cannot carry evidence",
		);

		const copied = createEmptyWorkspacePersistenceRecord();
		copied.migration = {
			...copied.migration,
			phase: "copied",
			startedAt: NOW,
			updatedAt: NOW,
		};
		expect(() => validateWorkspacePersistenceRecord(copied)).toThrow(
			"evidence is incomplete",
		);

		const confirmed = createEmptyWorkspacePersistenceRecord();
		confirmed.migration = {
			...confirmed.migration,
			phase: "confirmed",
			startedAt: NOW,
			copiedAt: NOW,
			validatedAt: null,
			confirmedAt: NOW,
			updatedAt: NOW,
		};
		expect(() => validateWorkspacePersistenceRecord(confirmed)).toThrow(
			"evidence is incomplete",
		);
	});
});

describe("queue inspection and repair", () => {
	function seededRecord(): WorkspacePersistenceRecord {
		const record = createEmptyWorkspacePersistenceRecord();
		record.snapshot = snapshot("seeded");
		record.binding = binding();
		record.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [mutation()],
			delivery: {
				retry: { attempt: 2, nextAttemptAt: 1_000, lastErrorCode: "timeout" },
				blocked: null,
				deadLetters: [],
			},
		};
		record.workspaces[OTHER_WORKSPACE_ID] = {
			workspaceId: OTHER_WORKSPACE_ID,
			mutations: [mutation(MUTATION_ID_2, 7, OTHER_WORKSPACE_ID)],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: null,
				deadLetters: [],
			},
		};
		return record;
	}

	it("reports active, total, orphan, blocked, and dead-letter counts", async () => {
		const persistence = new InMemoryWorkspacePersistence(seededRecord());
		const activeFence = await acquireFence(persistence);
		await persistence.blockMutation(
			WORKSPACE_ID,
			{
				mutationId: MUTATION_ID,
				kind: "node.delete",
				code: "entity_exists",
				disposition: "domain-conflict",
				messageKey: "workspace.domain-conflict",
				createdAt: NOW,
				blockedAt: NOW,
			},
			activeFence,
		);
		const orphanFence = await acquireFence(
			persistence,
			OTHER_WORKSPACE_ID,
			"tab-b",
		);
		await persistence.quarantineWorkspaceQueue({
			workspaceId: OTHER_WORKSPACE_ID,
			reason: "revision-gap",
			createdAt: NOW,
			fence: orphanFence,
		});

		const inspection = await persistence.inspectQueues(WORKSPACE_ID);
		expect(inspection.activeQueueCount).toBe(1);
		expect(inspection.totalQueueCount).toBe(1);
		expect(inspection.orphanedWorkspaceCount).toBe(1);
		expect(inspection.blockedCount).toBe(1);
		expect(inspection.deadLetterCount).toBe(1);
		expect(JSON.stringify(inspection)).not.toContain("node-1");
	});

	it("shares persisted retry timing with a restarted dispatcher", async () => {
		const persistence = new InMemoryWorkspacePersistence(seededRecord());
		const fence = await acquireFence(persistence);
		await persistence.setRetryMetadata(
			WORKSPACE_ID,
			MUTATION_ID,
			{
				attempt: 4,
				nextAttemptAt: 42_000,
				lastErrorCode: "upstream_timeout",
			},
			fence,
		);
		const restarted = new InMemoryWorkspacePersistence(
			await persistence.read(),
		);
		const inspection = await restarted.inspectQueues(WORKSPACE_ID);
		expect(inspection.workspaces[0]?.retry).toEqual({
			attempt: 4,
			nextAttemptAt: 42_000,
			lastErrorCode: "upstream_timeout",
		});
	});

	it("discards only a whole Workspace queue and keeps other queues intact", async () => {
		const persistence = new InMemoryWorkspacePersistence(seededRecord());
		expect(
			await persistence.discardWorkspaceQueue({
				workspaceId: OTHER_WORKSPACE_ID,
			}),
		).toBe(1);
		const stored = await persistence.read();
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toHaveLength(1);
		expect(stored.workspaces[OTHER_WORKSPACE_ID]).toBe(undefined);
	});

	it("requires baseline realignment when discarding the active queue", async () => {
		const persistence = new InMemoryWorkspacePersistence(seededRecord());
		const leaseNow = Date.now();
		const fence = await acquireFence(
			persistence,
			WORKSPACE_ID,
			"tab-a",
			leaseNow,
		);
		expect(
			(
				await captureError(
					persistence.discardWorkspaceQueue({ workspaceId: WORKSPACE_ID }),
				)
			).code,
		).toBe("corrupt-data");
		expect(
			await persistence.discardWorkspaceQueue({
				workspaceId: WORKSPACE_ID,
				snapshot: committedSnapshot(),
				binding: binding(),
			}),
		).toBe(1);
		expect((await persistence.read()).workspaces[WORKSPACE_ID]).toBe(undefined);
		expect(
			await persistence.renewLease({
				name: workspaceDispatcherLeaseName(WORKSPACE_ID),
				ownerId: fence.ownerId,
				fencingToken: fence.fencingToken,
				now: leaseNow + 1,
				ttlMs: 100,
			}),
		).toBeNull();
	});

	it("refuses an unsafe rebind and accepts an explicit contiguous repair", async () => {
		const record = seededRecord();
		record.workspaces[OTHER_WORKSPACE_ID]?.mutations.splice(
			0,
			1,
			mutation(MUTATION_ID_2, 7, OTHER_WORKSPACE_ID),
		);
		const persistence = new InMemoryWorkspacePersistence(record);
		const otherBinding = binding(3, OTHER_GIST_ID);
		const error = await captureError(
			persistence.rebindWorkspace({
				snapshot: snapshot("other", OTHER_GIST_ID),
				binding: otherBinding,
			}),
		);
		expect(error.code).toBe("corrupt-data");

		await persistence.repairWorkspaceQueue({
			snapshot: { ...snapshot("other", OTHER_GIST_ID), lastUpdated: NOW },
			binding: otherBinding,
			mutations: [reconcileMutation(MUTATION_ID_3, 3, OTHER_WORKSPACE_ID)],
		});
		const stored = await persistence.read();
		expect(stored.binding?.workspaceId).toBe(OTHER_WORKSPACE_ID);
		expect(
			stored.workspaces[OTHER_WORKSPACE_ID]?.mutations[0]?.expectedRevision,
		).toBe(3);
	});

	it("invalidates the previous Workspace lease when repair switches identity", async () => {
		const nowMs = 100;
		const persistence = automaticPersistence(() => nowMs);
		await persistence.commitAutomaticAction({
			snapshot: committedSnapshot(),
			binding: binding(),
			mutation: reconcileMutation(),
		});
		const staleFence = await acquireFence(
			persistence,
			WORKSPACE_ID,
			"tab-a",
			nowMs,
		);
		await persistence.repairWorkspaceQueue({
			snapshot: committedSnapshot(OTHER_GIST_ID),
			binding: binding(0, OTHER_GIST_ID),
			mutations: [],
		});
		const before = await persistence.read();

		expect(
			await persistence.renewLease({
				name: workspaceDispatcherLeaseName(WORKSPACE_ID),
				ownerId: staleFence.ownerId,
				fencingToken: staleFence.fencingToken,
				now: nowMs,
				ttlMs: 100,
			}),
		).toBeNull();
		const error = await captureError(
			persistence.commitDeliverySuccess({
				snapshot: committedSnapshot(),
				binding: binding(1),
				mutationId: MUTATION_ID,
				fence: staleFence,
			}),
		);
		expect(error.code).toBe("corrupt-data");
		const after = await persistence.read();
		expect(after.snapshot).toEqual(before.snapshot);
		expect(after.binding).toEqual(before.binding);
		expect(after.workspaces).toEqual(before.workspaces);
	});

	it("isolates one structurally corrupt queue and keeps repair reachable", async () => {
		const record = seededRecord();
		record.workspaces[WORKSPACE_ID]?.mutations.push(mutation(MUTATION_ID_3, 2));
		const persistence = new InMemoryWorkspacePersistence(record);
		const inspection = await persistence.inspectQueues(WORKSPACE_ID);
		expect(inspection.activeQueueCount).toBe(0);
		expect(
			inspection.workspaces.find(
				(workspace) => workspace.workspaceId === OTHER_WORKSPACE_ID,
			)?.mutations,
		).toHaveLength(1);
		expect(JSON.stringify(inspection)).not.toContain("node-3");

		await persistence.repairWorkspaceQueue({
			snapshot: committedSnapshot(),
			binding: binding(),
			mutations: [reconcileMutation(MUTATION_ID_3)],
		});
		const repaired = await persistence.read();
		expect(repaired.workspaces[WORKSPACE_ID]?.mutations).toEqual([
			reconcileMutation(MUTATION_ID_3),
		]);
		expect(
			repaired.quarantines.some(
				(entry) => entry.source === `queue:${WORKSPACE_ID}`,
			),
		).toBe(true);
	});

	it("rejects a nonempty repair without an initialized revision", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const uninitialized = createWorkspaceV2LocalState(GIST_ID, {
			syncMode: "automatic",
		});
		expect(
			(
				await captureError(
					persistence.repairWorkspaceQueue({
						snapshot: snapshot("repair"),
						binding: uninitialized,
						mutations: [mutation()],
					}),
				)
			).code,
		).toBe("corrupt-data");
	});
});

describe("dispatcher lease fencing", () => {
	it("rejects prototype-shaped and noncanonical Workspace identities", async () => {
		const persistence = automaticPersistence();
		for (const workspaceId of [
			"__proto__",
			"gist:__proto__",
			"gist:constructor",
			"gist:prototype",
			"gist:nested:value",
		]) {
			const error = await captureError(persistence.inspectQueues(workspaceId));
			expect(error instanceof WorkspacePersistenceError).toBe(true);
			expect(error.code).toBe("corrupt-data");
		}
		expect(
			captureThrown(() => workspaceDispatcherLeaseName("__proto__")) instanceof
				WorkspacePersistenceError,
		).toBe(true);
		const unsafeBinding = createWorkspaceV2LocalState("__proto__");
		for (const operation of [
			() => persistence.discardWorkspaceQueue({ workspaceId: "__proto__" }),
			() =>
				persistence.repairWorkspaceQueue({
					snapshot: snapshot("unsafe", "__proto__"),
					binding: unsafeBinding,
					mutations: [],
				}),
			() =>
				persistence.renewLease({
					name: "dispatcher:gist:__proto__",
					ownerId: "tab-a",
					fencingToken: 1,
					now: 100,
					ttlMs: 100,
				}),
			() =>
				persistence.releaseLease({
					name: "dispatcher:gist:__proto__",
					ownerId: "tab-a",
					fencingToken: 1,
				}),
		]) {
			const error = await captureError(operation());
			expect(error instanceof WorkspacePersistenceError).toBe(true);
			expect(error.code).toBe("corrupt-data");
		}
	});

	it("rejects prototype-shaped persisted queues and lease acquisition", async () => {
		const record = createEmptyWorkspacePersistenceRecord();
		const unsafeMutation = { ...mutation(), workspaceId: "__proto__" };
		Object.defineProperty(record.workspaces, "__proto__", {
			value: {
				workspaceId: "__proto__",
				mutations: [unsafeMutation],
				delivery: {
					retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
					blocked: null,
					deadLetters: [],
				},
			},
			enumerable: true,
		});
		expect(
			captureThrown(() => validateWorkspacePersistenceRecord(record)) instanceof
				WorkspacePersistenceError,
		).toBe(true);
		const leaseRecord = createEmptyWorkspacePersistenceRecord();
		const unsafeLeaseName = "dispatcher:gist:__proto__";
		Object.defineProperty(leaseRecord.leases, unsafeLeaseName, {
			value: {
				name: unsafeLeaseName,
				ownerId: "tab-a",
				fencingToken: 1,
				expiresAt: 200,
				heartbeatAt: 100,
			},
			enumerable: true,
		});
		leaseRecord.nextFencingToken = 2;
		expect(
			captureThrown(() =>
				validateWorkspacePersistenceRecord(leaseRecord),
			) instanceof WorkspacePersistenceError,
		).toBe(true);

		const persistence = new InMemoryWorkspacePersistence();
		const error = await captureError(
			persistence.acquireLease({
				name: unsafeLeaseName,
				ownerId: "tab-a",
				now: 100,
				ttlMs: 100,
			}),
		);
		expect(error instanceof WorkspacePersistenceError).toBe(true);
		expect(error.code).toBe("corrupt-data");
		expect((await persistence.read()).leases).toEqual({});
	});
	it("rejects an expired fence without requiring a takeover", async () => {
		const record = createEmptyWorkspacePersistenceRecord();
		record.snapshot = snapshot("seeded");
		record.binding = binding();
		record.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [mutation()],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: null,
				deadLetters: [],
			},
		};
		let nowMs = 100;
		const persistence = new InMemoryWorkspacePersistence(record, () => nowMs);
		const fence = await acquireFence(persistence, WORKSPACE_ID, "tab-a", nowMs);
		nowMs = 201;
		expect(
			(
				await captureError(
					persistence.setRetryMetadata(
						WORKSPACE_ID,
						MUTATION_ID,
						{ attempt: 1, nextAttemptAt: 500, lastErrorCode: "timeout" },
						fence,
					),
				)
			).code,
		).toBe("corrupt-data");
	});

	it("allows one owner, renews it, and fences a stale owner after takeover", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const name = workspaceDispatcherLeaseName(WORKSPACE_ID);
		const first = await persistence.acquireLease({
			name,
			ownerId: "tab-a",
			now: 100,
			ttlMs: 50,
		});
		expect(first.acquired).toBe(true);
		if (!first.acquired) throw new Error("lease not acquired");
		const denied = await persistence.acquireLease({
			name,
			ownerId: "tab-b",
			now: 120,
			ttlMs: 50,
		});
		expect(denied.acquired).toBe(false);

		const renewed = await persistence.renewLease({
			name,
			ownerId: "tab-a",
			fencingToken: first.lease.fencingToken,
			now: 130,
			ttlMs: 50,
		});
		expect(renewed?.expiresAt).toBe(180);
		const takeover = await persistence.acquireLease({
			name,
			ownerId: "tab-b",
			now: 181,
			ttlMs: 50,
		});
		expect(takeover.acquired).toBe(true);
		if (!takeover.acquired) throw new Error("lease not acquired");
		expect(takeover.lease.fencingToken).toBeGreaterThan(
			first.lease.fencingToken,
		);
		expect(
			await persistence.renewLease({
				name,
				ownerId: "tab-a",
				fencingToken: first.lease.fencingToken,
				now: 182,
				ttlMs: 50,
			}),
		).toBeNull();
		expect(
			await persistence.releaseLease({
				name,
				ownerId: "tab-a",
				fencingToken: first.lease.fencingToken,
			}),
		).toBe(false);
	});

	it("rejects stale retry, block, and quarantine transitions", async () => {
		let nowMs = 100;
		const persistence = new InMemoryWorkspacePersistence(
			(() => {
				const record = createEmptyWorkspacePersistenceRecord();
				record.snapshot = snapshot("seeded");
				record.binding = binding();
				record.workspaces[WORKSPACE_ID] = {
					workspaceId: WORKSPACE_ID,
					mutations: [mutation()],
					delivery: {
						retry: {
							attempt: 0,
							nextAttemptAt: null,
							lastErrorCode: null,
						},
						blocked: null,
						deadLetters: [],
					},
				};
				return record;
			})(),
			() => nowMs,
		);
		const stale = await acquireFence(persistence, WORKSPACE_ID, "tab-a", nowMs);
		nowMs = 201;
		const current = await acquireFence(persistence, WORKSPACE_ID, "tab-b", 201);
		const staleAt = stale;
		expect(
			(
				await captureError(
					persistence.setRetryMetadata(
						WORKSPACE_ID,
						MUTATION_ID,
						{
							attempt: 1,
							nextAttemptAt: 500,
							lastErrorCode: "timeout",
						},
						staleAt,
					),
				)
			).code,
		).toBe("corrupt-data");
		expect(
			(
				await captureError(
					persistence.blockMutation(
						WORKSPACE_ID,
						{
							mutationId: MUTATION_ID,
							kind: "node.delete",
							code: "entity_exists",
							disposition: "domain-conflict",
							messageKey: "workspace.domain-conflict",
							createdAt: NOW,
							blockedAt: NOW,
						},
						staleAt,
					),
				)
			).code,
		).toBe("corrupt-data");
		expect(
			(
				await captureError(
					persistence.quarantineWorkspaceQueue({
						workspaceId: WORKSPACE_ID,
						reason: "queue-corruption",
						createdAt: NOW,
						fence: staleAt,
					}),
				)
			).code,
		).toBe("corrupt-data");

		expect(
			(
				await captureError(
					persistence.setRetryMetadata(
						WORKSPACE_ID,
						MUTATION_ID_2,
						{ attempt: 1, nextAttemptAt: 500, lastErrorCode: "timeout" },
						current,
					),
				)
			).code,
		).toBe("corrupt-data");
		expect(
			(
				await captureError(
					persistence.blockMutation(
						WORKSPACE_ID,
						{
							mutationId: MUTATION_ID_2,
							kind: "node.delete",
							code: "entity_exists",
							disposition: "domain-conflict",
							messageKey: "workspace.domain-conflict",
							createdAt: NOW,
							blockedAt: NOW,
						},
						current,
					),
				)
			).code,
		).toBe("corrupt-data");
		await persistence.setRetryMetadata(
			WORKSPACE_ID,
			MUTATION_ID,
			{ attempt: 1, nextAttemptAt: 500, lastErrorCode: "timeout" },
			current,
		);
		expect(
			(await persistence.inspectQueues(WORKSPACE_ID)).workspaces[0]?.retry
				.attempt,
		).toBe(1);
	});

	it("rejects credential canaries in every safe metadata field", async () => {
		const record = createEmptyWorkspacePersistenceRecord();
		record.snapshot = snapshot("seeded");
		record.binding = binding();
		record.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [mutation()],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: null,
				deadLetters: [],
			},
		};
		const persistence = new InMemoryWorkspacePersistence(record);
		const fence = await acquireFence(persistence);
		const canary = "ghp_credential_canary";
		expect(
			(
				await captureError(
					persistence.setRetryMetadata(
						WORKSPACE_ID,
						MUTATION_ID,
						{ attempt: 1, nextAttemptAt: 500, lastErrorCode: canary },
						fence,
					),
				)
			).code,
		).toBe("corrupt-data");
		const blocked = {
			mutationId: MUTATION_ID,
			kind: "node.delete" as const,
			code: "entity_exists",
			disposition: "domain-conflict" as const,
			messageKey: "workspace.domain-conflict",
			createdAt: NOW,
			blockedAt: NOW,
		};
		for (const metadata of [
			{ ...blocked, code: canary },
			{ ...blocked, messageKey: canary },
			{ ...blocked, createdAt: canary },
			{ ...blocked, blockedAt: canary },
		]) {
			expect(
				(
					await captureError(
						persistence.blockMutation(WORKSPACE_ID, metadata, fence),
					)
				).code,
			).toBe("corrupt-data");
		}
		for (const input of [
			{ reason: canary, createdAt: NOW },
			{ reason: "queue-corruption", createdAt: canary },
		]) {
			expect(
				(
					await captureError(
						persistence.quarantineWorkspaceQueue({
							workspaceId: WORKSPACE_ID,
							...input,
							fence,
						}),
					)
				).code,
			).toBe("corrupt-data");
		}
	});
});

describe("legacy persistence migration", () => {
	it("retries every interrupted pre-commit boundary without deleting legacy keys", async () => {
		const points: WorkspacePersistenceFaultPoint[] = [
			"before-transaction",
			"after-snapshot",
			"after-binding",
			"after-queue",
			"before-commit",
		];
		for (const point of points) {
			const storage = new MemoryStorage();
			seedLegacy(storage);
			const persistence = new InMemoryWorkspacePersistence();
			persistence.setFault(point);
			const error = await captureError(
				migrateLegacyWorkspacePersistence(persistence, storage, {
					now: () => NOW,
				}),
			);
			expect(error.code).toBe("transaction-aborted");
			expect(storage.getItem(LEGACY_APP_STATE_KEY) === null).toBe(false);
			expect((await persistence.read()).migration.phase).toBe("not-started");

			await migrateLegacyWorkspacePersistence(persistence, storage, {
				now: () => NOW,
			});
			const migrated = (await persistence.read()).migration;
			expect(migrated.phase).toBe("confirmed");
			expect(migrated.cleanupCompletedAt).toBe(NOW);
			expect(storage.getItem(LEGACY_APP_STATE_KEY)).toBeNull();
		}
	});

	it("resumes after database commit but before legacy cleanup", async () => {
		const storage = new MemoryStorage();
		seedLegacy(storage);
		const persistence = new InMemoryWorkspacePersistence();
		persistence.setFault("after-commit");
		const error = await captureError(
			migrateLegacyWorkspacePersistence(persistence, storage, {
				now: () => NOW,
			}),
		);
		expect(error.code).toBe("transaction-aborted");
		expect((await persistence.read()).migration.phase).toBe("copied");
		expect(storage.getItem(LEGACY_MUTATION_QUEUE_KEY) === null).toBe(false);

		await migrateLegacyWorkspacePersistence(persistence, storage, {
			now: () => NOW,
		});
		const stored = await persistence.read();
		expect(stored.migration.phase).toBe("confirmed");
		expect(stored.migration.cleanupCompletedAt).toBe(NOW);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([mutation()]);
	});

	it("retries a partially interrupted legacy-key removal", async () => {
		const storage = new MemoryStorage();
		seedLegacy(storage);
		storage.failRemoveKey = LEGACY_WORKSPACE_STATE_KEY;
		const persistence = new InMemoryWorkspacePersistence();
		const error = await captureError(
			migrateLegacyWorkspacePersistence(persistence, storage, {
				now: () => NOW,
			}),
		);
		expect(error.message).toContain("legacy removal interrupted");
		const interrupted = (await persistence.read()).migration;
		expect(interrupted.phase).toBe("confirmed");
		expect(interrupted.cleanupCompletedAt).toBeNull();
		storage.failRemoveKey = null;
		await migrateLegacyWorkspacePersistence(persistence, storage, {
			now: () => NOW,
		});
		const completed = (await persistence.read()).migration;
		expect(completed.phase).toBe("confirmed");
		expect(completed.cleanupCompletedAt).toBe(NOW);
	});

	it("rejects a prototype-shaped legacy queue without wedging migration", async () => {
		const unsafeMutation: WorkspaceMutation = {
			...mutation(),
			workspaceId: "__proto__",
		};
		const persistence = new InMemoryWorkspacePersistence();
		const error = await captureError(
			persistence.importLegacy({
				snapshot: null,
				binding: null,
				mutations: [unsafeMutation],
				quarantines: [],
				quarantinePayloads: {},
				startedAt: NOW,
				copiedAt: NOW,
			}),
		);
		expect(error instanceof WorkspacePersistenceError).toBe(true);
		expect(error.code).toBe("corrupt-data");
		expect((await persistence.read()).migration.phase).toBe("not-started");

		const storage = new MemoryStorage();
		storage.setItem(
			LEGACY_MUTATION_QUEUE_KEY,
			JSON.stringify({ version: 2, mutations: [unsafeMutation] }),
		);
		await migrateLegacyWorkspacePersistence(persistence, storage, {
			now: () => NOW,
		});
		const stored = await persistence.read();
		expect(stored.migration.phase).toBe("confirmed");
		expect(
			stored.quarantines.some(
				(entry) => entry.reason === "invalid-legacy-queue",
			),
		).toBe(true);
		expect(storage.getItem(LEGACY_MUTATION_QUEUE_KEY)).toBeNull();
	});

	it("isolates corrupt queue metadata and never migrates auth storage", async () => {
		const storage = new MemoryStorage();
		storage.setItem(LEGACY_APP_STATE_KEY, JSON.stringify(snapshot("legacy")));
		storage.setItem(LEGACY_WORKSPACE_STATE_KEY, JSON.stringify(binding()));
		storage.setItem(LEGACY_MUTATION_QUEUE_KEY, `corrupt-${TOKEN_CANARY}`);
		storage.setItem("subman:auth:v2", TOKEN_CANARY);
		const persistence = new InMemoryWorkspacePersistence();
		await migrateLegacyWorkspacePersistence(persistence, storage, {
			now: () => NOW,
		});
		const stored = await persistence.read();
		expect(stored.workspaces).toEqual({});
		expect(stored.quarantines).toHaveLength(1);
		expect(stored.quarantines[0]?.source).toBe(LEGACY_MUTATION_QUEUE_KEY);
		expect(JSON.stringify(await persistence.inspectQueues())).not.toContain(
			TOKEN_CANARY,
		);
		expect(
			await persistence.readQuarantinePayloadForRepair(
				stored.quarantines[0]?.id ?? "",
			),
		).toContain(TOKEN_CANARY);
		expect(storage.getItem("subman:auth:v2")).toBe(TOKEN_CANARY);
	});

	it("migrates existing quarantine payloads and removes them after confirmation", async () => {
		const storage = new MemoryStorage();
		seedLegacy(storage);
		const quarantineKey = `${LEGACY_MUTATION_QUEUE_KEY}:quarantine:old`;
		storage.setItem(quarantineKey, `inaccessible-${TOKEN_CANARY}`);
		const persistence = new InMemoryWorkspacePersistence();
		await migrateLegacyWorkspacePersistence(persistence, storage, {
			now: () => NOW,
		});
		const stored = await persistence.read();
		const metadata = stored.quarantines.find(
			(entry) => entry.source === quarantineKey,
		);
		expect(metadata === undefined).toBe(false);
		expect(
			await persistence.readQuarantinePayloadForRepair(metadata?.id ?? ""),
		).toContain(TOKEN_CANARY);
		expect(JSON.stringify(await persistence.inspectQueues())).not.toContain(
			TOKEN_CANARY,
		);
		expect(storage.getItem(quarantineKey)).toBeNull();
	});

	it("quarantines a mismatched legacy binding instead of wedging migration", async () => {
		const storage = new MemoryStorage();
		storage.setItem(LEGACY_APP_STATE_KEY, JSON.stringify(snapshot("legacy")));
		storage.setItem(
			LEGACY_WORKSPACE_STATE_KEY,
			JSON.stringify(binding(0, OTHER_GIST_ID)),
		);
		const persistence = new InMemoryWorkspacePersistence();
		await migrateLegacyWorkspacePersistence(persistence, storage, {
			now: () => NOW,
		});
		const stored = await persistence.read();
		expect(stored.snapshot?.activeGistId).toBe(GIST_ID);
		expect(stored.binding).toBeNull();
		expect(stored.migration.phase).toBe("confirmed");
		expect(
			stored.quarantines.some(
				(entry) => entry.reason === "legacy-identity-mismatch",
			),
		).toBe(true);
	});
});

describe("storage failure classification", () => {
	it("persists records and serializes writers across IndexedDB clients", async () => {
		const factory = new DeterministicIdbFactory() as unknown as IDBFactory;
		const first = new TransactionalWorkspacePersistence(
			new IndexedDbWorkspacePersistenceBackend(factory, "deterministic-idb"),
		);
		const second = new TransactionalWorkspacePersistence(
			new IndexedDbWorkspacePersistenceBackend(factory, "deterministic-idb"),
		);
		const manual = manualBinding();
		await first.rebindWorkspace({
			snapshot: committedSnapshot(),
			binding: manual,
		});
		await first.commitLocalAction({
			snapshot: snapshot("indexed-db"),
			binding: manual,
		});
		expect((await second.read()).snapshot?.lastUpdated).toContain("indexed-db");

		const name = workspaceDispatcherLeaseName(WORKSPACE_ID);
		const [ownerA, ownerB] = await Promise.all([
			first.acquireLease({ name, ownerId: "tab-a", now: 100, ttlMs: 100 }),
			second.acquireLease({ name, ownerId: "tab-b", now: 100, ttlMs: 100 }),
		]);
		expect([ownerA, ownerB].filter((result) => result.acquired)).toHaveLength(
			1,
		);
		expect((await first.read()).nextFencingToken).toBe(2);
	});

	it("classifies quota, abort, upgrade, and unsupported storage failures", async () => {
		expect(
			classifyWorkspacePersistenceError({ name: "QuotaExceededError" }).code,
		).toBe("quota-exceeded");
		expect(classifyWorkspacePersistenceError({ name: "AbortError" }).code).toBe(
			"transaction-aborted",
		);
		expect(
			classifyWorkspacePersistenceError({ name: "VersionError" }).code,
		).toBe("upgrade-failed");

		const unsupported = new TransactionalWorkspacePersistence(
			new IndexedDbWorkspacePersistenceBackend(undefined),
		);
		expect((await captureError(unsupported.read())).code).toBe("unsupported");
	});

	it("classifies an IndexedDB open failure as an upgrade failure", async () => {
		const factory = {
			open: () => {
				throw { name: "VersionError" };
			},
		} as unknown as IDBFactory;
		const persistence = new TransactionalWorkspacePersistence(
			new IndexedDbWorkspacePersistenceBackend(factory, "test-upgrade-failure"),
		);
		expect((await captureError(persistence.read())).code).toBe(
			"upgrade-failed",
		);
	});
});
