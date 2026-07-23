import type { AppState } from "$lib/models";
import { WORKSPACE_FILE_NAME } from "$lib/workspace-document";
import type { WorkspaceV2LocalState } from "$lib/workspace-v2-state";

export type WorkspaceIdentityCheck =
	| { status: "local" }
	| { status: "connected"; gistId: string; workspaceId: string }
	| {
			status: "mismatch";
			appGistId: string | null;
			bindingGistId: string | null;
	  };

export function checkWorkspaceIdentity(
	state: Pick<AppState, "activeGistId" | "activeGistFile">,
	binding: WorkspaceV2LocalState | null,
): WorkspaceIdentityCheck {
	if (!binding && state.activeGistId === null) return { status: "local" };
	if (
		binding &&
		state.activeGistId === binding.gistId &&
		state.activeGistFile === WORKSPACE_FILE_NAME
	) {
		return {
			status: "connected",
			gistId: binding.gistId,
			workspaceId: binding.workspaceId,
		};
	}
	return {
		status: "mismatch",
		appGistId: state.activeGistId,
		bindingGistId: binding?.gistId ?? null,
	};
}

export function requireWorkspaceIdentity(
	state: Pick<AppState, "activeGistId" | "activeGistFile">,
	binding: WorkspaceV2LocalState | null,
): Extract<WorkspaceIdentityCheck, { status: "connected" }> {
	const result = checkWorkspaceIdentity(state, binding);
	if (result.status !== "connected") {
		throw new Error("Workspace identity requires repair");
	}
	return result;
}

export function withWorkspaceBinding(
	state: AppState,
	binding: WorkspaceV2LocalState | null,
): AppState {
	return {
		...state,
		activeGistId: binding?.gistId ?? null,
		activeGistFile: WORKSPACE_FILE_NAME,
	};
}
