import type { WorkspaceCoordinatorRpcErrorCode } from "$lib/server/workspace-coordinator";

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
	| "server_error";

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: ApiErrorCode,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export function jsonError(error: ApiError): Response {
	return Response.json(
		{
			error: {
				code: error.code,
				message: error.message,
			},
		},
		{ status: error.status },
	);
}
