import { describe, expect, it } from "bun:test";
import type { AppState, GistMeta, NodeItem } from "$lib/models";
import {
	commitQueuedBrowserWorkspaceMutation,
	persistBrowserWorkspaceSnapshot,
	readBrowserWorkspaceSnapshot,
	reconcileBrowserWorkspace,
	submitBrowserWorkspaceMutation,
} from "$lib/workspace-browser-session-v2";
import {
	createDefaultWorkspaceState,
	serializeWorkspaceState,
} from "$lib/workspace-data";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import {
	subscribeWorkspaceEvents,
	type WorkspaceEvent,
} from "$lib/workspace-events";
import type { WorkspaceFailureDisposition } from "$lib/workspace-failure-disposition";
import {
	parseWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import {
	InMemoryWorkspacePersistence,
	type WorkspacePersistenceRecord,
	workspaceDispatcherLeaseName,
} from "$lib/workspace-persistence";
import {
	createDefaultWorkspaceSyncStatus,
	transitionWorkspaceSyncState,
	type WorkspaceSyncEvent,
	type WorkspaceSyncStatus,
} from "$lib/workspace-sync-state-machine";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	type WorkspaceV2LocalState,
} from "$lib/workspace-v2-state";

const NOW = "2026-07-22T17:00:00.000Z";
const LATER = "2026-07-22T17:01:00.000Z";
const MUTATION_ID = "b0000000-0000-4000-8000-000000000001";
const MUTATION_ID_2 = "b0000000-0000-4000-8000-000000000002";
const MUTATION_ID_3 = "b0000000-0000-4000-8000-000000000003";

function node(id: string, name = id): NodeItem {
	return {
		id,
		name,
		type: "vless",
		raw: `vless://${id}`,
		tags: [],
		enabled: true,
		updatedAt: NOW,
		source: "single",
	};
}

function gist(fileName: string): GistMeta {
	return {
		id: "gist-1",
		description: "SubMan-Data",
		files: [{ filename: fileName, language: "JSON", size: 1 }],
		updatedAt: NOW,
		url: "https://gist.github.com/gist-1",
	};
}

