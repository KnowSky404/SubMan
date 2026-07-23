import { writable } from "svelte/store";

export type WorkspacePersistenceLifecycle =
	| "local-saved"
	| "queued"
	| "syncing"
	| "committed"
	| "retrying"
	| "manual-local-only"
	| "paused-conflict"
	| "auth-required"
	| "permanent-error"
	| "invalid-local-state"
	| "disconnected";

export type WorkspaceSyncStatus = {
	lifecycle: WorkspacePersistenceLifecycle;
	mode: "local" | "automatic" | "manual" | "paused-conflict" | "disconnected";
	queueCount: number;
	lastCommittedRevision: number | null;
	recentError: string | null;
	retrying: boolean;
	repairRequired: boolean;
	recoveryNotice: "queue-quarantined" | "state-quarantined" | null;
};

export const defaultWorkspaceSyncStatus: WorkspaceSyncStatus = {
	lifecycle: "disconnected",
	mode: "disconnected",
	queueCount: 0,
	lastCommittedRevision: null,
	recentError: null,
	retrying: false,
	repairRequired: false,
	recoveryNotice: null,
};

export const workspaceSyncStatus = writable<WorkspaceSyncStatus>(
	defaultWorkspaceSyncStatus,
);

export function updateWorkspaceSyncStatus(
	patch: Partial<WorkspaceSyncStatus>,
): void {
	workspaceSyncStatus.update((current) => ({ ...current, ...patch }));
}

export function reportWorkspaceStorageRecovery(
	kind: "queue" | "state",
	message: string,
): void {
	updateWorkspaceSyncStatus({
		lifecycle: "invalid-local-state",
		recentError: message,
		repairRequired: true,
		recoveryNotice:
			kind === "queue" ? "queue-quarantined" : "state-quarantined",
	});
}

export function markWorkspaceDisconnected(queueCount: number): void {
	updateWorkspaceSyncStatus({
		lifecycle: queueCount > 0 ? "auth-required" : "disconnected",
		mode: "disconnected",
		queueCount,
		retrying: false,
		recentError: null,
	});
}
