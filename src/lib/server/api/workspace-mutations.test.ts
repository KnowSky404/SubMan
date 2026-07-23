import { describe, expect, it } from "bun:test";
import {
	handleBrowserWorkspaceMutation,
	type WorkspaceCoordinatorNamespace,
} from "$lib/server/api/workspace-mutations";
import type { WorkspaceCoordinatorRpcResponse } from "$lib/server/workspace-coordinator";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";

const TOKEN = "browser-github-token";
const WORKSPACE_ID = "gist:gist-1";

function document(revision = 2): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision,
		updatedAt: "2026-07-22T12:00:00.000Z",
		lastMutationId: "90000000-0000-4000-8000-000000000001",
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
}

function mutation(
	overrides: Partial<WorkspaceMutation> = {},
): WorkspaceMutation {
	return {
		mutationId: "90000000-0000-4000-8000-000000000001",
		workspaceId: WORKSPACE_ID,
		expectedRevision: 1,
		source: "browser",
		createdAt: "2026-07-22T11:00:00.000Z",
		kind: "node.delete",
		payload: { id: "node-1" },
		...overrides,
	} as WorkspaceMutation;
}

function request(body: unknown, token = TOKEN): Request {
	return new Request("https://subman.example/api/workspaces/mutations", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

function namespaceReturning(
	response: WorkspaceCoordinatorRpcResponse,
	calls: Array<{ name: string; command: unknown; token: string }> = [],
): WorkspaceCoordinatorNamespace {
	return {
		getByName(name) {
			return {
				async mutate(command, token) {
					calls.push({ name, command, token });
					return response;
				},
			};
		},
	};
}

describe("browser workspace mutation endpoint", () => {
	it("routes a validated mutation by workspace and keeps the token separate", async () => {
		const calls: Array<{ name: string; command: unknown; token: string }> = [];
		const parsedMutation = mutation();
		const result = {
			document: document(),
			mutationId: parsedMutation.mutationId,
			workspaceId: WORKSPACE_ID,
			committedRevision: 2,
			committedAt: "2026-07-22T12:00:00.000Z",
			receipt: {
				kind: "node.delete" as const,
				entityId: "node-1",
				deleted: true as const,
			},
			status: "committed" as const,
		};
		const response = await handleBrowserWorkspaceMutation(
			request(parsedMutation),
			"gist%3Agist-1",
			namespaceReturning({ ok: true, result }, calls),
		);

		expect(response.status).toBe(200);
		const responseText = await response.text();
		expect(JSON.parse(responseText)).toEqual(result);
		expect(calls).toEqual([
			{
				name: WORKSPACE_ID,
				command: { gistId: "gist-1", mutation: parsedMutation },
				token: TOKEN,
			},
		]);
		expect(responseText).not.toContain(TOKEN);
	});

	it("returns the latest safe document for revision conflicts", async () => {
		const latest = document(3);
		const response = await handleBrowserWorkspaceMutation(
			request(mutation()),
			WORKSPACE_ID,
			namespaceReturning({
				ok: false,
				error: {
					code: "revision_conflict",
					message: "Workspace revision changed",
					document: latest,
					revision: latest.revision,
				},
			}),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: "revision_conflict",
				message: "Workspace revision changed",
			},
			document: latest,
			revision: 3,
		});
	});

	it("rejects missing credentials, workspace mismatches, and server mutations", async () => {
		const unused = namespaceReturning({
			ok: false,
			error: { code: "server_error", message: "must not be called" },
		});
		const unauthorized = await handleBrowserWorkspaceMutation(
			request(mutation(), ""),
			WORKSPACE_ID,
			unused,
		);
		expect(unauthorized.status).toBe(401);

		const mismatch = await handleBrowserWorkspaceMutation(
			request(mutation({ workspaceId: "gist:other" })),
			WORKSPACE_ID,
			unused,
		);
		expect(mismatch.status).toBe(400);
		expect(await mismatch.json()).toEqual({
			error: {
				code: "invalid_mutation",
				message: "Mutation workspace does not match the route",
			},
		});

		const wrongSource = await handleBrowserWorkspaceMutation(
			request(mutation({ source: "server-api" })),
			WORKSPACE_ID,
			unused,
		);
		expect(wrongSource.status).toBe(400);
	});

	it("maps stable coordinator failures to public HTTP statuses", async () => {
		for (const [code, status] of [
			["workspace_not_found", 404],
			["output_file_conflict", 409],
			["unsupported_schema", 422],
			["gist_read_failed", 502],
		] as const) {
			const response = await handleBrowserWorkspaceMutation(
				request(mutation()),
				WORKSPACE_ID,
				namespaceReturning({ ok: false, error: { code, message: code } }),
			);
			expect(response.status).toBe(status);
			expect(await response.json()).toEqual({
				error: { code, message: code },
			});
		}
	});
});
