import { createGist, getGist, getGistFileContent, listGists } from "$lib/gist";
import type { GistMeta } from "$lib/models";
import {
	parseWorkspaceState,
	WORKSPACE_DESCRIPTION,
	WORKSPACE_FILE,
} from "$lib/workspace-data";
import { withWorkspaceLock } from "$lib/workspace-lock";

export { WORKSPACE_DESCRIPTION, WORKSPACE_FILE } from "$lib/workspace-data";

export type WorkspaceGistApi = {
	createGist: typeof createGist;
	getGist: typeof getGist;
	getGistFileContent: typeof getGistFileContent;
	listGists: typeof listGists;
};

export type WorkspaceDiscovery =
	| { status: "found"; gist: GistMeta }
	| { status: "not-found" }
	| { status: "ambiguous"; gists: GistMeta[] };

const defaultApi: WorkspaceGistApi = {
	createGist,
	getGist,
	getGistFileContent,
	listGists,
};

export class WorkspaceAmbiguousError extends Error {
	readonly gists: GistMeta[];

	constructor(gists: GistMeta[]) {
		super(
			`Multiple valid SubMan workspaces found: ${gists.map((gist) => gist.id).join(", ")}`,
		);
		this.name = "WorkspaceAmbiguousError";
		this.gists = gists;
	}
}

function hasWorkspaceIdentity(gist: GistMeta): boolean {
	return (
		gist.description === WORKSPACE_DESCRIPTION &&
		gist.files.some((file) => file.filename === WORKSPACE_FILE)
	);
}

async function isValidWorkspace(
	token: string,
	gist: GistMeta,
	api: WorkspaceGistApi,
): Promise<boolean> {
	if (!hasWorkspaceIdentity(gist)) return false;
	try {
		parseWorkspaceState(
			await api.getGistFileContent(token, gist.id, WORKSPACE_FILE),
		);
		return true;
	} catch {
		return false;
	}
}

export async function discoverWorkspaceGist(
	token: string,
	activeGistId: string | null = null,
	options: { api?: WorkspaceGistApi } = {},
): Promise<WorkspaceDiscovery> {
	const api = options.api ?? defaultApi;

	if (activeGistId) {
		try {
			const saved = await api.getGist(token, activeGistId);
			if (await isValidWorkspace(token, saved, api)) {
				return { status: "found", gist: saved };
			}
		} catch {
			// Fall through to a complete discovery when the saved identity is stale.
		}
	}

	const candidates = (await api.listGists(token)).filter(hasWorkspaceIdentity);
	const validation = await Promise.all(
		candidates.map(async (gist) => ({
			gist,
			valid: await isValidWorkspace(token, gist, api),
		})),
	);
	const valid = validation
		.filter((item) => item.valid)
		.map((item) => item.gist);

	if (valid.length === 0) return { status: "not-found" };
	if (valid.length === 1)
		return { status: "found", gist: valid[0] as GistMeta };
	return { status: "ambiguous", gists: valid };
}

export async function findWorkspaceGist(
	token: string,
	activeGistId: string | null = null,
): Promise<GistMeta | null> {
	const result = await discoverWorkspaceGist(token, activeGistId);
	if (result.status === "ambiguous") {
		throw new WorkspaceAmbiguousError(result.gists);
	}
	return result.status === "found" ? result.gist : null;
}

export async function ensureWorkspaceGist(
	token: string,
	initialContent: string,
	options: { activeGistId?: string | null; api?: WorkspaceGistApi } = {},
): Promise<{ gist: GistMeta; created: boolean }> {
	const api = options.api ?? defaultApi;
	return withWorkspaceLock("subman:workspace:create", async () => {
		const discovery = await discoverWorkspaceGist(
			token,
			options.activeGistId ?? null,
			{ api },
		);
		if (discovery.status === "found") {
			return { gist: discovery.gist, created: false };
		}
		if (discovery.status === "ambiguous") {
			throw new WorkspaceAmbiguousError(discovery.gists);
		}

		const gist = await api.createGist(token, {
			description: WORKSPACE_DESCRIPTION,
			isPublic: false,
			files: { [WORKSPACE_FILE]: { content: initialContent } },
		});
		return { gist, created: true };
	});
}
