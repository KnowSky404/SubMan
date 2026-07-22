import { broadcastWorkspaceEvent } from "$lib/workspace-events";

const LEGACY_SYNC_KEYS = [
	"subman:sync:baseline-envelope:v1",
	"subman:sync:mode:v1",
	"subman:sync:last-status:v1",
] as const;

export function clearLegacyWorkspaceSyncState(): void {
	if (typeof localStorage === "undefined") return;
	for (const key of LEGACY_SYNC_KEYS) localStorage.removeItem(key);
	broadcastWorkspaceEvent({
		type: "reset",
		gistId: null,
		fileName: null,
	});
}
