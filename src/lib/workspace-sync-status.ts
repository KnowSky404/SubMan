import { writable } from "svelte/store";
import {
	createDefaultWorkspaceSyncStatus,
	emptyWorkspaceQueueMetrics,
	transitionWorkspaceSyncState,
	type WorkspaceSyncEvent,
	type WorkspaceSyncStatus,
} from "$lib/workspace-sync-state-machine";

export type {
	WorkspaceBlockedMutation,
	WorkspaceMutationMetadata,
	WorkspacePersistenceLifecycle,
	WorkspaceQueueMetrics,
	WorkspaceRetryMetadata,
	WorkspaceSyncError,
	WorkspaceSyncEvent,
	WorkspaceSyncMode,
	WorkspaceSyncPhase,
	WorkspaceSyncStatus,
} from "$lib/workspace-sync-state-machine";

export const defaultWorkspaceSyncStatus = createDefaultWorkspaceSyncStatus();

export const workspaceSyncStatus = writable<WorkspaceSyncStatus>(
	defaultWorkspaceSyncStatus,
);

export function dispatchWorkspaceSyncEvent(event: WorkspaceSyncEvent): boolean {
	let accepted = false;
	workspaceSyncStatus.update((current) => {
		const transition = transitionWorkspaceSyncState(current, event);
		accepted = transition.accepted;
		return transition.state;
	});
	return accepted;
}

export function updateWorkspaceQueueCount(totalQueueCount: number): void {
	workspaceSyncStatus.update((current) => {
		return transitionWorkspaceSyncState(current, {
			type: "QUEUE_COUNTS_UPDATED",
			queue: {
				activeQueueCount: Math.min(current.activeQueueCount, totalQueueCount),
				totalQueueCount,
				orphanedWorkspaceCount:
					totalQueueCount === 0 ? 0 : current.orphanedWorkspaceCount,
				blockedMutationCount:
					totalQueueCount === 0 ? 0 : current.blockedMutationCount,
			},
		}).state;
	});
}

export function reportWorkspaceStorageRecovery(
	kind: "queue" | "state",
	message: string,
): void {
	dispatchWorkspaceSyncEvent({
		type: "STORAGE_QUARANTINED",
		kind,
		queue: emptyWorkspaceQueueMetrics,
		error: {
			code: `${kind}_storage_quarantined`,
			message,
			disposition: "queue-corruption",
		},
	});
}

export function markWorkspaceDisconnected(queueCount: number): void {
	const queue = {
		activeQueueCount: queueCount,
		totalQueueCount: queueCount,
		orphanedWorkspaceCount: 0,
		blockedMutationCount: 0,
	};
	dispatchWorkspaceSyncEvent(
		queueCount > 0
			? { type: "AUTH_LOST", queue }
			: { type: "WORKSPACE_DISCONNECTED", queue },
	);
}
