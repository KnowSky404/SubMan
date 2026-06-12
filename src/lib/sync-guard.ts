import { mergeSyncState } from "$lib/merge";
import type { AppState } from "$lib/models";
import { getSyncStateSignature } from "$lib/serialization";

export type ManualPushDecisionAction =
	| "already-synced"
	| "safe-push"
	| "remote-changed";

export type ManualPushDecision = {
	action: ManualPushDecisionAction;
	localSignature: string;
	remoteSignature: string;
};

export function selectTrustedSyncBaseline(
	baseline: AppState | null,
	gistId: string,
	fileName: string,
): AppState | null {
	if (
		baseline?.activeGistId === gistId &&
		baseline.activeGistFile === fileName
	) {
		return baseline;
	}

	return null;
}

export function decideManualPush({
	local,
	remote,
	baselineSignature,
}: {
	local: AppState;
	remote: AppState;
	baselineSignature: string;
}): ManualPushDecision {
	const localSignature = getSyncStateSignature(local);
	const remoteSignature = getSyncStateSignature(remote);

	if (remoteSignature === localSignature) {
		return { action: "already-synced", localSignature, remoteSignature };
	}

	if (remoteSignature === baselineSignature) {
		return { action: "safe-push", localSignature, remoteSignature };
	}

	return { action: "remote-changed", localSignature, remoteSignature };
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
					Date.parse(remoteItem.updatedAt) >= Date.parse(localItem.updatedAt)
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

		if (!localItem && !remoteItem) {
			continue;
		}

		const localChanged =
			Boolean(localItem) &&
			JSON.stringify(localItem) !== JSON.stringify(baselineItem);
		const remoteChanged =
			Boolean(remoteItem) &&
			JSON.stringify(remoteItem) !== JSON.stringify(baselineItem);

		if (!localItem && remoteItem) {
			if (remoteChanged) {
				merged.push(remoteItem);
			}
			continue;
		}

		if (localItem && !remoteItem) {
			if (localChanged) {
				merged.push(localItem);
			}
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
				Date.parse(remoteItem.updatedAt) >= Date.parse(localItem.updatedAt)
					? remoteItem
					: localItem,
			);
		}
	}

	return merged;
}

export function mergeSyncStateFromBaseline(
	local: AppState,
	remote: AppState,
	baseline: AppState | null,
): AppState {
	if (!baseline) {
		return {
			...local,
			...mergeSyncState(local, remote),
		};
	}

	return {
		...local,
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
	};
}
