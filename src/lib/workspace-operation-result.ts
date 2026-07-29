import type { AppState } from "$lib/models";
import type { WorkspaceFailureDisposition } from "$lib/workspace-failure-disposition";

type WorkspaceDurableResultBase = {
	durable: true;
	mutationId: string | null;
	state: AppState;
};

export type WorkspaceOperationResult =
	| (WorkspaceDurableResultBase & {
			status: "remote-committed";
			revision: number;
	  })
	| (WorkspaceDurableResultBase & {
			status: "local-durable";
			mode: "local" | "manual" | "paused-conflict";
	  })
	| (WorkspaceDurableResultBase & {
			status: "local-durable-queued";
			mutationId: string;
	  })
	| (WorkspaceDurableResultBase & {
			status: "peer-owned";
			mutationId: string;
	  })
	| (WorkspaceDurableResultBase & {
			status: "retry-scheduled";
			mutationId: string;
			attempt: number;
			nextAttemptAt: number;
			lastErrorCode: string;
	  })
	| (WorkspaceDurableResultBase & {
			status: "conflict-or-blocked";
			mutationId: string;
			code: string;
			disposition: Exclude<WorkspaceFailureDisposition, "retryable-upstream">;
			messageKey: string | null;
	  })
	| {
			status: "rejected-before-durable-commit";
			durable: false;
			mutationId: string | null;
			code: string;
			message: string;
	  }
	| {
			status: "commit-acknowledgement-uncertain";
			durable: "uncertain";
			mutationId: string | null;
			state: AppState;
			code: string;
	  };

export function rejectedWorkspaceOperation(
	error: unknown,
	mutationId: string | null = null,
): WorkspaceOperationResult {
	const code =
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
			? error.code
			: "workspace_operation_rejected";
	return {
		status: "rejected-before-durable-commit",
		durable: false,
		mutationId,
		code,
		message: error instanceof Error ? error.message : String(error),
	};
}

export function isWorkspaceOperationDurable(
	result: WorkspaceOperationResult,
): boolean {
	return result.durable === true;
}
