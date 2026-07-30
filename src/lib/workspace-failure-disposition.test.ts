import { describe, expect, it } from "bun:test";
import type { WorkspaceCoordinatorRpcErrorCode } from "$lib/server/workspace-coordinator";
import {
	classifyWorkspaceFailure,
	type WorkspaceFailureDisposition,
} from "$lib/workspace-failure-disposition";

const EXPECTED = {
	invalid_mutation: "invalid-request",
	workspace_size_limit: "operator-repair",
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

describe("Workspace failure disposition", () => {
	it("classifies every coordinator error code exhaustively", () => {
		for (const [code, disposition] of Object.entries(EXPECTED)) {
			expect(classifyWorkspaceFailure({ code })).toBe(disposition);
		}
	});

	it("allows Workspace mismatch resolution only with a trusted latest document", () => {
		expect(
			classifyWorkspaceFailure({
				code: "workspace_mismatch",
				hasTrustedLatestDocument: true,
			}),
		).toBe("state-conflict");
	});

	it("classifies transport failures without a stable coordinator code", () => {
		expect(classifyWorkspaceFailure({ code: "precondition_failed" })).toBe(
			"state-conflict",
		);
		expect(classifyWorkspaceFailure({ status: 401 })).toBe("auth-required");
		expect(classifyWorkspaceFailure({ status: 403 })).toBe("auth-required");
		expect(classifyWorkspaceFailure({ status: 408 })).toBe(
			"retryable-upstream",
		);
		expect(classifyWorkspaceFailure({ status: 429 })).toBe(
			"retryable-upstream",
		);
		expect(classifyWorkspaceFailure({ status: 503 })).toBe(
			"retryable-upstream",
		);
		expect(classifyWorkspaceFailure({ status: 404 })).toBe(
			"permanent-upstream",
		);
		expect(classifyWorkspaceFailure({ status: 400 })).toBe("invalid-request");
		expect(classifyWorkspaceFailure({})).toBe("operator-repair");
	});
});
