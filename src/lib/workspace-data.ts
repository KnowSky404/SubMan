import type {
	AggregatePublishTarget,
	AggregateRule,
	AppState,
	ClientExportProfile,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";

export const WORKSPACE_VERSION = 1;
export const WORKSPACE_DESCRIPTION = "SubMan-Data";
export const WORKSPACE_FILE = "subman.json";

const EPOCH = new Date(0).toISOString();

type WorkspaceBusinessData = Pick<
	AppState,
	"nodes" | "subscriptions" | "aggregates" | "publishTargets" | "clientExports"
>;

export type SyncBaselineEnvelope = {
	version: 1;
	gistId: string;
	fileName: string;
	signature: string;
	state: AppState;
};

export function createDefaultWorkspaceState(lastUpdated = EPOCH): AppState {
	return {
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
		gists: [],
		activeGistId: null,
		activeGistFile: WORKSPACE_FILE,
		lastUpdated,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray<T>(
	data: Record<string, unknown>,
	key: keyof WorkspaceBusinessData,
): T[] {
	const value = data[key];
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`Invalid workspace data: ${key} must be an array`);
	}
	return value as T[];
}

export function normalizeWorkspaceState(value: unknown): AppState {
	if (!isRecord(value)) {
		throw new Error("Invalid workspace data");
	}

	return {
		nodes: requireArray<NodeItem>(value, "nodes"),
		subscriptions: requireArray<SubscriptionItem>(value, "subscriptions"),
		aggregates: requireArray<AggregateRule>(value, "aggregates"),
		publishTargets: requireArray<AggregatePublishTarget>(
			value,
			"publishTargets",
		),
		clientExports: requireArray<ClientExportProfile>(value, "clientExports"),
		gists: [],
		activeGistId:
			typeof value.activeGistId === "string" ? value.activeGistId : null,
		activeGistFile:
			typeof value.activeGistFile === "string" && value.activeGistFile
				? value.activeGistFile
				: WORKSPACE_FILE,
		lastUpdated:
			typeof value.lastUpdated === "string" ? value.lastUpdated : EPOCH,
	};
}

export function parseWorkspaceState(raw: string): AppState {
	const parsed = JSON.parse(raw) as unknown;
	if (!isRecord(parsed) || !isRecord(parsed.data)) {
		throw new Error("Invalid export payload");
	}
	if (parsed.schemaVersion !== undefined) {
		throw new Error(
			`Unsupported workspace schema version: ${String(parsed.schemaVersion)}`,
		);
	}
	if (parsed.version !== undefined && parsed.version !== WORKSPACE_VERSION) {
		throw new Error(`Unsupported workspace version: ${String(parsed.version)}`);
	}
	return normalizeWorkspaceState(parsed.data);
}

export function hydrateWorkspaceState(
	state: AppState,
	gistId: string,
	fileName = WORKSPACE_FILE,
): AppState {
	return {
		...normalizeWorkspaceState(state),
		activeGistId: gistId,
		activeGistFile: fileName,
	};
}

export function getWorkspaceBusinessData(
	state: AppState,
): WorkspaceBusinessData {
	return {
		nodes: state.nodes,
		subscriptions: state.subscriptions,
		aggregates: state.aggregates,
		publishTargets: state.publishTargets,
		clientExports: state.clientExports ?? [],
	};
}

export function getWorkspaceSignature(state: AppState): string {
	return JSON.stringify({
		version: WORKSPACE_VERSION,
		data: getWorkspaceBusinessData(state),
	});
}

export function serializeWorkspaceState(
	state: AppState,
	options: { exportedAt?: string } = {},
): string {
	return JSON.stringify(
		{
			version: WORKSPACE_VERSION,
			exportedAt: options.exportedAt ?? new Date().toISOString(),
			data: {
				...createDefaultWorkspaceState(state.lastUpdated),
				...getWorkspaceBusinessData(state),
				activeGistId: state.activeGistId,
				activeGistFile: state.activeGistFile || WORKSPACE_FILE,
				lastUpdated: state.lastUpdated,
			},
		},
		null,
		2,
	);
}

export function createSyncBaselineEnvelope(
	state: AppState,
	gistId: string,
	fileName = WORKSPACE_FILE,
): SyncBaselineEnvelope {
	const hydrated = hydrateWorkspaceState(state, gistId, fileName);
	return {
		version: 1,
		gistId,
		fileName,
		signature: getWorkspaceSignature(hydrated),
		state: hydrated,
	};
}

export function isTrustedSyncBaseline(
	baseline: SyncBaselineEnvelope | null,
	gistId: string,
	fileName: string,
): baseline is SyncBaselineEnvelope {
	return Boolean(
		baseline &&
			baseline.version === 1 &&
			baseline.gistId === gistId &&
			baseline.fileName === fileName &&
			baseline.signature === getWorkspaceSignature(baseline.state),
	);
}

function toTimestamp(value: string | null | undefined): number {
	const parsed = value ? Date.parse(value) : Number.NaN;
	return Number.isNaN(parsed) ? 0 : parsed;
}

function mergeItemsByBaseline<T extends { id: string; updatedAt: string }>(
	localItems: T[],
	remoteItems: T[],
	baselineItems: T[],
): T[] {
	const localById = new Map(localItems.map((item) => [item.id, item]));
	const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
	const baselineById = new Map(baselineItems.map((item) => [item.id, item]));
	const ids = new Set([
		...localById.keys(),
		...remoteById.keys(),
		...baselineById.keys(),
	]);
	const merged: T[] = [];

	for (const id of ids) {
		const localItem = localById.get(id);
		const remoteItem = remoteById.get(id);
		const baselineItem = baselineById.get(id);

		if (!baselineItem) {
			if (localItem && remoteItem) {
				merged.push(
					toTimestamp(remoteItem.updatedAt) >= toTimestamp(localItem.updatedAt)
						? remoteItem
						: localItem,
				);
			} else if (localItem) {
				merged.push(localItem);
			} else if (remoteItem) {
				merged.push(remoteItem);
			}
			continue;
		}

		if (!localItem && !remoteItem) continue;

		const localChanged =
			Boolean(localItem) &&
			JSON.stringify(localItem) !== JSON.stringify(baselineItem);
		const remoteChanged =
			Boolean(remoteItem) &&
			JSON.stringify(remoteItem) !== JSON.stringify(baselineItem);

		if (!localItem && remoteItem) {
			if (remoteChanged) merged.push(remoteItem);
			continue;
		}
		if (localItem && !remoteItem) {
			if (localChanged) merged.push(localItem);
			continue;
		}
		if (localItem && remoteItem && localChanged && !remoteChanged) {
			merged.push(localItem);
			continue;
		}
		if (localItem && remoteItem && remoteChanged && !localChanged) {
			merged.push(remoteItem);
			continue;
		}
		if (localItem && remoteItem) {
			merged.push(
				toTimestamp(remoteItem.updatedAt) >= toTimestamp(localItem.updatedAt)
					? remoteItem
					: localItem,
			);
		}
	}

	return merged;
}

export function mergeWorkspaceStateFromBaseline(
	local: AppState,
	remote: AppState,
	baseline: AppState,
): AppState {
	return {
		...remote,
		nodes: mergeItemsByBaseline(local.nodes, remote.nodes, baseline.nodes),
		subscriptions: mergeItemsByBaseline(
			local.subscriptions,
			remote.subscriptions,
			baseline.subscriptions,
		),
		aggregates: mergeItemsByBaseline(
			local.aggregates,
			remote.aggregates,
			baseline.aggregates,
		),
		publishTargets: mergeItemsByBaseline(
			local.publishTargets,
			remote.publishTargets,
			baseline.publishTargets,
		),
		clientExports: mergeItemsByBaseline(
			local.clientExports ?? [],
			remote.clientExports ?? [],
			baseline.clientExports ?? [],
		),
		lastUpdated:
			toTimestamp(local.lastUpdated) >= toTimestamp(remote.lastUpdated)
				? local.lastUpdated
				: remote.lastUpdated,
	};
}

export function reconcileWorkspaceState(
	state: AppState,
	now: string,
): AppState {
	const nodeIds = new Set(state.nodes.map((node) => node.id));
	const subscriptionIds = new Set(
		state.subscriptions.map((subscription) => subscription.id),
	);
	let changed = false;
	const aggregates = state.aggregates.map((aggregate) => {
		const nextNodeIds = aggregate.nodeIds.filter((id) => nodeIds.has(id));
		const nextSubscriptionIds = aggregate.subscriptionIds.filter((id) =>
			subscriptionIds.has(id),
		);
		if (
			nextNodeIds.length === aggregate.nodeIds.length &&
			nextSubscriptionIds.length === aggregate.subscriptionIds.length
		) {
			return aggregate;
		}
		changed = true;
		return {
			...aggregate,
			nodeIds: nextNodeIds,
			subscriptionIds: nextSubscriptionIds,
			updatedAt: now,
		};
	});

	return changed ? { ...state, aggregates } : state;
}
