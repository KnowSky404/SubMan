import type {
	WorkspaceCoordinatorJournal,
	WorkspaceCoordinatorPendingMutation,
	WorkspaceCoordinatorProcessedMutation,
} from "$lib/server/workspace-coordinator-core";

type WorkspaceCoordinatorStorage = Pick<
	DurableObjectStorage,
	"sql" | "transactionSync"
>;

type PendingRow = {
	mutation_id: string;
	workspace_id: string;
	request_hash: string;
	base_revision: number;
	base_document_hash: string;
	candidate_revision: number;
	candidate_document_hash: string;
	result_json: string;
	expected_files_json: string;
	committed_at: string;
};

type ProcessedRow = {
	mutation_id: string;
	workspace_id: string;
	request_hash: string;
	committed_revision: number;
	result_json: string;
	committed_at: string;
};

function pendingFromRow(row: PendingRow): WorkspaceCoordinatorPendingMutation {
	return {
		mutationId: row.mutation_id,
		workspaceId: row.workspace_id,
		requestHash: row.request_hash,
		baseRevision: row.base_revision,
		baseDocumentHash: row.base_document_hash,
		candidateRevision: row.candidate_revision,
		candidateDocumentHash: row.candidate_document_hash,
		resultJson: row.result_json,
		expectedFilesJson: row.expected_files_json,
		committedAt: row.committed_at,
	};
}

function processedFromRow(
	row: ProcessedRow,
): WorkspaceCoordinatorProcessedMutation {
	return {
		mutationId: row.mutation_id,
		workspaceId: row.workspace_id,
		requestHash: row.request_hash,
		committedRevision: row.committed_revision,
		resultJson: row.result_json,
		committedAt: row.committed_at,
	};
}

export class SqlWorkspaceCoordinatorJournal
	implements WorkspaceCoordinatorJournal
{
	constructor(private readonly storage: WorkspaceCoordinatorStorage) {}

	initialize(): void {
		this.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS pending_mutations (
				mutation_id TEXT PRIMARY KEY,
				workspace_id TEXT NOT NULL UNIQUE,
				request_hash TEXT NOT NULL,
				base_revision INTEGER NOT NULL,
				base_document_hash TEXT NOT NULL,
				candidate_revision INTEGER NOT NULL,
				candidate_document_hash TEXT NOT NULL,
				result_json TEXT NOT NULL,
				expected_files_json TEXT NOT NULL,
				committed_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS processed_mutations (
				mutation_id TEXT PRIMARY KEY,
				workspace_id TEXT NOT NULL,
				request_hash TEXT NOT NULL,
				committed_revision INTEGER NOT NULL,
				result_json TEXT NOT NULL,
				committed_at TEXT NOT NULL
			);
		`);
	}

	getProcessed(
		mutationId: string,
	): WorkspaceCoordinatorProcessedMutation | null {
		const row = this.storage.sql
			.exec<ProcessedRow>(
				`SELECT mutation_id, workspace_id, request_hash,
					committed_revision, result_json, committed_at
				FROM processed_mutations
				WHERE mutation_id = ?`,
				mutationId,
			)
			.toArray()[0];
		return row ? processedFromRow(row) : null;
	}

	getPendingByWorkspace(
		workspaceId: string,
	): WorkspaceCoordinatorPendingMutation | null {
		const row = this.storage.sql
			.exec<PendingRow>(
				`SELECT mutation_id, workspace_id, request_hash, base_revision,
					base_document_hash, candidate_revision, candidate_document_hash,
					result_json, expected_files_json, committed_at
				FROM pending_mutations
				WHERE workspace_id = ?`,
				workspaceId,
			)
			.toArray()[0];
		return row ? pendingFromRow(row) : null;
	}

	putPending(entry: WorkspaceCoordinatorPendingMutation): void {
		this.storage.sql.exec(
			`INSERT INTO pending_mutations (
				mutation_id, workspace_id, request_hash, base_revision,
				base_document_hash, candidate_revision, candidate_document_hash,
				result_json, expected_files_json, committed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(mutation_id) DO UPDATE SET
				workspace_id = excluded.workspace_id,
				request_hash = excluded.request_hash,
				base_revision = excluded.base_revision,
				base_document_hash = excluded.base_document_hash,
				candidate_revision = excluded.candidate_revision,
				candidate_document_hash = excluded.candidate_document_hash,
				result_json = excluded.result_json,
				expected_files_json = excluded.expected_files_json,
				committed_at = excluded.committed_at`,
			entry.mutationId,
			entry.workspaceId,
			entry.requestHash,
			entry.baseRevision,
			entry.baseDocumentHash,
			entry.candidateRevision,
			entry.candidateDocumentHash,
			entry.resultJson,
			entry.expectedFilesJson,
			entry.committedAt,
		);
	}

	commitPending(entry: WorkspaceCoordinatorPendingMutation): void {
		this.storage.transactionSync(() => {
			this.storage.sql.exec(
				`INSERT INTO processed_mutations (
					mutation_id, workspace_id, request_hash, committed_revision,
					result_json, committed_at
				) VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(mutation_id) DO NOTHING`,
				entry.mutationId,
				entry.workspaceId,
				entry.requestHash,
				entry.candidateRevision,
				entry.resultJson,
				entry.committedAt,
			);
			this.storage.sql.exec(
				"DELETE FROM pending_mutations WHERE mutation_id = ?",
				entry.mutationId,
			);
		});
	}

	deletePending(mutationId: string): void {
		this.storage.sql.exec(
			"DELETE FROM pending_mutations WHERE mutation_id = ?",
			mutationId,
		);
	}
}
