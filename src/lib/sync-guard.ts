import { mergeSyncState } from "$lib/merge";
import type { AppState } from "$lib/models";
import { getSyncStateSignature } from "$lib/serialization";
import { mergeWorkspaceStateFromBaseline } from "$lib/workspace-data";

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

	return mergeWorkspaceStateFromBaseline(local, remote, baseline);
}
