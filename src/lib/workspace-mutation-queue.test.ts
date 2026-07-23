import { describe, expect, it } from "bun:test";
import type { WorkspaceCoordinatorResult } from "$lib/server/workspace-coordinator-core";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import {
	deliverNextWorkspaceMutation,
	WorkspaceMutationQueue,
} from "$lib/workspace-mutation-queue";

const WORKSPACE_ID = "gist:gist-1";
const TOKEN = "browser-github-token";

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

function mutation(
	id = "b0000000-0000-4000-8000-000000000001",
): WorkspaceMutation {
	return {
		mutationId: id,
		workspaceId: WORKSPACE_ID,
		expectedRevision: 1,
		source: "browser",
		createdAt: "2026-07-22T11:00:00.000Z",
		kind: "node.delete",
		payload: { id: "node-1" },
	};
}

function document(revision = 2): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision,
		updatedAt: "2026-07-22T12:00:00.000Z",
		lastMutationId: mutation().mutationId,
		data: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
		tombstones: {
			nodes: [
				{
					id: "node-1",
					deletedAt: "2026-07-22T12:00:00.000Z",
					deletedRevision: revision,
					mutationId: mutation().mutationId,
				},
			],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
}

function committed(): WorkspaceCoordinatorResult {
	return {
		document: document(),
		mutationId: mutation().mutationId,
		workspaceId: WORKSPACE_ID,
		committedRevision: 2,
		committedAt: "2026-07-22T12:00:00.000Z",
		receipt: { kind: "node.delete", entityId: "node-1", deleted: true },
		status: "committed",
	};
}

function alreadyCommittedAfterLaterMutation(): WorkspaceCoordinatorResult {
	return {
		...committed(),
		document: {
			...document(3),
			updatedAt: "2026-07-22T13:00:00.000Z",
			lastMutationId: "b0000000-0000-4000-8000-000000000002",
		},
		status: "already-committed",
	};
}

function persistCommitted(): void {}

describe("WorkspaceMutationQueue", () => {
	it("persists validated browser mutations in insertion order", async () => {
		const storage = new MemoryStorage();
		const first = mutation();
		const second = mutation("b0000000-0000-4000-8000-000000000002");
		await new WorkspaceMutationQueue(storage).enqueue(first);
		await new WorkspaceMutationQueue(storage).enqueue(second);

		expect(new WorkspaceMutationQueue(storage).list()).toEqual([first, second]);
	});

	it("deduplicates an exact retry and rejects mutation ID reuse", async () => {
		const queue = new WorkspaceMutationQueue(new MemoryStorage());
		await queue.enqueue(mutation());
		await queue.enqueue(mutation());
		expect(queue.list()).toHaveLength(1);
		let collision: unknown;
		try {
			await queue.enqueue({ ...mutation(), expectedRevision: 2 });
		} catch (error) {
			collision = error;
		}
		expect((collision as Error).message).toBe(
			"Mutation ID is already queued with different content",
		);
	});

	it("preserves FIFO order independently for each workspace", async () => {
		const queue = new WorkspaceMutationQueue(new MemoryStorage());
		const otherWorkspace = "gist:gist-2";
		const first = mutation();
		const other = {
			...mutation("b0000000-0000-4000-8000-000000000002"),
			workspaceId: otherWorkspace,
		};
		const second = mutation("b0000000-0000-4000-8000-000000000003");
		await queue.enqueue(first);
		await queue.enqueue(other);
		await queue.enqueue(second);

		expect(queue.list(WORKSPACE_ID)).toEqual([first, second]);
		expect(queue.peek(otherWorkspace)).toEqual(other);
		await queue.remove(first.mutationId);
		expect(queue.peek(WORKSPACE_ID)).toEqual(second);
	});

	it("serializes concurrent writes to the shared queue storage", async () => {
		const storage = new MemoryStorage();
		const first = mutation();
		const second = mutation("b0000000-0000-4000-8000-000000000002");

		await Promise.all([
			new WorkspaceMutationQueue(storage).enqueue(first),
			new WorkspaceMutationQueue(storage).enqueue(second),
		]);

		expect(new WorkspaceMutationQueue(storage).list()).toEqual([first, second]);
	});

	it("allocates consecutive expected revisions inside the queue write lock", async () => {
		const queue = new WorkspaceMutationQueue(new MemoryStorage());
		const ids = [
			"b0000000-0000-4000-8000-000000000001",
			"b0000000-0000-4000-8000-000000000002",
		];

		await Promise.all(
			ids.map((id) =>
				queue.enqueueNext(WORKSPACE_ID, 7, (expectedRevision) => ({
					...mutation(id),
					expectedRevision,
				})),
			),
		);

		expect(
			queue.list(WORKSPACE_ID).map((item) => item.expectedRevision),
		).toEqual([7, 8]);
	});

	it("rejects server mutations and quarantines corrupted storage", () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(
			storage,
			() => {},
			() => "2026-07-23T00:00:00.000Z",
		);
		expect(() =>
			queue.enqueue({ ...mutation(), source: "server-api" }),
		).toThrow("Only browser mutations can be queued");

		storage.setItem(queue.storageKey, "corrupted");
		expect(queue.list()).toEqual([]);
		expect(storage.getItem(queue.storageKey)).toBeNull();
		expect(
			storage.getItem(
				"subman:workspace-mutation-queue:v1:quarantine:20260723T000000000Z",
			),
		).toBe("corrupted");
	});

	it("migrates the known version one queue envelope", () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		storage.setItem(
			queue.storageKey,
			JSON.stringify({ version: 1, mutations: [mutation()] }),
		);

		expect(queue.list()).toEqual([mutation()]);
		expect(JSON.parse(storage.getItem(queue.storageKey) ?? "{}").version).toBe(
			2,
		);
	});
});

