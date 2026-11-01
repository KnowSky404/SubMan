import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCoordinator } from "../../src/lib/server/workspace-coordinator";
import { SqlWorkspaceCoordinatorJournal } from "../../src/lib/server/workspace-coordinator-journal";
import {
	hashWorkspaceSource,
	serializeWorkspaceDocumentV2,
	type WorkspaceDocumentV2,
} from "../../src/lib/workspace-document";
import type { WorkspaceMutation } from "../../src/lib/workspace-mutation";

function cloudResetFixture(gistId: string) {
	const now = "2026-11-01T10:00:00.000Z";
	const document: WorkspaceDocumentV2 = {
		version: 2,
		schemaVersion: 2,
		workspaceId: `gist:${gistId}`,
		revision: 1,
		updatedAt: now,
		lastMutationId: null,
		data: {
			nodes: [
				{
					id: "existing-node",
					name: "Existing",
					type: "vless",
					raw: "vless://existing",
					tags: [],
					enabled: true,
					updatedAt: now,
					source: "single",
				},
			],
			subscriptions: [],
			aggregates: [
				{
					id: "existing-rule",
					name: "Existing rule",
					nodeIds: ["existing-node"],
					subscriptionIds: [],
					excludeTagIds: [],
					renameMap: {},
					allowedTypes: [],
					updatedAt: now,
				},
			],
			publishTargets: [
				{
					id: "existing-target",
					name: "Existing target",
					ruleId: "existing-rule",
					fileName: "published.txt",
					description: "",
					isPublic: false,
					lastPublishedAt: now,
					lastPublishedUrl: `https://gist.githubusercontent.com/owner/${gistId}/raw/published.txt`,
					lastPublishTransitionAt: null,
					lastPublishTransitionFromFileName: null,
					lastPublishTransitionToFileName: null,
					lastPublishTransitionOutcome: null,
					updatedAt: now,
				},
			],
			clientExports: [],
		},
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
	const files: Record<string, string> = {
		"subman.json": serializeWorkspaceDocumentV2(document),
		"subman.v1.backup.json": "immutable original backup",
		"published.txt": "published proxy output",
		"unknown.txt": "unowned file must remain",
	};
	const patches: Array<Record<string, { content: string } | null>> = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) !== `https://api.github.com/gists/${gistId}`)
				throw new Error("Unexpected outbound request");
			if (init?.method === "PATCH") {
				const patch = JSON.parse(String(init.body)) as {
					files: Record<string, { content: string } | null>;
				};
				patches.push(patch.files);
				for (const [name, file] of Object.entries(patch.files)) {
					if (file) files[name] = file.content;
					else delete files[name];
				}
				return Response.json({ ok: true });
			}
			return Response.json({
				id: gistId,
				owner: { login: "owner" },
				files: Object.fromEntries(
					Object.entries(files).map(([name, content]) => [
						name,
						{
							filename: name,
							language: "Text",
							size: content.length,
							content,
							truncated: false,
						},
					]),
				),
			});
		},
	);
	return { document, files, patches };
}

