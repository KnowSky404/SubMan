import type { WorkspaceCoordinatorRpcErrorCode } from "$lib/server/workspace-coordinator";
import type { GitHubGatewayErrorMetadata } from "$lib/server/workspace-gist";
import { classifyWorkspaceFailure } from "$lib/workspace-failure-disposition";

export type ApiErrorCode =
	| WorkspaceCoordinatorRpcErrorCode
	| "bad_request"
	| "invalid_json"
	| "payload_too_large"
	| "unsupported_media_type"
	| "unauthorized"
	| "duplicate_node_raw"
	| "not_found"
	| "method_not_allowed"
	| "precondition_failed"
	| "server_error";

export type ApiErrorDetails = {
	gateway?: GitHubGatewayErrorMetadata;
	revision?: number;
};

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: ApiErrorCode,
		message: string,
		public readonly details: ApiErrorDetails = {},
	) {
		super(message);
		this.name = "ApiError";
	}
}

export function jsonError(error: ApiError): Response {
	const disposition = classifyWorkspaceFailure({
		code: error.details.gateway ? undefined : error.code,
		status: error.status,
	});
	const headers = new Headers({ "Cache-Control": "no-store" });
	if (
		error.details.gateway?.retryAfter !== null &&
		error.details.gateway?.retryAfter !== undefined
	) {
		headers.set("Retry-After", String(error.details.gateway.retryAfter));
	}
	return Response.json(
		{
			error: {
				code: error.code,
				message: error.message,
				disposition,
				...(error.details.gateway ? { gateway: error.details.gateway } : {}),
			},
			...(error.details.revision !== undefined
				? { workspace: { revision: error.details.revision } }
				: {}),
		},
		{ status: error.status, headers },
	);
}
