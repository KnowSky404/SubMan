export type ApiErrorCode =
	| "bad_request"
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
