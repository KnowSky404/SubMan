import { describe, expect, it } from "bun:test";
import type { AppState } from "$lib/models";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import type { WorkspaceMutationSubmissionResult } from "$lib/workspace-mutation-queue";
import {
	type BrowserWorkspacePersistence,
	createEmptyWorkspacePersistenceRecord,
	InMemoryWorkspacePersistenceBackend,
	TransactionalWorkspacePersistence,
	type WorkspacePersistenceRecord,
	workspaceDispatcherLeaseName,
} from "$lib/workspace-persistence";
import { dispatchPersistedWorkspaceMutation } from "$lib/workspace-persistence-dispatcher";
import { createWorkspaceV2LocalState } from "$lib/workspace-v2-state";

const NOW = "2026-07-23T10:00:00.000Z";
const NOW_2 = "2026-07-23T10:00:01.000Z";
const NOW_MS = Date.parse(NOW);
const GIST_ID = "gist-1";
const WORKSPACE_ID = `gist:${GIST_ID}`;
const MUTATION_ID = "b0000000-0000-4000-8000-000000000001";
const MUTATION_ID_2 = "b0000000-0000-4000-8000-000000000002";
const MUTATION_ID_3 = "b0000000-0000-4000-8000-000000000003";

const DATA = {
	nodes: [],
	subscriptions: [],
	aggregates: [],
	publishTargets: [],
	clientExports: [],
};

function document(
	revision = 0,
	lastMutationId: string | null = revision === 0 ? null : MUTATION_ID,
	updatedAt = NOW,
): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision,
		updatedAt,
		lastMutationId,
		data: DATA,
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
}

function snapshot(lastUpdated = NOW): AppState {
	return {
		...DATA,
		gists: [],
		activeGistId: GIST_ID,
		activeGistFile: "subman.json",
		lastUpdated,
	};
}

function mutation(
	mutationId = MUTATION_ID,
	expectedRevision = 0,
	createdAt = NOW,
): WorkspaceMutation {
	return {
		mutationId,
		workspaceId: WORKSPACE_ID,
		expectedRevision,
		source: "browser",
		createdAt,
		kind: "workspace.reconcile",
		payload: { baselineRevision: expectedRevision, data: DATA },
	};
}

function seededRecord(
	options: {
		mutations?: WorkspaceMutation[];
		syncMode?: "automatic" | "manual";
		retry?: {
			attempt: number;
			nextAttemptAt: number | null;
			lastErrorCode: string | null;
		};
	} = {},
): WorkspacePersistenceRecord {
	const mutations = options.mutations ?? [mutation()];
	const record = createEmptyWorkspacePersistenceRecord();
	record.snapshot = snapshot(mutations.at(-1)?.createdAt ?? NOW);
	record.binding = createWorkspaceV2LocalState(GIST_ID, {
		baseline: document(),
		syncMode: options.syncMode ?? "automatic",
	});
	record.workspaces[WORKSPACE_ID] = {
		workspaceId: WORKSPACE_ID,
		mutations,
		delivery: {
			retry: options.retry ?? {
				attempt: 0,
				nextAttemptAt: null,
				lastErrorCode: null,
			},
			blocked: null,
			deadLetters: [],
		},
	};
	return record;
}

function backend(record = seededRecord()): InMemoryWorkspacePersistenceBackend {
	return new InMemoryWorkspacePersistenceBackend(record, () => NOW);
}

function client(
	shared: InMemoryWorkspacePersistenceBackend,
	now: () => number,
): TransactionalWorkspacePersistence {
	return new TransactionalWorkspacePersistence(shared, now);
}

function committed(
	mutationValue = mutation(),
	status: "committed" | "already-committed" = "committed",
): WorkspaceMutationSubmissionResult {
	return {
		status: "committed",
		result: {
			document: document(
				mutationValue.expectedRevision + 1,
				mutationValue.mutationId,
				mutationValue.createdAt,
			),
			mutationId: mutationValue.mutationId,
			workspaceId: mutationValue.workspaceId,
			committedRevision: mutationValue.expectedRevision + 1,
			committedAt: mutationValue.createdAt,
			receipt: null,
			status,
		},
	};
}

