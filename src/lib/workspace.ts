import type { GistMeta } from '$lib/models';
import { createGist, listGists } from '$lib/gist';

export const WORKSPACE_DESCRIPTION = 'SubMan-Data';
export const WORKSPACE_FILE = 'subman.json';

export async function findWorkspaceGist(token: string): Promise<GistMeta | null> {
	const gists = await listGists(token);
	return (
		gists.find(
			(gist) =>
				gist.description === WORKSPACE_DESCRIPTION ||
				gist.files.some((file) => file.filename === WORKSPACE_FILE)
		) ?? null
	);
}

export async function ensureWorkspaceGist(
	token: string,
	initialContent: string
): Promise<{ gist: GistMeta; created: boolean }> {
	const existing = await findWorkspaceGist(token);
	if (existing) {
		return { gist: existing, created: false };
	}

	const created = await createGist(token, {
		description: WORKSPACE_DESCRIPTION,
		isPublic: false,
		files: {
			[WORKSPACE_FILE]: { content: initialContent }
		}
	});

	return { gist: created, created: true };
}
