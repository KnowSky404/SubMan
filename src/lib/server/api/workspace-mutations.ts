import { getBearerToken } from "$lib/server/api/auth";
import type {
	WorkspaceCoordinatorCommand,
	WorkspaceCoordinatorRpcError,
	WorkspaceCoordinatorRpcErrorCode,
	WorkspaceCoordinatorRpcResponse,
} from "$lib/server/workspace-coordinator";
import {
	parseWorkspaceMutation,
	type WorkspaceMutation,
	WorkspaceMutationError,
} from "$lib/workspace-mutation";

type WorkspaceCoordinatorStub = {
	mutate: (
		command: WorkspaceCoordinatorCommand,
		githubToken: string,
	) => Promise<WorkspaceCoordinatorRpcResponse>;
};

export type WorkspaceCoordinatorNamespace = {
	getByName: (name: string) => WorkspaceCoordinatorStub;
};

function errorResponse(
	status: number,
	code: WorkspaceCoordinatorRpcErrorCode | "unauthorized" | "invalid_mutation",
	message: string,
	latest?: Pick<WorkspaceCoordinatorRpcError, "document" | "revision">,
): Response {
	return Response.json(
		{
			error: { code, message },
			...(latest?.document
				? { document: latest.document, revision: latest.revision }
				: {}),
		},
		{ status },
	);
}

function statusForCoordinatorError(
	code: WorkspaceCoordinatorRpcErrorCode,
): number {
	switch (code) {
		case "invalid_mutation":
		case "invalid_workspace_document":
			return 400;
		case "workspace_not_found":
		case "entity_not_found":
			return 404;
		case "revision_conflict":
		case "entity_deleted":
		case "entity_exists":
		case "workspace_mismatch":
		case "migration_backup_conflict":
		case "mutation_id_reused":
		case "mutation_recovery_failed":
		case "duplicate_node_raw":
		case "duplicate_subscription_url":
		case "publication_file_mismatch":
			return 409;
		case "unsupported_schema":
			return 422;
		case "gist_read_failed":
		case "gist_write_failed":
		case "write_verification_failed":
		case "invalid_gateway_response":
			return 502;
		default:
			return 500;
	}
}

function parseWorkspaceId(rawWorkspaceId: string): {
	workspaceId: string;
	gistId: string;
} | null {
	let workspaceId: string;
	try {
		workspaceId = decodeURIComponent(rawWorkspaceId);
	} catch {
		return null;
	}
	if (!workspaceId.startsWith("gist:")) return null;
	const gistId = workspaceId.slice("gist:".length);
	if (!gistId || /[\s/]/.test(gistId)) return null;
	return { workspaceId, gistId };
}

export async function handleBrowserWorkspaceMutation(
	request: Request,
	rawWorkspaceId: string,
	namespace: WorkspaceCoordinatorNamespace | undefined,
): Promise<Response> {
	const githubToken = getBearerToken(request.headers.get("Authorization"));
	if (!githubToken) {
		return errorResponse(401, "unauthorized", "Unauthorized");
	}

	const identity = parseWorkspaceId(rawWorkspaceId);
	if (!identity) {
		return errorResponse(400, "invalid_mutation", "Workspace ID is invalid");
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return errorResponse(400, "invalid_mutation", "Request body must be JSON");
	}

	let mutation: WorkspaceMutation;
	try {
		mutation = parseWorkspaceMutation(body);
	} catch (error) {
		if (error instanceof WorkspaceMutationError) {
			return errorResponse(400, error.code, error.message);
		}
		return errorResponse(400, "invalid_mutation", "Mutation is invalid");
	}
	if (mutation.workspaceId !== identity.workspaceId) {
		return errorResponse(
			400,
			"invalid_mutation",
			"Mutation workspace does not match the route",
		);
	}
	if (mutation.source !== "browser") {
		return errorResponse(
			400,
			"invalid_mutation",
			"Browser mutations must use the browser source",
		);
	}
	if (!namespace) {
		return errorResponse(
			500,
			"server_error",
			"Workspace coordinator is not configured",
		);
	}

	let response: WorkspaceCoordinatorRpcResponse;
	try {
		response = await namespace
			.getByName(identity.workspaceId)
			.mutate({ gistId: identity.gistId, mutation }, githubToken);
	} catch {
		return errorResponse(500, "server_error", "Workspace mutation failed");
	}
	if (response.ok) return Response.json(response.result);
	return errorResponse(
		statusForCoordinatorError(response.error.code),
		response.error.code,
		response.error.message,
		response.error,
	);
}
