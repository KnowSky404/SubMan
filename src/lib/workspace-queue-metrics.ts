import type { WorkspacePersistenceRecord } from "$lib/workspace-persistence";
import type { WorkspaceQueueMetrics } from "$lib/workspace-sync-state-machine";

function retainsWorkspaceEvidence(
	record: WorkspacePersistenceRecord,
	workspaceId: string,
): boolean {
	const queue = record.workspaces[workspaceId];
	return Boolean(
		queue &&
			(queue.mutations.length > 0 ||
				queue.delivery.blocked !== null ||
				queue.delivery.deadLetters.length > 0),
	);
}

export function deriveWorkspaceQueueMetrics(
	record: WorkspacePersistenceRecord,
	activeWorkspaceId: string | null = record.binding?.workspaceId ?? null,
): WorkspaceQueueMetrics {
	const queues = Object.values(record.workspaces);
	return {
		activeQueueCount: activeWorkspaceId
			? (record.workspaces[activeWorkspaceId]?.mutations.length ?? 0)
			: 0,
		totalQueueCount: queues.reduce(
			(total, queue) => total + queue.mutations.length,
			0,
		),
		orphanedWorkspaceCount: queues.filter(
			(queue) =>
				queue.workspaceId !== activeWorkspaceId &&
				retainsWorkspaceEvidence(record, queue.workspaceId),
		).length,
		blockedMutationCount: queues.filter(
			(queue) => queue.delivery.blocked !== null,
		).length,
		deadLetterCount: queues.reduce(
			(total, queue) => total + queue.delivery.deadLetters.length,
			0,
		),
	};
}
