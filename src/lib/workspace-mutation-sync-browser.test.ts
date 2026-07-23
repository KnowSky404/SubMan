import * as bunTest from "bun:test";
import type { AppState, NodeItem } from "$lib/models";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";

const { describe, expect, it } = bunTest;
const bun = bunTest as unknown as {
	mock: {
		module: (specifier: string, factory: () => unknown) => void;
	};
};

bun.mock.module("$app/environment", () => ({ browser: false }));

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

function node(): NodeItem {
	return {
		id: "node-1",
		name: "node-1",
		type: "vless",
		raw: "vless://node-1",
		tags: [],
		enabled: true,
		updatedAt: NOW,
		source: "single",
	};
}

function document(revision: number): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision,
		updatedAt: NOW,
		lastMutationId: revision === 1 ? null : MUTATION_ID,
		data: {
			nodes: revision === 1 ? [node()] : [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
		tombstones: {
			nodes:
				revision === 1
					? []
					: [
							{
								id: "node-1",
								deletedAt: NOW,
								deletedRevision: revision,
								mutationId: MUTATION_ID,
							},
						],
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
		kind: "node.delete",
		payload: { id: "node-1" },
	};
}

async function waitFor<T>(promise: Promise<T>): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("Scheduler retry timed out")), 1_000),
		),
	]);
}

