import { describe, expect, it } from "bun:test";
import type { AppState, NodeItem } from "$lib/models";
import type { BrowserWorkspaceSnapshot } from "$lib/workspace-browser-session-v2";
import { createCloudWorkspaceSession } from "$lib/workspace-cloud-session";
import type { WorkspaceCloudStatus } from "$lib/workspace-cloud-status";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import { parseWorkspaceMutation } from "$lib/workspace-mutation";
import {
	createEmptyWorkspacePersistenceRecord,
	InMemoryWorkspacePersistence,
} from "$lib/workspace-persistence";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
} from "$lib/workspace-v2-state";

const NOW = "2026-10-23T10:00:00.000Z";
const GIST_ID = "cloud-session-gist";
const WORKSPACE_ID = `gist:${GIST_ID}`;
const MUTATION_ID = "91000000-0000-4000-8000-000000000001";

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

function document(revision = 0, nodes: NodeItem[] = []): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision,
		updatedAt: NOW,
		lastMutationId: revision === 0 ? null : MUTATION_ID,
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

function state(remote = document()): AppState {
	return hydrateAppStateFromWorkspaceDocument(
		createDefaultWorkspaceState(NOW),
		remote,
		GIST_ID,
	);
}

function snapshot(remote = document()): BrowserWorkspaceSnapshot {
	return { origin: "v2", document: remote, state: state(remote) };
}

function persistence(pending = false): InMemoryWorkspacePersistence {
	const record = createEmptyWorkspacePersistenceRecord();
	record.snapshot = state();
	record.binding = createWorkspaceV2LocalState(GIST_ID, {
		baseline: document(),
	});
	if (pending) {
		record.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [
				parseWorkspaceMutation({
					mutationId: MUTATION_ID,
					workspaceId: WORKSPACE_ID,
					expectedRevision: 0,
					source: "browser",
					createdAt: NOW,
					kind: "workspace.reconcile",
					payload: { baselineRevision: 0, data: document().data },
				}),
			],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: null,
				deadLetters: [],
			},
		};
	}
	return new InMemoryWorkspacePersistence(record);
}

