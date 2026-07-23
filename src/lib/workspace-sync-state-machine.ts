import type { WorkspaceFailureDisposition } from "$lib/workspace-failure-disposition";

export type WorkspaceSyncPhase =
	| "local-only"
	| "automatic-idle"
	| "queued"
	| "syncing"
	| "retrying"
	| "manual-local-only"
	| "paused-state-conflict"
	| "blocked-domain-conflict"
	| "auth-required"
	| "queue-repair-required"
	| "operator-repair-required"
	| "invalid-local-storage"
	| "disconnected";

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

export type WorkspaceSyncMode =
	| "local"
	| "automatic"
	| "manual"
	| "paused-conflict"
	| "disconnected";

export type WorkspaceQueueMetrics = {
	activeQueueCount: number;
	totalQueueCount: number;
	orphanedWorkspaceCount: number;
	blockedMutationCount: number;
	deadLetterCount: number;
};

export type WorkspaceSyncError = {
	code: string;
	message: string;
	disposition: WorkspaceFailureDisposition;
};

export type WorkspaceMutationMetadata = {
	mutationId: string;
	kind: string;
};

export type WorkspaceBlockedMutation = WorkspaceMutationMetadata & {
	code: string;
	disposition: WorkspaceFailureDisposition;
	message: string;
};

export type WorkspaceRetryMetadata = {
	attempt: number;
	nextAttemptAt: number;
	retryAfterMs: number | null;
	lastErrorCode: string | null;
};

type WorkspaceSyncStatusBase = WorkspaceQueueMetrics & {
	lifecycle: WorkspacePersistenceLifecycle;
	mode: WorkspaceSyncMode;
	queueCount: number;
	lastCommittedRevision: number | null;
	recentError: WorkspaceSyncError | null;
	retrying: boolean;
	repairRequired: boolean;
	recoveryNotice: "queue-quarantined" | "state-quarantined" | null;
	nextAttemptAt: number | null;
	retry: WorkspaceRetryMetadata | null;
};

type WorkspaceHealthySyncStatus = WorkspaceSyncStatusBase & {
	phase:
		| "local-only"
		| "automatic-idle"
		| "queued"
		| "syncing"
		| "manual-local-only"
		| "auth-required"
		| "disconnected";
	blockedMutation: null;
};

type WorkspaceRetryingSyncStatus = WorkspaceSyncStatusBase & {
	phase: "retrying";
	retry: WorkspaceRetryMetadata;
	nextAttemptAt: number;
	blockedMutation: WorkspaceBlockedMutation | null;
};

type WorkspaceRepairSyncStatus = WorkspaceSyncStatusBase & {
	phase:
		| "paused-state-conflict"
		| "blocked-domain-conflict"
		| "queue-repair-required"
		| "operator-repair-required"
		| "invalid-local-storage";
	repairRequired: true;
	blockedMutation: WorkspaceBlockedMutation | null;
};

export type WorkspaceSyncStatus =
	| WorkspaceHealthySyncStatus
	| WorkspaceRetryingSyncStatus
	| WorkspaceRepairSyncStatus;

type QueueEvent = { queue: WorkspaceQueueMetrics };
type FailureEvent = QueueEvent & {
	error: WorkspaceSyncError;
	blockedMutation: WorkspaceBlockedMutation | null;
};

export type WorkspaceSyncEvent =
	| ({
			type: "LOCAL_COMMITTED";
			mode: "local" | "automatic" | "manual";
	  } & QueueEvent)
	| ({
			type: "MUTATION_ENQUEUED";
			mutation: WorkspaceMutationMetadata;
	  } & QueueEvent)
	| ({
			type: "SYNC_STARTED";
			mutation: WorkspaceMutationMetadata | null;
	  } & QueueEvent)
	| ({ type: "SYNC_COMMITTED"; revision: number | null } & QueueEvent)
	| ({
			type: "SYNC_RETRY_SCHEDULED";
			retry: WorkspaceRetryMetadata;
	  } & FailureEvent)
	| ({ type: "AUTH_LOST"; error?: WorkspaceSyncError } & QueueEvent)
	| ({ type: "AUTH_RESTORED" } & QueueEvent)
	| ({ type: "STATE_CONFLICT" } & FailureEvent)
	| ({ type: "DOMAIN_BLOCKED" } & FailureEvent)
	| ({ type: "QUEUE_CORRUPTED" } & FailureEvent)
	| ({ type: "OPERATOR_REPAIR_REQUIRED" } & FailureEvent)
	| ({
			type: "REPAIR_SUCCEEDED";
			mode: "automatic" | "manual";
			revision: number | null;
	  } & QueueEvent)
	| ({
			type: "WORKSPACE_BOUND";
			mode: "automatic" | "manual";
			revision: number | null;
	  } & QueueEvent)
	| ({ type: "WORKSPACE_DISCONNECTED" } & QueueEvent)
	| ({
			type: "STORAGE_QUARANTINED";
			kind: "queue" | "state";
			error: WorkspaceSyncError;
	  } & QueueEvent)
	| ({
			type: "SYNC_CONTEXT_LOADED";
			mode: "automatic" | "manual" | "paused-conflict" | "disconnected";
			authenticated: boolean;
			revision: number | null;
			blockedMutation: WorkspaceBlockedMutation | null;
	  } & QueueEvent)
	| ({ type: "QUEUE_COUNTS_UPDATED" } & QueueEvent);

