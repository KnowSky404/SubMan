import type { AppState } from "$lib/models";
import type { WorkspaceCoordinatorResult } from "$lib/server/workspace-coordinator-core";
import {
	broadcastWorkspaceEvent,
	type WorkspaceEvent,
} from "$lib/workspace-events";
import {
	applyWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import {
	deliverNextWorkspaceMutation,
	type WorkspaceMutationConflict,
	type WorkspaceMutationDeliveryResult,
	type WorkspaceMutationQueue,
} from "$lib/workspace-mutation-queue";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	type WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

type DeliveryDependencies = {
	queue: WorkspaceMutationQueue;
	stateStore: WorkspaceV2StateStore;
	githubToken: string | null;
	getState: () => AppState;
	setState: (state: AppState) => void;
	fetchImpl?: typeof fetch;
	broadcast?: (event: WorkspaceEvent) => void;
};

function requireCurrentWorkspace(
	dependencies: DeliveryDependencies,
	workspaceId: string,
): { gistId: string; syncMode: "automatic" | "manual" | "paused-conflict" } {
	const binding = dependencies.stateStore.read();
	if (!binding || binding.workspaceId !== workspaceId) {
		throw new Error("Workspace binding changed during mutation delivery");
	}
	if (dependencies.getState().activeGistId !== binding.gistId) {
		throw new Error("Active Workspace changed during mutation delivery");
	}
	return { gistId: binding.gistId, syncMode: binding.syncMode };
}

function persistCommittedResult(
	dependencies: DeliveryDependencies,
	result: WorkspaceCoordinatorResult,
): void {
	const current = requireCurrentWorkspace(dependencies, result.workspaceId);
	const binding = createWorkspaceV2LocalState(current.gistId, {
		baseline: result.document,
		syncMode: current.syncMode,
	});
	const optimisticDocument = replayPendingMutations(
		result.document,
		dependencies.queue.list(result.workspaceId),
		current.gistId,
		result.mutationId,
	);
	const state = hydrateAppStateFromWorkspaceDocument(
		dependencies.getState(),
		optimisticDocument,
		current.gistId,
	);
	dependencies.stateStore.write(binding);
	dependencies.setState(state);
	(dependencies.broadcast ?? broadcastWorkspaceEvent)({
		type: "workspace-v2-committed",
		gistId: current.gistId,
		fileName: binding.fileName,
		mutationId: result.mutationId,
		document: result.document,
		state,
		status: result.status === "committed" ? "committed" : "already-synced",
	});
}

function replayPendingMutations(
	committed: WorkspaceCoordinatorResult["document"],
	queued: readonly WorkspaceMutation[],
	gistId: string,
	committedMutationId?: string,
): WorkspaceCoordinatorResult["document"] {
	let optimistic = committed;
	for (const mutation of queued) {
		if (mutation.mutationId === committedMutationId) continue;
		if (mutation.expectedRevision < optimistic.revision) continue;
		if (mutation.expectedRevision !== optimistic.revision) {
			throw new Error(
				"Pending Workspace mutation revisions are not contiguous",
			);
		}
		optimistic = applyWorkspaceMutation(optimistic, mutation, {
			committedAt: mutation.createdAt,
			gist: { id: gistId, files: [] },
		}).document;
	}
	return optimistic;
}

function persistConflict(
	dependencies: DeliveryDependencies,
	workspaceId: string,
	conflict: WorkspaceMutationConflict,
): void {
	const current = requireCurrentWorkspace(dependencies, workspaceId);
	const previous = dependencies.stateStore.read();
	if (!previous) throw new Error("Workspace binding is missing");
	const binding = conflict.document
		? createWorkspaceV2LocalState(current.gistId, {
				baseline: conflict.document,
				syncMode: "paused-conflict",
			})
		: { ...previous, syncMode: "paused-conflict" as const };
	dependencies.stateStore.write(binding);
	(dependencies.broadcast ?? broadcastWorkspaceEvent)({
		type: "paused-conflict",
		gistId: current.gistId,
		fileName: binding.fileName,
		document: conflict.document,
	});
}

export async function deliverQueuedWorkspaceMutation(
	dependencies: DeliveryDependencies,
	options: { allowManual?: boolean } = {},
): Promise<WorkspaceMutationDeliveryResult> {
	const binding = dependencies.stateStore.read();
	if (!binding || binding.revision === null) return { status: "blocked" };
	if (
		binding.syncMode === "paused-conflict" ||
		(binding.syncMode === "manual" && !options.allowManual)
	) {
		return { status: "blocked" };
	}
	return deliverNextWorkspaceMutation({
		queue: dependencies.queue,
		workspaceId: binding.workspaceId,
		githubToken: dependencies.githubToken,
		syncMode: binding.syncMode,
		fetchImpl: dependencies.fetchImpl,
		onCommitted: (result) => persistCommittedResult(dependencies, result),
		onConflict: (conflict) =>
			persistConflict(dependencies, binding.workspaceId, conflict),
	});
}

export function applyCommittedWorkspaceEvent(
	event: WorkspaceEvent,
	dependencies: Pick<
		DeliveryDependencies,
		"queue" | "stateStore" | "getState" | "setState"
	>,
): boolean {
	if (
		event.type !== "workspace-v2-committed" ||
		!event.document ||
		!event.gistId
	) {
		return false;
	}
	const current = dependencies.stateStore.read();
	if (
		!current ||
		current.gistId !== event.gistId ||
		current.syncMode === "paused-conflict" ||
		(current.revision !== null && current.revision >= event.document.revision)
	) {
		return false;
	}
	const binding = createWorkspaceV2LocalState(event.gistId, {
		baseline: event.document,
		syncMode: current.syncMode,
	});
	const optimisticDocument = replayPendingMutations(
		event.document,
		dependencies.queue.list(event.document.workspaceId),
		event.gistId,
		event.mutationId,
	);
	const state = hydrateAppStateFromWorkspaceDocument(
		dependencies.getState(),
		optimisticDocument,
		event.gistId,
	);
	dependencies.stateStore.write(binding);
	dependencies.setState(state);
	return true;
}
