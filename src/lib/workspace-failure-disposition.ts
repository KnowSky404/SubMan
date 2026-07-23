import type { WorkspaceCoordinatorRpcErrorCode } from "$lib/server/workspace-coordinator";

export type WorkspaceFailureDisposition =
	| "state-conflict"
	| "domain-conflict"
	| "auth-required"
	| "queue-corruption"
	| "operator-repair"
	| "retryable-upstream"
	| "permanent-upstream"
	| "invalid-request";

export const WORKSPACE_COORDINATOR_FAILURE_DISPOSITIONS = {
	invalid_mutation: "invalid-request",
	workspace_mismatch: "operator-repair",
	revision_conflict: "state-conflict",
	entity_deleted: "state-conflict",
	entity_not_found: "domain-conflict",
	entity_exists: "domain-conflict",
	duplicate_node_raw: "domain-conflict",
	duplicate_subscription_url: "domain-conflict",
	output_file_conflict: "domain-conflict",
	publication_file_mismatch: "domain-conflict",
	workspace_not_found: "permanent-upstream",
	invalid_bootstrap_marker: "operator-repair",
	migration_backup_conflict: "operator-repair",
	mutation_id_reused: "queue-corruption",
	mutation_recovery_failed: "operator-repair",
	gist_read_failed: "retryable-upstream",
	gist_write_failed: "retryable-upstream",
	write_verification_failed: "operator-repair",
	commit_index_failed: "operator-repair",
	invalid_gateway_response: "operator-repair",
	invalid_journal_record: "operator-repair",
	invalid_workspace_document: "operator-repair",
	unsupported_schema: "invalid-request",
	server_error: "operator-repair",
} as const satisfies Record<
	WorkspaceCoordinatorRpcErrorCode,
	WorkspaceFailureDisposition
>;

type WorkspaceFailureInput = {
	code?: string;
	status?: number;
	hasTrustedLatestDocument?: boolean;
};

export function classifyWorkspaceFailure({
	code,
	status,
	hasTrustedLatestDocument = false,
}: WorkspaceFailureInput): WorkspaceFailureDisposition {
	if (code === "unauthorized" || status === 401 || status === 403) {
		return "auth-required";
	}
	if (code === "workspace_mismatch" && hasTrustedLatestDocument) {
		return "state-conflict";
	}
	if (code && code in WORKSPACE_COORDINATOR_FAILURE_DISPOSITIONS) {
		return WORKSPACE_COORDINATOR_FAILURE_DISPOSITIONS[
			code as WorkspaceCoordinatorRpcErrorCode
		];
	}
	if (
		status === 408 ||
		status === 429 ||
		(status !== undefined && status >= 500)
	) {
		return "retryable-upstream";
	}
	if (status === 404 || status === 409 || status === 422) {
		return "permanent-upstream";
	}
	if (status !== undefined && status >= 400 && status < 500) {
		return "invalid-request";
	}
	return "operator-repair";
}