describe("Workspace mutation delivery", () => {
	it("sends the queue head with request-scoped auth and removes it on commit", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		await queue.enqueue(mutation());
		const calls: Array<{ input: string; init?: RequestInit }> = [];
		const delivered: WorkspaceCoordinatorResult[] = [];

		const result = await deliverNextWorkspaceMutation({
			queue,
			workspaceId: WORKSPACE_ID,
			githubToken: TOKEN,
			syncMode: "automatic",
			fetchImpl: async (input, init) => {
				calls.push({ input: String(input), init });
				return Response.json(committed());
			},
			onCommitted: (value) => {
				delivered.push(value);
			},
		});

		expect(result.status).toBe("committed");
		expect(queue.list()).toEqual([]);
		expect(delivered[0]?.document.revision).toBe(2);
		expect(calls[0]?.input).toBe("/api/workspaces/gist%3Agist-1/mutations");
		expect(calls[0]?.init?.headers).toEqual({
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
		});
		expect(calls[0]?.init?.body).toBe(JSON.stringify(mutation()));
		expect(storage.getItem(queue.storageKey) ?? "").not.toContain(TOKEN);
	});

	it("keeps the same mutation after a network failure", async () => {
		const storage = new MemoryStorage();
		const queue = new WorkspaceMutationQueue(storage);
		await queue.enqueue(mutation());

		const result = await deliverNextWorkspaceMutation({
			queue,
			workspaceId: WORKSPACE_ID,
			githubToken: TOKEN,
			syncMode: "automatic",
			fetchImpl: async () => {
				throw new Error("offline");
			},
			onCommitted: persistCommitted,
		});

		expect(result.status).toBe("retryable-error");
		expect(queue.peek(WORKSPACE_ID)?.mutationId).toBe(mutation().mutationId);
		expect(storage.getItem(queue.storageKey) ?? "").not.toContain(TOKEN);
	});

	it("rejects a committed document from another workspace", async () => {
		const queue = new WorkspaceMutationQueue(new MemoryStorage());
		await queue.enqueue(mutation());
		const response = committed();
		response.document = {
			...response.document,
			workspaceId: "gist:gist-2",
		};

		const result = await deliverNextWorkspaceMutation({
			queue,
			workspaceId: WORKSPACE_ID,
			githubToken: TOKEN,
			syncMode: "automatic",
			fetchImpl: async () => Response.json(response),
			onCommitted: persistCommitted,
		});

		expect(result.status).toBe("retryable-error");
		expect(queue.peek(WORKSPACE_ID)?.mutationId).toBe(mutation().mutationId);
	});

	it("accepts an idempotent retry that returns a newer workspace head", async () => {
		const queue = new WorkspaceMutationQueue(new MemoryStorage());
		await queue.enqueue(mutation());
		let hydratedRevision: number | undefined;

		const result = await deliverNextWorkspaceMutation({
			queue,
			workspaceId: WORKSPACE_ID,
			githubToken: TOKEN,
			syncMode: "automatic",
			fetchImpl: async () =>
				Response.json(alreadyCommittedAfterLaterMutation()),
			onCommitted: (value) => {
				hydratedRevision = value.document.revision;
			},
		});

		expect(result.status).toBe("committed");
		expect(hydratedRevision).toBe(3);
		expect(queue.list()).toEqual([]);
	});

	it("keeps the mutation when committed-document hydration fails", async () => {
		const queue = new WorkspaceMutationQueue(new MemoryStorage());
		await queue.enqueue(mutation());

		const result = await deliverNextWorkspaceMutation({
			queue,
			workspaceId: WORKSPACE_ID,
			githubToken: TOKEN,
			syncMode: "automatic",
			fetchImpl: async () => Response.json(committed()),
			onCommitted: () => {
				expect(queue.peek(WORKSPACE_ID) === null).toBe(false);
				throw new Error("local hydration failed");
			},
		});

		expect(result.status).toBe("retryable-error");
		expect(queue.peek(WORKSPACE_ID)?.mutationId).toBe(mutation().mutationId);
	});

	it("keeps the mutation and reports the latest document on conflict", async () => {
		const queue = new WorkspaceMutationQueue(new MemoryStorage());
		await queue.enqueue(mutation());
		const latest = document(3);
		let conflictRevision: number | undefined;

		const result = await deliverNextWorkspaceMutation({
			queue,
			workspaceId: WORKSPACE_ID,
			githubToken: TOKEN,
			syncMode: "automatic",
			fetchImpl: async () =>
				Response.json(
					{
						error: {
							code: "revision_conflict",
							message: "Workspace revision changed",
						},
						document: latest,
						revision: latest.revision,
					},
					{ status: 409 },
				),
			onConflict: (conflict) => {
				conflictRevision = conflict.document?.revision;
			},
			onCommitted: persistCommitted,
		});

		expect(result.status).toBe("conflict");
		expect(conflictRevision).toBe(3);
		expect(queue.list()).toHaveLength(1);
	});

	it("blocks paused or unauthenticated delivery", async () => {
		const queue = new WorkspaceMutationQueue(new MemoryStorage());
		await queue.enqueue(mutation());
		let calls = 0;
		const fetchImpl = async () => {
			calls += 1;
			return Response.json(committed());
		};

		expect(
			(
				await deliverNextWorkspaceMutation({
					queue,
					workspaceId: WORKSPACE_ID,
					githubToken: TOKEN,
					syncMode: "paused-conflict",
					fetchImpl,
					onCommitted: persistCommitted,
				})
			).status,
		).toBe("blocked");
		expect(
			(
				await deliverNextWorkspaceMutation({
					queue,
					workspaceId: WORKSPACE_ID,
					githubToken: null,
					syncMode: "automatic",
					fetchImpl,
					onCommitted: persistCommitted,
				})
			).status,
		).toBe("blocked");
		expect(calls).toBe(0);
	});

	it("serializes concurrent delivery attempts across the workspace lock", async () => {
		const queue = new WorkspaceMutationQueue(new MemoryStorage());
		await queue.enqueue(mutation());
		let calls = 0;
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const options = {
			queue,
			workspaceId: WORKSPACE_ID,
			githubToken: TOKEN,
			syncMode: "automatic" as const,
			fetchImpl: async () => {
				calls += 1;
				await gate;
				return Response.json(committed());
			},
			onCommitted: persistCommitted,
		};

		const first = deliverNextWorkspaceMutation(options);
		const second = deliverNextWorkspaceMutation(options);
		await Promise.resolve();
		expect(calls).toBe(1);
		release();
		const results = await Promise.all([first, second]);

		expect(calls).toBe(1);
		expect(results.map((result) => result.status)).toEqual([
			"committed",
			"empty",
		]);
	});
});
