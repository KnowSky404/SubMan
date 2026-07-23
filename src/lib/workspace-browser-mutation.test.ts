import { describe, expect, it } from "bun:test";
import {
	enqueueAutomaticWorkspaceMutation,
	enqueueAutomaticWorkspaceReconcile,
	validateAutomaticWorkspaceMutationDraft,
} from "$lib/workspace-browser-mutation";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import {
	createWorkspaceV2LocalState,
	WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

const WORKSPACE_ID = "gist:gist-1";
const NOW = "2026-07-22T15:00:00.000Z";

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

function document(revision = 5): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision,
		updatedAt: NOW,
		lastMutationId: "b0000000-0000-4000-8000-000000000000",
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

function stores(syncMode: "automatic" | "manual" | "paused-conflict") {
	const storage = new MemoryStorage();
	const stateStore = new WorkspaceV2StateStore(storage);
	stateStore.write(
		createWorkspaceV2LocalState("gist-1", {
			baseline: document(),
			syncMode,
		}),
	);
	return {
		storage,
		stateStore,
		queue: new WorkspaceMutationQueue(storage),
	};
}

describe("automatic browser mutation enqueue", () => {
	it("rejects an invalid automatic mutation before optimistic state can change", () => {
		const { stateStore } = stores("automatic");
		const invalidProfile = {
			id: "export-1",
			name: "Export",
			type: "sing-box-client",
			ruleId: "aggregate-1",
			fileName: "client.json",
			options: {
				listenAddress: "127.0.0.1",
				listenPort: 2080,
				inboundType: "mixed",
				dnsMode: "conservative",
				routeMode: "global-proxy",
				includeExperimental: true,
				selectorTag: "",
				urlTestTag: "auto",
			},
			lastGeneratedAt: null,
			lastPublishedAt: null,
			lastPublishedUrl: null,
			updatedAt: NOW,
		};

		expect(() =>
			validateAutomaticWorkspaceMutationDraft(
				{
					kind: "client-export.upsert",
					payload: { profile: invalidProfile },
				},
				{ stateStore },
			),
		).toThrow("selectorTag must be a non-empty string");
	});

	it("validates local and manual drafts without enqueueing them", () => {
		const localStore = new WorkspaceV2StateStore(new MemoryStorage());
		const { stateStore: manualStore } = stores("manual");
		const invalidDraft = {
			kind: "output.delete" as const,
			payload: { fileName: "subman.json" },
		};

		expect(() =>
			validateAutomaticWorkspaceMutationDraft(invalidDraft, {
				stateStore: localStore,
			}),
		).toThrow();
		expect(() =>
			validateAutomaticWorkspaceMutationDraft(invalidDraft, {
				stateStore: manualStore,
			}),
		).toThrow();
	});

	it("allocates revisions after the committed baseline and pending queue", async () => {
		const { queue, stateStore } = stores("automatic");
		const ids = [
			"b0000000-0000-4000-8000-000000000001",
			"b0000000-0000-4000-8000-000000000002",
		];

		for (const id of ids) {
			await enqueueAutomaticWorkspaceMutation(
				{ kind: "node.delete", payload: { id: "node-1" } },
				{
					stateStore,
					queue,
					mutationId: () => id,
					now: () => NOW,
				},
			);
		}

		expect(
			queue.list(WORKSPACE_ID).map((item) => item.expectedRevision),
		).toEqual([5, 6]);
		expect(queue.list(WORKSPACE_ID).map((item) => item.mutationId)).toEqual(
			ids,
		);
	});

	it("does not enqueue local, bind-only, manual, or paused changes", async () => {
		const emptyStorage = new MemoryStorage();
		const local = await enqueueAutomaticWorkspaceMutation(
			{ kind: "node.delete", payload: { id: "node-1" } },
			{
				stateStore: new WorkspaceV2StateStore(emptyStorage),
				queue: new WorkspaceMutationQueue(emptyStorage),
			},
		);
		expect(local.status).toBe("local-only");

		const bindOnlyStorage = new MemoryStorage();
		const bindOnlyStore = new WorkspaceV2StateStore(bindOnlyStorage);
		bindOnlyStore.write(
			createWorkspaceV2LocalState("gist-1", { syncMode: "manual" }),
		);
		const bindOnly = await enqueueAutomaticWorkspaceMutation(
			{ kind: "node.delete", payload: { id: "node-1" } },
			{
				stateStore: bindOnlyStore,
				queue: new WorkspaceMutationQueue(bindOnlyStorage),
			},
		);
		expect(bindOnly.status).toBe("uninitialized");

		for (const mode of ["manual", "paused-conflict"] as const) {
			const { queue, stateStore } = stores(mode);
			const result = await enqueueAutomaticWorkspaceMutation(
				{ kind: "node.delete", payload: { id: "node-1" } },
				{ stateStore, queue },
			);
			expect(result.status).toBe(mode);
			expect(queue.list()).toEqual([]);
		}
	});

	it("queues an explicit reconcile for imported automatic state", async () => {
		const { queue, stateStore } = stores("automatic");
		const imported = createDefaultWorkspaceState(NOW);

		const result = await enqueueAutomaticWorkspaceReconcile(imported, {
			stateStore,
			queue,
			mutationId: () => "b0000000-0000-4000-8000-000000000003",
			now: () => NOW,
		});

		expect(result.status).toBe("queued");
		const queued = queue.peek(WORKSPACE_ID);
		expect(queued?.kind).toBe("workspace.reconcile");
		expect(
			queued?.kind === "workspace.reconcile"
				? queued.payload.baselineRevision
				: null,
		).toBe(5);
	});
});
