import { getBearerToken } from "$lib/server/api/auth";
import { readBoundedJson } from "$lib/server/api/bounded-json";
import { ApiError } from "$lib/server/api/errors";
import type {
	WorkspaceCoordinatorCommand,
	WorkspaceCoordinatorRpcError,
	WorkspaceCoordinatorRpcErrorCode,
	WorkspaceCoordinatorRpcResponse,
} from "$lib/server/workspace-coordinator";
import { classifyWorkspaceFailure } from "$lib/workspace-failure-disposition";
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
	code:
		| WorkspaceCoordinatorRpcErrorCode
		| "unauthorized"
		| "invalid_json"
		| "payload_too_large"
		| "unsupported_media_type",
	message: string,
	details?: Pick<
		WorkspaceCoordinatorRpcError,
		"document" | "revision" | "gateway"
	>,
): Response {
	const disposition = classifyWorkspaceFailure({
		code: details?.gateway ? undefined : code,
		status,
		hasTrustedLatestDocument: Boolean(details?.document),
	});
	const safeLatest = disposition === "state-conflict" ? details : undefined;
	return Response.json(
		{
			error: {
				code,
				message,
				disposition,
				...(details?.gateway ? { gateway: details.gateway } : {}),
			},
			...(safeLatest?.document
				? { document: safeLatest.document, revision: safeLatest.revision }
				: {}),
		},
		{ status },
	);
}

export function getWorkspaceCoordinatorErrorStatus(
	code: WorkspaceCoordinatorRpcErrorCode,
	gateway?: WorkspaceCoordinatorRpcError["gateway"],
): number {
	if (gateway) {
		switch (gateway.category) {
			case "authentication":
				return 401;
			case "authorization":
				return 403;
			case "not-found":
				return 404;
			case "conflict":
				return 409;
			case "validation":
				return 422;
			case "rate-limit":
				return 429;
			case "timeout":
				return 504;
			case "http":
				return gateway.status !== null &&
					gateway.status >= 400 &&
					gateway.status < 500
					? gateway.status
					: 502;
			default:
				return 502;
		}
	}
	switch (code) {
		case "invalid_mutation":
		case "invalid_workspace_document":
		case "invalid_bootstrap_marker":
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
		case "output_file_conflict":
			return 409;
		case "unsupported_schema":
			return 422;
		case "gist_read_failed":
		case "gist_write_failed":
		case "write_verification_failed":
		case "invalid_gateway_response":
			return 502;
		case "commit_index_failed":
		case "invalid_journal_record":
		case "server_error":
			return 500;
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
		body = await readBoundedJson(request);
	} catch (error) {
		if (
			error instanceof ApiError &&
			(error.code === "invalid_json" ||
				error.code === "payload_too_large" ||
				error.code === "unsupported_media_type")
		) {
			return errorResponse(error.status, error.code, error.message);
		}
		return errorResponse(
			400,
			"invalid_json",
			"Request body must be valid JSON",
		);
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
		getWorkspaceCoordinatorErrorStatus(
			response.error.code,
			response.error.gateway,
		),
		response.error.code,
		response.error.message,
		response.error,
	);
}
