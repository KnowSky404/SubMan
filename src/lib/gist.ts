import type { GistMeta } from '$lib/models';

const API_ROOT = 'https://api.github.com';

type GistApiResponse = {
	id: string;
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

function mapGist(response: GistApiResponse): GistMeta {
	return {
		id: response.id,
		description: response.description,
		updatedAt: response.updated_at,
		url: response.html_url,
		files: Object.values(response.files).map((file) => ({
			filename: file.filename,
			language: file.language,
			size: file.size,
			rawUrl: file.raw_url
		}))
	};
}

export async function listGists(token: string): Promise<GistMeta[]> {
	const res = await fetch(`${API_ROOT}/gists`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json'
		}
	});

	if (!res.ok) {
		throw new Error('Failed to fetch gists');
	}

	const data = (await res.json()) as GistApiResponse[];
	return data.map(mapGist);
}

export async function getGist(token: string, gistId: string): Promise<GistMeta> {
	const res = await fetch(`${API_ROOT}/gists/${gistId}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json'
		}
	});

	if (!res.ok) {
		throw new Error('Failed to fetch gist');
	}

	const data = (await res.json()) as GistApiResponse;
	return mapGist(data);
}

export async function getGistFileContent(
	token: string,
	gistId: string,
	filename: string
): Promise<string> {
	const res = await fetch(`${API_ROOT}/gists/${gistId}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json'
		}
	});

	if (!res.ok) {
		throw new Error('Failed to fetch gist content');
	}

	const data = (await res.json()) as GistApiResponse;
	const file = Object.values(data.files).find((item) => item.filename === filename);

	if (!file) {
		throw new Error(`File not found in gist: ${filename}`);
	}

	if (file.content && !file.truncated) {
		return file.content;
	}

	if (!file.raw_url) {
		throw new Error('Gist file content unavailable');
	}

	const rawRes = await fetch(file.raw_url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'text/plain'
		}
	});

	if (!rawRes.ok) {
		throw new Error('Failed to fetch raw gist content');
	}

	return rawRes.text();
}

export async function createGist(
	token: string,
	payload: { description: string; files: Record<string, { content: string }>; isPublic: boolean }
): Promise<GistMeta> {
	const res = await fetch(`${API_ROOT}/gists`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			description: payload.description,
			public: payload.isPublic,
			files: payload.files
		})
	});

	if (!res.ok) {
		throw new Error('Failed to create gist');
	}

	const data = (await res.json()) as GistApiResponse;
	return mapGist(data);
}

export async function updateGist(
	token: string,
	payload: { gistId: string; description?: string; files?: Record<string, { content: string }> }
): Promise<GistMeta> {
	const res = await fetch(`${API_ROOT}/gists/${payload.gistId}`, {
		method: 'PATCH',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			description: payload.description,
			files: payload.files
		})
	});

	if (!res.ok) {
		throw new Error('Failed to update gist');
	}

	const data = (await res.json()) as GistApiResponse;
	return mapGist(data);
}
