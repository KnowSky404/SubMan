import { toStableGistRawUrl } from "$lib/gist-raw-url";
import type { WorkspaceCoordinatorGateway } from "$lib/server/workspace-coordinator-core";

const API_ROOT = "https://api.github.com";
const USER_AGENT = "SubMan";

type GistApiFile = {
	filename: string;
	language: string | null;
	size: number;
	truncated?: boolean;
	content?: string;
	raw_url?: string;
};

type GistApiResponse = {
	id: string;
	owner?: { login?: string } | null;
	files: Record<string, GistApiFile>;
};

function githubHeaders(
	githubToken: string,
	extra: Record<string, string> = {},
): HeadersInit {
	return {
		Authorization: `Bearer ${githubToken}`,
		Accept: "application/vnd.github+json",
		"User-Agent": USER_AGENT,
		...extra,
	};
}

function githubFailure(response: Response, operation: string): Error {
	return new Error(
		`${operation}: ${response.status} ${response.statusText || "GitHub request failed"}`,
	);
}

async function loadFileContent(
	githubToken: string,
	file: GistApiFile,
	fetchImpl: typeof fetch,
): Promise<string> {
	if (!file.truncated && file.content !== undefined) return file.content;
	if (!file.raw_url) {
		throw new Error(`GitHub Gist content is unavailable for ${file.filename}`);
	}
	const response = await fetchImpl(file.raw_url, {
		headers: githubHeaders(githubToken, { Accept: "text/plain" }),
	});
	if (!response.ok) throw githubFailure(response, "Failed to fetch Gist file");
	return response.text();
}

export function createWorkspaceGistGateway(
	fetchImpl: typeof fetch = fetch,
): WorkspaceCoordinatorGateway {
	return {
		async read(githubToken, gistId, requiredFiles = []) {
			const response = await fetchImpl(
				`${API_ROOT}/gists/${encodeURIComponent(gistId)}`,
				{ headers: githubHeaders(githubToken) },
			);
			if (!response.ok) throw githubFailure(response, "Failed to fetch Gist");
			const gist = (await response.json()) as GistApiResponse;
			const files = Object.values(gist.files);
			const requested = new Set(requiredFiles);
			const contents = Object.fromEntries(
				await Promise.all(
					files
						.filter(
							(file) => requested.size === 0 || requested.has(file.filename),
						)
						.map(async (file) => [
							file.filename,
							await loadFileContent(githubToken, file, fetchImpl),
						]),
				),
			);
			return {
				gist: {
					id: gist.id,
					...(gist.owner?.login ? { ownerLogin: gist.owner.login } : {}),
					files: files.map((file) => ({
						filename: file.filename,
						language: file.language,
						size: file.size,
						...(file.raw_url
							? { rawUrl: toStableGistRawUrl(file.raw_url) }
							: {}),
					})),
				},
				contents,
			};
		},

		async patch(githubToken, gistId, files) {
			const response = await fetchImpl(
				`${API_ROOT}/gists/${encodeURIComponent(gistId)}`,
				{
					method: "PATCH",
					headers: githubHeaders(githubToken, {
						"Content-Type": "application/json",
					}),
					body: JSON.stringify({ files }),
				},
			);
			if (!response.ok) throw githubFailure(response, "Failed to update Gist");
		},
	};
}