export type WorkspaceSyncTransition =
	| { accepted: true; state: WorkspaceSyncStatus }
	| { accepted: false; state: WorkspaceSyncStatus; reason: string };

export const emptyWorkspaceQueueMetrics: WorkspaceQueueMetrics = {
	activeQueueCount: 0,
	totalQueueCount: 0,
	orphanedWorkspaceCount: 0,
	blockedMutationCount: 0,
	deadLetterCount: 0,
};

const REPAIR_PHASES = new Set<WorkspaceSyncPhase>([
	"paused-state-conflict",
	"blocked-domain-conflict",
	"queue-repair-required",
	"operator-repair-required",
	"invalid-local-storage",
]);

function assertQueueMetrics(
	queue: WorkspaceQueueMetrics,
): WorkspaceQueueMetrics {
	for (const value of Object.values(queue)) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new Error("Workspace queue metrics are invalid");
		}
	}
	if (queue.activeQueueCount > queue.totalQueueCount) {
		throw new Error("Active Workspace queue count exceeds total queue count");
	}
	return { ...queue };
}

function assertRetryMetadata(
	retry: WorkspaceRetryMetadata,
): WorkspaceRetryMetadata {
	if (
		!Number.isSafeInteger(retry.attempt) ||
		retry.attempt < 1 ||
		!Number.isSafeInteger(retry.nextAttemptAt) ||
		retry.nextAttemptAt < 0 ||
		(retry.retryAfterMs !== null &&
			(!Number.isSafeInteger(retry.retryAfterMs) || retry.retryAfterMs < 0))
	) {
		throw new Error("Workspace retry metadata is invalid");
	}
	return { ...retry };
}

function lifecycleForPhase(
	phase: WorkspaceSyncPhase,
): WorkspacePersistenceLifecycle {
	switch (phase) {
		case "local-only":
			return "local-saved";
		case "automatic-idle":
			return "committed";
		case "queued":
			return "queued";
		case "syncing":
			return "syncing";
		case "retrying":
			return "retrying";
		case "manual-local-only":
			return "manual-local-only";
		case "paused-state-conflict":
			return "paused-conflict";
		case "auth-required":
			return "auth-required";
		case "invalid-local-storage":
			return "invalid-local-state";
		case "blocked-domain-conflict":
		case "queue-repair-required":
		case "operator-repair-required":
			return "permanent-error";
		case "disconnected":
			return "disconnected";
	}
}

function modeForPhase(phase: WorkspaceSyncPhase): WorkspaceSyncMode {
	switch (phase) {
		case "local-only":
			return "local";
		case "manual-local-only":
			return "manual";
		case "paused-state-conflict":
			return "paused-conflict";
		case "auth-required":
		case "invalid-local-storage":
		case "disconnected":
			return "disconnected";
		default:
			return "automatic";
	}
}

