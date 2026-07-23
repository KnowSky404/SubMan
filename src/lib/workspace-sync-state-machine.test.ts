import { describe, expect, it } from "bun:test";
import {
	createDefaultWorkspaceSyncStatus,
	emptyWorkspaceQueueMetrics,
	transitionWorkspaceSyncState,
	type WorkspaceBlockedMutation,
	type WorkspaceQueueMetrics,
	type WorkspaceSyncError,
	type WorkspaceSyncEvent,
	type WorkspaceSyncPhase,
	type WorkspaceSyncStatus,
} from "$lib/workspace-sync-state-machine";

const RETRY_AT = 1_753_271_205_000;

const queued: WorkspaceQueueMetrics = {
	activeQueueCount: 1,
	totalQueueCount: 2,
	orphanedWorkspaceCount: 1,
	blockedMutationCount: 0,
	deadLetterCount: 0,
};

const blockedQueue: WorkspaceQueueMetrics = {
	...queued,
	blockedMutationCount: 1,
};

const stateError: WorkspaceSyncError = {
	code: "revision_conflict",
	message: "Workspace revision changed",
	disposition: "state-conflict",
};

const domainError: WorkspaceSyncError = {
	code: "duplicate_node_raw",
	message: "A node already uses this URI",
	disposition: "domain-conflict",
};

const queueError: WorkspaceSyncError = {
	code: "mutation_id_reused",
	message: "Mutation ID was reused",
	disposition: "queue-corruption",
};

const operatorError: WorkspaceSyncError = {
	code: "commit_index_failed",
	message: "The commit index requires operator repair",
	disposition: "operator-repair",
};

const blockedMutation: WorkspaceBlockedMutation = {
	mutationId: "10000000-0000-4000-8000-000000000001",
	kind: "node.upsert",
	code: domainError.code,
	disposition: domainError.disposition,
	message: domainError.message,
};

function apply(
	state: WorkspaceSyncStatus,
	event: WorkspaceSyncEvent,
): WorkspaceSyncStatus {
	const result = transitionWorkspaceSyncState(state, event);
	expect(result.accepted).toBe(true);
	return result.state;
}

function automaticIdle(): WorkspaceSyncStatus {
	return apply(createDefaultWorkspaceSyncStatus(), {
		type: "WORKSPACE_BOUND",
		mode: "automatic",
		revision: 4,
		queue: emptyWorkspaceQueueMetrics,
	});
}

function syncing(): WorkspaceSyncStatus {
	const bound = apply(createDefaultWorkspaceSyncStatus(), {
		type: "WORKSPACE_BOUND",
		mode: "automatic",
		revision: 4,
		queue: queued,
	});
	return apply(bound, {
		type: "SYNC_STARTED",
		queue: queued,
		mutation: {
			mutationId: blockedMutation.mutationId,
			kind: blockedMutation.kind,
		},
	});
}

