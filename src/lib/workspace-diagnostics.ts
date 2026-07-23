import { get } from "svelte/store";
import type { AppState } from "$lib/models";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import { workspaceSyncStatus } from "$lib/workspace-sync-status";
import { WorkspaceV2StateStore } from "$lib/workspace-v2-state";

const QUARANTINE_MARKER = ":quarantine:";

export function exportWorkspaceDiagnostics(
	state: AppState,
	storage: Storage = localStorage,
): string {
	const binding = new WorkspaceV2StateStore(storage).read();
	const mutations = new WorkspaceMutationQueue(storage).list();
	const quarantines: Array<{ key: string; bytes: number }> = [];
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (!key?.includes(QUARANTINE_MARKER)) continue;
		quarantines.push({ key, bytes: storage.getItem(key)?.length ?? 0 });
	}
	return JSON.stringify(
		{
			version: 1,
			kind: "subman-workspace-diagnostics",
			exportedAt: new Date().toISOString(),
			workspace: binding
				? {
						gistId: binding.gistId,
						workspaceId: binding.workspaceId,
						revision: binding.revision,
						syncMode: binding.syncMode,
					}
				: null,
			activeGistId: state.activeGistId,
			queue: mutations,
			status: get(workspaceSyncStatus),
			quarantines,
			businessCounts: {
				nodes: state.nodes.length,
				subscriptions: state.subscriptions.length,
				aggregates: state.aggregates.length,
				publishTargets: state.publishTargets.length,
				clientExports: state.clientExports.length,
			},
		},
		null,
		2,
	);
}
