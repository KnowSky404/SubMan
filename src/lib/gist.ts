import { collectPages } from "$lib/github-pagination";
import type { GistMeta } from "$lib/models";

const API_ROOT = "https://api.github.com";
const USER_AGENT = "SubMan";

type GistApiResponse = {
	id: string;
	owner?: { login?: string } | null;
	description: string | null;
	updated_at: string;
	html_url: string;
	files: Record<
		string,
		{
			filename: string;
			language: string | null;
			size: number;
			truncated?: boolean;
			content?: string;
			raw_url?: string;
		}
	>;
};

async function githubErrorMessage(
	res: Response,
	fallback: string,
): Promise<string> {
	const body = await res.text().catch(() => "");
	let detail = body.slice(0, 300);

	try {
		const parsed = JSON.parse(body) as { message?: string };
		detail = parsed.message ?? detail;
	} catch {
		// Use the plain response body snippet when GitHub does not return JSON.
	}

	return `${fallback}: ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ""}`;
}

function githubHeaders(
	token: string,
	headers: Record<string, string> = {},
): HeadersInit {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"User-Agent": USER_AGENT,
		...headers,
	};
}

export function toStableGistRawUrl(rawUrl?: string | null): string | undefined {
	if (!rawUrl) {
		return undefined;
	}

	try {
		const url = new URL(rawUrl);
		const segments = url.pathname.split("/").filter(Boolean);
		const rawIndex = segments.indexOf("raw");

		if (
			url.hostname !== "gist.githubusercontent.com" ||
			rawIndex < 0 ||
			segments.length <= rawIndex + 2
		) {
			return rawUrl;
		}

		url.pathname = `/${[...segments.slice(0, rawIndex + 1), ...segments.slice(rawIndex + 2)].join("/")}`;
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return rawUrl;
	}
}

function mapGist(response: GistApiResponse): GistMeta {
	return {
		id: response.id,
		ownerLogin: response.owner?.login,
		description: response.description,
		updatedAt: response.updated_at,
		url: response.html_url,
		files: Object.values(response.files).map((file) => ({
			filename: file.filename,
			language: file.language,
			size: file.size,
			rawUrl: toStableGistRawUrl(file.raw_url),
		})),
	};
}

export async function listGists(
	token: string,
	fetchImpl: typeof fetch = fetch,
): Promise<GistMeta[]> {
	const data = await collectPages<GistApiResponse>(async (page, perPage) => {
		const res = await fetchImpl(
			`${API_ROOT}/gists?per_page=${perPage}&page=${page}`,
			{ headers: githubHeaders(token) },
		);

		if (!res.ok) {
			throw new Error(await githubErrorMessage(res, "Failed to fetch gists"));
		}

		return (await res.json()) as GistApiResponse[];
	});
	return data.map(mapGist);
}

export async function getGist(
	token: string,
	gistId: string,
): Promise<GistMeta> {
	const res = await fetch(`${API_ROOT}/gists/${gistId}`, {
		headers: githubHeaders(token),
	});

	if (!res.ok) {
		throw new Error(await githubErrorMessage(res, "Failed to fetch gist"));
	}

	const data = (await res.json()) as GistApiResponse;
	return mapGist(data);
}

export async function getGistFileContent(
	token: string,
	gistId: string,
	filename: string,
): Promise<string> {
	const res = await fetch(`${API_ROOT}/gists/${gistId}`, {
		headers: githubHeaders(token),
	});

	if (!res.ok) {
		throw new Error(
			await githubErrorMessage(res, "Failed to fetch gist content"),
		);
	}

	const data = (await res.json()) as GistApiResponse;
	const file = Object.values(data.files).find(
		(item) => item.filename === filename,
	);

	if (!file) {
		throw new Error(`File not found in gist: ${filename}`);
	}

	if (file.content && !file.truncated) {
		return file.content;
	}

	if (!file.raw_url) {
		throw new Error("Gist file content unavailable");
	}

	const rawRes = await fetch(file.raw_url, {
		headers: githubHeaders(token, { Accept: "text/plain" }),
	});

	if (!rawRes.ok) {
		throw new Error(
			await githubErrorMessage(rawRes, "Failed to fetch raw gist content"),
		);
	}

	return rawRes.text();
}

export async function createGist(
	token: string,
	payload: {
		description: string;
		files: Record<string, { content: string }>;
		isPublic: boolean;
	},
): Promise<GistMeta> {
	const res = await fetch(`${API_ROOT}/gists`, {
		method: "POST",
		headers: githubHeaders(token, { "Content-Type": "application/json" }),
		body: JSON.stringify({
			description: payload.description,
			public: payload.isPublic,
			files: payload.files,
		}),
	});

	if (!res.ok) {
		throw new Error(await githubErrorMessage(res, "Failed to create gist"));
	}

	const data = (await res.json()) as GistApiResponse;
	return mapGist(data);
}

export async function updateGist(
	token: string,
	payload: {
		gistId: string;
		description?: string;
		files?: Record<string, { content: string } | null>;
	},
): Promise<GistMeta> {
	const res = await fetch(`${API_ROOT}/gists/${payload.gistId}`, {
		method: "PATCH",
		headers: githubHeaders(token, { "Content-Type": "application/json" }),
		body: JSON.stringify({
			description: payload.description,
			files: payload.files,
		}),
	});

	if (!res.ok) {
		throw new Error(await githubErrorMessage(res, "Failed to update gist"));
	}

	const data = (await res.json()) as GistApiResponse;
	return mapGist(data);
}