describe("Workspace sync state machine", () => {
	it("represents every required phase through explicit events", () => {
		const phases = new Set<WorkspaceSyncPhase>();
		const initial = createDefaultWorkspaceSyncStatus();
		phases.add(initial.phase);

		const local = apply(initial, {
			type: "LOCAL_COMMITTED",
			mode: "local",
			queue: emptyWorkspaceQueueMetrics,
		});
		phases.add(local.phase);

		const automatic = automaticIdle();
		phases.add(automatic.phase);
		const queueState = apply(automatic, {
			type: "MUTATION_ENQUEUED",
			queue: queued,
			mutation: {
				mutationId: blockedMutation.mutationId,
				kind: blockedMutation.kind,
			},
		});
		phases.add(queueState.phase);
		const syncingState = apply(queueState, {
			type: "SYNC_STARTED",
			queue: queued,
			mutation: {
				mutationId: blockedMutation.mutationId,
				kind: blockedMutation.kind,
			},
		});
		phases.add(syncingState.phase);
		phases.add(
			apply(syncingState, {
				type: "SYNC_RETRY_SCHEDULED",
				queue: queued,
				error: {
					code: "network_error",
					message: "Network request failed",
					disposition: "retryable-upstream",
				},
				blockedMutation: {
					...blockedMutation,
					code: "network_error",
					message: "Network request failed",
					disposition: "retryable-upstream",
				},
				retry: {
					attempt: 1,
					nextAttemptAt: RETRY_AT,
					retryAfterMs: 5_000,
					lastErrorCode: "network_error",
				},
			}).phase,
		);
		phases.add(
			apply(initial, {
				type: "WORKSPACE_BOUND",
				mode: "manual",
				revision: 4,
				queue: emptyWorkspaceQueueMetrics,
			}).phase,
		);
		phases.add(
			apply(syncing(), {
				type: "STATE_CONFLICT",
				queue: blockedQueue,
				error: stateError,
				blockedMutation: { ...blockedMutation, ...stateError },
			}).phase,
		);
		phases.add(
			apply(syncing(), {
				type: "DOMAIN_BLOCKED",
				queue: blockedQueue,
				error: domainError,
				blockedMutation,
			}).phase,
		);
		phases.add(
			apply(syncing(), {
				type: "AUTH_LOST",
				queue: queued,
			}).phase,
		);
		phases.add(
			apply(syncing(), {
				type: "QUEUE_CORRUPTED",
				queue: blockedQueue,
				error: queueError,
				blockedMutation: { ...blockedMutation, ...queueError },
			}).phase,
		);
		phases.add(
			apply(syncing(), {
				type: "OPERATOR_REPAIR_REQUIRED",
				queue: blockedQueue,
				error: operatorError,
				blockedMutation: { ...blockedMutation, ...operatorError },
			}).phase,
		);
		phases.add(
			apply(initial, {
				type: "STORAGE_QUARANTINED",
				kind: "state",
				queue: emptyWorkspaceQueueMetrics,
				error: queueError,
			}).phase,
		);

		expect([...phases].sort()).toEqual(
			[
				"auth-required",
				"automatic-idle",
				"blocked-domain-conflict",
				"disconnected",
				"invalid-local-storage",
				"local-only",
				"manual-local-only",
				"operator-repair-required",
				"paused-state-conflict",
				"queue-repair-required",
				"queued",
				"retrying",
				"syncing",
			].sort(),
		);
	});

	it("uses active queue counts while preserving total and orphaned counts", () => {
		const state = apply(createDefaultWorkspaceSyncStatus(), {
			type: "SYNC_CONTEXT_LOADED",
			mode: "automatic",
			authenticated: true,
			revision: 7,
			queue: queued,
			blockedMutation: null,
		});

		expect(state.phase).toBe("queued");
		expect(state.queueCount).toBe(1);
		expect(state.activeQueueCount).toBe(1);
		expect(state.totalQueueCount).toBe(2);
		expect(state.orphanedWorkspaceCount).toBe(1);
		expect(state.blockedMutationCount).toBe(0);

		const observed = apply(state, {
			type: "QUEUE_COUNTS_UPDATED",
			queue: {
				activeQueueCount: 2,
				totalQueueCount: 4,
				orphanedWorkspaceCount: 2,
				blockedMutationCount: 1,
				deadLetterCount: 3,
			},
		});
		expect(observed.queueCount).toBe(2);
		expect(observed.totalQueueCount).toBe(4);
		expect(observed.orphanedWorkspaceCount).toBe(2);
		expect(observed.blockedMutationCount).toBe(1);
		expect(observed.deadLetterCount).toBe(3);
	});

	it("routes authentication loss and restoration without losing queue metadata", () => {
		const lost = apply(syncing(), {
			type: "AUTH_LOST",
			queue: queued,
			error: {
				code: "unauthorized",
				message: "Reconnect GitHub",
				disposition: "auth-required",
			},
		});
		expect(lost.phase).toBe("auth-required");
		expect(lost.totalQueueCount).toBe(2);

		const restored = apply(lost, {
			type: "AUTH_RESTORED",
			queue: queued,
		});
		expect(restored.phase).toBe("queued");
		expect(restored.recentError).toBeNull();
	});

	it("clears stale retry and repair fields after commit, repair, and rebind", () => {
		const retrying = apply(syncing(), {
			type: "SYNC_RETRY_SCHEDULED",
			queue: queued,
			error: {
				code: "network_error",
				message: "Network request failed",
				disposition: "retryable-upstream",
			},
			blockedMutation: null,
			retry: {
				attempt: 2,
				nextAttemptAt: RETRY_AT,
				retryAfterMs: 5_000,
				lastErrorCode: "network_error",
			},
		});
		const restarted = apply(retrying, {
			type: "SYNC_STARTED",
			queue: queued,
			mutation: null,
		});
		const committed = apply(restarted, {
			type: "SYNC_COMMITTED",
			revision: 5,
			queue: emptyWorkspaceQueueMetrics,
		});
		for (const value of [committed]) {
			expect(value.recentError).toBeNull();
			expect(value.retry).toBeNull();
			expect(value.nextAttemptAt).toBeNull();
			expect(value.repairRequired).toBe(false);
			expect(value.blockedMutation).toBeNull();
		}

		const repairRequired = apply(syncing(), {
			type: "OPERATOR_REPAIR_REQUIRED",
			queue: blockedQueue,
			error: operatorError,
			blockedMutation: { ...blockedMutation, ...operatorError },
		});
		const repaired = apply(repairRequired, {
			type: "REPAIR_SUCCEEDED",
			mode: "automatic",
			revision: 5,
			queue: emptyWorkspaceQueueMetrics,
		});
		expect(repaired.phase).toBe("automatic-idle");
		expect(repaired.recentError).toBeNull();
		expect(repaired.repairRequired).toBe(false);
		expect(repaired.blockedMutation).toBeNull();

		const rebound = apply(repairRequired, {
			type: "WORKSPACE_BOUND",
			mode: "manual",
			revision: 9,
			queue: emptyWorkspaceQueueMetrics,
		});
		expect(rebound.phase).toBe("manual-local-only");
		expect(rebound.recentError).toBeNull();
		expect(rebound.repairRequired).toBe(false);
	});

	it("clears all transient flags when the Workspace disconnects", () => {
		const blocked = apply(syncing(), {
			type: "DOMAIN_BLOCKED",
			queue: blockedQueue,
			error: domainError,
			blockedMutation,
		});
		const disconnected = apply(blocked, {
			type: "WORKSPACE_DISCONNECTED",
			queue: {
				activeQueueCount: 0,
				totalQueueCount: 1,
				orphanedWorkspaceCount: 1,
				blockedMutationCount: 0,
				deadLetterCount: 0,
			},
		});

		expect(disconnected.phase).toBe("disconnected");
		expect(disconnected.recentError).toBeNull();
		expect(disconnected.retry).toBeNull();
		expect(disconnected.repairRequired).toBe(false);
		expect(disconnected.blockedMutation).toBeNull();
		expect(disconnected.queueCount).toBe(0);
		expect(disconnected.totalQueueCount).toBe(1);
	});

	it("rejects illegal transitions without changing state", () => {
		const initial = createDefaultWorkspaceSyncStatus();
		const events: WorkspaceSyncEvent[] = [
			{
				type: "SYNC_STARTED",
				queue: emptyWorkspaceQueueMetrics,
				mutation: null,
			},
			{
				type: "SYNC_COMMITTED",
				revision: 1,
				queue: emptyWorkspaceQueueMetrics,
			},
			{
				type: "AUTH_RESTORED",
				queue: emptyWorkspaceQueueMetrics,
			},
			{
				type: "REPAIR_SUCCEEDED",
				mode: "automatic",
				revision: 1,
				queue: emptyWorkspaceQueueMetrics,
			},
		];

		for (const event of events) {
			const transition = transitionWorkspaceSyncState(initial, event);
			expect(transition.accepted).toBe(false);
			expect(transition.state).toBe(initial);
			if (!transition.accepted) {
				expect(transition.reason).toContain(event.type);
			}
		}
	});

	it("keeps repair states fail-closed across ordinary local and auth events", () => {
		const domainBlocked = apply(syncing(), {
			type: "DOMAIN_BLOCKED",
			queue: blockedQueue,
			error: domainError,
			blockedMutation,
		});
		const afterLocal = apply(domainBlocked, {
			type: "LOCAL_COMMITTED",
			mode: "automatic",
			queue: blockedQueue,
		});
		const afterAuthLost = apply(afterLocal, {
			type: "AUTH_LOST",
			queue: blockedQueue,
		});

		expect(afterLocal.phase).toBe("blocked-domain-conflict");
		expect(afterAuthLost.phase).toBe("blocked-domain-conflict");
		expect(afterAuthLost.blockedMutation).toEqual(blockedMutation);
	});
});
