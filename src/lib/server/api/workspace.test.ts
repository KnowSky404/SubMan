import { describe, expect, it } from "bun:test";
import type { GistMeta } from "$lib/models";
import {
	createServerMutationIdentity,
	loadServerWorkspace,
	submitServerWorkspaceMutation,
} from "$lib/server/api/workspace";
import type { WorkspaceCoordinatorNamespace } from "$lib/server/api/workspace-mutations";
import {
	createDefaultWorkspaceState,
	serializeWorkspaceState,
} from "$lib/workspace-data";
import {
	serializeWorkspaceDocumentV2,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";

const TOKEN = "server-github-token";

function gist(id = "gist-1", fileName = "subman.json"): GistMeta {
	return {
		id,
		description: "SubMan-Data",
		files: [{ filename: fileName, language: "JSON", size: 10 }],
		updatedAt: "2026-07-22T00:00:00.000Z",
		url: `https://gist.github.com/${id}`,
	};
}

function document(revision = 4): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: "gist:gist-1",
		revision,
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
	};
}

function mutation(): WorkspaceMutation {
	return {
		mutationId: "a0000000-0000-4000-8000-000000000001",
		workspaceId: "gist:gist-1",
		expectedRevision: 4,
		source: "server-api",
		createdAt: "2026-07-22T11:00:00.000Z",
		kind: "node.delete",
		payload: { id: "node-1" },
	};
}

describe("loadServerWorkspace", () => {
	it("loads legacy V1 data at revision zero for coordinator migration", async () => {
		const state = createDefaultWorkspaceState();
		state.nodes = document().data.nodes;
		const result = await loadServerWorkspace(TOKEN, {
			ensureWorkspace: async () => ({ gist: gist(), created: false }),
			getFileContent: async () => serializeWorkspaceState(state),
		});

		expect(result.revision).toBe(0);
		expect(result.data.nodes[0]?.id).toBe("node-1");
	});

	it("loads a V2 workspace revision and business data", async () => {
		const result = await loadServerWorkspace(TOKEN, {
			ensureWorkspace: async () => ({ gist: gist(), created: false }),
			getFileContent: async () => serializeWorkspaceDocumentV2(document()),
		});

		expect(result.workspaceId).toBe("gist:gist-1");
		expect(result.revision).toBe(4);
		expect(result.data.nodes[0]?.id).toBe("node-1");
	});

	it("treats a bootstrap workspace as an empty revision zero document", async () => {
		const result = await loadServerWorkspace(TOKEN, {
			ensureWorkspace: async () => ({
				gist: gist("gist-1", "subman.bootstrap.json"),
				created: true,
			}),
			getFileContent: async () => {
				throw new Error("bootstrap must not read subman.json");
			},
		});

		expect(result.revision).toBe(0);
		expect(result.data.nodes).toEqual([]);
	});

	it("sanitizes workspace discovery failures before route logging", async () => {
		let failure: unknown;
		try {
			await loadServerWorkspace(TOKEN, {
				ensureWorkspace: async () => {
					throw new Error(`upstream echoed ${TOKEN}`);
				},
			});
		} catch (error) {
			failure = error;
		}

		expect((failure as { status?: number }).status).toBe(502);
		expect((failure as { code?: string }).code).toBe("gist_read_failed");
		expect((failure as { message?: string }).message).not.toContain(TOKEN);
	});
});

describe("Server API coordinator submission", () => {
	it("builds server-owned mutation identity from the latest revision", () => {
		const identity = createServerMutationIdentity(
			{
				gist: gist(),
				workspaceId: "gist:gist-1",
				revision: 4,
				data: document().data,
			},
			{
				id: () => "a0000000-0000-4000-8000-000000000001",
				now: () => "2026-07-22T11:00:00.000Z",
			},
		);

		expect(identity).toEqual({
			mutationId: "a0000000-0000-4000-8000-000000000001",
			workspaceId: "gist:gist-1",
			expectedRevision: 4,
			source: "server-api",
			createdAt: "2026-07-22T11:00:00.000Z",
		});
	});

	it("routes the token separately and returns the committed result", async () => {
		const calls: unknown[] = [];
		const committed = document(5);
		const namespace: WorkspaceCoordinatorNamespace = {
			getByName(name) {
				return {
					async mutate(command, token) {
						calls.push({ name, command, token });
						return {
							ok: true,
							result: {
								document: committed,
								mutationId: mutation().mutationId,
								workspaceId: committed.workspaceId,
								committedRevision: committed.revision,
								committedAt: committed.updatedAt,
								receipt: {
									kind: "node.delete",
									entityId: "node-1",
									deleted: true,
								},
								status: "committed",
							},
						};
					},
				};
			},
		};

		const result = await submitServerWorkspaceMutation(
			namespace,
			TOKEN,
			gist(),
			mutation(),
		);

		expect(result.document.revision).toBe(5);
		expect(calls).toEqual([
			{
				name: "gist:gist-1",
				command: { gistId: "gist-1", mutation: mutation() },
				token: TOKEN,
			},
		]);
		expect(JSON.stringify(result)).not.toContain(TOKEN);
	});

	it("maps coordinator conflicts to the Server API error contract", async () => {
		const namespace: WorkspaceCoordinatorNamespace = {
			getByName() {
				return {
					async mutate() {
						return {
							ok: false,
							error: {
								code: "revision_conflict",
								message: "Workspace revision changed",
								document: document(5),
								revision: 5,
							},
						};
					},
				};
			},
		};

		let failure: unknown;
		try {
			await submitServerWorkspaceMutation(namespace, TOKEN, gist(), mutation());
		} catch (error) {
			failure = error;
		}
		expect((failure as { status?: number }).status).toBe(409);
		expect((failure as { code?: string }).code).toBe("revision_conflict");
	});
});
