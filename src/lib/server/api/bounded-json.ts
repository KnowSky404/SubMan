import { ApiError } from "$lib/server/api/errors";
import { WORKSPACE_LIMITS } from "$lib/workspace-limits";

function isJsonContentType(value: string | null): boolean {
	if (!value) return false;
	const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	return mediaType === "application/json" || mediaType.endsWith("+json");
}

function payloadTooLarge(limit: number): ApiError {
	return new ApiError(
		413,
		"payload_too_large",
		`JSON request body exceeds ${limit} bytes`,
	);
}

export async function readBoundedJson(
	request: Request,
	limit = WORKSPACE_LIMITS.mutationRequestBytes,
): Promise<unknown> {
	if (!Number.isSafeInteger(limit) || limit <= 0) {
		throw new Error("JSON request byte limit must be a positive safe integer");
	}
	if (!isJsonContentType(request.headers.get("Content-Type"))) {
		throw new ApiError(
			415,
			"unsupported_media_type",
			"Content-Type must be application/json",
		);
	}

	const declaredLength = Number(request.headers.get("Content-Length"));
	if (Number.isFinite(declaredLength) && declaredLength > limit) {
		throw payloadTooLarge(limit);
	}
	if (!request.body) {
		throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
	}

	const chunks: Uint8Array[] = [];
	let bytes = 0;
	const reader = request.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > limit) {
				await reader.cancel("payload too large");
				throw payloadTooLarge(limit);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
	} catch {
		throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
	}
}