function setup(
	store: InMemoryWorkspacePersistence,
	readCloudSnapshot: (
		token: string,
		gistId: string,
		current: AppState,
	) => Promise<BrowserWorkspaceSnapshot>,
	fetchImpl?: typeof fetch,
) {
	let token: string | null = "fixture-token";
	let current = state();
	let status: WorkspaceCloudStatus = { phase: "disconnected", message: null };
	const session = createCloudWorkspaceSession({
		persistence: store,
		getState: () => current,
		setState: (next) => {
			current = next;
		},
		getToken: () => token,
		setStatus: (next) => {
			status = next;
		},
		readCloudSnapshot,
		fetchImpl,
	});
	return {
		...session,
		state: () => current,
		status: () => status,
		setToken: (next: string | null) => {
			token = next;
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("cloud Workspace session", () => {
	it("revalidates only the saved cloud Gist and replaces the browser cache", async () => {
		const store = persistence();
		const calls: string[] = [];
		const session = setup(store, async (_token, gistId) => {
			calls.push(gistId);
			return snapshot(document(2, [node("cloud")]));
		});

		expect(await session.refreshCloudWorkspace("fixture-token")).toBe(true);
		expect(calls).toEqual([GIST_ID]);
		expect(session.state().nodes.map((item) => item.id)).toEqual(["cloud"]);
		expect(session.status()).toEqual({ phase: "ready", message: null });
		expect((await store.read()).binding?.revision).toBe(2);
	});

	it("stays disconnected without a bound cloud Gist and never uploads a local cache", async () => {
		const record = createEmptyWorkspacePersistenceRecord();
		record.snapshot = {
			...createDefaultWorkspaceState(NOW),
			nodes: [node("legacy-local")],
		};
		const store = new InMemoryWorkspacePersistence(record);
		const before = await store.read();
		let readCount = 0;
		const session = setup(store, async () => {
			readCount += 1;
			return snapshot();
		});

		expect(await session.refreshCloudWorkspace("fixture-token")).toBe(false);
		expect(session.status().phase).toBe("disconnected");
		expect(readCount).toBe(0);
		expect(await store.read()).toEqual(before);
	});

	it("delivers original pending mutation IDs before fetching the latest cloud document", async () => {
		const store = persistence(true);
		const steps: string[] = [];
		const session = setup(
			store,
			async () => {
				steps.push("read-cloud");
				expect(
					(await store.read()).workspaces[WORKSPACE_ID]?.mutations,
				).toEqual([]);
				return snapshot(document(2, [node("new-cloud")]));
			},
			async (_input, init) => {
				const request = JSON.parse(String(init?.body));
				steps.push(request.mutationId);
				return Response.json({
					document: document(1),
					mutationId: request.mutationId,
					workspaceId: WORKSPACE_ID,
					committedRevision: 1,
					committedAt: NOW,
					receipt: { kind: request.kind },
					status: "committed",
				});
			},
		);

		expect(await session.refreshCloudWorkspace("fixture-token")).toBe(true);
		expect(steps).toEqual([MUTATION_ID, "read-cloud"]);
		expect(session.state().nodes.map((item) => item.id)).toEqual(["new-cloud"]);
		expect((await store.read()).binding?.revision).toBe(2);
	});

	it("preserves deferred mutations and blocks editing without loading stale cloud data", async () => {
		const record = await persistence(true).read();
		record.workspaces[WORKSPACE_ID].delivery.retry = {
			attempt: 2,
			nextAttemptAt: Date.now() + 60_000,
			lastErrorCode: "upstream_timeout",
		};
		const store = new InMemoryWorkspacePersistence(record);
		let readCount = 0;
		const session = setup(store, async () => {
			readCount += 1;
			return snapshot(document(2));
		});

		expect(await session.refreshCloudWorkspace("fixture-token")).toBe(false);
		expect(session.status()).toEqual({
			phase: "error",
			message:
				"Cloud synchronization is pending. Retry after the connection is restored.",
		});
		expect(readCount).toBe(0);
		expect(
			(await store.read()).workspaces[WORKSPACE_ID]?.mutations[0]?.mutationId,
		).toBe(MUTATION_ID);
	});

	it("resumes an authentication-blocked mutation with its original identity", async () => {
		const record = await persistence(true).read();
		record.workspaces[WORKSPACE_ID].delivery.blocked = {
			mutationId: MUTATION_ID,
			kind: "workspace.reconcile",
			code: "unauthorized",
			disposition: "auth-required",
			messageKey: "workspace.auth-required",
			createdAt: NOW,
			blockedAt: NOW,
		};
		const store = new InMemoryWorkspacePersistence(record);
		const sent: string[] = [];
		const session = setup(
			store,
			async () => snapshot(document(1)),
			async (_input, init) => {
				const request = JSON.parse(String(init?.body));
				sent.push(request.mutationId);
				return Response.json({
					document: document(1),
					mutationId: request.mutationId,
					workspaceId: WORKSPACE_ID,
					committedRevision: 1,
					committedAt: NOW,
					receipt: { kind: request.kind },
					status: "committed",
				});
			},
		);

		expect(await session.refreshCloudWorkspace("fixture-token")).toBe(true);
		expect(sent).toEqual([MUTATION_ID]);
		expect(
			(await store.read()).workspaces[WORKSPACE_ID]?.delivery.blocked,
		).toBeNull();
		expect(session.status().phase).toBe("ready");
	});

	it("reports a bounded load error while preserving cached data and repair evidence", async () => {
		const store = persistence();
		const before = await store.read();
		const session = setup(store, async () => {
			throw new Error("fixture-token upstream response body");
		});

		expect(await session.refreshCloudWorkspace("fixture-token")).toBe(false);
		expect(session.status()).toEqual({
			phase: "error",
			message:
				"Unable to load cloud data. Check your token and connection, then retry.",
		});
		expect(await store.read()).toEqual(before);
	});

	it("clears the ready state when authentication is absent", async () => {
		let reads = 0;
		const session = setup(persistence(), async () => {
			reads += 1;
			return snapshot(document(1));
		});
		expect(await session.refreshCloudWorkspace("fixture-token")).toBe(true);
		session.setToken(null);

		expect(await session.refreshCloudWorkspace("")).toBe(false);
		expect(session.status().phase).toBe("disconnected");
		expect(reads).toBe(1);
	});

	it("requires explicit migration before loading a legacy cloud document", async () => {
		const store = persistence();
		const before = await store.read();
		const session = setup(store, async () => ({
			...snapshot(),
			origin: "v1",
			legacySourceSha256: "a".repeat(64),
		}));

		expect(await session.refreshCloudWorkspace("fixture-token")).toBe(false);
		expect(session.status()).toEqual({
			phase: "error",
			message: "Upgrade this Workspace to continue.",
		});
		expect(await store.read()).toEqual(before);
	});

	for (const syncMode of ["manual", "paused-conflict"] as const) {
		it(`does not publish retained ${syncMode} browser changes while loading cloud data`, async () => {
			const record = await persistence(true).read();
			record.binding = createWorkspaceV2LocalState(GIST_ID, {
				baseline: document(),
				syncMode,
			});
			record.snapshot = state(document(0, [node("legacy-browser-only")]));
			record.workspaces[WORKSPACE_ID].mutations[0] = parseWorkspaceMutation({
				...record.workspaces[WORKSPACE_ID].mutations[0],
				payload: {
					baselineRevision: 0,
					data: document(0, [node("legacy-browser-only")]).data,
				},
			});
			const store = new InMemoryWorkspacePersistence(record);
			const before = await store.read();
			let readCount = 0;
			let writeCount = 0;
			const session = setup(
				store,
				async () => {
					readCount += 1;
					return snapshot(document(1));
				},
				async () => {
					writeCount += 1;
					return new Response("Injected unexpected publication", {
						status: 500,
					});
				},
			);

			expect(await session.refreshCloudWorkspace("fixture-token")).toBe(false);
			expect(writeCount).toBe(0);
			expect(readCount).toBe(0);
			expect(session.status()).toEqual({
				phase: "error",
				message: "Retained changes require Reload from Cloud before editing.",
			});
			expect(await store.read()).toEqual(before);
		});
	}

	it("ignores a cloud response after logout", async () => {
		const store = persistence();
		const before = await store.read();
		const response = deferred<BrowserWorkspaceSnapshot>();
		const started = deferred<void>();
		const session = setup(store, async () => {
			started.resolve();
			return response.promise;
		});
		const loading = session.refreshCloudWorkspace("fixture-token");
		await started.promise;
		session.setToken(null);
		session.cancelCloudWorkspaceLoad();
		response.resolve(snapshot(document(4, [node("late")])));

		expect(await loading).toBe(false);
		expect(session.status().phase).toBe("disconnected");
		expect(session.state().nodes).toEqual([]);
		expect(await store.read()).toEqual(before);
	});

	it("acknowledges an in-flight commit but sends no later queued writes after logout", async () => {
		const record = await persistence(true).read();
		const secondMutationId = "91000000-0000-4000-8000-000000000002";
		record.workspaces[WORKSPACE_ID].mutations.push(
			parseWorkspaceMutation({
				mutationId: secondMutationId,
				workspaceId: WORKSPACE_ID,
				expectedRevision: 1,
				source: "browser",
				createdAt: NOW,
				kind: "workspace.reconcile",
				payload: { baselineRevision: 0, data: document().data },
			}),
		);
		const store = new InMemoryWorkspacePersistence(record);
		const response = deferred<Response>();
		const started = deferred<void>();
		const sent: string[] = [];
		const session = setup(
			store,
			async () => snapshot(document(2)),
			async (_input, init) => {
				const request = JSON.parse(String(init?.body));
				sent.push(request.mutationId);
				started.resolve();
				return response.promise;
			},
		);
		const loading = session.refreshCloudWorkspace("fixture-token");
		await started.promise;
		session.setToken(null);
		session.cancelCloudWorkspaceLoad();
		response.resolve(
			Response.json({
				document: document(1),
				mutationId: MUTATION_ID,
				workspaceId: WORKSPACE_ID,
				committedRevision: 1,
				committedAt: NOW,
				receipt: { kind: "workspace.reconcile" },
				status: "committed",
			}),
		);

		expect(await loading).toBe(false);
		expect(sent).toEqual([MUTATION_ID]);
		const stored = await store.read();
		expect(stored.binding?.revision).toBe(1);
		expect(
			stored.workspaces[WORKSPACE_ID]?.mutations.map((item) => item.mutationId),
		).toEqual([secondMutationId]);
		expect(session.status().phase).toBe("disconnected");
	});

	it("ignores a stale response from an earlier refresh", async () => {
		const store = persistence();
		const firstResponse = deferred<BrowserWorkspaceSnapshot>();
		const started = deferred<void>();
		let reads = 0;
		const session = setup(store, async () => {
			reads += 1;
			if (reads === 1) {
				started.resolve();
				return firstResponse.promise;
			}
			return snapshot(document(5, [node("latest")]));
		});
		const first = session.refreshCloudWorkspace("fixture-token");
		await started.promise;
		expect(await session.refreshCloudWorkspace("fixture-token")).toBe(true);
		firstResponse.resolve(snapshot(document(2, [node("stale")])));

		expect(await first).toBe(false);
		expect(session.state().nodes.map((item) => item.id)).toEqual(["latest"]);
		expect((await store.read()).binding?.revision).toBe(5);
		expect(session.status().phase).toBe("ready");
	});

	it("ignores responses if the authentication token changed without another refresh", async () => {
		const store = persistence();
		const before = await store.read();
		const response = deferred<BrowserWorkspaceSnapshot>();
		const started = deferred<void>();
		const session = setup(store, async () => {
			started.resolve();
			return response.promise;
		});
		const loading = session.refreshCloudWorkspace("fixture-token");
		await started.promise;
		session.setToken("replacement-token");
		response.resolve(snapshot(document(4, [node("stale-token")])));

		expect(await loading).toBe(false);
		expect(session.status().phase).toBe("disconnected");
		expect(await store.read()).toEqual(before);
	});

	it("does not overwrite a newer confirmed edit when a cloud read finishes late", async () => {
		const store = persistence();
		const response = deferred<BrowserWorkspaceSnapshot>();
		const started = deferred<void>();
		const session = setup(store, async () => {
			started.resolve();
			return response.promise;
		});
		const loading = session.refreshCloudWorkspace("fixture-token");
		await started.promise;
		const confirmed = document(4, [node("confirmed")]);
		await store.rebindWorkspace({
			snapshot: state(confirmed),
			binding: createWorkspaceV2LocalState(GIST_ID, { baseline: confirmed }),
		});
		const before = await store.read();
		response.resolve(snapshot(document(2, [node("stale-read")])));

		expect(await loading).toBe(false);
		expect(session.status().phase).toBe("error");
		expect(await store.read()).toEqual(before);
	});
});
