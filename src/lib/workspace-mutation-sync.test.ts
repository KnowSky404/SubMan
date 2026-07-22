import { describe, expect, it } from "bun:test";
import type { AppState, NodeItem } from "$lib/models";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import type { WorkspaceEvent } from "$lib/workspace-events";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import {
	applyCommittedWorkspaceEvent,
	deliverQueuedWorkspaceMutation,
} from "$lib/workspace-mutation-sync";
import {
	createWorkspaceV2LocalState,
	WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

const GIST_ID = "gist-1";
const WORKSPACE_ID = `gist:${GIST_ID}`;
const MUTATION_ID = "b0000000-0000-4000-8000-000000000001";
const NOW = "2026-07-22T16:00:00.000Z";

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

function document(revision: number, nodes: NodeItem[]): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision,
		updatedAt: NOW,
		lastMutationId: revision === 1 ? null : MUTATION_ID,
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

function mutation(): WorkspaceMutation {
	return {
		mutationId: MUTATION_ID,
		workspaceId: WORKSPACE_ID,
		expectedRevision: 1,
		source: "browser",
		createdAt: NOW,
		kind: "node.upsert",
		payload: { operation: "replace", node: node("committed") },
	};
}

async function setup(syncMode: "automatic" | "manual" = "automatic") {
	const storage = new MemoryStorage();
	const queue = new WorkspaceMutationQueue(storage);
	const stateStore = new WorkspaceV2StateStore(storage);
	stateStore.write(
		createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(1, []),
			syncMode,
		}),
	);
	await queue.enqueue(mutation());
	let state: AppState = {
		...createDefaultWorkspaceState(),
		nodes: [node("optimistic")],
		activeGistId: GIST_ID,
	};
	const events: WorkspaceEvent[] = [];
	return {
		queue,
		stateStore,
		getState: () => state,
		setState: (next: AppState) => {
			state = next;
		},
		getCurrentState: () => state,
		events,
		broadcast: (event: WorkspaceEvent) => events.push(event),
	};
}

describe("Workspace mutation synchronization", () => {
	it("persists and broadcasts the committed document before dequeue", async () => {
		const dependencies = await setup();
		const committed = document(2, [node("committed")]);

		const result = await deliverQueuedWorkspaceMutation({
			...dependencies,
			githubToken: "github-token",
			fetchImpl: async () =>
				Response.json({
					document: committed,
					mutationId: MUTATION_ID,
					workspaceId: WORKSPACE_ID,
					committedRevision: 2,
					committedAt: NOW,
					receipt: { kind: "node.upsert", entityId: "committed" },
					status: "committed",
				}),
		});

		expect(result.status).toBe("committed");
		expect(dependencies.stateStore.read()?.revision).toBe(2);
		expect(dependencies.getCurrentState().nodes[0]?.id).toBe("committed");
		expect(dependencies.events[0]?.type).toBe("workspace-v2-committed");
		expect(dependencies.queue.list()).toEqual([]);
	});

	it("replays later queued mutations over the committed baseline", async () => {
		const dependencies = await setup();
		const later = node("later-optimistic");
		await dependencies.queue.enqueue({
			mutationId: "b0000000-0000-4000-8000-000000000002",
			workspaceId: WORKSPACE_ID,
			expectedRevision: 2,
			source: "browser",
			createdAt: "2026-07-22T16:01:00.000Z",
			kind: "node.upsert",
			payload: { operation: "replace", node: later },
		});
		const committed = document(2, [node("committed")]);

		const result = await deliverQueuedWorkspaceMutation({
			...dependencies,
			githubToken: "github-token",
			fetchImpl: async () =>
				Response.json({
					document: committed,
					mutationId: MUTATION_ID,
					workspaceId: WORKSPACE_ID,
					committedRevision: 2,
					committedAt: NOW,
					receipt: { kind: "node.upsert", entityId: "committed" },
					status: "committed",
				}),
		});

		expect(result.status).toBe("committed");
		expect(dependencies.stateStore.read()?.revision).toBe(2);
		expect(dependencies.getCurrentState().nodes.map((item) => item.id)).toEqual(
			["later-optimistic", "committed"],
		);
		expect(dependencies.queue.list().map((item) => item.mutationId)).toEqual([
			"b0000000-0000-4000-8000-000000000002",
		]);
	});

	it("pauses on conflict while preserving optimistic local state and queue", async () => {
		const dependencies = await setup();
		const latest = document(2, [node("remote")]);

		const result = await deliverQueuedWorkspaceMutation({
			...dependencies,
			githubToken: "github-token",
			fetchImpl: async () =>
				Response.json(
					{
						error: {
							code: "revision_conflict",
							message: "Workspace revision changed",
						},
						document: latest,
						revision: 2,
					},
					{ status: 409 },
				),
		});

		expect(result.status).toBe("conflict");
		expect(dependencies.stateStore.read()?.syncMode).toBe("paused-conflict");
		expect(dependencies.stateStore.read()?.revision).toBe(2);
		expect(dependencies.stateStore.read()?.conflictBaseline?.revision).toBe(1);
		expect(dependencies.getCurrentState().nodes[0]?.id).toBe("optimistic");
		expect(dependencies.queue.list()).toHaveLength(1);
	});

	it("does not automatically deliver manual mode", async () => {
		const dependencies = await setup("manual");
		let calls = 0;

		const result = await deliverQueuedWorkspaceMutation({
			...dependencies,
			githubToken: "github-token",
			fetchImpl: async () => {
				calls += 1;
				return Response.json({});
			},
		});

		expect(result.status).toBe("blocked");
		expect(calls).toBe(0);
	});

	it("hydrates a newer committed document broadcast by another tab", async () => {
		const dependencies = await setup();
		const latest = document(2, [node("other-tab")]);

		const applied = applyCommittedWorkspaceEvent(
			{
				type: "workspace-v2-committed",
				gistId: GIST_ID,
				fileName: "subman.json",
				document: latest,
			},
			dependencies,
		);

		expect(applied).toBe(true);
		expect(dependencies.stateStore.read()?.revision).toBe(2);
		expect(dependencies.getCurrentState().nodes[0]?.id).toBe("other-tab");
	});
});
