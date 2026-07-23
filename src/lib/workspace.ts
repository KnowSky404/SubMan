import { createGist, getGist, getGistFileContent, listGists } from "$lib/gist";
import type { GistMeta } from "$lib/models";
import { WORKSPACE_DESCRIPTION, WORKSPACE_FILE } from "$lib/workspace-data";
import {
	createWorkspaceBootstrapContent,
	isValidWorkspaceBootstrapMarker,
	parseWorkspaceDocument,
	WORKSPACE_BOOTSTRAP_FILE_NAME,
} from "$lib/workspace-document";
import { withWorkspaceLock } from "$lib/workspace-lock";

export { WORKSPACE_DESCRIPTION, WORKSPACE_FILE } from "$lib/workspace-data";
export {
	createWorkspaceBootstrapContent,
	isValidWorkspaceBootstrapMarker,
} from "$lib/workspace-document";

export type WorkspaceGistApi = {
	createGist: typeof createGist;
	getGist: typeof getGist;
	getGistFileContent: typeof getGistFileContent;
	listGists: typeof listGists;
};

export type WorkspaceDiscovery =
	| { status: "found"; gist: GistMeta; candidate: WorkspaceCandidate }
	| { status: "not-found"; candidates: WorkspaceCandidate[] }
	| { status: "chooser"; candidates: WorkspaceCandidate[] };

export type WorkspaceCandidateKind =
	| "materialized-v2"
	| "legacy-v1"
	| "bootstrap-incomplete"
	| "invalid";

export type WorkspaceCandidate = {
	gist: GistMeta;
	kind: WorkspaceCandidateKind;
	currentBinding: boolean;
	reason?:
		| "invalid_workspace_document"
		| "invalid_bootstrap_marker"
		| "bootstrap_has_extra_files";
};

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
			`SubMan Workspace selection is required: ${gists.map((gist) => gist.id).join(", ")}`,
		);
		this.name = "WorkspaceAmbiguousError";
		this.gists = gists;
	}
}

function hasWorkspaceDescription(gist: GistMeta): boolean {
	return gist.description === WORKSPACE_DESCRIPTION;
}

function hasFile(gist: GistMeta, fileName: string): boolean {
	return gist.files.some((file) => file.filename === fileName);
}

function hasWorkspaceIdentity(gist: GistMeta): boolean {
	return (
		hasWorkspaceDescription(gist) &&
		(hasFile(gist, WORKSPACE_FILE) ||
			hasFile(gist, WORKSPACE_BOOTSTRAP_FILE_NAME))
	);
}

