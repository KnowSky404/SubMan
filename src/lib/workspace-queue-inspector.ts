import type { AppState } from "$lib/models";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import type {
	BrowserWorkspacePersistence,
	WorkspaceQueueInspection,
} from "$lib/workspace-persistence";
import type { WorkspaceV2LocalState } from "$lib/workspace-v2-state";

function assertSelectedIdentity(
	workspaceId: string,
	binding: WorkspaceV2LocalState,
): void {
	if (binding.workspaceId !== workspaceId) {
		throw new TypeError(
			"Selected Workspace identity does not match the binding",
		);
	}
}

async function refresh(
	persistence: BrowserWorkspacePersistence,
): Promise<WorkspaceQueueInspection> {
	const record = await persistence.read();
	return persistence.inspectQueues(record.binding?.workspaceId ?? null);
}

export async function refreshWorkspaceQueueInspection(
	persistence: BrowserWorkspacePersistence,
): Promise<WorkspaceQueueInspection> {
	return refresh(persistence);
}

export async function discardInspectedWorkspaceQueue(
	persistence: BrowserWorkspacePersistence,
	input: {
		workspaceId: string;
		realignment?: {
			snapshot: AppState;
			binding: WorkspaceV2LocalState;
		};
	},
): Promise<{ discardedCount: number; inspection: WorkspaceQueueInspection }> {
	if (input.realignment) {
		assertSelectedIdentity(input.workspaceId, input.realignment.binding);
	}
	const discardedCount = await persistence.discardWorkspaceQueue({
		workspaceId: input.workspaceId,
		...(input.realignment ?? {}),
	});
	return { discardedCount, inspection: await refresh(persistence) };
}

export async function rebindInspectedWorkspace(
	persistence: BrowserWorkspacePersistence,
	input: {
		workspaceId: string;
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
	},
): Promise<WorkspaceQueueInspection> {
	assertSelectedIdentity(input.workspaceId, input.binding);
	await persistence.rebindWorkspace({
		snapshot: input.snapshot,
		binding: input.binding,
	});
	return refresh(persistence);
}

export async function repairInspectedWorkspaceQueue(
	persistence: BrowserWorkspacePersistence,
	input: {
		workspaceId: string;
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
		mutations: WorkspaceMutation[];
	},
): Promise<WorkspaceQueueInspection> {
	assertSelectedIdentity(input.workspaceId, input.binding);
	await persistence.repairWorkspaceQueue({
		snapshot: input.snapshot,
		binding: input.binding,
		mutations: input.mutations,
	});
	return refresh(persistence);
}
