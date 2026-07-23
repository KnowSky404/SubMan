import type { AppState } from "$lib/models";
import {
	createDefaultWorkspaceState,
	getWorkspaceBusinessData,
	getWorkspaceSignature,
	parseWorkspaceState,
	serializeWorkspaceState,
} from "$lib/workspace-data";
import { validateWorkspaceData } from "$lib/workspace-document";

export function getSyncStateSignature(state: AppState): string {
	return getWorkspaceSignature(state);
}

export function exportState(state: AppState): string {
	return JSON.stringify(
		{
			version: 2,
			kind: "subman-business-configuration",
			exportedAt: new Date().toISOString(),
			data: getWorkspaceBusinessData(state),
		},
		null,
		2,
	);
}

export function exportSyncState(state: AppState): string {
	return serializeWorkspaceState(state);
}

export function importState(raw: string): AppState {
	const parsed = JSON.parse(raw) as unknown;
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		!Array.isArray(parsed) &&
		"version" in parsed &&
		parsed.version === 2 &&
		"kind" in parsed &&
		parsed.kind === "subman-business-configuration" &&
		"data" in parsed
	) {
		return {
			...createDefaultWorkspaceState(),
			...validateWorkspaceData(parsed.data),
		};
	}
	return parseWorkspaceState(raw);
}
