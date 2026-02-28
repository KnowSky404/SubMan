import type { AppState } from '$lib/models';
import { defaultState } from '$lib/stores/app';

const EXPORT_VERSION = 1;

function buildSyncState(state: AppState): AppState {
	return {
		...defaultState,
		nodes: state.nodes,
		subscriptions: state.subscriptions,
		aggregates: state.aggregates,
		publishTargets: state.publishTargets,
		lastUpdated: state.lastUpdated
	};
}

export function exportState(state: AppState): string {
	return JSON.stringify(
		{
			version: EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			data: state
		},
		null,
		2
	);
}

export function exportSyncState(state: AppState): string {
	return JSON.stringify(
		{
			version: EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			data: buildSyncState(state)
		},
		null,
		2
	);
}

export function importState(raw: string): AppState {
	const parsed = JSON.parse(raw) as {
		version?: number;
		data?: AppState;
	};

	if (!parsed?.data) {
		throw new Error('Invalid export payload');
	}

	return { ...defaultState, ...parsed.data };
}
