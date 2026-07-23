import { toStableGistRawUrl } from "$lib/gist-raw-url";
import type { WorkspaceCoordinatorGateway } from "$lib/server/workspace-coordinator-core";

const API_ROOT = "https://api.github.com";
const USER_AGENT = "SubMan";
const DEFAULT_TIMEOUT_MS = 15_000;

export type GitHubGatewayOperation =
	| "gist.read"
	| "gist.raw.read"
	| "gist.patch";

export type GitHubGatewayErrorCategory =
	| "authentication"
	| "authorization"
	| "not-found"
	| "conflict"
	| "validation"
	| "rate-limit"
	| "timeout"
	| "network"
	| "upstream"
	| "invalid-response"
	| "http";

export type GitHubGatewayErrorMetadata = {
	operation: GitHubGatewayOperation;
	status: number | null;
	category: GitHubGatewayErrorCategory;
	requestId: string | null;
	retryAfter: number | null;
	rateLimitReset: number | null;
};

export class GitHubGatewayError extends Error {
	readonly operation: GitHubGatewayOperation;
	readonly status: number | null;
	readonly category: GitHubGatewayErrorCategory;
	readonly requestId: string | null;
	readonly retryAfter: number | null;
	readonly rateLimitReset: number | null;

	constructor(metadata: GitHubGatewayErrorMetadata) {
		super(
			metadata.status === null
				? `GitHub ${metadata.operation} failed (${metadata.category})`
				: `GitHub ${metadata.operation} failed with status ${metadata.status} (${metadata.category})`,
		);
		this.name = "GitHubGatewayError";
		this.operation = metadata.operation;
		this.status = metadata.status;
		this.category = metadata.category;
		this.requestId = metadata.requestId;
		this.retryAfter = metadata.retryAfter;
		this.rateLimitReset = metadata.rateLimitReset;
	}

	toJSON(): GitHubGatewayErrorMetadata {
		return {
			operation: this.operation,
			status: this.status,
			category: this.category,
			requestId: this.requestId,
			retryAfter: this.retryAfter,
			rateLimitReset: this.rateLimitReset,
		};
	}
}

type WorkspaceGistGatewayOptions = {
	timeoutMs?: number;
	now?: () => number;
};

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

function categoryForStatus(status: number): GitHubGatewayErrorCategory {
	switch (status) {
		case 401:
			return "authentication";
		case 403:
			return "authorization";
		case 404:
			return "not-found";
		case 408:
			return "timeout";
		case 409:
			return "conflict";
		case 422:
			return "validation";
		case 429:
			return "rate-limit";
		default:
			return status >= 500 ? "upstream" : "http";
	}
}

function safeIntegerHeader(value: string | null): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function safeRequestId(value: string | null): string | null {
	const requestId = value?.trim() ?? "";
	return requestId.length > 0 &&
		requestId.length <= 128 &&
		/^[0-9A-Za-z._:-]+$/.test(requestId)
		? requestId
		: null;
}

function retryAfterSeconds(
	value: string | null,
	now: () => number,
): number | null {
	const seconds = safeIntegerHeader(value);
	if (seconds !== null) return seconds;
	if (!value) return null;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return null;
	return Math.max(0, Math.ceil((timestamp - now()) / 1_000));
}

function metadataFromResponse(
	operation: GitHubGatewayOperation,
	response: Response,
	now: () => number,
): GitHubGatewayErrorMetadata {
	return {
		operation,
		status: response.status,
		category: categoryForStatus(response.status),
		requestId: safeRequestId(response.headers.get("x-github-request-id")),
		retryAfter: retryAfterSeconds(response.headers.get("retry-after"), now),
		rateLimitReset: safeIntegerHeader(
			response.headers.get("x-ratelimit-reset"),
		),
	};
}

async function githubRequest<T>(
	operation: GitHubGatewayOperation,
	input: RequestInfo | URL,
	init: RequestInit,
	consume: (response: Response) => Promise<T>,
	options: Required<WorkspaceGistGatewayOptions>,
	fetchImpl: typeof fetch,
): Promise<T> {
	const controller = new AbortController();
	let timedOut = false;
	let responseReceived = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, options.timeoutMs);

	try {
		const response = await fetchImpl(input, {
			...init,
			signal: controller.signal,
		});
		responseReceived = true;
		if (!response.ok) {
			throw new GitHubGatewayError(
				metadataFromResponse(operation, response, options.now),
			);
		}
		return await consume(response);
	} catch (error) {
		if (error instanceof GitHubGatewayError) throw error;
		throw new GitHubGatewayError({
			operation,
			status: null,
			category: timedOut
				? "timeout"
				: responseReceived
					? "invalid-response"
					: "network",
			requestId: null,
			retryAfter: null,
			rateLimitReset: null,
		});
	} finally {
		clearTimeout(timer);
	}
}

async function loadFileContent(
	githubToken: string,
	file: GistApiFile,
	fetchImpl: typeof fetch,
	options: Required<WorkspaceGistGatewayOptions>,
): Promise<string> {
	if (!file.truncated && file.content !== undefined) return file.content;
	if (!file.raw_url) {
		throw new Error(`GitHub Gist content is unavailable for ${file.filename}`);
	}
	return githubRequest(
		"gist.raw.read",
		file.raw_url,
		{ headers: githubHeaders(githubToken, { Accept: "text/plain" }) },
		(response) => response.text(),
		options,
		fetchImpl,
	);
}

export function createWorkspaceGistGateway(
	fetchImpl: typeof fetch = fetch,
	configured: WorkspaceGistGatewayOptions = {},
): WorkspaceCoordinatorGateway {
	const options: Required<WorkspaceGistGatewayOptions> = {
		timeoutMs: configured.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		now: configured.now ?? Date.now,
	};
	if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
		throw new TypeError("GitHub request timeout must be a positive integer");
	}
	return {
		async read(githubToken, gistId, requiredFiles = []) {
			const gist = await githubRequest(
				"gist.read",
				`${API_ROOT}/gists/${encodeURIComponent(gistId)}`,
				{ headers: githubHeaders(githubToken) },
				(response) => response.json() as Promise<GistApiResponse>,
				options,
				fetchImpl,
			);
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
							await loadFileContent(githubToken, file, fetchImpl, options),
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
			await githubRequest(
				"gist.patch",
				`${API_ROOT}/gists/${encodeURIComponent(gistId)}`,
				{
					method: "PATCH",
					headers: githubHeaders(githubToken, {
						"Content-Type": "application/json",
					}),
					body: JSON.stringify({ files }),
				},
				async () => undefined,
				options,
				fetchImpl,
			);
		},
	};
}
