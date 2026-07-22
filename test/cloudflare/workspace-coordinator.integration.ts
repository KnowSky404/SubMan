import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { WorkspaceCoordinator } from "../../src/lib/server/workspace-coordinator";
import { SqlWorkspaceCoordinatorJournal } from "../../src/lib/server/workspace-coordinator-journal";

describe("WorkspaceCoordinator Durable Object", () => {
	it("initializes the SQLite journal without credential columns", async () => {
		const stub = env.WORKSPACE_COORDINATOR.getByName("gist:integration-test");

		await runInDurableObject(
			stub,
			async (instance: WorkspaceCoordinator, state) => {
				expect(instance).toBeInstanceOf(WorkspaceCoordinator);
				const tableNames = state.storage.sql
					.exec<{ name: string }>(
						"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
					)
					.toArray()
					.map((row) => row.name);
				expect(tableNames).toContain("pending_mutations");
				expect(tableNames).toContain("processed_mutations");

				for (const table of ["pending_mutations", "processed_mutations"]) {
					const columns = state.storage.sql
						.exec<{ name: string }>(`PRAGMA table_info(${table})`)
						.toArray()
						.map((row) => row.name);
					expect(columns).not.toContain("token");
					expect(columns).not.toContain("github_token");
					expect(columns).not.toContain("mutation_payload");
					expect(columns).not.toContain("workspace_document");
				}
			},
		);
	});

	it("atomically promotes safe pending metadata into the processed index", async () => {
		const stub = env.WORKSPACE_COORDINATOR.getByName("gist:journal-test");

		await runInDurableObject(
			stub,
			async (_instance: WorkspaceCoordinator, state) => {
				const journal = new SqlWorkspaceCoordinatorJournal(state.storage);
				const pending = {
					mutationId: "80000000-0000-4000-8000-000000000001",
					workspaceId: "gist:journal-test",
					requestHash: "a".repeat(64),
					baseRevision: 1,
					baseDocumentHash: "b".repeat(64),
					candidateRevision: 2,
					candidateDocumentHash: "c".repeat(64),
					resultJson: JSON.stringify({
						mutationId: "80000000-0000-4000-8000-000000000001",
						workspaceId: "gist:journal-test",
						committedRevision: 2,
						committedAt: "2026-07-22T11:00:00.000Z",
						receipt: { kind: "node.delete", entityId: "node-1", deleted: true },
					}),
					expectedFilesJson: JSON.stringify([
						{ fileName: "subman.json", contentHash: "d".repeat(64) },
					]),
					committedAt: "2026-07-22T11:00:00.000Z",
				};

				journal.putPending(pending);
				expect(journal.getPendingByWorkspace(pending.workspaceId)).toEqual(
					pending,
				);
				journal.commitPending(pending);

				expect(journal.getPendingByWorkspace(pending.workspaceId)).toBeNull();
				expect(journal.getProcessed(pending.mutationId)).toEqual({
					mutationId: pending.mutationId,
					workspaceId: pending.workspaceId,
					requestHash: pending.requestHash,
					committedRevision: pending.candidateRevision,
					resultJson: pending.resultJson,
					committedAt: pending.committedAt,
				});
				expect(
					JSON.stringify(
						state.storage.sql
							.exec("SELECT * FROM processed_mutations")
							.toArray(),
					),
				).not.toContain("github-token");
			},
		);
	});
});
