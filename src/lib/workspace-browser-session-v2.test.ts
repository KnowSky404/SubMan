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
	parseWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import { InMemoryWorkspacePersistence } from "$lib/workspace-persistence";
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

async function seed(
	persistence: InMemoryWorkspacePersistence,
	state: AppState,
	binding: WorkspaceV2LocalState,
	mutations: WorkspaceMutation[] = [],
): Promise<void> {
	if (mutations.length > 0) {
		await persistence.repairWorkspaceQueue({
			snapshot: state,
			binding,
			mutations,
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
			},
		);

		expect(requestBody).toContain(MUTATION_ID_3);
		expect(requestBody).not.toContain(MUTATION_ID_2);
		const stored = await persistence.read();
		expect(stored.workspaces["gist:gist-1"]?.mutations).toEqual([]);
		expect(stored.binding?.revision).toBe(2);
		expect(state.nodes[0]?.name).toBe("resolved");
	});

	it("keeps the same reconcile mutation queued with persisted retry metadata", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		let state: AppState = {
			...createDefaultWorkspaceState(NOW),
			nodes: [node("local")],
			activeGistId: "gist-1",
			activeGistFile: "subman.json",
		};
		const baseline = document(0, null, []);

		let error: unknown;
		try {
			await reconcileBrowserWorkspace(
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
					},
					mutationId: () => MUTATION_ID,
					now: () => NOW,
					fetchImpl: async () => {
						throw new Error("offline");
					},
				},
			);
		} catch (caught) {
			error = caught;
		}
		expect((error as Error).message).toContain(
			"Workspace reconciliation failed",
		);

		const stored = await persistence.read();
		expect(stored.workspaces["gist:gist-1"]?.mutations[0]?.mutationId).toBe(
			MUTATION_ID,
		);
		expect(stored.workspaces["gist:gist-1"]?.delivery.retry.attempt).toBe(1);
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

		let error: unknown;
		try {
			await submitBrowserWorkspaceMutation(
				{
					token: "token",
					kind: "output.delete",
					payload: { fileName: "a.txt" },
				},
				{ persistence, getState: () => mismatched, setState: () => {} },
			);
		} catch (caught) {
			error = caught;
		}
		expect((error as Error).message).toBe("Workspace identity requires repair");
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

		let error: unknown;
		try {
			await submitBrowserWorkspaceMutation(
				{
					token: "token",
					kind: "output.delete",
					payload: { fileName: "a.txt" },
				},
				{ persistence, getState: () => state, setState: () => {} },
			);
		} catch (caught) {
			error = caught;
		}
		expect((error as Error).message).toBe(
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
	});

	it("hydrates committed explicit mutation state without persisting the token", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const baseline = document();
		let state = stateFor(baseline);
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
			},
		);

		expect(state.nodes[0]?.name).toBe("committed");
		expect(JSON.stringify(await persistence.read())).not.toContain(
			"secret-token-canary",
		);
	});
});
