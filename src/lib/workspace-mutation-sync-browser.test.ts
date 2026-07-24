import * as bunTest from "bun:test";
import type { AppState, NodeItem } from "$lib/models";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import type { WorkspaceEvent } from "$lib/workspace-events";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import type { WorkspaceSyncStatus } from "$lib/workspace-sync-status";

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

		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
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

	it("blocks a domain conflict with safe mutation metadata", async () => {
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
		const blockedStatus: { current: WorkspaceSyncStatus | null } = {
			current: null,
		};
		let eventListener: (event: WorkspaceEvent) => void = () => {};
		let fetchCalls = 0;
		let unsubscribeStatus = () => {};
		const blocked = new Promise<void>((resolve) => {
			unsubscribeStatus = statusModule.workspaceSyncStatus.subscribe(
				(status) => {
					if (status.phase === "blocked-domain-conflict") {
						blockedStatus.current = status;
						resolve();
					}
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
			subscribeEvents: (listener) => {
				eventListener = listener;
				return () => {};
			},
			fetchImpl: async () => {
				fetchCalls += 1;
				return Response.json(
					{
						error: {
							code: "duplicate_node_raw",
							message: "A node already uses this URI",
							disposition: "domain-conflict",
						},
					},
					{ status: 409 },
				);
			},
		});

		try {
			await waitFor(blocked);
			expect(blockedStatus.current?.recentError?.code).toBe(
				"duplicate_node_raw",
			);
			expect(blockedStatus.current?.blockedMutation).toEqual({
				mutationId: MUTATION_ID,
				kind: "node.delete",
				code: "duplicate_node_raw",
				disposition: "domain-conflict",
				message: "duplicate_node_raw",
			});
			expect(blockedStatus.current?.activeQueueCount).toBe(1);
			expect(blockedStatus.current?.blockedMutationCount).toBe(1);
			expect(queue.list()).toEqual([mutation()]);
			eventListener({
				type: "mutation-queue-changed",
				gistId: GIST_ID,
				fileName: "subman.json",
				mutationId: MUTATION_ID,
				queueAction: "enqueued",
			});
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(fetchCalls).toBe(1);
		} finally {
			stop();
			unsubscribeStatus();
		}
	});

	it("settles empty and blocked delivery races instead of staying syncing", async () => {
		const [workspaceData, queueModule, stateModule, sync, statusModule] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-mutation-queue"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
				import("$lib/workspace-sync-status"),
			]);
		for (const scenario of ["empty", "blocked"] as const) {
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
			const expectedPhase =
				scenario === "empty" ? "automatic-idle" : "manual-local-only";
			let changedRaceState = false;
			let unsubscribeStatus = () => {};
			const settled = new Promise<void>((resolve) => {
				unsubscribeStatus = statusModule.workspaceSyncStatus.subscribe(
					(status) => {
						if (status.phase === "syncing" && !changedRaceState) {
							changedRaceState = true;
							if (scenario === "empty") {
								storage.removeItem("subman:workspace-mutation-queue:v1");
							} else {
								stateStore.write(
									stateModule.createWorkspaceV2LocalState(GIST_ID, {
										baseline: document(1),
										syncMode: "manual",
									}),
								);
							}
						}
						if (changedRaceState && status.phase === expectedPhase) resolve();
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
				fetchImpl: async () => {
					throw new Error("race must settle before network delivery");
				},
			});

			try {
				await waitFor(settled);
				expect(changedRaceState).toBe(true);
			} finally {
				stop();
				unsubscribeStatus();
			}
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

	it("delivers through persisted storage, hydrates the committed snapshot, and broadcasts after commit", async () => {
		const [workspaceData, persistenceModule, stateModule, sync, statusModule] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-persistence"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
				import("$lib/workspace-sync-status"),
			]);
		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
		const baseline = document(1);
		const binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
			baseline,
		});
		const initialSnapshot = stateModule.hydrateAppStateFromWorkspaceDocument(
			workspaceData.createDefaultWorkspaceState(NOW),
			baseline,
			GIST_ID,
		);
		const record = persistenceModule.createEmptyWorkspacePersistenceRecord();
		record.snapshot = initialSnapshot;
		record.binding = binding;
		const persistence = new persistenceModule.InMemoryWorkspacePersistence(
			record,
		);
		const { expectedRevision: _revision, ...draft } = mutation();
		const optimisticSnapshot = stateModule.hydrateAppStateFromWorkspaceDocument(
			initialSnapshot,
			document(2),
			GIST_ID,
		);
		await persistence.commitAutomaticAction({
			snapshot: optimisticSnapshot,
			binding,
			mutation: draft,
		});

		let state = initialSnapshot;
		const hydrated: AppState[] = [];
		const broadcasts: WorkspaceEvent[] = [];
		let unsubscribeStatus = () => {};
		const committed = new Promise<void>((resolve) => {
			unsubscribeStatus = statusModule.workspaceSyncStatus.subscribe(
				(status) => {
					if (
						status.lifecycle === "committed" &&
						status.lastCommittedRevision === 2
					) {
						resolve();
					}
				},
			);
		});
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 0,
			persistence,
			refreshPersistence: () => persistence.read(),
			getState: () => state,
			setState: (next) => {
				state = next;
				hydrated.push(next);
			},
			broadcast: (event) => broadcasts.push(event),
			subscribeAuth: (listener) => {
				listener({ token: "browser-token" });
				return () => {};
			},
			subscribeEvents: () => () => {},
			fetchImpl: async () =>
				Response.json({
					document: document(2),
					mutationId: MUTATION_ID,
					workspaceId: WORKSPACE_ID,
					committedRevision: 2,
					committedAt: NOW,
					receipt: {
						kind: "node.delete",
						entityId: "node-1",
						deleted: true,
					},
					status: "committed",
				}),
		});

		try {
			await waitFor(committed);
			const stored = await persistence.read();
			expect(stored.binding?.revision).toBe(2);
			expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([]);
			expect(hydrated.at(-1)).toEqual(stored.snapshot);
			expect(state).toEqual(stored.snapshot);
			expect(broadcasts).toEqual([
				{
					type: "workspace-v2-committed",
					gistId: GIST_ID,
					fileName: "subman.json",
					mutationId: MUTATION_ID,
					document: document(2),
					status: "committed",
				},
			]);
		} finally {
			stop();
			unsubscribeStatus();
		}
	});

	it("refreshes persisted state for queue, commit, and conflict wake events before scheduling", async () => {
		const [workspaceData, persistenceModule, stateModule, sync] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-persistence"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
			]);
		const snapshots = ["queue", "commit", "conflict"].map((name, index) => ({
			...stateModule.hydrateAppStateFromWorkspaceDocument(
				workspaceData.createDefaultWorkspaceState(NOW),
				document(1),
				GIST_ID,
			),
			lastUpdated: `${NOW}:${index}:${name}`,
		}));
		const records = snapshots.map((snapshot, index) => {
			const record = persistenceModule.createEmptyWorkspacePersistenceRecord();
			record.snapshot = snapshot;
			record.binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
				baseline: document(1),
				syncMode: index === 2 ? "paused-conflict" : "automatic",
			});
			return record;
		});
		const persistence = new persistenceModule.InMemoryWorkspacePersistence(
			records[0],
		);
		let eventListener: (event: WorkspaceEvent) => void = () => {};
		let refreshIndex = 0;
		let state = workspaceData.createDefaultWorkspaceState(NOW);
		const seen: string[] = [];
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 60_000,
			persistence,
			refreshPersistence: async () =>
				structuredClone(records[Math.min(refreshIndex++, records.length - 1)]),
			getState: () => state,
			setState: (next) => {
				state = next;
				seen.push(next.lastUpdated);
			},
			subscribeAuth: (listener) => {
				listener({ token: null });
				return () => {};
			},
			subscribeEvents: (listener) => {
				eventListener = listener;
				return () => {};
			},
		});
		const wakeEvents: WorkspaceEvent[] = [
			{
				type: "mutation-queue-changed",
				gistId: GIST_ID,
				fileName: "subman.json",
			},
			{
				type: "workspace-v2-committed",
				gistId: GIST_ID,
				fileName: "subman.json",
			},
			{
				type: "paused-conflict",
				gistId: GIST_ID,
				fileName: "subman.json",
			},
		];

		try {
			for (const [index, event] of wakeEvents.entries()) {
				eventListener(event);
				for (
					let attempt = 0;
					attempt < 20 && seen.length <= index;
					attempt += 1
				) {
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
			}
			expect(seen).toEqual(snapshots.map((snapshot) => snapshot.lastUpdated));
			expect(state).toEqual(snapshots.at(-1));
		} finally {
			stop();
		}
	});

	it("reconstructs a persisted manual retry through the real event channel", async () => {
		const [
			workspaceData,
			events,
			persistenceModule,
			stateModule,
			sync,
			statusModule,
		] = await Promise.all([
			import("$lib/workspace-data"),
			import("$lib/workspace-events"),
			import("$lib/workspace-persistence"),
			import("$lib/workspace-v2-state"),
			import("$lib/workspace-mutation-sync-browser"),
			import("$lib/workspace-sync-status"),
		]);
		const baseline = document(1);
		const binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
			baseline,
			syncMode: "manual",
		});
		let state = stateModule.hydrateAppStateFromWorkspaceDocument(
			workspaceData.createDefaultWorkspaceState(NOW),
			document(2),
			GIST_ID,
		);
		const persistence = new persistenceModule.InMemoryWorkspacePersistence();
		await persistence.repairWorkspaceQueue({
			snapshot: state,
			binding,
			mutations: [mutation()],
		});
		const ownerId = "manual-retry-test";
		const acquired = await persistence.acquireLease({
			name: persistenceModule.workspaceDispatcherLeaseName(WORKSPACE_ID),
			ownerId,
			now: Date.now(),
			ttlMs: 30_000,
		});
		if (!acquired.acquired) throw new Error("Expected retry metadata lease");
		const fence = {
			ownerId,
			fencingToken: acquired.lease.fencingToken,
		};
		const nextAttemptAt = Date.now() + 60_000;
		await persistence.setRetryMetadata(
			WORKSPACE_ID,
			MUTATION_ID,
			{
				attempt: 2,
				nextAttemptAt,
				lastErrorCode: "network_error",
			},
			fence,
		);
		await persistence.releaseLease({
			name: persistenceModule.workspaceDispatcherLeaseName(WORKSPACE_ID),
			...fence,
		});

		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
		let latest = statusModule.defaultWorkspaceSyncStatus;
		let resolveRetrying = () => {};
		const retrying = new Promise<void>((resolve) => {
			resolveRetrying = resolve;
		});
		const unsubscribeStatus = statusModule.workspaceSyncStatus.subscribe(
			(status) => {
				latest = status;
				if (status.phase === "retrying") resolveRetrying();
			},
		);
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 60_000,
			persistence,
			getState: () => state,
			setState: (next) => {
				state = next;
			},
			subscribeAuth: (listener) => {
				listener({ token: "browser-token" });
				return () => {};
			},
		});

		try {
			events.broadcastWorkspaceEvent({
				type: "mutation-queue-changed",
				gistId: GIST_ID,
				fileName: "subman.json",
				mutationId: MUTATION_ID,
			});
			await waitFor(retrying);
			expect(latest.phase).toBe("retrying");
			expect(latest.retry?.attempt).toBe(2);
			expect(latest.retry?.nextAttemptAt).toBe(nextAttemptAt);
			expect(latest.repairRequired).toBe(false);
		} finally {
			stop();
			unsubscribeStatus();
			statusModule.workspaceSyncStatus.set({
				...statusModule.defaultWorkspaceSyncStatus,
			});
		}
	});

	it("settles persisted empty, blocked, and auth-cleared paths without remaining syncing", async () => {
		const [workspaceData, persistenceModule, stateModule, sync, statusModule] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-persistence"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
				import("$lib/workspace-sync-status"),
			]);
		const binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(1),
		});
		const snapshot = stateModule.hydrateAppStateFromWorkspaceDocument(
			workspaceData.createDefaultWorkspaceState(NOW),
			document(1),
			GIST_ID,
		);
		const queued = persistenceModule.createEmptyWorkspacePersistenceRecord();
		queued.snapshot = snapshot;
		queued.binding = binding;
		queued.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [mutation()],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: null,
				deadLetters: [],
			},
		};
		const empty = structuredClone(queued);
		empty.workspaces[WORKSPACE_ID].mutations = [];

		for (const outcome of ["empty", "blocked"] as const) {
			statusModule.workspaceSyncStatus.set({
				...statusModule.defaultWorkspaceSyncStatus,
			});
			let reads = 0;
			let latest = statusModule.defaultWorkspaceSyncStatus;
			const unsubscribe = statusModule.workspaceSyncStatus.subscribe(
				(status) => (latest = status),
			);
			const persistence = new persistenceModule.InMemoryWorkspacePersistence(
				queued,
			);
			const stop = sync.startWorkspaceMutationSync({
				enabled: true,
				delayMs: 0,
				persistence,
				refreshPersistence: async () => {
					reads += 1;
					return structuredClone(
						reads === 1 ? queued : outcome === "empty" ? empty : queued,
					);
				},
				dispatchPersistence: async () => ({ status: outcome }),
				getState: () => snapshot,
				setState: () => {},
				subscribeAuth: (listener) => {
					listener({ token: "browser-token" });
					return () => {};
				},
				subscribeEvents: () => () => {},
			});
			try {
				for (
					let attempt = 0;
					attempt < 20 && latest.phase === "syncing";
					attempt += 1
				) {
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
				expect(latest.phase).not.toBe("syncing");
				expect(latest.phase).toBe(
					outcome === "empty" ? "automatic-idle" : "queued",
				);
			} finally {
				stop();
				unsubscribe();
			}
		}

		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
		let authListener: (state: { token: string | null }) => void = () => {};
		let latest = statusModule.defaultWorkspaceSyncStatus;
		const unsubscribe = statusModule.workspaceSyncStatus.subscribe(
			(status) => (latest = status),
		);
		const persistence = new persistenceModule.InMemoryWorkspacePersistence(
			queued,
		);
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 0,
			persistence,
			refreshPersistence: () => persistence.read(),
			getState: () => snapshot,
			setState: () => {},
			subscribeAuth: (listener) => {
				authListener = listener;
				listener({ token: "browser-token" });
				return () => {};
			},
			subscribeEvents: () => () => {},
		});
		try {
			authListener({ token: null });
			for (
				let attempt = 0;
				attempt < 20 && latest.phase !== "auth-required";
				attempt += 1
			) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			expect(latest.phase).toBe("auth-required");
		} finally {
			stop();
			unsubscribe();
		}
	});

	it("reconstructs persisted blocked state and surfaces unexpected persistence failures", async () => {
		const [workspaceData, persistenceModule, stateModule, sync, statusModule] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-persistence"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
				import("$lib/workspace-sync-status"),
			]);
		const snapshot = stateModule.hydrateAppStateFromWorkspaceDocument(
			workspaceData.createDefaultWorkspaceState(NOW),
			document(1),
			GIST_ID,
		);
		const record = persistenceModule.createEmptyWorkspacePersistenceRecord();
		record.snapshot = snapshot;
		record.binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(1),
		});
		record.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [mutation()],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: {
					mutationId: MUTATION_ID,
					kind: "node.delete",
					code: "duplicate_node_raw",
					disposition: "domain-conflict",
					messageKey: "workspace.domain-conflict",
					createdAt: NOW,
					blockedAt: NOW,
				},
				deadLetters: [],
			},
		};
		const persistence = new persistenceModule.InMemoryWorkspacePersistence(
			record,
		);
		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
		let latest = statusModule.defaultWorkspaceSyncStatus;
		const unsubscribe = statusModule.workspaceSyncStatus.subscribe(
			(status) => (latest = status),
		);
		let dispatchCalls = 0;
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 0,
			persistence,
			refreshPersistence: () => persistence.read(),
			dispatchPersistence: async () => {
				dispatchCalls += 1;
				return { status: "blocked" };
			},
			getState: () => snapshot,
			setState: () => {},
			subscribeAuth: (listener) => {
				listener({ token: "browser-token" });
				return () => {};
			},
			subscribeEvents: () => () => {},
		});
		try {
			for (
				let attempt = 0;
				attempt < 20 && latest.phase !== "blocked-domain-conflict";
				attempt += 1
			) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			expect(latest.phase).toBe("blocked-domain-conflict");
			expect(latest.blockedMutation?.mutationId).toBe(MUTATION_ID);
			expect(dispatchCalls).toBe(0);
		} finally {
			stop();
			unsubscribe();
		}

		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
		latest = statusModule.defaultWorkspaceSyncStatus;
		const unsubscribeFailure = statusModule.workspaceSyncStatus.subscribe(
			(status) => (latest = status),
		);
		const stopFailure = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 0,
			persistence,
			refreshPersistence: async () => {
				throw new Error("injected read failure");
			},
			getState: () => snapshot,
			setState: () => {},
			subscribeAuth: (listener) => {
				listener({ token: null });
				return () => {};
			},
			subscribeEvents: () => () => {},
		});
		try {
			for (
				let attempt = 0;
				attempt < 20 && latest.phase !== "invalid-local-storage";
				attempt += 1
			) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			expect(latest.phase).toBe("invalid-local-storage");
			expect(latest.recentError?.code).toBe("workspace_persistence_failed");
		} finally {
			stopFailure();
			unsubscribeFailure();
		}
	});

	it("resumes the same persisted queue head after authentication is restored", async () => {
		const [workspaceData, persistenceModule, stateModule, sync, statusModule] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-persistence"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
				import("$lib/workspace-sync-status"),
			]);
		const snapshot = stateModule.hydrateAppStateFromWorkspaceDocument(
			workspaceData.createDefaultWorkspaceState(NOW),
			document(1),
			GIST_ID,
		);
		const record = persistenceModule.createEmptyWorkspacePersistenceRecord();
		record.snapshot = snapshot;
		record.binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(1),
		});
		record.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [mutation()],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: {
					mutationId: MUTATION_ID,
					kind: "node.delete",
					code: "unauthorized",
					disposition: "auth-required",
					messageKey: "workspace.auth-required",
					createdAt: NOW,
					blockedAt: NOW,
				},
				deadLetters: [],
			},
		};
		const persistence = new persistenceModule.InMemoryWorkspacePersistence(
			record,
		);
		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
		let authListener: (state: { token: string | null }) => void = () => {};
		let latest = statusModule.defaultWorkspaceSyncStatus;
		const unsubscribe = statusModule.workspaceSyncStatus.subscribe(
			(status) => (latest = status),
		);
		let dispatchCalls = 0;
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 0,
			persistence,
			refreshPersistence: () => persistence.read(),
			dispatchPersistence: async () => {
				dispatchCalls += 1;
				return { status: "blocked" };
			},
			getState: () => snapshot,
			setState: () => {},
			subscribeAuth: (listener) => {
				authListener = listener;
				listener({ token: null });
				return () => {};
			},
			subscribeEvents: () => () => {},
		});
		try {
			for (
				let attempt = 0;
				attempt < 20 && latest.phase !== "auth-required";
				attempt += 1
			) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			expect(latest.phase).toBe("auth-required");
			expect(dispatchCalls).toBe(0);

			authListener({ token: "replacement-token" });
			for (let attempt = 0; attempt < 20 && dispatchCalls === 0; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			const stored = await persistence.read();
			expect(dispatchCalls).toBe(1);
			expect(stored.workspaces[WORKSPACE_ID]?.mutations[0]?.mutationId).toBe(
				MUTATION_ID,
			);
			expect(stored.workspaces[WORKSPACE_ID]?.delivery.blocked).toBeNull();
			expect(latest.phase).toBe("queued");
		} finally {
			stop();
			unsubscribe();
		}
	});

	it("restores a dead-letter-only active queue as repair-required", async () => {
		const [workspaceData, persistenceModule, stateModule, sync, statusModule] =
			await Promise.all([
				import("$lib/workspace-data"),
				import("$lib/workspace-persistence"),
				import("$lib/workspace-v2-state"),
				import("$lib/workspace-mutation-sync-browser"),
				import("$lib/workspace-sync-status"),
			]);
		const snapshot = stateModule.hydrateAppStateFromWorkspaceDocument(
			workspaceData.createDefaultWorkspaceState(NOW),
			document(1),
			GIST_ID,
		);
		const record = persistenceModule.createEmptyWorkspacePersistenceRecord();
		record.snapshot = snapshot;
		record.binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(1),
		});
		record.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: null,
				deadLetters: [
					{
						mutationId: MUTATION_ID,
						kind: "node.delete",
						code: "invalid_success_response",
						disposition: "queue-corruption",
						messageKey: null,
						createdAt: NOW,
						blockedAt: NOW,
						payloadBytes: 64,
					},
				],
			},
		};
		const persistence = new persistenceModule.InMemoryWorkspacePersistence(
			record,
		);
		statusModule.workspaceSyncStatus.set({
			...statusModule.defaultWorkspaceSyncStatus,
		});
		let latest = statusModule.defaultWorkspaceSyncStatus;
		const unsubscribe = statusModule.workspaceSyncStatus.subscribe(
			(status) => (latest = status),
		);
		let dispatchCalls = 0;
		const stop = sync.startWorkspaceMutationSync({
			enabled: true,
			delayMs: 0,
			persistence,
			refreshPersistence: () => persistence.read(),
			dispatchPersistence: async () => {
				dispatchCalls += 1;
				return { status: "blocked" };
			},
			getState: () => snapshot,
			setState: () => {},
			subscribeAuth: (listener) => {
				listener({ token: "browser-token" });
				return () => {};
			},
			subscribeEvents: () => () => {},
		});
		try {
			for (
				let attempt = 0;
				attempt < 20 && latest.phase !== "queue-repair-required";
				attempt += 1
			) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			expect(latest.phase).toBe("queue-repair-required");
			expect(latest.deadLetterCount).toBe(1);
			expect(latest.repairRequired).toBe(true);
			expect(dispatchCalls).toBe(0);
		} finally {
			stop();
			unsubscribe();
		}
	});
});
