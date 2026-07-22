import type { AppState } from "$lib/models";
import { hydrateWorkspaceState } from "$lib/workspace-data";

export function bindWorkspaceOnly(
	local: AppState,
	gistId: string,
	fileName: string,
): AppState {
	return {
		...local,
		activeGistId: gistId,
		activeGistFile: fileName,
	};
}

export function pullWorkspaceExactly(
	remote: AppState,
	gistId: string,
	fileName: string,
): AppState {
	return hydrateWorkspaceState(remote, gistId, fileName);
}
