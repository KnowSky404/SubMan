import { getGistFileContent } from "$lib/gist";
import type { GistMeta } from "$lib/models";
import { ApiError } from "$lib/server/api/errors";
import {
	getWorkspaceCoordinatorErrorStatus,
	type WorkspaceCoordinatorNamespace,
} from "$lib/server/api/workspace-mutations";
import type { WorkspaceCoordinatorRpcResponse } from "$lib/server/workspace-coordinator";
import type { WorkspaceCoordinatorResult } from "$lib/server/workspace-coordinator-core";
import { ensureWorkspaceBootstrapGist } from "$lib/workspace";
import {
	parseWorkspaceDocument,
	WORKSPACE_FILE_NAME,
	type WorkspaceData,
	WorkspaceDocumentError,
} from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";

export type ServerWorkspace = {
	gist: GistMeta;
	workspaceId: string;
	revision: number;
	data: WorkspaceData;
};

type ServerWorkspaceDependencies = {
	ensureWorkspace?: (
		githubToken: string,
	) => Promise<{ gist: GistMeta; created: boolean }>;
	getFileContent?: (
		githubToken: string,
		gistId: string,
		fileName: string,
	) => Promise<string>;
};

export type ServerMutationClock = {
	id: () => string;
	now: () => string;
};

const defaultClock: ServerMutationClock = {
	id: () => crypto.randomUUID(),
	now: () => new Date().toISOString(),
};

function emptyWorkspaceData(): WorkspaceData {
	return {
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
	};
}

function selectWorkspaceData(data: WorkspaceData): WorkspaceData {
	return {
		nodes: data.nodes,
		subscriptions: data.subscriptions,
		aggregates: data.aggregates,
		publishTargets: data.publishTargets,
		clientExports: data.clientExports,
	};
}

export async function loadServerWorkspace(
	githubToken: string,
	dependencies: ServerWorkspaceDependencies = {},
): Promise<ServerWorkspace> {
	try {
		const ensureWorkspace =
			dependencies.ensureWorkspace ??
			((token: string) => ensureWorkspaceBootstrapGist(token));
		const getFileContent = dependencies.getFileContent ?? getGistFileContent;
		const { gist } = await ensureWorkspace(githubToken);
		const workspaceId = `gist:${gist.id}`;
		if (!gist.files.some((file) => file.filename === WORKSPACE_FILE_NAME)) {
			return { gist, workspaceId, revision: 0, data: emptyWorkspaceData() };
		}
		const parsed = parseWorkspaceDocument(
			await getFileContent(githubToken, gist.id, WORKSPACE_FILE_NAME),
			{ expectedWorkspaceId: workspaceId },
		);
		return {
			gist,
			workspaceId,
			revision: parsed.schemaVersion === 2 ? parsed.document.revision : 0,
			data: selectWorkspaceData(parsed.document.data),
		};
	} catch (error) {
		if (error instanceof WorkspaceDocumentError) {
			throw new ApiError(
				getWorkspaceCoordinatorErrorStatus(error.code),
				error.code,
				error.message,
			);
		}
		if (error instanceof ApiError) throw error;
		throw new ApiError(
			502,
			"gist_read_failed",
			"Unable to read the workspace Gist",
		);
	}
}

export function createServerMutationIdentity(
	workspace: ServerWorkspace,
	clock: ServerMutationClock = defaultClock,
): Pick<
	WorkspaceMutation,
	"mutationId" | "workspaceId" | "expectedRevision" | "source" | "createdAt"
> {
	return {
		mutationId: clock.id(),
		workspaceId: workspace.workspaceId,
		expectedRevision: workspace.revision,
		source: "server-api",
		createdAt: clock.now(),
	};
}

export async function submitServerWorkspaceMutation(
	namespace: WorkspaceCoordinatorNamespace | undefined,
	githubToken: string,
	gist: Pick<GistMeta, "id">,
	mutation: WorkspaceMutation,
): Promise<WorkspaceCoordinatorResult> {
	if (!namespace) {
		throw new ApiError(
			500,
			"server_error",
			"Workspace coordinator is not configured",
		);
	}
	if (mutation.workspaceId !== `gist:${gist.id}`) {
		throw new ApiError(
			400,
			"invalid_mutation",
			"Mutation workspace does not match the Gist",
		);
	}

	let response: WorkspaceCoordinatorRpcResponse;
	try {
		response = await namespace
			.getByName(mutation.workspaceId)
			.mutate({ gistId: gist.id, mutation }, githubToken);
	} catch {
		throw new ApiError(500, "server_error", "Workspace mutation failed");
	}
	if (response.ok) return response.result;
	throw new ApiError(
		getWorkspaceCoordinatorErrorStatus(
			response.error.code,
			response.error.gateway,
		),
		response.error.code,
		response.error.message,
		{
			...(response.error.gateway ? { gateway: response.error.gateway } : {}),
			...(response.error.revision !== undefined
				? { revision: response.error.revision }
				: {}),
		},
	);
}
