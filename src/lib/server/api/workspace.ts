import type { AppState, GistMeta } from "../../models";
import { createGist, getGistFileContent, listGists, updateGist } from "../../gist";

const EXPORT_VERSION = 1;
const WORKSPACE_DESCRIPTION = "SubMan-Data";
const WORKSPACE_FILE = "subman.json";

const defaultState: AppState = {
	nodes: [],
	subscriptions: [],
	aggregates: [],
	publishTargets: [],
	clientExports: [],
	gists: [],
	activeGistId: null,
	activeGistFile: WORKSPACE_FILE,
	lastUpdated: new Date(0).toISOString(),
};

export type WorkspaceState = {
	gist: GistMeta;
	state: AppState;
};

export function readStateFromWorkspaceContent(content: string): AppState {
	if (!content.trim()) {
		return defaultState;
	}

	const parsed = JSON.parse(content) as {
		version?: number;
		data?: AppState;
	};

	if (!parsed?.data) {
		throw new Error("Invalid export payload");
	}

	return { ...defaultState, ...parsed.data };
}

function exportServerSyncState(state: AppState): string {
	return JSON.stringify(
		{
			version: EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				...defaultState,
				nodes: state.nodes,
				subscriptions: state.subscriptions,
				aggregates: state.aggregates,
				publishTargets: state.publishTargets,
				clientExports: state.clientExports,
				lastUpdated: state.lastUpdated,
			},
		},
		null,
		2,
	);
}

async function ensureServerWorkspaceGist(
	token: string,
	initialContent: string,
): Promise<{ gist: GistMeta; created: boolean }> {
	const gists = await listGists(token);
	const existing = gists.find(
		(gist) =>
			gist.description === WORKSPACE_DESCRIPTION ||
			gist.files.some((file) => file.filename === WORKSPACE_FILE),
	);

	if (existing) {
		return { gist: existing, created: false };
	}

	const gist = await createGist(token, {
		description: WORKSPACE_DESCRIPTION,
		isPublic: false,
		files: {
			[WORKSPACE_FILE]: { content: initialContent },
		},
	});

	return { gist, created: true };
}

export async function loadWorkspaceState(
	githubToken: string,
): Promise<WorkspaceState> {
	const initialContent = exportServerSyncState(defaultState);
	const { gist } = await ensureServerWorkspaceGist(githubToken, initialContent);
	const content = await getGistFileContent(githubToken, gist.id, WORKSPACE_FILE);

	return {
		gist,
		state: {
			...readStateFromWorkspaceContent(content),
			activeGistId: gist.id,
			activeGistFile: WORKSPACE_FILE,
		},
	};
}

export async function saveWorkspaceState(
	githubToken: string,
	gistId: string,
	state: AppState,
): Promise<GistMeta> {
	return updateGist(githubToken, {
		gistId,
		files: {
			[WORKSPACE_FILE]: { content: exportServerSyncState(state) },
		},
	});
}