function document(
	revision = 1,
	lastMutationId: string | null = MUTATION_ID,
	nodes: NodeItem[] = [node("local")],
): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: "gist:gist-1",
		revision,
		updatedAt: revision > 1 ? LATER : NOW,
		lastMutationId,
		data: {
			nodes,
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

function stateFor(documentValue: WorkspaceDocumentV2): AppState {
	return hydrateAppStateFromWorkspaceDocument(
		createDefaultWorkspaceState(NOW),
		documentValue,
		"gist-1",
	);
}

function mutation(
	mutationId: string,
	expectedRevision: number,
	name: string,
	createdAt = NOW,
): WorkspaceMutation {
	return parseWorkspaceMutation({
		mutationId,
		workspaceId: "gist:gist-1",
		expectedRevision,
		source: "browser",
		createdAt,
		kind: "node.upsert",
		payload: {
			operation: "replace",
			node: node("local", name),
		},
	});
}

function committedResponse(documentValue: WorkspaceDocumentV2): Response {
	return Response.json({
		document: documentValue,
		mutationId: documentValue.lastMutationId,
		workspaceId: documentValue.workspaceId,
		committedRevision: documentValue.revision,
		committedAt: documentValue.updatedAt,
		receipt: { kind: "workspace.reconcile" },
		status: "committed",
	});
}

function failureResponse(
	status: number,
	code: string,
	disposition: WorkspaceFailureDisposition,
	latest?: WorkspaceDocumentV2,
): Response {
	const error = { code, message: code, disposition };
	return Response.json(
		latest ? { error, document: latest, revision: latest.revision } : { error },
		{ status },
	);
}

function collectSessionEvents(order: string[] = []): {
	broadcasts: WorkspaceEvent[];
	syncEvents: WorkspaceSyncEvent[];
	acceptedSyncEvents: boolean[];
	getSyncStatus: () => WorkspaceSyncStatus;
	broadcast: (event: WorkspaceEvent) => void;
	dispatchSyncEvent: (event: WorkspaceSyncEvent) => boolean;
} {
	const broadcasts: WorkspaceEvent[] = [];
	const syncEvents: WorkspaceSyncEvent[] = [];
	const acceptedSyncEvents: boolean[] = [];
	let syncStatus = createDefaultWorkspaceSyncStatus();
	return {
		broadcasts,
		syncEvents,
		acceptedSyncEvents,
		getSyncStatus: () => syncStatus,
		broadcast: (event) => {
			broadcasts.push(event);
			order.push(`broadcast:${event.type}`);
		},
		dispatchSyncEvent: (event) => {
			syncEvents.push(event);
			order.push(`sync:${event.type}`);
			const transition = transitionWorkspaceSyncState(syncStatus, event);
			acceptedSyncEvents.push(transition.accepted);
			syncStatus = transition.state;
			return transition.accepted;
		},
	};
}

class PeerSettlesBetweenReadsPersistence extends InMemoryWorkspacePersistence {
	private readCount = 0;

	constructor(
		private readonly peerSnapshot: AppState,
		private readonly peerBinding: WorkspaceV2LocalState,
	) {
		super();
	}

	override async read(): Promise<WorkspacePersistenceRecord> {
		const record = await super.read();
		this.readCount += 1;
		if (this.readCount === 2) {
			await this.discardWorkspaceQueue({
				workspaceId: this.peerBinding.workspaceId,
				snapshot: this.peerSnapshot,
				binding: this.peerBinding,
			});
		}
		return record;
	}
}

class ReadFailsAfterExplicitCommitPersistence extends InMemoryWorkspacePersistence {
	private failedReads = 0;

	override async commitExplicitAction(
		input: Parameters<InMemoryWorkspacePersistence["commitExplicitAction"]>[0],
	) {
		const committed = await super.commitExplicitAction(input);
		this.failedReads = 1;
		return committed;
	}

	override async read(): Promise<WorkspacePersistenceRecord> {
		if (this.failedReads > 0) {
			this.failedReads -= 1;
			throw new Error("injected post-explicit-commit read failure");
		}
		return super.read();
	}
}

class ReadFailsAfterDeliveryCommitPersistence extends InMemoryWorkspacePersistence {
	private failedReads = 0;

	override async commitDeliverySuccess(
		input: Parameters<InMemoryWorkspacePersistence["commitDeliverySuccess"]>[0],
	): Promise<void> {
		await super.commitDeliverySuccess(input);
		this.failedReads = 1;
	}

	override async read(): Promise<WorkspacePersistenceRecord> {
		if (this.failedReads > 0) {
			this.failedReads -= 1;
			throw new Error("injected post-delivery-commit read failure");
		}
		return super.read();
	}
}

async function seed(
	persistence: InMemoryWorkspacePersistence,
	state: AppState,
	binding: WorkspaceV2LocalState,
	mutations: WorkspaceMutation[] = [],
): Promise<void> {
	if (mutations.length > 0) {
		const expected = await persistence.read();
		await persistence.repairWorkspaceQueue({
			snapshot: state,
			binding,
			mutations,
			expected: {
				snapshot: expected.snapshot,
				binding: expected.binding,
				queue: expected.workspaces[binding.workspaceId] ?? null,
			},
		});
		return;
	}
	await persistence.rebindWorkspace({ snapshot: state, binding });
}

describe("browser Workspace V2 session", () => {
	it("normalizes legacy and bootstrap workspaces into revision-zero baselines", async () => {
		const current = {
			...createDefaultWorkspaceState(),
			nodes: [node("local")],
		};
		const legacy = await readBrowserWorkspaceSnapshot(
			"token",
			gist("subman.json"),
			current,
			{
				readContent: async () =>
					serializeWorkspaceState(current, { exportedAt: NOW }),
				now: () => NOW,
			},
		);
		const bootstrap = await readBrowserWorkspaceSnapshot(
			"token",
			gist("subman.bootstrap.json"),
			current,
			{ now: () => NOW },
		);

		expect(legacy.origin).toBe("v1");
		expect(legacy.document.revision).toBe(0);
		expect(legacy.state.nodes[0]?.id).toBe("local");
		expect(bootstrap.origin).toBe("bootstrap");
		expect(bootstrap.document.data.nodes).toEqual([]);
	});

	it("accepts a remote snapshot by atomically discarding the complete active queue", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		const binding = createWorkspaceV2LocalState("gist-1", { baseline });
		const queued = mutation(MUTATION_ID_2, 1, "optimistic");
		const optimistic = {
			...stateFor(document(2, MUTATION_ID_2, [node("local", "optimistic")])),
			lastUpdated: NOW,
		};
		await seed(persistence, optimistic, binding, [queued]);
		let state = optimistic;
		const remote = document(4, MUTATION_ID_3, [node("remote")]);

		await persistBrowserWorkspaceSnapshot(
			{ origin: "v2", document: remote, state: stateFor(remote) },
			"gist-1",
			"automatic",
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
			},
		);

		const stored = await persistence.read();
		expect(stored.binding?.revision).toBe(4);
		expect(stored.workspaces["gist:gist-1"]).toBe(undefined);
		expect(stored.snapshot?.nodes[0]?.id).toBe("remote");
		expect(state.nodes[0]?.id).toBe("remote");
	});

	it("atomically replaces pending work with an explicit reconcile and commits it", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		const binding = createWorkspaceV2LocalState("gist-1", { baseline });
		const oldMutation = mutation(MUTATION_ID_2, 1, "old");
		const resolved = stateFor(document(2, MUTATION_ID_3, [node("resolved")]));
		await seed(
			persistence,
			{
				...stateFor(document(2, MUTATION_ID_2, [node("local", "old")])),
				lastUpdated: NOW,
			},
			binding,
			[oldMutation],
		);
		let state = resolved;
		let requestBody = "";
		const events = collectSessionEvents();

		await reconcileBrowserWorkspace(
			{
				token: "token",
				gistId: "gist-1",
				baseline,
				resolvedState: resolved,
				syncMode: "automatic",
				replacePending: true,
			},
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				mutationId: () => MUTATION_ID_3,
				now: () => NOW,
				fetchImpl: async (_input, init) => {
					requestBody = String(init?.body);
					return committedResponse(
						document(2, MUTATION_ID_3, [node("resolved")]),
					);
				},
				broadcast: events.broadcast,
				dispatchSyncEvent: events.dispatchSyncEvent,
			},
		);

		expect(requestBody).toContain(MUTATION_ID_3);
		expect(requestBody).not.toContain(MUTATION_ID_2);
		const stored = await persistence.read();
		expect(stored.workspaces["gist:gist-1"]?.mutations).toEqual([]);
		expect(stored.binding?.revision).toBe(2);
		expect(state.nodes[0]?.name).toBe("resolved");
		expect(events.broadcasts.map((event) => event.type)).toEqual([
			"workspace-v2-committed",
		]);
		expect(events.syncEvents.map((event) => event.type)).toEqual([
			"SYNC_CONTEXT_LOADED",
		]);
		expect(events.acceptedSyncEvents).toEqual([true]);
	});

	it("returns retry-scheduled for a durable reconcile without throwing", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		let state: AppState = {
			...createDefaultWorkspaceState(NOW),
			nodes: [node("local")],
			activeGistId: "gist-1",
			activeGistFile: "subman.json",
		};
		const baseline = document(0, null, []);
		const order: string[] = [];
		const events = collectSessionEvents(order);

		const result = await reconcileBrowserWorkspace(
			{
				token: "token",
				gistId: "gist-1",
				baseline,
				resolvedState: state,
				syncMode: "automatic",
			},
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
					order.push("hydrated");
				},
				mutationId: () => MUTATION_ID,
				now: () => NOW,
				fetchImpl: async () => {
					throw new Error("offline");
				},
				broadcast: events.broadcast,
				dispatchSyncEvent: events.dispatchSyncEvent,
			},
		);
		expect(result.status).toBe("retry-scheduled");
		expect(result.mutationId).toBe(MUTATION_ID);
		if (result.status !== "retry-scheduled") {
			throw new Error("Expected retry-scheduled result");
		}
		expect(result.attempt).toBe(1);
		expect(result.lastErrorCode).toBe("network_error");

		const stored = await persistence.read();
		expect(stored.workspaces["gist:gist-1"]?.mutations[0]?.mutationId).toBe(
			MUTATION_ID,
		);
		expect(stored.workspaces["gist:gist-1"]?.delivery.retry.attempt).toBe(1);
		expect(events.syncEvents.map((event) => event.type)).toEqual([
			"SYNC_CONTEXT_LOADED",
			"SYNC_STARTED",
			"SYNC_RETRY_SCHEDULED",
		]);
		expect(events.acceptedSyncEvents).toEqual([true, true, true]);
		expect(events.broadcasts.map((event) => event.type)).toEqual([
			"mutation-queue-changed",
		]);
		expect(events.broadcasts[0]?.queueAction).toBe(undefined);
		expect(
			order.indexOf("hydrated") < order.indexOf("sync:SYNC_RETRY_SCHEDULED"),
		).toBe(true);
	});

	it("rejects an uninitialized session before a durable commit", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const state = createDefaultWorkspaceState(NOW);
		const result = await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "output.delete",
				payload: { fileName: "a.txt" },
			},
			{
				persistence,
				getState: () => state,
				setState: () => {},
				mutationId: () => MUTATION_ID_2,
			},
		);

		expect(result.status).toBe("rejected-before-durable-commit");
		expect(result.durable).toBe(false);
		expect(result.mutationId).toBe(MUTATION_ID_2);
		if (result.status !== "rejected-before-durable-commit") {
			throw new Error("Expected a pre-commit rejection");
		}
		expect(result.message).toBe("Workspace V2 is not initialized");
		expect((await persistence.read()).workspaces).toEqual({});
	});

	it("rejects identity mismatch before persisting an explicit mutation", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		await seed(
			persistence,
			stateFor(baseline),
			createWorkspaceV2LocalState("gist-1", { baseline }),
		);
		const mismatched = {
			...stateFor(baseline),
			activeGistId: "different-gist",
		};

		const result = await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "output.delete",
				payload: { fileName: "a.txt" },
			},
			{
				persistence,
				getState: () => mismatched,
				setState: () => {},
				mutationId: () => MUTATION_ID_2,
			},
		);

		expect(result.status).toBe("rejected-before-durable-commit");
		expect(result.durable).toBe(false);
		expect(result.mutationId).toBe(MUTATION_ID_2);
		if (result.status !== "rejected-before-durable-commit") {
			throw new Error("Expected a pre-commit rejection");
		}
		expect(result.message).toBe("Workspace identity requires repair");
		expect((await persistence.read()).workspaces).toEqual({});
	});

	it("rejects paused-conflict delivery before persisting a mutation", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		const state = stateFor(baseline);
		await seed(
			persistence,
			state,
			createWorkspaceV2LocalState("gist-1", {
				baseline,
				syncMode: "paused-conflict",
			}),
		);

		const result = await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "output.delete",
				payload: { fileName: "a.txt" },
			},
			{
				persistence,
				getState: () => state,
				setState: () => {},
				mutationId: () => MUTATION_ID_2,
			},
		);

		expect(result.status).toBe("rejected-before-durable-commit");
		expect(result.durable).toBe(false);
		expect(result.mutationId).toBe(MUTATION_ID_2);
		if (result.status !== "rejected-before-durable-commit") {
			throw new Error("Expected a pre-commit rejection");
		}
		expect(result.message).toBe(
			"Workspace synchronization is paused by a conflict",
		);
		expect((await persistence.read()).workspaces).toEqual({});
	});

	it("requires opt-in for manual delivery and preserves manual mode after commit", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		const binding = createWorkspaceV2LocalState("gist-1", {
			baseline,
			syncMode: "manual",
		});
		let state = stateFor(baseline);
		await seed(persistence, state, binding);

		const rejected = await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "output.delete",
				payload: { fileName: "a.txt" },
			},
			{
				persistence,
				getState: () => state,
				setState: () => {},
				mutationId: () => MUTATION_ID_2,
			},
		);
		expect(rejected.status).toBe("rejected-before-durable-commit");
		expect(rejected.durable).toBe(false);
		expect(rejected.mutationId).toBe(MUTATION_ID_2);
		if (rejected.status !== "rejected-before-durable-commit") {
			throw new Error("Expected a pre-commit rejection");
		}
		expect(rejected.message).toBe(
			"Push local Workspace changes before publishing",
		);

		await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "output.delete",
				payload: { fileName: "a.txt" },
			},
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				allowManual: true,
				mutationId: () => MUTATION_ID_2,
				now: () => NOW,
				fetchImpl: async () =>
					Response.json({
						document: document(2, MUTATION_ID_2),
						mutationId: MUTATION_ID_2,
						workspaceId: "gist:gist-1",
						committedRevision: 2,
						committedAt: LATER,
						receipt: { kind: "output.delete", deleted: true },
						status: "committed",
					}),
			},
		);

		const stored = await persistence.read();
		expect(stored.binding?.syncMode).toBe("manual");
		expect(stored.binding?.revision).toBe(2);
		expect(stored.workspaces["gist:gist-1"]?.mutations).toEqual([]);
	});

	it("keeps one explicit mutation when its post-commit read fails", async () => {
		const persistence = new ReadFailsAfterExplicitCommitPersistence();
		const baseline = document();
		const state = stateFor(baseline);
		await seed(
			persistence,
			state,
			createWorkspaceV2LocalState("gist-1", { baseline }),
		);
		let generatedIds = 0;
		let requests = 0;

		const result = await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "output.delete",
				payload: { fileName: "a.txt" },
			},
			{
				persistence,
				getState: () => state,
				setState: () => {},
				mutationId: () => {
					generatedIds += 1;
					return generatedIds === 1 ? MUTATION_ID_2 : MUTATION_ID_3;
				},
				now: () => NOW,
				fetchImpl: async () => {
					requests += 1;
					return committedResponse(document(2, MUTATION_ID_2));
				},
			},
		);

		expect(result.status).toBe("commit-acknowledgement-uncertain");
		expect(result.durable).toBe("uncertain");
		expect(result.mutationId).toBe(MUTATION_ID_2);
		expect(generatedIds).toBe(1);
		expect(requests).toBe(0);
		expect(
			(await persistence.read()).workspaces["gist:gist-1"]?.mutations.map(
				(item) => item.mutationId,
			),
		).toEqual([MUTATION_ID_2]);
	});

	it("does not retry a remote commit when its persisted acknowledgement read fails", async () => {
		const persistence = new ReadFailsAfterDeliveryCommitPersistence();
		const baseline = document();
		let state = stateFor(baseline);
		await seed(
			persistence,
			state,
			createWorkspaceV2LocalState("gist-1", { baseline }),
		);
		let generatedIds = 0;
		let requests = 0;

		const result = await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "node.upsert",
				payload: { operation: "replace", node: node("local", "committed") },
			},
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				mutationId: () => {
					generatedIds += 1;
					return generatedIds === 1 ? MUTATION_ID_2 : MUTATION_ID_3;
				},
				now: () => NOW,
				fetchImpl: async () => {
					requests += 1;
					return Response.json({
						document: document(2, MUTATION_ID_2, [node("local", "committed")]),
						mutationId: MUTATION_ID_2,
						workspaceId: "gist:gist-1",
						committedRevision: 2,
						committedAt: LATER,
						receipt: { kind: "node.upsert", entityId: "local" },
						status: "committed",
					});
				},
			},
		);

		expect(result.status).toBe("commit-acknowledgement-uncertain");
		expect(result.durable).toBe("uncertain");
		expect(result.mutationId).toBe(MUTATION_ID_2);
		expect(generatedIds).toBe(1);
		expect(requests).toBe(1);
		const stored = await persistence.read();
		expect(stored.binding?.revision).toBe(2);
		expect(stored.workspaces["gist:gist-1"]?.mutations).toEqual([]);
	});

	it("commits a selected queued mutation in FIFO order", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		const first = mutation(MUTATION_ID_2, 1, "first");
		const second = mutation(MUTATION_ID_3, 2, "second", LATER);
		const optimisticNode = { ...node("local", "second"), updatedAt: LATER };
		const optimistic = stateFor(document(3, MUTATION_ID_3, [optimisticNode]));
		await seed(
			persistence,
			optimistic,
			createWorkspaceV2LocalState("gist-1", { baseline }),
			[first, second],
		);
		let state = optimistic;
		let requests = 0;
		const events = collectSessionEvents();

		await commitQueuedBrowserWorkspaceMutation(
			{ token: "token", mutationId: MUTATION_ID_2 },
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				fetchImpl: async (_input, init) => {
					requests += 1;
					expect(String(init?.body)).toContain(MUTATION_ID_2);
					return Response.json({
						document: document(2, MUTATION_ID_2, [node("local", "first")]),
						mutationId: MUTATION_ID_2,
						workspaceId: "gist:gist-1",
						committedRevision: 2,
						committedAt: LATER,
						receipt: { kind: "node.upsert", entityId: "local" },
						status: "committed",
					});
				},
				broadcast: events.broadcast,
				dispatchSyncEvent: events.dispatchSyncEvent,
			},
		);

		const stored = await persistence.read();
		expect(requests).toBe(1);
		expect(
			stored.workspaces["gist:gist-1"]?.mutations.map(
				(item) => item.mutationId,
			),
		).toEqual([MUTATION_ID_3]);
		expect(state.nodes[0]?.name).toBe("second");
		expect(events.broadcasts.map((event) => event.type)).toEqual([
			"workspace-v2-committed",
		]);
		expect(events.syncEvents.map((event) => event.type)).toEqual([
			"SYNC_CONTEXT_LOADED",
		]);
		expect(events.acceptedSyncEvents).toEqual([true]);
	});

	it("returns peer-owned without broadcasting when a peer owns the queued mutation", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		let state = {
			...stateFor(document(2, MUTATION_ID_2, [node("local", "pending")])),
			lastUpdated: NOW,
		};
		await seed(
			persistence,
			state,
			createWorkspaceV2LocalState("gist-1", { baseline }),
			[mutation(MUTATION_ID_2, 1, "pending")],
		);
		const lease = await persistence.acquireLease({
			name: workspaceDispatcherLeaseName("gist:gist-1"),
			ownerId: "peer",
			now: Date.now(),
			ttlMs: 30_000,
		});
		expect(lease.acquired).toBe(true);
		const events = collectSessionEvents();
		let requests = 0;
		const result = await commitQueuedBrowserWorkspaceMutation(
			{ token: "token", mutationId: MUTATION_ID_2 },
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				fetchImpl: async () => {
					requests += 1;
					return committedResponse(document(2, MUTATION_ID_2));
				},
				broadcast: events.broadcast,
				dispatchSyncEvent: events.dispatchSyncEvent,
			},
		);

		expect(result.status).toBe("peer-owned");
		expect(result.mutationId).toBe(MUTATION_ID_2);
		expect(requests).toBe(0);
		expect(events.broadcasts).toEqual([]);
		expect(
			(await persistence.read()).workspaces["gist:gist-1"]?.mutations[0]
				?.mutationId,
		).toBe(MUTATION_ID_2);
	});

	it("returns peer-owned for a mutation left in an orphan queue after rebind", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		const queuedState = {
			...stateFor(document(2, MUTATION_ID_2, [node("local", "pending")])),
			lastUpdated: NOW,
		};
		await seed(
			persistence,
			queuedState,
			createWorkspaceV2LocalState("gist-1", { baseline }),
			[mutation(MUTATION_ID_2, 1, "pending")],
		);
		const peerBaseline: WorkspaceDocumentV2 = {
			...document(),
			workspaceId: "gist:gist-2",
		};
		const peerState = hydrateAppStateFromWorkspaceDocument(
			createDefaultWorkspaceState(NOW),
			peerBaseline,
			"gist-2",
		);
		await persistence.rebindWorkspace({
			snapshot: peerState,
			binding: createWorkspaceV2LocalState("gist-2", {
				baseline: peerBaseline,
			}),
		});
		let requests = 0;

		const result = await commitQueuedBrowserWorkspaceMutation(
			{ token: "token", mutationId: MUTATION_ID_2 },
			{
				persistence,
				getState: () => peerState,
				setState: () => {},
				fetchImpl: async () => {
					requests += 1;
					return committedResponse(document(2, MUTATION_ID_2));
				},
			},
		);

		expect(result.status).toBe("peer-owned");
		expect(result.mutationId).toBe(MUTATION_ID_2);
		expect(requests).toBe(0);
		const stored = await persistence.read();
		expect(stored.binding?.workspaceId).toBe("gist:gist-2");
		expect(
			stored.workspaces["gist:gist-1"]?.mutations.map(
				(item) => item.mutationId,
			),
		).toEqual([MUTATION_ID_2]);
	});

	it("does not rebroadcast a mutation already settled by a peer", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const committed = document(2, MUTATION_ID_2, [node("local", "peer")]);
		let state = stateFor(committed);
		await seed(
			persistence,
			state,
			createWorkspaceV2LocalState("gist-1", { baseline: committed }),
		);
		const events = collectSessionEvents();

		await commitQueuedBrowserWorkspaceMutation(
			{ token: "token", mutationId: MUTATION_ID_2 },
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				broadcast: events.broadcast,
				dispatchSyncEvent: events.dispatchSyncEvent,
			},
		);

		expect(state.nodes[0]?.name).toBe("peer");
		expect(events.broadcasts).toEqual([]);
		expect(events.syncEvents).toEqual([]);
	});

	it("accepts a peer commit between the outer and dispatcher reads", async () => {
		const baseline = document();
		const committed = document(2, MUTATION_ID_2, [node("local", "peer")]);
		const peerState = stateFor(committed);
		const peerBinding = createWorkspaceV2LocalState("gist-1", {
			baseline: committed,
		});
		const persistence = new PeerSettlesBetweenReadsPersistence(
			peerState,
			peerBinding,
		);
		let state = {
			...stateFor(document(2, MUTATION_ID_2, [node("local", "pending")])),
			lastUpdated: NOW,
		};
		await seed(
			persistence,
			state,
			createWorkspaceV2LocalState("gist-1", { baseline }),
			[mutation(MUTATION_ID_2, 1, "pending")],
		);
		const events = collectSessionEvents();
		let requests = 0;

		await commitQueuedBrowserWorkspaceMutation(
			{ token: "token", mutationId: MUTATION_ID_2 },
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				fetchImpl: async () => {
					requests += 1;
					return committedResponse(committed);
				},
				broadcast: events.broadcast,
				dispatchSyncEvent: events.dispatchSyncEvent,
			},
		);

		expect(requests).toBe(0);
		expect(state.nodes[0]?.name).toBe("peer");
		expect(events.broadcasts).toEqual([]);
		expect(events.syncEvents.map((event) => event.type)).toEqual([
			"SYNC_CONTEXT_LOADED",
		]);
		expect(events.getSyncStatus().repairRequired).toBe(false);
	});

	it("hydrates committed explicit mutation state without persisting the token", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		let state = stateFor(baseline);
		const events = collectSessionEvents();
		await seed(
			persistence,
			state,
			createWorkspaceV2LocalState("gist-1", { baseline }),
		);

		await submitBrowserWorkspaceMutation(
			{
				token: "secret-token-canary",
				kind: "node.upsert",
				payload: { operation: "replace", node: node("local", "committed") },
			},
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				mutationId: () => MUTATION_ID_2,
				now: () => NOW,
				fetchImpl: async (_input, init) => {
					expect(
						(init?.headers as Record<string, string>).Authorization,
					).toContain("secret-token-canary");
					return Response.json({
						document: document(2, MUTATION_ID_2, [node("local", "committed")]),
						mutationId: MUTATION_ID_2,
						workspaceId: "gist:gist-1",
						committedRevision: 2,
						committedAt: LATER,
						receipt: { kind: "node.upsert", entityId: "local" },
						status: "committed",
					});
				},
				broadcast: events.broadcast,
				dispatchSyncEvent: events.dispatchSyncEvent,
			},
		);

		expect(state.nodes[0]?.name).toBe("committed");
		expect(JSON.stringify(await persistence.read())).not.toContain(
			"secret-token-canary",
		);
		expect(events.broadcasts.map((event) => event.type)).toEqual([
			"workspace-v2-committed",
		]);
		expect(events.broadcasts[0]).toEqual({
			type: "workspace-v2-committed",
			gistId: "gist-1",
			fileName: "subman.json",
			mutationId: MUTATION_ID_2,
			document: document(2, MUTATION_ID_2, [node("local", "committed")]),
			status: "committed",
		});
		expect(events.syncEvents.map((event) => event.type)).toEqual([
			"SYNC_CONTEXT_LOADED",
		]);
		expect(events.acceptedSyncEvents).toEqual([true]);
	});

	it("hydrates a peer from the persisted commit received over the real event channel", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		let state = stateFor(baseline);
		let peerState = stateFor(baseline);
		await seed(
			persistence,
			state,
			createWorkspaceV2LocalState("gist-1", { baseline }),
		);
		let unsubscribe = () => {};
		let timeout: ReturnType<typeof setTimeout> | null = null;
		const peerHydrated = new Promise<void>((resolve, reject) => {
			timeout = setTimeout(
				() => reject(new Error("Peer did not receive the committed event")),
				1_000,
			);
			unsubscribe = subscribeWorkspaceEvents((event) => {
				if (
					event.type !== "workspace-v2-committed" ||
					event.mutationId !== MUTATION_ID_2
				) {
					return;
				}
				void persistence.read().then((record) => {
					if (record.snapshot) peerState = record.snapshot;
					resolve();
				});
			});
		});

		try {
			await submitBrowserWorkspaceMutation(
				{
					token: "token",
					kind: "node.upsert",
					payload: {
						operation: "replace",
						node: node("local", "peer-committed"),
					},
				},
				{
					persistence,
					getState: () => state,
					setState: (next) => {
						state = next;
					},
					mutationId: () => MUTATION_ID_2,
					now: () => NOW,
					fetchImpl: async () =>
						Response.json({
							document: document(2, MUTATION_ID_2, [
								node("local", "peer-committed"),
							]),
							mutationId: MUTATION_ID_2,
							workspaceId: "gist:gist-1",
							committedRevision: 2,
							committedAt: LATER,
							receipt: { kind: "node.upsert", entityId: "local" },
							status: "committed",
						}),
				},
			);
			await peerHydrated;
		} finally {
			if (timeout) clearTimeout(timeout);
			unsubscribe();
		}

		expect(peerState.nodes[0]?.name).toBe("peer-committed");
		expect(peerState.lastUpdated).toBe(LATER);
	});

	it("returns retry-scheduled for retryable explicit manual delivery", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		let state = stateFor(baseline);
		await seed(
			persistence,
			state,
			createWorkspaceV2LocalState("gist-1", {
				baseline,
				syncMode: "manual",
			}),
		);
		const events = collectSessionEvents();
		const result = await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "output.delete",
				payload: { fileName: "a.txt" },
			},
			{
				persistence,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				mutationId: () => MUTATION_ID_2,
				now: () => NOW,
				allowManual: true,
				fetchImpl: async () => {
					throw new Error("offline");
				},
				broadcast: events.broadcast,
				dispatchSyncEvent: events.dispatchSyncEvent,
			},
		);

		expect(result.status).toBe("retry-scheduled");
		expect(result.mutationId).toBe(MUTATION_ID_2);
		expect(events.syncEvents.map((event) => event.type)).toEqual([
			"SYNC_CONTEXT_LOADED",
			"SYNC_STARTED",
			"SYNC_RETRY_SCHEDULED",
		]);
		expect(events.acceptedSyncEvents).toEqual([true, true, true]);
		expect(events.getSyncStatus().phase).toBe("retrying");
		expect(events.broadcasts.map((event) => event.type)).toEqual([
			"mutation-queue-changed",
		]);
		expect(events.broadcasts[0]?.queueAction).toBe(undefined);
	});

	it("hydrates explicit failures before returning exact blocked outcomes", async () => {
		for (const testCase of [
			{
				status: 401,
				code: "unauthorized",
				disposition: "auth-required",
				eventType: "AUTH_LOST",
				expectedPhase: "auth-required",
			},
			{
				status: 409,
				code: "duplicate_node_raw",
				disposition: "domain-conflict",
				eventType: "DOMAIN_BLOCKED",
				expectedPhase: "blocked-domain-conflict",
			},
			{
				status: 409,
				code: "mutation_recovery_failed",
				disposition: "operator-repair",
				eventType: "OPERATOR_REPAIR_REQUIRED",
				expectedPhase: "operator-repair-required",
			},
			{
				status: 409,
				code: "revision_conflict",
				disposition: "state-conflict",
				eventType: "STATE_CONFLICT",
				expectedPhase: "paused-state-conflict",
				latest: document(3, MUTATION_ID_3, [node("remote")]),
			},
			{
				status: 200,
				code: "invalid_success_response",
				disposition: "queue-corruption",
				eventType: "QUEUE_CORRUPTED",
				expectedPhase: "queue-repair-required",
				invalidSuccess: true,
			},
		] as const) {
			const persistence = new InMemoryWorkspacePersistence();
			const baseline = document();
			let state = stateFor(baseline);
			await seed(
				persistence,
				state,
				createWorkspaceV2LocalState("gist-1", {
					baseline,
					syncMode: "manual",
				}),
			);
			const order: string[] = [];
			const events = collectSessionEvents(order);
			const result = await submitBrowserWorkspaceMutation(
				{
					token: "token",
					kind: "output.delete",
					payload: { fileName: "a.txt" },
				},
				{
					persistence,
					getState: () => state,
					setState: (next) => {
						state = next;
						order.push("hydrated");
					},
					mutationId: () => MUTATION_ID_2,
					now: () => NOW,
					allowManual: true,
					fetchImpl: async () =>
						"invalidSuccess" in testCase && testCase.invalidSuccess
							? Response.json({})
							: failureResponse(
									testCase.status,
									testCase.code,
									testCase.disposition,
									"latest" in testCase ? testCase.latest : undefined,
								),
					broadcast: events.broadcast,
					dispatchSyncEvent: events.dispatchSyncEvent,
				},
			);

			expect(result.status).toBe("conflict-or-blocked");
			if (result.status !== "conflict-or-blocked") {
				throw new Error("Expected conflict-or-blocked result");
			}
			expect(result.code).toBe(testCase.code);
			expect(result.disposition).toBe(testCase.disposition);
			expect(result.mutationId).toBe(MUTATION_ID_2);
			expect(events.syncEvents.map((event) => event.type)).toEqual([
				"SYNC_CONTEXT_LOADED",
				testCase.eventType,
			]);
			expect(events.acceptedSyncEvents).toEqual([true, true]);
			expect(events.getSyncStatus().phase).toBe(testCase.expectedPhase);
			expect(
				order.indexOf("hydrated") < order.indexOf(`sync:${testCase.eventType}`),
			).toBe(true);
			if (testCase.eventType === "STATE_CONFLICT") {
				expect(events.broadcasts.map((event) => event.type)).toEqual([
					"paused-conflict",
				]);
				expect(events.broadcasts[0]?.mutationId).toBe(MUTATION_ID_2);
				expect(events.broadcasts[0]?.document).toEqual(
					"latest" in testCase ? testCase.latest : undefined,
				);
			} else {
				expect(events.broadcasts.map((event) => event.type)).toEqual([
					"mutation-queue-changed",
				]);
				expect(events.broadcasts[0]?.queueAction).toBe(undefined);
			}
		}
	});
});
