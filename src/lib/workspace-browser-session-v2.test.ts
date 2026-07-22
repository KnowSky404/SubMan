import { describe, expect, it } from "bun:test";
import type { AppState, GistMeta, NodeItem } from "$lib/models";
import {
	readBrowserWorkspaceSnapshot,
	reconcileBrowserWorkspace,
} from "$lib/workspace-browser-session-v2";
import {
	createDefaultWorkspaceState,
	serializeWorkspaceState,
} from "$lib/workspace-data";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import { WorkspaceV2StateStore } from "$lib/workspace-v2-state";

const NOW = "2026-07-22T17:00:00.000Z";
const MUTATION_ID = "b0000000-0000-4000-8000-000000000001";

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
});