export async function classifyWorkspaceCandidate(
	token: string,
	gist: GistMeta,
	options: {
		api?: WorkspaceGistApi;
		activeGistId?: string | null;
	} = {},
): Promise<WorkspaceCandidate> {
	const api = options.api ?? defaultApi;
	const currentBinding = gist.id === (options.activeGistId ?? null);
	if (!hasWorkspaceIdentity(gist)) {
		return {
			gist,
			kind: "invalid",
			currentBinding,
			reason: "invalid_workspace_document",
		};
	}
	if (hasFile(gist, WORKSPACE_FILE)) {
		try {
			const parsed = parseWorkspaceDocument(
				await api.getGistFileContent(token, gist.id, WORKSPACE_FILE),
				{ expectedWorkspaceId: `gist:${gist.id}` },
			);
			if (hasFile(gist, WORKSPACE_BOOTSTRAP_FILE_NAME)) {
				const marker = await api.getGistFileContent(
					token,
					gist.id,
					WORKSPACE_BOOTSTRAP_FILE_NAME,
				);
				if (!isValidWorkspaceBootstrapMarker(marker)) {
					return {
						gist,
						kind: "invalid",
						currentBinding,
						reason: "invalid_bootstrap_marker",
					};
				}
			}
			return {
				gist,
				kind: parsed.schemaVersion === 2 ? "materialized-v2" : "legacy-v1",
				currentBinding,
			};
		} catch {
			return {
				gist,
				kind: "invalid",
				currentBinding,
				reason: "invalid_workspace_document",
			};
		}
	}
	if (gist.files.length !== 1) {
		return {
			gist,
			kind: "invalid",
			currentBinding,
			reason: "bootstrap_has_extra_files",
		};
	}
	try {
		const valid = isValidWorkspaceBootstrapMarker(
			await api.getGistFileContent(
				token,
				gist.id,
				WORKSPACE_BOOTSTRAP_FILE_NAME,
			),
		);
		return valid
			? { gist, kind: "bootstrap-incomplete", currentBinding }
			: {
					gist,
					kind: "invalid",
					currentBinding,
					reason: "invalid_bootstrap_marker",
				};
	} catch {
		return {
			gist,
			kind: "invalid",
			currentBinding,
			reason: "invalid_bootstrap_marker",
		};
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
			const candidate = await classifyWorkspaceCandidate(token, saved, {
				api,
				activeGistId,
			});
			if (candidate.kind !== "invalid") {
				return { status: "found", gist: saved, candidate };
			}
		} catch {
			// Fall through to a complete discovery when the saved identity is stale.
		}
	}

	const candidates = (await api.listGists(token)).filter(hasWorkspaceIdentity);
	const classified = await Promise.all(
		candidates.map((gist) =>
			classifyWorkspaceCandidate(token, gist, { api, activeGistId }),
		),
	);
	const materialized = classified.filter(
		(candidate) =>
			candidate.kind === "materialized-v2" || candidate.kind === "legacy-v1",
	);
	if (materialized.length === 1) {
		const candidate = materialized[0] as WorkspaceCandidate;
		return { status: "found", gist: candidate.gist, candidate };
	}
	if (materialized.length > 1) {
		return { status: "chooser", candidates: classified };
	}
	const bootstraps = classified.filter(
		(candidate) => candidate.kind === "bootstrap-incomplete",
	);
	if (bootstraps.length === 1) {
		const candidate = bootstraps[0] as WorkspaceCandidate;
		return { status: "found", gist: candidate.gist, candidate };
	}
	if (bootstraps.length > 1) {
		return { status: "chooser", candidates: classified };
	}
	if (classified.length > 0) {
		return { status: "chooser", candidates: classified };
	}
	return { status: "not-found", candidates: classified };
}

export async function findWorkspaceGist(
	token: string,
	activeGistId: string | null = null,
): Promise<GistMeta | null> {
	const result = await discoverWorkspaceGist(token, activeGistId);
	if (result.status === "chooser") {
		throw new WorkspaceAmbiguousError(
			result.candidates.map((candidate) => candidate.gist),
		);
	}
	return result.status === "found" ? result.gist : null;
}

export async function ensureWorkspaceBootstrapGist(
	token: string,
	options: {
		activeGistId?: string | null;
		api?: WorkspaceGistApi;
		now?: () => string;
		nonce?: () => string;
	} = {},
): Promise<{ gist: GistMeta; created: boolean }> {
	return ensureWorkspaceWithFiles(
		token,
		{
			[WORKSPACE_BOOTSTRAP_FILE_NAME]: {
				content: createWorkspaceBootstrapContent(
					(options.now ?? (() => new Date().toISOString()))(),
					options.nonce ? options.nonce() : crypto.randomUUID(),
				),
			},
		},
		options,
	);
}

async function ensureWorkspaceWithFiles(
	token: string,
	files: Record<string, { content: string }>,
	options: { activeGistId?: string | null; api?: WorkspaceGistApi },
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
		if (discovery.status === "chooser") {
			throw new WorkspaceAmbiguousError(
				discovery.candidates.map((candidate) => candidate.gist),
			);
		}

		const gist = await api.createGist(token, {
			description: WORKSPACE_DESCRIPTION,
			isPublic: false,
			files,
		});
		return { gist, created: true };
	});
}
