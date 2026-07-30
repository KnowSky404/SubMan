import { isAuthorized } from "./auth";
import { getServerApiEnv } from "./env";
import { ApiError, jsonError } from "./errors";

export function workspaceRevisionEtag(revision: number): string {
	return `"subman-revision-${revision}"`;
}

export function workspaceJson(
	body: unknown,
	revision: number,
	init: ResponseInit = {},
): Response {
	const headers = new Headers(init.headers);
	headers.set("Cache-Control", "no-store");
	headers.set("ETag", workspaceRevisionEtag(revision));
	headers.set("X-SubMan-Revision", String(revision));
	return Response.json(body, { ...init, headers });
}

export function assertWorkspacePrecondition(
	request: Request,
	revision: number,
): void {
	const ifMatch = request.headers.get("If-Match");
	if (ifMatch === null || ifMatch.trim() === "*") return;
	const current = workspaceRevisionEtag(revision);
	const candidates = ifMatch.split(",").map((value) => value.trim());
	if (candidates.includes(current)) return;
	throw new ApiError(
		412,
		"precondition_failed",
		"Workspace revision does not match If-Match",
		{ revision },
	);
}

export async function requireApiAccess(
	request: Request,
	platform: App.Platform | undefined,
): Promise<string> {
	const env = getServerApiEnv(platform);
	if (
		!(await isAuthorized(
			request.headers.get("Authorization"),
			env.submanApiToken,
		))
	) {
		throw new ApiError(401, "unauthorized", "Unauthorized");
	}
	if (!env.githubToken) {
		throw new ApiError(500, "server_error", "GITHUB_TOKEN is not configured");
	}
	return env.githubToken;
}

export function handleApiError(error: unknown): Response {
	if (error instanceof ApiError) {
		return jsonError(error);
	}

	console.error(
		JSON.stringify({
			message: "Unhandled server API error",
			errorType: error instanceof Error ? "error" : "unknown",
		}),
	);
	return jsonError(new ApiError(500, "server_error", "Internal server error"));
}
