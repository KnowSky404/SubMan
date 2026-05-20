import { isAuthorized } from "./auth";
import { getServerApiEnv } from "./env";
import { ApiError, jsonError } from "./errors";

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

	return jsonError(new ApiError(500, "server_error", "Internal server error"));
}
