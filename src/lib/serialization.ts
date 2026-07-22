import type { AppState } from "$lib/models";
import {
	getWorkspaceSignature,
	parseWorkspaceState,
	serializeWorkspaceState,
} from "$lib/workspace-data";

export function getSyncStateSignature(state: AppState): string {
	return getWorkspaceSignature(state);
}

export function exportState(state: AppState): string {
	return JSON.stringify(
		{
			version: 1,
			exportedAt: new Date().toISOString(),
			data: state,
		},
		null,
		2,
	);
}

export function exportSyncState(state: AppState): string {
	return serializeWorkspaceState(state);
}

export function importState(raw: string): AppState {
	return parseWorkspaceState(raw);
}
