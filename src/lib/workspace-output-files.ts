import { updateGist } from "$lib/gist";
import type { GistMeta } from "$lib/models";
import { WORKSPACE_FILE } from "$lib/workspace-data";

export type WorkspaceOutputUpdate = (
	token: string,
	input: {
		gistId: string;
		files: Record<string, { content: string } | null>;
	},
) => Promise<GistMeta>;

export class ProtectedWorkspaceFileError extends Error {
	constructor(fileName: string) {
		super(`Workspace config cannot be deleted: ${fileName}`);
		this.name = "ProtectedWorkspaceFileError";
	}
}

export async function deleteWorkspaceOutputFile(
	token: string,
	gistId: string,
	fileName: string,
	update: WorkspaceOutputUpdate = updateGist,
): Promise<GistMeta> {
	if (fileName === WORKSPACE_FILE) {
		throw new ProtectedWorkspaceFileError(fileName);
	}
	return await update(token, {
		gistId,
		files: { [fileName]: null },
	});
}
