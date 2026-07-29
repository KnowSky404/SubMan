import type { ToastType } from "$lib/stores/toast";
import type { WorkspaceOperationResult } from "$lib/workspace-operation-result";

export type WorkspaceOperationPresentation = {
	tone: ToastType;
	messageKey: string;
	messageParams?: Record<string, string | number>;
	finalizeDraft: boolean;
	remoteCommitted: boolean;
};

export type WorkspaceOperationPresentationOptions = {
	remoteCommittedMessageKey?: string;
	localDurableMessageKey?: string;
	rejectedMessageKey?: string;
	successMessageParams?: Record<string, string | number>;
};

export function presentWorkspaceOperation(
	result: WorkspaceOperationResult,
	options: WorkspaceOperationPresentationOptions = {},
): WorkspaceOperationPresentation {
	switch (result.status) {
		case "remote-committed":
			return {
				tone: "success",
				messageKey: options.remoteCommittedMessageKey ?? "Saved to Workspace",
				messageParams: options.successMessageParams,
				finalizeDraft: true,
				remoteCommitted: true,
			};
		case "local-durable":
			if (result.mode === "manual") {
				return {
					tone: "info",
					messageKey: "Saved locally; manual push required",
					finalizeDraft: true,
					remoteCommitted: false,
				};
			}
			if (result.mode === "paused-conflict") {
				return {
					tone: "info",
					messageKey: "Saved locally; sync paused by conflict",
					finalizeDraft: true,
					remoteCommitted: false,
				};
			}
			return {
				tone: "success",
				messageKey: options.localDurableMessageKey ?? "Saved locally",
				messageParams: options.successMessageParams,
				finalizeDraft: true,
				remoteCommitted: false,
			};
		case "local-durable-queued":
			return {
				tone: "info",
				messageKey: "Saved locally and queued for Workspace sync",
				finalizeDraft: true,
				remoteCommitted: false,
			};
		case "peer-owned":
			return {
				tone: "info",
				messageKey: "Saved locally; another tab is synchronizing",
				finalizeDraft: true,
				remoteCommitted: false,
			};
		case "retry-scheduled":
			return {
				tone: "info",
				messageKey: "Saved locally; retrying Workspace sync",
				finalizeDraft: true,
				remoteCommitted: false,
			};
		case "conflict-or-blocked":
			return {
				tone: "info",
				messageKey:
					"Saved locally; Workspace synchronization needs repair: {error}",
				messageParams: { error: result.messageKey ?? result.code },
				finalizeDraft: false,
				remoteCommitted: false,
			};
		case "rejected-before-durable-commit":
			return {
				tone: "error",
				messageKey:
					options.rejectedMessageKey ??
					"Workspace change was not saved: {error}",
				messageParams: { error: result.message },
				finalizeDraft: false,
				remoteCommitted: false,
			};
		case "commit-acknowledgement-uncertain":
			return {
				tone: "info",
				messageKey:
					"Workspace save acknowledgement is uncertain; reload before retrying",
				finalizeDraft: false,
				remoteCommitted: false,
			};
	}
}