function createStatus(
	phase: WorkspaceSyncPhase,
	options: {
		queue?: WorkspaceQueueMetrics;
		revision?: number | null;
		error?: WorkspaceSyncError | null;
		blockedMutation?: WorkspaceBlockedMutation | null;
		retry?: WorkspaceRetryMetadata | null;
		recoveryNotice?: WorkspaceSyncStatus["recoveryNotice"];
	} = {},
): WorkspaceSyncStatus {
	const queue = assertQueueMetrics(options.queue ?? emptyWorkspaceQueueMetrics);
	const retry =
		phase === "retrying" && options.retry
			? assertRetryMetadata(options.retry)
			: null;
	if (phase === "retrying" && retry === null) {
		throw new Error("Retrying Workspace state requires retry metadata");
	}
	const repairRequired = REPAIR_PHASES.has(phase);
	const result = {
		phase,
		lifecycle: lifecycleForPhase(phase),
		mode: modeForPhase(phase),
		queueCount: queue.activeQueueCount,
		...queue,
		lastCommittedRevision: options.revision ?? null,
		recentError: options.error ?? null,
		retrying: phase === "retrying",
		repairRequired,
		recoveryNotice: options.recoveryNotice ?? null,
		nextAttemptAt: retry?.nextAttemptAt ?? null,
		retry,
		blockedMutation: options.blockedMutation ?? null,
	};
	return result as WorkspaceSyncStatus;
}

export function createDefaultWorkspaceSyncStatus(): WorkspaceSyncStatus {
	return createStatus("disconnected");
}

function reject(
	state: WorkspaceSyncStatus,
	event: WorkspaceSyncEvent,
): WorkspaceSyncTransition {
	return {
		accepted: false,
		state,
		reason: `${event.type} is not valid while Workspace sync is ${state.phase}`,
	};
}

function healthyPhase(
	mode: "local" | "automatic" | "manual",
	queue: WorkspaceQueueMetrics,
): WorkspaceSyncPhase {
	if (mode === "local") return "local-only";
	if (mode === "manual") return "manual-local-only";
	return queue.activeQueueCount > 0 ? "queued" : "automatic-idle";
}

function repairPhase(phase: WorkspaceSyncPhase): boolean {
	return REPAIR_PHASES.has(phase);
}

