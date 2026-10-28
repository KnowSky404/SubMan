import type { ToastType } from "$lib/stores/toast";
import type { WorkspaceOperationResult } from "$lib/workspace-operation-result";

export type WorkspaceFeedbackState =
	| "pending"
	| "success"
	| "attention"
	| "error";

export type WorkspaceOperationPresentation = {
	tone: ToastType;
	feedbackState: WorkspaceFeedbackState;
	messageKey: string;
	messageParams?: Record<string, string | number>;
	finalizeDraft: boolean;
	remoteCommitted: boolean;
};

export type WorkspaceOperationPresentationOptions = {
	remoteCommittedMessageKey?: string;
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
				feedbackState: "success",
				messageKey: options.remoteCommittedMessageKey ?? "Saved to Workspace",
				messageParams: options.successMessageParams,
				finalizeDraft: true,
				remoteCommitted: true,
			};
		case "local-durable":
			return {
				tone: "info",
				feedbackState: "pending",
				messageKey: "Cloud confirmation required; reload from Cloud",
				finalizeDraft: false,
				remoteCommitted: false,
			};
		case "local-durable-queued":
			return {
				tone: "info",
				feedbackState: "pending",
				messageKey: "Cloud save pending",
				finalizeDraft: false,
				remoteCommitted: false,
			};
		case "peer-owned":
			return {
				tone: "info",
				feedbackState: "pending",
				messageKey: "Cloud save pending; another tab is synchronizing",
				finalizeDraft: false,
				remoteCommitted: false,
			};
		case "retry-scheduled":
			return {
				tone: "info",
				feedbackState: "pending",
				messageKey: "Cloud save pending; retrying",
				finalizeDraft: false,
				remoteCommitted: false,
			};
		case "conflict-or-blocked":
			return {
				tone: "info",
				feedbackState: "attention",
				messageKey: "Cloud synchronization needs repair: {error}",
				messageParams: { error: result.messageKey ?? result.code },
				finalizeDraft: false,
				remoteCommitted: false,
			};
		case "rejected-before-durable-commit":
			return {
				tone: "error",
				feedbackState: "error",
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
				feedbackState: "attention",
				messageKey:
					"Workspace save acknowledgement is uncertain; reload before retrying",
				finalizeDraft: false,
				remoteCommitted: false,
			};
	}
}
