import type { AppState, GistMeta } from "$lib/models";
import { ensureWorkspaceGist } from "$lib/workspace";
import {
	createDefaultWorkspaceState,
	parseWorkspaceState,
	serializeWorkspaceState,
	WORKSPACE_FILE,
} from "$lib/workspace-data";
import {
	readWorkspaceSnapshot,
	runWorkspaceTransaction,
	type WorkspaceTransactionInput,
	type WorkspaceTransactionResult,
} from "$lib/workspace-transaction";

export type WorkspaceState = {
	gist: GistMeta;
	state: AppState;
};

type ServerWorkspaceDependencies = {
	ensureWorkspace?: typeof ensureWorkspaceGist;
	runTransaction?: (
		input: WorkspaceTransactionInput,
	) => Promise<WorkspaceTransactionResult>;
};

export function readStateFromWorkspaceContent(content: string): AppState {
	return content.trim()
		? parseWorkspaceState(content)
		: createDefaultWorkspaceState();
}

export async function loadWorkspaceState(
	githubToken: string,
): Promise<WorkspaceState> {
	const { gist } = await ensureWorkspaceGist(
		githubToken,
		serializeWorkspaceState(createDefaultWorkspaceState()),
	);
	return readWorkspaceSnapshot(githubToken, gist.id, WORKSPACE_FILE);
}

export async function transactServerWorkspace<T>(
	githubToken: string,
	mutate: (state: AppState) => { state: AppState; value: T },
	dependencies: ServerWorkspaceDependencies = {},
): Promise<WorkspaceState & { value: T }> {
	const ensureWorkspace = dependencies.ensureWorkspace ?? ensureWorkspaceGist;
	const runTransaction = dependencies.runTransaction ?? runWorkspaceTransaction;
	const { gist } = await ensureWorkspace(
		githubToken,
		serializeWorkspaceState(createDefaultWorkspaceState()),
	);
	const mutation: { current?: { state: AppState; value: T } } = {};
	const result = await runTransaction({
		token: githubToken,
		gistId: gist.id,
		fileName: WORKSPACE_FILE,
		mutate: (state) => {
			mutation.current = mutate(state);
			return mutation.current.state;
		},
	});
	if (!mutation.current) {
		throw new Error("Server workspace mutation was not applied");
	}
	return {
		gist: result.gist,
		state: result.state,
		value: mutation.current.value,
	};
}