export function transitionWorkspaceSyncState(
	state: WorkspaceSyncStatus,
	event: WorkspaceSyncEvent,
): WorkspaceSyncTransition {
	switch (event.type) {
		case "QUEUE_COUNTS_UPDATED":
			return {
				accepted: true,
				state: createStatus(state.phase, {
					queue: event.queue,
					revision: state.lastCommittedRevision,
					error: state.recentError,
					blockedMutation: state.blockedMutation,
					retry: state.retry,
					recoveryNotice: state.recoveryNotice,
				}),
			};
		case "WORKSPACE_DISCONNECTED":
			return {
				accepted: true,
				state: createStatus("disconnected", { queue: event.queue }),
			};
		case "WORKSPACE_BOUND":
			return {
				accepted: true,
				state: createStatus(healthyPhase(event.mode, event.queue), {
					queue: event.queue,
					revision: event.revision,
				}),
			};
		case "LOCAL_COMMITTED":
			if (repairPhase(state.phase)) {
				return {
					accepted: true,
					state: createStatus(state.phase, {
						queue: event.queue,
						revision: state.lastCommittedRevision,
						error: state.recentError,
						blockedMutation: state.blockedMutation,
						recoveryNotice: state.recoveryNotice,
					}),
				};
			}
			return {
				accepted: true,
				state: createStatus(healthyPhase(event.mode, event.queue), {
					queue: event.queue,
					revision: state.lastCommittedRevision,
				}),
			};
		case "MUTATION_ENQUEUED":
			if (state.phase === "auth-required") {
				return {
					accepted: true,
					state: createStatus("auth-required", {
						queue: event.queue,
						revision: state.lastCommittedRevision,
					}),
				};
			}
			if (
				state.phase !== "automatic-idle" &&
				state.phase !== "queued" &&
				state.phase !== "syncing"
			) {
				return reject(state, event);
			}
			return {
				accepted: true,
				state: createStatus(state.phase === "syncing" ? "syncing" : "queued", {
					queue: event.queue,
					revision: state.lastCommittedRevision,
				}),
			};
		case "SYNC_STARTED":
			if (state.phase !== "queued" && state.phase !== "retrying") {
				return reject(state, event);
			}
			return {
				accepted: true,
				state: createStatus("syncing", {
					queue: event.queue,
					revision: state.lastCommittedRevision,
				}),
			};
		case "SYNC_COMMITTED":
			if (
				state.phase !== "syncing" &&
				state.phase !== "retrying" &&
				state.phase !== "queued"
			) {
				return reject(state, event);
			}
			return {
				accepted: true,
				state: createStatus(healthyPhase("automatic", event.queue), {
					queue: event.queue,
					revision: event.revision,
				}),
			};
		case "SYNC_RETRY_SCHEDULED":
			if (state.phase !== "syncing" && state.phase !== "retrying") {
				return reject(state, event);
			}
			return {
				accepted: true,
				state: createStatus("retrying", {
					queue: event.queue,
					revision: state.lastCommittedRevision,
					error: event.error,
					blockedMutation: event.blockedMutation,
					retry: event.retry,
				}),
			};
		case "AUTH_LOST":
			if (repairPhase(state.phase)) {
				return {
					accepted: true,
					state: createStatus(state.phase, {
						queue: event.queue,
						revision: state.lastCommittedRevision,
						error: state.recentError,
						blockedMutation: state.blockedMutation,
						recoveryNotice: state.recoveryNotice,
					}),
				};
			}
			return {
				accepted: true,
				state: createStatus("auth-required", {
					queue: event.queue,
					revision: state.lastCommittedRevision,
					error: event.error ?? null,
				}),
			};
		case "AUTH_RESTORED":
			if (state.phase !== "auth-required") return reject(state, event);
			return {
				accepted: true,
				state: createStatus(healthyPhase("automatic", event.queue), {
					queue: event.queue,
					revision: state.lastCommittedRevision,
				}),
			};
		case "STATE_CONFLICT":
			return {
				accepted: true,
				state: createStatus("paused-state-conflict", {
					queue: event.queue,
					revision: state.lastCommittedRevision,
					error: event.error,
					blockedMutation: event.blockedMutation,
				}),
			};
		case "DOMAIN_BLOCKED":
			return {
				accepted: true,
				state: createStatus("blocked-domain-conflict", {
					queue: event.queue,
					revision: state.lastCommittedRevision,
					error: event.error,
					blockedMutation: event.blockedMutation,
				}),
			};
		case "QUEUE_CORRUPTED":
			return {
				accepted: true,
				state: createStatus("queue-repair-required", {
					queue: event.queue,
					revision: state.lastCommittedRevision,
					error: event.error,
					blockedMutation: event.blockedMutation,
				}),
			};
		case "OPERATOR_REPAIR_REQUIRED":
			return {
				accepted: true,
				state: createStatus("operator-repair-required", {
					queue: event.queue,
					revision: state.lastCommittedRevision,
					error: event.error,
					blockedMutation: event.blockedMutation,
				}),
			};
		case "REPAIR_SUCCEEDED":
			if (!repairPhase(state.phase)) return reject(state, event);
			return {
				accepted: true,
				state: createStatus(healthyPhase(event.mode, event.queue), {
					queue: event.queue,
					revision: event.revision,
				}),
			};
		case "STORAGE_QUARANTINED":
			return {
				accepted: true,
				state: createStatus("invalid-local-storage", {
					queue: event.queue,
					revision: state.lastCommittedRevision,
					error: event.error,
					recoveryNotice:
						event.kind === "queue" ? "queue-quarantined" : "state-quarantined",
				}),
			};
		case "SYNC_CONTEXT_LOADED": {
			if (
				repairPhase(state.phase) &&
				!(
					state.phase === "paused-state-conflict" &&
					event.mode !== "paused-conflict"
				)
			) {
				return {
					accepted: true,
					state: createStatus(state.phase, {
						queue: event.queue,
						revision: event.revision,
						error: state.recentError,
						blockedMutation: state.blockedMutation,
						recoveryNotice: state.recoveryNotice,
					}),
				};
			}
			if (event.mode === "paused-conflict") {
				const error: WorkspaceSyncError = {
					code: "revision_conflict",
					message: "Workspace synchronization is paused by a state conflict",
					disposition: "state-conflict",
				};
				return {
					accepted: true,
					state: createStatus("paused-state-conflict", {
						queue: event.queue,
						revision: event.revision,
						error,
						blockedMutation: event.blockedMutation,
					}),
				};
			}
			if (event.mode === "disconnected") {
				return {
					accepted: true,
					state: createStatus("disconnected", { queue: event.queue }),
				};
			}
			if (!event.authenticated && event.queue.activeQueueCount > 0) {
				return {
					accepted: true,
					state: createStatus("auth-required", {
						queue: event.queue,
						revision: event.revision,
					}),
				};
			}
			return {
				accepted: true,
				state: createStatus(healthyPhase(event.mode, event.queue), {
					queue: event.queue,
					revision: event.revision,
				}),
			};
		}
	}
}
