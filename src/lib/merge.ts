import type { AggregatePublishTarget, AggregateRule, NodeItem, SubscriptionItem } from '$lib/models';

function toTimestamp(value: string | null | undefined): number {
	if (!value) {
		return 0;
	}
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function mergeByUpdatedAt<T extends { id: string; updatedAt: string }>(
	localItems: T[],
	remoteItems: T[]
): T[] {
	const map = new Map<string, T>();

	for (const item of localItems) {
		map.set(item.id, item);
	}

	for (const item of remoteItems) {
		const existing = map.get(item.id);
		if (!existing) {
			map.set(item.id, item);
			continue;
		}
		const existingTs = toTimestamp(existing.updatedAt);
		const incomingTs = toTimestamp(item.updatedAt);
		map.set(item.id, incomingTs >= existingTs ? item : existing);
	}

	return Array.from(map.values());
}

export function mergeSyncState(
	local: {
		nodes: NodeItem[];
		subscriptions: SubscriptionItem[];
		aggregates: AggregateRule[];
		publishTargets: AggregatePublishTarget[];
	},
	remote: {
		nodes: NodeItem[];
		subscriptions: SubscriptionItem[];
		aggregates: AggregateRule[];
		publishTargets: AggregatePublishTarget[];
	}
): {
	nodes: NodeItem[];
	subscriptions: SubscriptionItem[];
	aggregates: AggregateRule[];
	publishTargets: AggregatePublishTarget[];
} {
	return {
		nodes: mergeByUpdatedAt(local.nodes, remote.nodes),
		subscriptions: mergeByUpdatedAt(local.subscriptions, remote.subscriptions),
		aggregates: mergeByUpdatedAt(local.aggregates, remote.aggregates),
		publishTargets: mergeByUpdatedAt(local.publishTargets, remote.publishTargets)
	};
}
