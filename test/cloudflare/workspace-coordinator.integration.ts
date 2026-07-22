import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCoordinator } from "../../src/lib/server/workspace-coordinator";
import { SqlWorkspaceCoordinatorJournal } from "../../src/lib/server/workspace-coordinator-journal";
import { serializeWorkspaceDocumentV2 } from "../../src/lib/workspace-document";
import type { WorkspaceMutation } from "../../src/lib/workspace-mutation";

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

	it("returns a structured RPC error without echoing the credential", async () => {
		const token = "rpc-github-token";
		const stub = env.WORKSPACE_COORDINATOR.getByName("gist:rpc-error");
		const mutation = {
			mutationId: "80000000-0000-4000-8000-000000000002",
			workspaceId: "gist:rpc-error",
			expectedRevision: 0,
			source: "browser",
			createdAt: "2026-07-22T11:00:00.000Z",
			kind: "node.delete",
			payload: { id: "node-1" },
		} satisfies WorkspaceMutation;

		const response = await stub.mutate(
			{ gistId: "different-gist", mutation },
			token,
		);

		expect(response).toEqual({
			ok: false,
			error: {
				code: "workspace_mismatch",
				message: "Mutation workspace does not match the Gist identity",
			},
		});
		expect(JSON.stringify(response)).not.toContain(token);
	});

	it("serves the browser endpoint and rejects a server-api mutation", async () => {
		const token = "route-github-token";
		const response = await SELF.fetch(
			"https://subman.example/api/workspaces/gist%3Arpc-route/mutations",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					mutationId: "80000000-0000-4000-8000-000000000003",
					workspaceId: "gist:rpc-route",
					expectedRevision: 0,
					source: "server-api",
					createdAt: "2026-07-22T11:00:00.000Z",
					kind: "node.delete",
					payload: { id: "node-1" },
				}),
			},
		);
		const body = await response.text();

		expect(response.status).toBe(400);
		expect(JSON.parse(body)).toEqual({
			error: {
				code: "invalid_mutation",
				message: "Browser mutations must use the browser source",
			},
		});
		expect(body).not.toContain(token);
	});

	it("commits and retries a browser mutation through the real Worker and DO", async () => {
		const gistId = "successful-worker-do";
		const workspaceId = `gist:${gistId}`;
		const token = "successful-route-token";
		const mutationId = "80000000-0000-4000-8000-000000000004";
		let content = serializeWorkspaceDocumentV2({
			version: 2,
			schemaVersion: 2,
			workspaceId,
			revision: 1,
			updatedAt: "2026-07-22T10:00:00.000Z",
			lastMutationId: null,
			data: {
				nodes: [
					{
						id: "node-1",
						name: "node-1",
						type: "vless",
						raw: "vless://node-1",
						tags: [],
						enabled: true,
						updatedAt: "2026-07-22T10:00:00.000Z",
						source: "single",
					},
				],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			},
			tombstones: {
				nodes: [],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			},
		});
		let patchCount = 0;
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url !== `https://api.github.com/gists/${gistId}`) {
					throw new Error(`Unexpected outbound request: ${url}`);
				}
				if (init?.method === "PATCH") {
					patchCount += 1;
					const body = JSON.parse(String(init.body)) as {
						files: Record<string, { content: string } | null>;
					};
					const workspace = body.files["subman.json"];
					if (!workspace) throw new Error("Workspace content is missing");
					content = workspace.content;
					return Response.json({ ok: true });
				}
				return Response.json({
					id: gistId,
					owner: { login: "owner" },
					files: {
						"subman.json": {
							filename: "subman.json",
							language: "JSON",
							size: content.length,
							truncated: false,
							content,
							raw_url: `https://gist.githubusercontent.com/owner/${gistId}/raw/subman.json`,
						},
					},
				});
			},
		);
		const mutation = {
			mutationId,
			workspaceId,
			expectedRevision: 1,
			source: "browser",
			createdAt: "2026-07-22T11:00:00.000Z",
			kind: "node.delete",
			payload: { id: "node-1" },
		} satisfies WorkspaceMutation;
		const send = () =>
			SELF.fetch(
				`https://subman.example/api/workspaces/${encodeURIComponent(workspaceId)}/mutations`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(mutation),
				},
			);

		try {
			const first = await send();
			const firstBody = await first.json<{
				status: string;
				document: {
					revision: number;
					tombstones: { nodes: Array<{ id: string }> };
				};
			}>();
			expect(first.status).toBe(200);
			expect(firstBody.status).toBe("committed");
			expect(firstBody.document.revision).toBe(2);
			expect(firstBody.document.tombstones.nodes[0]?.id).toBe("node-1");

			const retry = await send();
			const retryBody = await retry.json<{ status: string }>();
			expect(retry.status).toBe(200);
			expect(retryBody.status).toBe("already-committed");
			expect(patchCount).toBe(1);

			const stub = env.WORKSPACE_COORDINATOR.getByName(workspaceId);
			await runInDurableObject(
				stub,
				async (_instance: WorkspaceCoordinator, state) => {
					const rows = state.storage.sql
						.exec<{ mutation_id: string; committed_revision: number }>(
							"SELECT mutation_id, committed_revision FROM processed_mutations",
						)
						.toArray();
					expect(rows).toEqual([
						{ mutation_id: mutationId, committed_revision: 2 },
					]);
					expect(JSON.stringify(rows)).not.toContain(token);
				},
			);
		} finally {
			vi.restoreAllMocks();
		}
	});
});