function committedResponse(
	status: "committed" | "already-committed",
): Response {
	return Response.json(
		(committed(mutation(), status) as { result: unknown }).result,
	);
}

function advancedAlreadyCommitted(
	mutationValue = mutation(),
): WorkspaceMutationSubmissionResult {
	const base = committed(mutationValue, "already-committed");
	if (base.status !== "committed") {
		throw new Error("Expected a committed submission fixture");
	}
	return {
		...base,
		result: {
			...base.result,
			document: document(3, MUTATION_ID_3, NOW_2),
			status: "already-committed",
		},
	};
}

async function waitUntil(
	check: () => boolean | Promise<boolean>,
): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	throw new Error("Timed out waiting for test condition");
}

describe("persistence-backed Workspace dispatcher", () => {
	it("commits the head and replays the remaining optimistic queue", async () => {
		const second = mutation(MUTATION_ID_2, 1, NOW_2);
		const shared = backend(seededRecord({ mutations: [mutation(), second] }));
		const persistence = client(shared, () => NOW_MS);

		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence,
				githubToken: "token",
				ownerId: "tab-a",
				now: () => NOW_MS,
				submit: async () => committed(),
			}),
		).toEqual({ status: "committed" });

		const stored = await persistence.read();
		expect(stored.binding?.revision).toBe(1);
		expect(stored.snapshot?.lastUpdated).toBe(NOW_2);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([second]);
		expect(stored.leases).toEqual({});
	});

	it("preserves a committed result when lease cleanup fails", async () => {
		const shared = backend();
		const persistence = client(shared, () => NOW_MS);
		const cleanupFailure = new Proxy(persistence, {
			get(target, property) {
				if (property === "releaseLease") {
					return async () => {
						throw new Error("injected lease cleanup failure");
					};
				}
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		}) as BrowserWorkspacePersistence;

		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence: cleanupFailure,
				githubToken: "token",
				ownerId: "tab-a",
				now: () => NOW_MS,
				submit: async () => committed(),
			}),
		).toEqual({ status: "committed" });
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations,
		).toEqual([]);
	});

	it("allows only one of two independent dispatchers to submit", async () => {
		const shared = backend();
		const first = client(shared, () => NOW_MS);
		const second = client(shared, () => NOW_MS);
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let submits = 0;
		const firstDispatch = dispatchPersistedWorkspaceMutation({
			persistence: first,
			githubToken: "token",
			ownerId: "tab-a",
			now: () => NOW_MS,
			submit: async () => {
				submits += 1;
				await gate;
				return committed();
			},
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence: second,
				githubToken: "token",
				ownerId: "tab-b",
				now: () => NOW_MS,
				submit: async () => {
					submits += 1;
					return committed();
				},
			}),
		).toEqual({ status: "busy" });
		release();
		expect(await firstDispatch).toEqual({ status: "committed" });
		expect(submits).toBe(1);
	});

	it("heartbeats its fence while a long submit is in flight", async () => {
		let now = NOW_MS;
		const shared = backend();
		const first = client(shared, () => now);
		const second = client(shared, () => now);
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const firstDispatch = dispatchPersistedWorkspaceMutation({
			persistence: first,
			githubToken: "token",
			ownerId: "tab-a",
			leaseTtlMs: 50,
			leaseHeartbeatIntervalMs: 2,
			now: () => now,
			submit: async () => {
				await gate;
				return committed();
			},
		});
		const leaseName = workspaceDispatcherLeaseName(WORKSPACE_ID);
		await waitUntil(async () =>
			Boolean((await first.read()).leases[leaseName]),
		);
		now += 40;
		await waitUntil(
			async () => (await first.read()).leases[leaseName]?.heartbeatAt === now,
		);
		now += 20;

		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence: second,
				githubToken: "token",
				ownerId: "tab-b",
				leaseTtlMs: 50,
				leaseHeartbeatIntervalMs: 2,
				now: () => now,
				submit: async () => committed(),
			}),
		).toEqual({ status: "busy" });
		release();
		expect(await firstDispatch).toEqual({ status: "committed" });
		expect((await first.read()).workspaces[WORKSPACE_ID]?.mutations).toEqual(
			[],
		);
	});

	it("stops heartbeating before commit and permits expiry takeover", async () => {
		let now = NOW_MS;
		const shared = backend();
		const first = client(shared, () => now);
		const second = client(shared, () => now);
		let releaseCommit = () => {};
		let signalCommit = () => {};
		const commitGate = new Promise<void>((resolve) => {
			releaseCommit = resolve;
		});
		const commitStarted = new Promise<void>((resolve) => {
			signalCommit = resolve;
		});
		const delayedCommit = new Proxy(first, {
			get(target, property) {
				if (property === "commitDeliverySuccess") {
					return async (
						...args: Parameters<typeof target.commitDeliverySuccess>
					) => {
						signalCommit();
						await commitGate;
						return target.commitDeliverySuccess(...args);
					};
				}
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		}) as BrowserWorkspacePersistence;
		const firstDispatch = dispatchPersistedWorkspaceMutation({
			persistence: delayedCommit,
			githubToken: "token",
			ownerId: "tab-a",
			leaseTtlMs: 50,
			leaseHeartbeatIntervalMs: 2,
			now: () => now,
			submit: async () => committed(),
		});
		await commitStarted;
		const leaseName = workspaceDispatcherLeaseName(WORKSPACE_ID);
		const stoppedLease = (await first.read()).leases[leaseName];
		now += 20;
		await new Promise((resolve) => setTimeout(resolve, 8));
		expect((await first.read()).leases[leaseName]).toEqual(stoppedLease);
		now += 31;

		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence: second,
				githubToken: "token",
				ownerId: "tab-b",
				leaseTtlMs: 50,
				leaseHeartbeatIntervalMs: 2,
				now: () => now,
				submit: async () => committed(),
			}),
		).toEqual({ status: "committed" });
		releaseCommit();
		expect(await firstDispatch).toEqual({ status: "stale" });
	});

	it("does not quarantine when the lease expires immediately before commit", async () => {
		let now = NOW_MS;
		const shared = backend();
		const persistence = client(shared, () => now);
		const expiring = new Proxy(persistence, {
			get(target, property) {
				if (property === "commitDeliverySuccess") {
					return (...args: Parameters<typeof target.commitDeliverySuccess>) => {
						now += 51;
						return target.commitDeliverySuccess(...args);
					};
				}
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		}) as BrowserWorkspacePersistence;

		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence: expiring,
				githubToken: "token",
				ownerId: "tab-a",
				leaseTtlMs: 50,
				now: () => now,
				submit: async () => committed(),
			}),
		).toEqual({ status: "stale" });
		const stored = await persistence.read();
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toHaveLength(1);
		expect(stored.quarantines).toEqual([]);
	});

	it("persists shared retry guidance and honors it after restart", async () => {
		const now = NOW_MS;
		const shared = backend();
		const first = client(shared, () => now);
		const retry = await dispatchPersistedWorkspaceMutation({
			persistence: first,
			githubToken: "token",
			ownerId: "tab-a",
			now: () => now,
			random: () => 0,
			submit: async () => ({
				status: "retryable-error",
				statusCode: 429,
				code: "gist_read_failed",
				disposition: "retryable-upstream",
				retryAfterMs: 60_000,
			}),
		});
		expect(retry.status).toBe("retryable-error");
		const stored = await first.read();
		expect(stored.workspaces[WORKSPACE_ID]?.delivery.retry).toEqual({
			attempt: 1,
			nextAttemptAt: NOW_MS + 60_000,
			lastErrorCode: "gist_read_failed",
		});

		let submits = 0;
		const restarted = client(shared, () => now);
		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence: restarted,
				githubToken: "token",
				ownerId: "tab-b",
				now: () => now,
				submit: async () => {
					submits += 1;
					return committed();
				},
			}),
		).toEqual({ status: "deferred", nextAttemptAt: NOW_MS + 60_000 });
		expect(submits).toBe(0);
	});

	it("stores state conflict separately from other blocked failures", async () => {
		const shared = backend();
		const persistence = client(shared, () => NOW_MS);
		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence,
				githubToken: "token",
				ownerId: "tab-a",
				now: () => NOW_MS,
				submit: async () => ({
					status: "conflict",
					code: "revision_conflict",
					disposition: "state-conflict",
					document: document(3, MUTATION_ID_3),
				}),
			}),
		).toEqual({
			status: "conflict",
			code: "revision_conflict",
			disposition: "state-conflict",
		});
		const stored = await persistence.read();
		expect(stored.binding?.syncMode).toBe("paused-conflict");
		expect(stored.binding?.revision).toBe(3);
		expect(stored.binding?.conflictBaseline?.revision).toBe(0);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toHaveLength(1);
		expect(stored.workspaces[WORKSPACE_ID]?.delivery.blocked?.code).toBe(
			"revision_conflict",
		);
	});

	it("keeps and safely blocks permanent, auth, domain, and operator failures", async () => {
		for (const [code, disposition] of [
			["duplicate_node_raw", "domain-conflict"],
			["unauthorized", "auth-required"],
			["mutation_recovery_failed", "operator-repair"],
			["workspace_not_found", "permanent-upstream"],
		] as const) {
			const shared = backend();
			const persistence = client(shared, () => NOW_MS);
			await dispatchPersistedWorkspaceMutation({
				persistence,
				githubToken: "token",
				ownerId: `owner-${code}`,
				now: () => NOW_MS,
				submit: async () => ({
					status: "permanent-error",
					code,
					disposition,
				}),
			});
			const stored = await persistence.read();
			expect(stored.binding?.syncMode).toBe("automatic");
			expect(stored.workspaces[WORKSPACE_ID]?.mutations).toHaveLength(1);
			expect(stored.workspaces[WORKSPACE_ID]?.delivery.blocked?.code).toBe(
				code,
			);
		}
	});

	it("quarantines the whole queue on a corrupt transport response", async () => {
		const second = mutation(MUTATION_ID_2, 1, NOW_2);
		const shared = backend(seededRecord({ mutations: [mutation(), second] }));
		const persistence = client(shared, () => NOW_MS);
		await dispatchPersistedWorkspaceMutation({
			persistence,
			githubToken: "token",
			ownerId: "tab-a",
			now: () => NOW_MS,
			submit: async () => ({
				status: "permanent-error",
				code: "invalid_success_response",
				disposition: "queue-corruption",
			}),
		});
		const stored = await persistence.read();
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([]);
		expect(stored.workspaces[WORKSPACE_ID]?.delivery.deadLetters).toHaveLength(
			2,
		);
		expect(stored.workspaces[WORKSPACE_ID]?.delivery.deadLetters[0]?.code).toBe(
			"invalid_success_response",
		);
		expect(stored.quarantines).toHaveLength(1);
	});

	it("requires an explicit opt-in for manual dispatch", async () => {
		const shared = backend(seededRecord({ syncMode: "manual" }));
		const persistence = client(shared, () => NOW_MS);
		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence,
				githubToken: "token",
				ownerId: "tab-a",
				now: () => NOW_MS,
				submit: async () => committed(),
			}),
		).toEqual({ status: "blocked" });
		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence,
				githubToken: "token",
				allowManual: true,
				ownerId: "tab-a",
				now: () => NOW_MS,
				submit: async () => committed(),
			}),
		).toEqual({ status: "committed" });
	});

	it("retries the same mutation after timeout and accepts idempotent recovery", async () => {
		const shared = backend();
		const persistence = client(shared, () => NOW_MS);
		let calls = 0;
		const fetchImpl: typeof fetch = async (_input, init) => {
			calls += 1;
			if (calls > 1) return committedResponse("already-committed");
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("timeout")),
				);
			});
		};
		const options = {
			persistence,
			githubToken: "token",
			ownerId: "tab-a",
			now: () => NOW_MS,
			random: () => 0,
			fetchImpl,
			timeoutMs: 5,
		};

		expect(await dispatchPersistedWorkspaceMutation(options)).toEqual({
			status: "retryable-error",
			code: "upstream_timeout",
			disposition: "retryable-upstream",
		});
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations[0]
				?.mutationId,
		).toBe(MUTATION_ID);
		expect(await dispatchPersistedWorkspaceMutation(options)).toEqual({
			status: "committed",
		});
		expect(calls).toBe(2);
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations,
		).toEqual([]);
	});

	it("adopts a newer document after an already-committed head with no tail", async () => {
		const shared = backend();
		const persistence = client(shared, () => NOW_MS);

		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence,
				githubToken: "token",
				ownerId: "tab-a",
				now: () => NOW_MS,
				submit: async () => advancedAlreadyCommitted(),
			}),
		).toEqual({ status: "committed" });

		const stored = await persistence.read();
		expect(stored.binding?.revision).toBe(3);
		expect(stored.binding?.syncMode).toBe("automatic");
		expect(stored.binding?.conflictBaseline).toBeNull();
		expect(stored.snapshot?.lastUpdated).toBe(NOW_2);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([]);
	});

	it("keeps recovered delivery committed when lease cleanup fails", async () => {
		const shared = backend();
		const persistence = client(shared, () => NOW_MS);
		const cleanupFailure = new Proxy(persistence, {
			get(target, property) {
				if (property === "releaseLease") {
					return async () => {
						throw new Error("injected lease cleanup failure");
					};
				}
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		}) as BrowserWorkspacePersistence;
		let submits = 0;
		const options = {
			persistence: cleanupFailure,
			githubToken: "token",
			ownerId: "tab-a",
			now: () => NOW_MS,
			submit: async () => {
				submits += 1;
				return advancedAlreadyCommitted();
			},
		};

		expect(await dispatchPersistedWorkspaceMutation(options)).toEqual({
			status: "committed",
		});
		expect(await dispatchPersistedWorkspaceMutation(options)).toEqual({
			status: "empty",
		});
		expect(submits).toBe(1);
		const stored = await persistence.read();
		expect(stored.binding?.revision).toBe(3);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([]);
	});

	it("dequeues a proven head and pauses only its tail after remote advance", async () => {
		const secondMutation = mutation(MUTATION_ID_2, 1, NOW_2);
		const shared = backend(
			seededRecord({ mutations: [mutation(), secondMutation] }),
		);
		const persistence = client(shared, () => NOW_MS);

		expect(
			await dispatchPersistedWorkspaceMutation({
				persistence,
				githubToken: "token",
				ownerId: "tab-a",
				now: () => NOW_MS,
				submit: async () => advancedAlreadyCommitted(),
			}),
		).toEqual({
			status: "conflict",
			code: "revision_conflict",
			disposition: "state-conflict",
		});

		const stored = await persistence.read();
		expect(stored.binding?.revision).toBe(3);
		expect(stored.binding?.syncMode).toBe("paused-conflict");
		expect(stored.binding?.conflictBaseline?.revision).toBe(1);
		expect(stored.binding?.conflictBaseline?.lastMutationId).toBe(MUTATION_ID);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([
			secondMutation,
		]);
		expect(stored.workspaces[WORKSPACE_ID]?.delivery.blocked?.mutationId).toBe(
			MUTATION_ID_2,
		);
		expect(stored.leases).toEqual({});
	});
});
