import { describe, expect, it } from "bun:test";
import { get } from "svelte/store";
import {
	defaultWorkspaceSyncStatus,
	dispatchWorkspaceSyncEvent,
	markWorkspaceDisconnected,
	reportWorkspaceStorageRecovery,
	updateWorkspaceQueueCount,
	workspaceSyncStatus,
} from "$lib/workspace-sync-status";

function resetStatus(): void {
	workspaceSyncStatus.set({ ...defaultWorkspaceSyncStatus });
}

describe("Workspace sync status store", () => {
	it("dispatches complete reducer states and rejects illegal events", () => {
		resetStatus();
		const accepted = dispatchWorkspaceSyncEvent({
			type: "WORKSPACE_BOUND",
			mode: "automatic",
			revision: 3,
			queue: {
				activeQueueCount: 0,
				totalQueueCount: 2,
				orphanedWorkspaceCount: 1,
				blockedMutationCount: 0,
				deadLetterCount: 0,
			},
		});
		expect(accepted).toBe(true);
		expect(get(workspaceSyncStatus).phase).toBe("automatic-idle");

		const rejected = dispatchWorkspaceSyncEvent({
			type: "SYNC_COMMITTED",
			revision: 4,
			queue: {
				activeQueueCount: 0,
				totalQueueCount: 2,
				orphanedWorkspaceCount: 1,
				blockedMutationCount: 0,
				deadLetterCount: 0,
			},
		});
		expect(rejected).toBe(false);
		expect(get(workspaceSyncStatus).phase).toBe("automatic-idle");
	});

	it("keeps pending work auth-required and fully clears a real disconnect", () => {
		resetStatus();
		markWorkspaceDisconnected(2);
		expect(get(workspaceSyncStatus).phase).toBe("auth-required");
		expect(get(workspaceSyncStatus).queueCount).toBe(2);

		dispatchWorkspaceSyncEvent({
			type: "OPERATOR_REPAIR_REQUIRED",
			queue: {
				activeQueueCount: 2,
				totalQueueCount: 2,
				orphanedWorkspaceCount: 0,
				blockedMutationCount: 1,
				deadLetterCount: 1,
			},
			error: {
				code: "commit_index_failed",
				message: "Operator repair required",
				disposition: "operator-repair",
			},
			blockedMutation: null,
		});
		markWorkspaceDisconnected(0);
		const disconnected = get(workspaceSyncStatus);
		expect(disconnected.phase).toBe("disconnected");
		expect(disconnected.recentError).toBeNull();
		expect(disconnected.repairRequired).toBe(false);
		expect(disconnected.blockedMutationCount).toBe(0);
	});

	it("turns storage recovery into structured repair state", () => {
		resetStatus();
		reportWorkspaceStorageRecovery("queue", "Stored queue was quarantined");
		const status = get(workspaceSyncStatus);
		expect(status.phase).toBe("invalid-local-storage");
		expect(status.recoveryNotice).toBe("queue-quarantined");
		expect(status.recentError).toEqual({
			code: "queue_storage_quarantined",
			message: "Stored queue was quarantined",
			disposition: "queue-corruption",
		});
	});

	it("updates queue counts without clearing repair state", () => {
		resetStatus();
		reportWorkspaceStorageRecovery("state", "Stored state was quarantined");
		updateWorkspaceQueueCount(3);
		const status = get(workspaceSyncStatus);
		expect(status.phase).toBe("invalid-local-storage");
		expect(status.totalQueueCount).toBe(3);
		expect(status.recoveryNotice).toBe("state-quarantined");
		expect(status.repairRequired).toBe(true);
	});
});
