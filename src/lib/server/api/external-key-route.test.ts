import * as bunTest from "bun:test";
import type { NodeItem } from "$lib/models";
import {
	serializeWorkspaceDocumentV2,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import {
	applyWorkspaceMutation,
	WorkspaceMutationError,
} from "$lib/workspace-mutation";
import type { WorkspaceCoordinatorNamespace } from "./workspace-mutations";

const { describe, expect, test } = bunTest;
const bun = bunTest as unknown as {
	mock: { module: (specifier: string, factory: () => unknown) => void };
};
bun.mock.module("$env/dynamic/private", () => ({ env: {} }));

type NodeResponse = { data: NodeItem; workspace: { revision: number } };
const { PUT } = await import(
	"../../../routes/api/nodes/by-key/[externalKey]/+server"
);

async function withWorkspace(
	run: (
		put: (key: string, tags?: string[]) => Promise<Response>,
	) => Promise<void>,
) {
	const gistId = "external-key-fixture";
	let document: WorkspaceDocumentV2 = {
		version: 2,
		schemaVersion: 2,
		workspaceId: `gist:${gistId}`,
		revision: 1,
		updatedAt: "2026-07-22T10:00:00.000Z",
		lastMutationId: null,
		data: {
			nodes: [],
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
	};
	const namespace: WorkspaceCoordinatorNamespace = {
		getByName() {
			return {
				async mutate({ mutation }) {
					try {
						const applied = applyWorkspaceMutation(document, mutation, {
							gist: { id: gistId, files: [] },
							committedAt: mutation.createdAt,
						});
						document = applied.document;
						return {
							ok: true,
							result: {
								document,
								mutationId: mutation.mutationId,
								workspaceId: document.workspaceId,
								committedRevision: document.revision,
								committedAt: document.updatedAt,
								receipt: applied.receipt,
								status: "committed",
							},
						};
					} catch (error) {
						if (!(error instanceof WorkspaceMutationError)) throw error;
						return {
							ok: false,
							error: { code: error.code, message: error.message },
						};
					}
				},
			};
		},
	};
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const content = serializeWorkspaceDocumentV2(document);
		const gist = {
			id: gistId,
			description: "SubMan-Data",
			updated_at: document.updatedAt,
			html_url: `https://gist.github.com/${gistId}`,
			files: {
				"subman.json": {
					filename: "subman.json",
					content,
					size: content.length,
					truncated: false,
				},
			},
		};
		if (String(input) === "https://api.github.com/gists?per_page=100&page=1")
			return Response.json([gist]);
		if (String(input) === `https://api.github.com/gists/${gistId}`)
			return Response.json(gist);
		throw new Error("Unexpected outbound request");
	}) as typeof fetch;
	try {
		await run((key, tags = []) =>
			PUT({
				request: new Request(
					`https://subman.example/api/nodes/by-key/${encodeURIComponent(key)}`,
					{
						method: "PUT",
						headers: {
							Authorization: "Bearer fixture-api-token",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							name: "Fixture",
							type: "vless",
							raw: `vless://fixture#${encodeURIComponent(key)}`,
							tags,
						}),
					},
				),
				platform: {
					env: {
						GITHUB_TOKEN: "fixture-github-token",
						SUBMAN_API_TOKEN: "fixture-api-token",
						WORKSPACE_COORDINATOR: namespace,
					},
				} as unknown as App.Platform,
				params: { externalKey: key },
			}),
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

describe("public external-key route", () => {
	for (const key of ["vps-100%", "vps%2Fregion"]) {
		test(`preserves the framework-decoded key ${key} across updates`, async () => {
			await withWorkspace(async (put) => {
				const first = await put(key);
				expect(first.status).toBe(200);
				const created = (await first.json()) as NodeResponse;
				expect(created.data.tags.map((tag) => tag.label)).toEqual([
					`external:${key}`,
				]);
				const second = await put(key);
				expect(second.status).toBe(200);
				const updated = (await second.json()) as NodeResponse;
				expect(updated.data.id).toBe(created.data.id);
				expect(updated.workspace.revision).toBe(created.workspace.revision + 1);
			});
		});
	}

	test("counts the generated external tag in UTF-8 and tag limits", async () => {
		await withWorkspace(async (put) => {
			const tags = Array.from({ length: 63 }, (_, index) => `tag-${index}`);
			const key = "a".repeat(119);
			expect((await put(key, tags)).status).toBe(200);
			for (const [invalidKey, invalidTags] of [
				["a".repeat(120), []],
				["\u00e9".repeat(60), []],
				[key, [...tags, "one-more"]],
			] as Array<[string, string[]]>) {
				const rejected = await put(invalidKey, invalidTags);
				expect(rejected.status).toBe(400);
				const body = (await rejected.json()) as {
					error: { code: string; disposition: string };
				};
				expect(body.error.code).toBe("invalid_mutation");
				expect(body.error.disposition).toBe("invalid-request");
			}
		});
	});
});