describe("browser Workspace mutation scheduler", () => {
	it("reports local, queued, manual, conflict, and auth-required lifecycle states", async () => {
		const [
			workspaceData,
			queueModule,
			stateModule,
			sync,
			appStore,
			statusModule,
		] = await Promise.all([
			import("$lib/workspace-data"),
			import("$lib/workspace-mutation-queue"),
			import("$lib/workspace-v2-state"),
			import("$lib/workspace-mutation-sync-browser"),
			import("$lib/stores/app"),
			import("$lib/workspace-sync-status"),
		]);

		let latestLifecycle = statusModule.defaultWorkspaceSyncStatus.lifecycle;
		const unsubscribeLatest = statusModule.workspaceSyncStatus.subscribe(
			(status) => {
				latestLifecycle = status.lifecycle;
			},
		);
		appStore.appState.set(workspaceData.createDefaultWorkspaceState(NOW));
		const localAction = appStore.upsertNode(node());
		expect(localAction.accepted).toBe(true);
		expect((await localAction.completion).status).toBe("local-saved");
		expect(latestLifecycle).toBe("local-saved");
		unsubscribeLatest();

		async function expectIdleLifecycle(options: {
			expected:
				| "queued"
				| "manual-local-only"
				| "paused-conflict"
				| "auth-required";
			syncMode: "automatic" | "manual" | "paused-conflict";
			token: string | null;
			pending?: boolean;
		}): Promise<void> {
			statusModule.workspaceSyncStatus.set({
				...statusModule.defaultWorkspaceSyncStatus,
			});
			const storage = new MemoryStorage();
			const queue = new queueModule.WorkspaceMutationQueue(storage);
			const stateStore = new stateModule.WorkspaceV2StateStore(storage);
			stateStore.write(
				stateModule.createWorkspaceV2LocalState(GIST_ID, {
					baseline: document(1),
					syncMode: options.syncMode,
				}),
			);
			if (options.pending) await queue.enqueue(mutation());

			let unsubscribeStatus = () => {};
			const reached = new Promise<void>((resolve) => {
				unsubscribeStatus = statusModule.workspaceSyncStatus.subscribe(
					(status) => {
						if (status.lifecycle === options.expected) resolve();
					},
				);
			});
			const stop = sync.startWorkspaceMutationSync({
				enabled: true,
				delayMs: 60_000,
				queue,
				stateStore,
				getState: () => ({
					...workspaceData.createDefaultWorkspaceState(NOW),
					activeGistId: GIST_ID,
				}),
				setState: () => {},
				subscribeAuth: (listener) => {
					listener({ token: options.token });
					return () => {};
				},
				subscribeEvents: () => () => {},
			});

			try {
				await waitFor(reached);
			} finally {
				stop();
				unsubscribeStatus();
			}
		}

		await expectIdleLifecycle({
			expected: "queued",
			syncMode: "automatic",
			token: "browser-token",
			pending: true,
		});
		await expectIdleLifecycle({
			expected: "manual-local-only",
			syncMode: "manual",
			token: "browser-token",
		});
		await expectIdleLifecycle({
			expected: "paused-conflict",
			syncMode: "paused-conflict",
			token: "browser-token",
		});
		await expectIdleLifecycle({
			expected: "auth-required",
			syncMode: "automatic",
			token: null,
			pending: true,
		});
	});

	it("reports a permanent synchronization error while preserving the mutation", async () => {
		const [workspaceData, queueModule, stateModule, sync, statusModule] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-mutation-queue"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
				import("$lib/workspace-sync-status"),
			]);
		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
		const storage = new MemoryStorage();
		const queue = new queueModule.WorkspaceMutationQueue(storage);
		const stateStore = new stateModule.WorkspaceV2StateStore(storage);
		stateStore.write(
			stateModule.createWorkspaceV2LocalState(GIST_ID, {
				baseline: document(1),
			}),
		);
		await queue.enqueue(mutation());
		let unsubscribeStatus = () => {};
		const permanentError = new Promise<void>((resolve) => {
			unsubscribeStatus = statusModule.workspaceSyncStatus.subscribe(
				(status) => {
					if (status.lifecycle === "permanent-error") resolve();
				},
			);
		});
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 0,
			queue,
			stateStore,
			getState: () => ({
				...workspaceData.createDefaultWorkspaceState(NOW),
				activeGistId: GIST_ID,
			}),
			setState: () => {},
			subscribeAuth: (listener) => {
				listener({ token: "browser-token" });
				return () => {};
			},
			subscribeEvents: () => () => {},
			fetchImpl: async () =>
				Response.json({ error: { code: "invalid_mutation" } }, { status: 400 }),
		});

		try {
			await waitFor(permanentError);
			expect(queue.list()).toEqual([mutation()]);
		} finally {
			stop();
			unsubscribeStatus();
		}
	});

	it("preserves pending work and stops delivery after authentication is cleared", async () => {
		const [workspaceData, queueModule, stateModule, sync, statusModule] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-mutation-queue"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
				import("$lib/workspace-sync-status"),
			]);
		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
		const storage = new MemoryStorage();
		const queue = new queueModule.WorkspaceMutationQueue(storage);
		const stateStore = new stateModule.WorkspaceV2StateStore(storage);
		stateStore.write(
			stateModule.createWorkspaceV2LocalState(GIST_ID, {
				baseline: document(1),
			}),
		);
		await queue.enqueue(mutation());
		let authListener: (state: { token: string | null }) => void = () => {};
		let fetchCalls = 0;
		let unsubscribeStatus = () => {};
		const authRequired = new Promise<void>((resolve) => {
			unsubscribeStatus = statusModule.workspaceSyncStatus.subscribe(
				(status) => {
					if (status.lifecycle === "auth-required") resolve();
				},
			);
		});
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 60_000,
			queue,
			stateStore,
			getState: () => ({
				...workspaceData.createDefaultWorkspaceState(NOW),
				activeGistId: GIST_ID,
			}),
			setState: () => {},
			subscribeAuth: (listener) => {
				authListener = listener;
				listener({ token: "browser-token" });
				return () => {};
			},
			subscribeEvents: () => () => {},
			fetchImpl: async () => {
				fetchCalls += 1;
				throw new Error("delivery must remain stopped");
			},
		});

		try {
			authListener({ token: null });
			await waitFor(authRequired);
			expect(queue.list()).toEqual([mutation()]);
			expect(fetchCalls).toBe(0);
		} finally {
			stop();
			unsubscribeStatus();
		}
	});

	it("retries the same queued mutation after an offline failure", async () => {
		const [workspaceData, queueModule, stateModule, sync, toastModule] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-mutation-queue"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
				import("$lib/stores/toast"),
			]);
		const { workspaceSyncStatus } = await import("$lib/workspace-sync-status");
		toastModule.toastStore.set([]);
		const lifecycle: string[] = [];
		const unsubscribeStatus = workspaceSyncStatus.subscribe((status) => {
			lifecycle.push(status.lifecycle);
		});
		const storage = new MemoryStorage();
		const queue = new queueModule.WorkspaceMutationQueue(storage);
		const stateStore = new stateModule.WorkspaceV2StateStore(storage);
		stateStore.write(
			stateModule.createWorkspaceV2LocalState(GIST_ID, {
				baseline: document(1),
			}),
		);
		await queue.enqueue(mutation());
		const optimistic: AppState = {
			...workspaceData.createDefaultWorkspaceState(NOW),
			activeGistId: GIST_ID,
			nodes: [],
		};
		let state = optimistic;

		let calls = 0;
		const requestBodies: string[] = [];
		let resolveCommitted = () => {};
		const committed = new Promise<void>((resolve) => {
			resolveCommitted = resolve;
		});
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 0,
			retryDelayMs: 0,
			queue,
			stateStore,
			getState: () => state,
			setState: (next) => {
				state = next;
			},
			subscribeAuth: (listener) => {
				listener({ token: "browser-token" });
				return () => {};
			},
			subscribeEvents: () => () => {},
			fetchImpl: async (_input, init) => {
				calls += 1;
				requestBodies.push(String(init?.body));
				if (calls === 1) throw new Error("offline");
				resolveCommitted();
				return Response.json({
					document: document(2),
					mutationId: MUTATION_ID,
					workspaceId: WORKSPACE_ID,
					committedRevision: 2,
					committedAt: NOW,
					receipt: { kind: "node.delete", entityId: "node-1", deleted: true },
					status: "committed",
				});
			},
		});

		try {
			await waitFor(committed);
			for (
				let attempt = 0;
				attempt < 10 && queue.list().length > 0;
				attempt += 1
			) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			expect(calls).toBe(2);
			expect(requestBodies).toEqual([
				JSON.stringify(mutation()),
				JSON.stringify(mutation()),
			]);
			expect(queue.list()).toEqual([]);
			expect(stateStore.read()?.revision).toBe(2);
			expect(lifecycle).toContain("syncing");
			expect(lifecycle).toContain("retrying");
			expect(lifecycle).toContain("committed");
			let messages: string[] = [];
			const unsubscribeToasts = toastModule.toastStore.subscribe((toasts) => {
				messages = toasts.map((toast) => toast.message);
			});
			expect(messages.some((message) => message.includes("not saved"))).toBe(
				false,
			);
			unsubscribeToasts();
		} finally {
			stop();
			unsubscribeStatus();
		}
	});
});