describe("WorkspaceCoordinator Durable Object", () => {
	it("resets through RPC without erasing SQLite history and rejects old reset boundaries", async () => {
		const gistId = "cloud-reset-rpc-sqlite";
		const { document, files, patches } = cloudResetFixture(gistId);
		const workspaceId = document.workspaceId;
		const token = "cloud-reset-rpc-token-must-not-persist";
		const stub = env.WORKSPACE_COORDINATOR.getByName(workspaceId);
		const beforeReset = {
			mutationId: "80000000-0000-4000-8000-000000000030",
			workspaceId,
			expectedRevision: 1,
			source: "browser",
			createdAt: document.updatedAt,
			kind: "node.upsert",
			payload: {
				operation: "replace",
				node: {
					...document.data.nodes[0],
					id: "before-reset",
					raw: "vless://before-reset",
				},
			},
		} satisfies WorkspaceMutation;
		const reset = {
			mutationId: "80000000-0000-4000-8000-000000000031",
			workspaceId,
			expectedRevision: 2,
			source: "browser",
			createdAt: document.updatedAt,
			kind: "workspace.reset",
			payload: {},
		} satisfies WorkspaceMutation;
		try {
			expect(
				(await stub.mutate({ gistId, mutation: beforeReset }, token)).ok,
			).toBe(true);
			const committed = await stub.mutate({ gistId, mutation: reset }, token);
			expect(committed).toMatchObject({
				ok: true,
				result: {
					status: "committed",
					document: {
						workspaceId,
						revision: 3,
						resetRevision: 3,
						data: {
							nodes: [],
							subscriptions: [],
							aggregates: [],
							publishTargets: [],
							clientExports: [],
						},
					},
				},
			});
			expect(patches[1]).toMatchObject({ "published.txt": null });
			expect(Object.keys(patches[1]).sort()).toEqual([
				"published.txt",
				"subman.json",
			]);
			expect(files["published.txt"]).toBeUndefined();
			expect(files["unknown.txt"]).toBe("unowned file must remain");
			expect(files["subman.v1.backup.json"]).toBe("immutable original backup");
			for (const mutation of [beforeReset, reset]) {
				expect(await stub.mutate({ gistId, mutation }, token)).toMatchObject({
					ok: true,
					result: {
						status: "already-committed",
						document: { revision: 3, resetRevision: 3, data: { nodes: [] } },
					},
				});
			}
			expect(patches).toHaveLength(2);
			const oldIntent = {
				...beforeReset,
				mutationId: "80000000-0000-4000-8000-000000000032",
				expectedRevision: 3,
				payload: {
					operation: "replace",
					node: {
						...document.data.nodes[0],
						id: "never-reached-cloud",
						raw: "vless://never-reached-cloud",
					},
				},
			} satisfies WorkspaceMutation;
			expect(
				await stub.mutate({ gistId, mutation: oldIntent }, token),
			).toMatchObject({
				ok: false,
				error: {
					code: "revision_conflict",
					revision: 3,
					document: { resetRevision: 3 },
				},
			});
			const fresh = {
				...oldIntent,
				mutationId: "80000000-0000-4000-8000-000000000033",
				expectedResetRevision: 3,
			} satisfies WorkspaceMutation;
			expect(
				await stub.mutate({ gistId, mutation: fresh }, token),
			).toMatchObject({
				ok: true,
				result: { document: { revision: 4, resetRevision: 3 } },
			});
			expect(patches).toHaveLength(3);
			await runInDurableObject(
				stub,
				async (_instance: WorkspaceCoordinator, state) => {
					const rows = state.storage.sql
						.exec<{ mutation_id: string; committed_revision: number }>(
							"SELECT mutation_id, committed_revision FROM processed_mutations ORDER BY committed_revision",
						)
						.toArray();
					expect(rows).toEqual([
						{ mutation_id: beforeReset.mutationId, committed_revision: 2 },
						{ mutation_id: reset.mutationId, committed_revision: 3 },
						{ mutation_id: fresh.mutationId, committed_revision: 4 },
					]);
					expect(
						state.storage.sql.exec("SELECT * FROM pending_mutations").toArray(),
					).toEqual([]);
					expect(
						JSON.stringify(
							state.storage.sql
								.exec("SELECT * FROM processed_mutations")
								.toArray(),
						),
					).not.toContain(token);
				},
			);
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("returns HTTP 409 instead of resetting a revision newer than the confirmed preview", async () => {
		const gistId = "cloud-reset-stale-http";
		const { document, files, patches } = cloudResetFixture(gistId);
		const workspaceId = document.workspaceId;
		const token = "cloud-reset-http-fixture-token";
		try {
			const concurrent = {
				mutationId: "80000000-0000-4000-8000-000000000034",
				workspaceId,
				expectedRevision: 1,
				source: "browser",
				createdAt: document.updatedAt,
				kind: "node.upsert",
				payload: {
					operation: "replace",
					node: {
						...document.data.nodes[0],
						id: "concurrent-node",
						raw: "vless://concurrent",
					},
				},
			} satisfies WorkspaceMutation;
			expect(
				(
					await env.WORKSPACE_COORDINATOR.getByName(workspaceId).mutate(
						{ gistId, mutation: concurrent },
						token,
					)
				).ok,
			).toBe(true);
			const staleReset = {
				mutationId: "80000000-0000-4000-8000-000000000035",
				workspaceId,
				expectedRevision: 1,
				source: "browser",
				createdAt: document.updatedAt,
				kind: "workspace.reset",
				payload: {},
			} satisfies WorkspaceMutation;
			const response = await SELF.fetch(
				`https://subman.example/api/workspaces/${encodeURIComponent(workspaceId)}/mutations`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(staleReset),
				},
			);
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({
				error: { code: "revision_conflict", disposition: "state-conflict" },
				revision: 2,
				document: { revision: 2 },
			});
			expect(
				JSON.parse(files["subman.json"]).data.nodes.map(
					(node: { id: string }) => node.id,
				),
			).toEqual(["concurrent-node", "existing-node"]);
			expect(files["published.txt"]).toBe("published proxy output");
			expect(patches).toHaveLength(1);
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("routes percent-containing external keys through the API authentication boundary", async () => {
		for (const key of ["vps-100%", "vps%2Fregion"]) {
			const response = await SELF.fetch(
				`https://subman.example/api/nodes/by-key/${encodeURIComponent(key)}`,
				{ method: "PUT" },
			);
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({
				error: { code: "unauthorized", disposition: "auth-required" },
			});
		}
	});

	it("migrates through the Worker and SQLite DO without replacing publication links or outputs", async () => {
		const gistId = "migration-worker-do";
		const workspaceId = `gist:${gistId}`;
		const now = "2026-07-22T10:00:00.000Z";
		const stableUrl = `https://gist.githubusercontent.com/owner/${gistId}/raw/old.txt`;
		const v1 = `${JSON.stringify({ version: 1, data: { nodes: [], subscriptions: [], aggregates: [{ id: "rule", name: "Old rule", nodeIds: [], subscriptionIds: [], excludeTagIds: [], renameMap: {}, updatedAt: now }], publishTargets: [{ id: "target", name: "Old target", ruleId: "rule", fileName: "old.txt", description: "", isPublic: false, lastPublishedAt: now, lastPublishedUrl: stableUrl, updatedAt: now }] } }, null, 2)}\r\n`;
		const files: Record<string, string> = {
			"subman.json": v1,
			"old.txt": "existing-output\r\n",
		};
		const patches: string[][] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input) !== `https://api.github.com/gists/${gistId}`)
					throw new Error("Unexpected outbound request");
				if (init?.method === "PATCH") {
					const patch = JSON.parse(String(init.body)) as {
						files: Record<string, { content: string } | null>;
					};
					patches.push(Object.keys(patch.files).sort());
					for (const [name, file] of Object.entries(patch.files)) {
						if (file) files[name] = file.content;
						else delete files[name];
					}
					return Response.json({ ok: true });
				}
				return Response.json({
					id: gistId,
					owner: { login: "owner" },
					files: Object.fromEntries(
						Object.entries(files).map(([name, content]) => [
							name,
							{
								filename: name,
								language: "Text",
								size: content.length,
								content,
								truncated: false,
								raw_url: `https://gist.githubusercontent.com/owner/${gistId}/raw/${name}`,
							},
						]),
					),
				});
			},
		);
		const mutation = {
			mutationId: "80000000-0000-4000-8000-000000000005",
			workspaceId,
			expectedRevision: 0,
			source: "browser",
			createdAt: now,
			kind: "workspace.migrate",
			payload: { sourceSha256: await hashWorkspaceSource(v1) },
		} satisfies WorkspaceMutation;
		const send = () =>
			SELF.fetch(
				`https://subman.example/api/workspaces/${encodeURIComponent(workspaceId)}/mutations`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer fixture-migration-token",
						"Content-Type": "application/json",
					},
					body: JSON.stringify(mutation),
				},
			);
		try {
			const first = await send();
			expect(first.status).toBe(200);
			const body = await first.json<{
				document: {
					schemaVersion: number;
					data: {
						publishTargets: Array<{
							lastPublishedUrl: string;
							lastPublishedAt: string;
							fileName: string;
						}>;
					};
				};
			}>();
			expect(body.document.schemaVersion).toBe(2);
			expect(body.document.data.publishTargets[0]).toMatchObject({
				lastPublishedUrl: stableUrl,
				lastPublishedAt: now,
				fileName: "old.txt",
			});
			expect(files["old.txt"]).toBe("existing-output\r\n");
			expect(files["subman.v1.backup.json"]).toBe(v1);
			expect(patches).toEqual([["subman.json", "subman.v1.backup.json"]]);
			expect((await send()).status).toBe(200);
			expect(patches).toHaveLength(1);
		} finally {
			vi.restoreAllMocks();
		}
	});

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

	it("serializes safe GitHub gateway metadata across Durable Object RPC", async () => {
		const gistId = "rpc-gateway-error";
		const workspaceId = `gist:${gistId}`;
		const token = "rpc-gateway-token-must-not-escape";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(`unsafe body containing ${token}`, {
				status: 429,
				headers: {
					"Retry-After": "45",
					"X-RateLimit-Reset": "1780000000",
					"X-GitHub-Request-Id": "ABCD:5678",
				},
			}),
		);
		const mutation = {
			mutationId: "80000000-0000-4000-8000-000000000020",
			workspaceId,
			expectedRevision: 0,
			source: "browser",
			createdAt: "2026-07-22T11:00:00.000Z",
			kind: "node.delete",
			payload: { id: "node-1" },
		} satisfies WorkspaceMutation;

		try {
			const response = await env.WORKSPACE_COORDINATOR.getByName(
				workspaceId,
			).mutate({ gistId, mutation }, token);

			expect(response).toEqual({
				ok: false,
				error: {
					code: "gist_read_failed",
					message: "Unable to read the workspace Gist",
					gateway: {
						operation: "gist.read",
						status: 429,
						category: "rate-limit",
						requestId: "ABCD:5678",
						retryAfter: 45,
						rateLimitReset: 1780000000,
					},
				},
			});
			expect(JSON.stringify(response)).not.toContain(token);
			expect(JSON.stringify(response)).not.toContain("unsafe body");
		} finally {
			vi.restoreAllMocks();
		}
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
				disposition: "invalid-request",
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
