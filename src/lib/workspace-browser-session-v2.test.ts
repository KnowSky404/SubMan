import { describe, expect, it } from "bun:test";
import type { AppState, GistMeta, NodeItem } from "$lib/models";
import {
	commitQueuedBrowserWorkspaceMutation,
	readBrowserWorkspaceSnapshot,
	reconcileBrowserWorkspace,
	submitBrowserWorkspaceMutation,
} from "$lib/workspace-browser-session-v2";
import {
	createDefaultWorkspaceState,
	getWorkspaceBusinessData,
	serializeWorkspaceState,
} from "$lib/workspace-data";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import { parseWorkspaceMutation } from "$lib/workspace-mutation";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import {
	createWorkspaceV2LocalState,
	WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

const NOW = "2026-07-22T17:00:00.000Z";
const MUTATION_ID = "b0000000-0000-4000-8000-000000000001";
const MUTATION_ID_2 = "b0000000-0000-4000-8000-000000000002";
const MUTATION_ID_3 = "b0000000-0000-4000-8000-000000000003";

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

function node(id: string): NodeItem {
	return {
		id,
		name: id,
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

function committedDocument(): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: "gist:gist-1",
		revision: 1,
		updatedAt: NOW,
		lastMutationId: MUTATION_ID,
		data: {
			nodes: [node("local")],
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

	it("queues and commits reconciliation before advancing the local baseline", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		const stateStore = new WorkspaceV2StateStore(storage);
		let state: AppState = {
			...createDefaultWorkspaceState(),
			nodes: [node("local")],
			activeGistId: "gist-1",
		};
		const baseline = await readBrowserWorkspaceSnapshot(
			"token",
			gist("subman.bootstrap.json"),
			state,
			{ now: () => NOW },
		);

		await reconcileBrowserWorkspace(
			{
				token: "token",
				gistId: "gist-1",
				baseline: baseline.document,
				resolvedState: state,
				syncMode: "automatic",
			},
			{
				queue,
				stateStore,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				mutationId: () => MUTATION_ID,
				now: () => NOW,
				fetchImpl: async (_input, init) => {
					expect(String(init?.body)).not.toContain("token");
					return Response.json({
						document: committedDocument(),
						mutationId: MUTATION_ID,
						workspaceId: "gist:gist-1",
						committedRevision: 1,
						committedAt: NOW,
						receipt: { kind: "workspace.reconcile" },
						status: "committed",
					});
				},
			},
		);

		expect(stateStore.read()?.revision).toBe(1);
		expect(stateStore.read()?.syncMode).toBe("automatic");
		expect(queue.list()).toEqual([]);
		expect(state.nodes[0]?.id).toBe("local");
	});

	it("keeps automatic reconciliation retryable after a transient failure", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		const stateStore = new WorkspaceV2StateStore(storage);
		let state: AppState = {
			...createDefaultWorkspaceState(),
			nodes: [node("local")],
			activeGistId: "gist-1",
		};
		const baseline = await readBrowserWorkspaceSnapshot(
			"token",
			gist("subman.bootstrap.json"),
			state,
			{ now: () => NOW },
		);

		let error: unknown;
		try {
			await reconcileBrowserWorkspace(
				{
					token: "token",
					gistId: "gist-1",
					baseline: baseline.document,
					resolvedState: state,
					syncMode: "automatic",
				},
				{
					queue,
					stateStore,
					getState: () => state,
					setState: (next) => {
						state = next;
					},
					mutationId: () => MUTATION_ID,
					now: () => NOW,
					fetchImpl: async () => new Response(null, { status: 503 }),
				},
			);
		} catch (caught) {
			error = caught;
		}

		expect(error instanceof Error).toBe(true);
		expect(stateStore.read()?.syncMode).toBe("automatic");
		expect(queue.peek("gist:gist-1")?.mutationId).toBe(MUTATION_ID);

		let retryCalls = 0;
		await reconcileBrowserWorkspace(
			{
				token: "token",
				gistId: "gist-1",
				baseline: baseline.document,
				resolvedState: state,
				syncMode: "automatic",
			},
			{
				queue,
				stateStore,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				fetchImpl: async () => {
					retryCalls += 1;
					return Response.json({
						document: committedDocument(),
						mutationId: MUTATION_ID,
						workspaceId: "gist:gist-1",
						committedRevision: 1,
						committedAt: NOW,
						receipt: { kind: "workspace.reconcile" },
						status: "committed",
					});
				},
			},
		);

		expect(retryCalls).toBe(1);
		expect(queue.list()).toEqual([]);
		expect(stateStore.read()?.revision).toBe(1);
	});

	it("blocks publish and delete before enqueue when Workspace identity differs", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		const stateStore = new WorkspaceV2StateStore(storage);
		stateStore.write(
			createWorkspaceV2LocalState("gist-1", {
				baseline: committedDocument(),
			}),
		);
		const state = {
			...createDefaultWorkspaceState(),
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
				{ queue, stateStore, getState: () => state, setState: () => {} },
			);
		} catch (caught) {
			error = caught;
		}
		expect((error as Error).message).toBe("Workspace identity requires repair");
		expect(queue.list()).toEqual([]);
	});

	it("blocks publishing remote stale data while manual changes are local only", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		const stateStore = new WorkspaceV2StateStore(storage);
		stateStore.write(
			createWorkspaceV2LocalState("gist-1", {
				baseline: committedDocument(),
				syncMode: "manual",
			}),
		);
		const state = {
			...createDefaultWorkspaceState(),
			activeGistId: "gist-1",
		};

		let error: unknown;
		try {
			await submitBrowserWorkspaceMutation(
				{
					token: "token",
					kind: "output.delete",
					payload: { fileName: "a.txt" },
				},
				{ queue, stateStore, getState: () => state, setState: () => {} },
			);
		} catch (caught) {
			error = caught;
		}
		expect((error as Error).message).toBe(
			"Push local Workspace changes before publishing",
		);
		expect(queue.list()).toEqual([]);
	});

	it("allows an explicit manual push action before publication", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		const stateStore = new WorkspaceV2StateStore(storage);
		stateStore.write(
			createWorkspaceV2LocalState("gist-1", {
				baseline: committedDocument(),
				syncMode: "manual",
			}),
		);
		let state: AppState = {
			...createDefaultWorkspaceState(),
			activeGistId: "gist-1",
		};
		await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "output.delete",
				payload: { fileName: "a.txt" },
			},
			{
				queue,
				stateStore,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				allowManual: true,
				mutationId: () => MUTATION_ID_2,
				now: () => NOW,
				fetchImpl: async () =>
					Response.json({
						document: {
							...committedDocument(),
							revision: 2,
							lastMutationId: MUTATION_ID_2,
						},
						mutationId: MUTATION_ID_2,
						workspaceId: "gist:gist-1",
						committedRevision: 2,
						committedAt: NOW,
						receipt: { kind: "output.delete", deleted: true },
						status: "committed",
					}),
			},
		);

		expect(queue.list()).toEqual([]);
		expect(stateStore.read()?.revision).toBe(2);
		expect(stateStore.read()?.syncMode).toBe("manual");
	});

	it("reconciles unrelated manual changes before an atomic target update", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		const stateStore = new WorkspaceV2StateStore(storage);
		stateStore.write(
			createWorkspaceV2LocalState("gist-1", {
				baseline: committedDocument(),
				syncMode: "manual",
			}),
		);
		const aggregate = {
			id: "aggregate-1",
			name: "Manual aggregate",
			nodeIds: ["unsynced"],
			subscriptionIds: [],
			excludeTagIds: [],
			renameMap: {},
			allowedTypes: [],
			updatedAt: NOW,
		};
		const target = {
			id: "target-1",
			name: "Manual target",
			ruleId: aggregate.id,
			fileName: "manual.txt",
			description: "",
			isPublic: false,
			lastPublishedAt: null,
			lastPublishedUrl: null,
			lastPublishTransitionAt: null,
			lastPublishTransitionFromFileName: null,
			lastPublishTransitionToFileName: null,
			lastPublishTransitionOutcome: null,
			updatedAt: NOW,
		};
		let state: AppState = {
			...createDefaultWorkspaceState(),
			nodes: [node("local"), node("unsynced")],
			aggregates: [aggregate],
			publishTargets: [target],
			activeGistId: "gist-1",
		};
		const localSnapshot = state;
		const reconcileState = { ...state, publishTargets: [] };

		await reconcileBrowserWorkspace(
			{
				token: "token",
				gistId: "gist-1",
				baseline: committedDocument(),
				resolvedState: reconcileState,
				syncMode: "manual",
			},
			{
				queue,
				stateStore,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				mutationId: () => MUTATION_ID_2,
				now: () => NOW,
				fetchImpl: async (_input, init) => {
					expect(String(init?.body)).toContain('"kind":"workspace.reconcile"');
					return Response.json({
						document: {
							...committedDocument(),
							revision: 2,
							lastMutationId: MUTATION_ID_2,
							data: getWorkspaceBusinessData(reconcileState),
						},
						mutationId: MUTATION_ID_2,
						workspaceId: "gist:gist-1",
						committedRevision: 2,
						committedAt: NOW,
						receipt: { kind: "workspace.reconcile" },
						status: "committed",
					});
				},
			},
		);

		await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "publish-target.upsert",
				payload: { target, previousFileCleanup: "delete-if-unreferenced" },
			},
			{
				queue,
				stateStore,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				allowManual: true,
				mutationId: () => MUTATION_ID_3,
				now: () => NOW,
				fetchImpl: async (_input, init) => {
					expect(String(init?.body)).toContain(
						'"kind":"publish-target.upsert"',
					);
					return Response.json({
						document: {
							...(stateStore.read()?.baseline ?? committedDocument()),
							revision: 3,
							lastMutationId: MUTATION_ID_3,
							data: getWorkspaceBusinessData(localSnapshot),
						},
						mutationId: MUTATION_ID_3,
						workspaceId: "gist:gist-1",
						committedRevision: 3,
						committedAt: NOW,
						receipt: {
							kind: "publish-target.upsert",
							entityId: target.id,
						},
						status: "committed",
					});
				},
			},
		);

		expect(state.nodes.map((item) => item.id)).toEqual(["local", "unsynced"]);
		expect(state.publishTargets[0]?.id).toBe(target.id);
		expect(stateStore.read()?.revision).toBe(3);
	});

	it("preserves unrelated manual changes before atomic target cleanup", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		const stateStore = new WorkspaceV2StateStore(storage);
		const aggregate = {
			id: "aggregate-1",
			name: "Manual aggregate",
			nodeIds: ["unsynced"],
			subscriptionIds: [],
			excludeTagIds: [],
			renameMap: {},
			allowedTypes: [],
			updatedAt: NOW,
		};
		const target = {
			id: "target-1",
			name: "Published target",
			ruleId: aggregate.id,
			fileName: "manual.txt",
			description: "",
			isPublic: false,
			lastPublishedAt: NOW,
			lastPublishedUrl: "https://example.com/manual.txt",
			lastPublishTransitionAt: null,
			lastPublishTransitionFromFileName: null,
			lastPublishTransitionToFileName: null,
			lastPublishTransitionOutcome: null,
			updatedAt: NOW,
		};
		let state: AppState = {
			...createDefaultWorkspaceState(),
			nodes: [node("local"), node("unsynced")],
			aggregates: [aggregate],
			publishTargets: [target],
			activeGistId: "gist-1",
		};
		stateStore.write(
			createWorkspaceV2LocalState("gist-1", {
				baseline: committedDocument(),
				syncMode: "manual",
			}),
		);

		await reconcileBrowserWorkspace(
			{
				token: "token",
				gistId: "gist-1",
				baseline: committedDocument(),
				resolvedState: state,
				syncMode: "manual",
			},
			{
				queue,
				stateStore,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				mutationId: () => MUTATION_ID_2,
				now: () => NOW,
				fetchImpl: async () =>
					Response.json({
						document: {
							...committedDocument(),
							revision: 2,
							lastMutationId: MUTATION_ID_2,
							data: getWorkspaceBusinessData(state),
						},
						mutationId: MUTATION_ID_2,
						workspaceId: "gist:gist-1",
						committedRevision: 2,
						committedAt: NOW,
						receipt: { kind: "workspace.reconcile" },
						status: "committed",
					}),
			},
		);

		await submitBrowserWorkspaceMutation(
			{
				token: "token",
				kind: "publish-target.delete",
				payload: { id: target.id, cleanupUnreferencedOutputs: true },
			},
			{
				queue,
				stateStore,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				allowManual: true,
				mutationId: () => MUTATION_ID_3,
				now: () => NOW,
				fetchImpl: async (_input, init) => {
					expect(String(init?.body)).toContain(
						'"kind":"publish-target.delete"',
					);
					return Response.json({
						document: {
							...(stateStore.read()?.baseline ?? committedDocument()),
							revision: 3,
							lastMutationId: MUTATION_ID_3,
							data: {
								...getWorkspaceBusinessData(state),
								publishTargets: [],
							},
						},
						mutationId: MUTATION_ID_3,
						workspaceId: "gist:gist-1",
						committedRevision: 3,
						committedAt: NOW,
						receipt: {
							kind: "publish-target.delete",
							entityId: target.id,
							deleted: true,
						},
						status: "committed",
					});
				},
			},
		);

		expect(state.nodes.map((item) => item.id)).toEqual(["local", "unsynced"]);
		expect(state.publishTargets).toEqual([]);
		expect(stateStore.read()?.revision).toBe(3);
	});

	it("commits a saved action in FIFO order before a later queued action", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		const stateStore = new WorkspaceV2StateStore(storage);
		stateStore.write(
			createWorkspaceV2LocalState("gist-1", {
				baseline: committedDocument(),
			}),
		);
		let state: AppState = {
			...createDefaultWorkspaceState(),
			nodes: [node("local")],
			activeGistId: "gist-1",
		};
		await queue.enqueue(
			parseWorkspaceMutation({
				mutationId: MUTATION_ID_2,
				workspaceId: "gist:gist-1",
				expectedRevision: 1,
				source: "browser",
				createdAt: NOW,
				kind: "node.upsert",
				payload: {
					operation: "replace",
					node: { ...node("local"), name: "first" },
				},
			}),
		);
		await queue.enqueue(
			parseWorkspaceMutation({
				mutationId: MUTATION_ID_3,
				workspaceId: "gist:gist-1",
				expectedRevision: 2,
				source: "browser",
				createdAt: NOW,
				kind: "node.upsert",
				payload: {
					operation: "replace",
					node: { ...node("local"), name: "second" },
				},
			}),
		);
		let requests = 0;
		await commitQueuedBrowserWorkspaceMutation(
			{ token: "token", mutationId: MUTATION_ID_2 },
			{
				queue,
				stateStore,
				getState: () => state,
				setState: (next) => {
					state = next;
				},
				fetchImpl: async (_input, init) => {
					requests += 1;
					expect(String(init?.body)).toContain(MUTATION_ID_2);
					return Response.json({
						document: {
							...committedDocument(),
							revision: 2,
							lastMutationId: MUTATION_ID_2,
							data: {
								...committedDocument().data,
								nodes: [{ ...node("local"), name: "first" }],
							},
						},
						mutationId: MUTATION_ID_2,
						workspaceId: "gist:gist-1",
						committedRevision: 2,
						committedAt: NOW,
						receipt: { kind: "node.upsert", entityId: "local" },
						status: "committed",
					});
				},
			},
		);

		expect(requests).toBe(1);
		expect(queue.list().map((mutation) => mutation.mutationId)).toEqual([
			MUTATION_ID_3,
		]);
		expect(state.nodes[0]?.name).toBe("second");
	});
});
