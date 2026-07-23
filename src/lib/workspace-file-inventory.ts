import type { WorkspaceData } from "$lib/workspace-document";
import {
	WORKSPACE_BOOTSTRAP_FILE_NAME,
	WORKSPACE_FILE_NAME,
	WORKSPACE_RESERVED_FILE_NAMES,
	WORKSPACE_V1_BACKUP_FILE_NAME,
} from "$lib/workspace-document";

export type WorkspaceFileKind =
	| "workspace-config"
	| "v1-migration-backup"
	| "bootstrap-marker"
	| "managed-output"
	| "external-file";

export function classifyWorkspaceFile(
	fileName: string,
	data: Pick<WorkspaceData, "publishTargets" | "clientExports">,
): WorkspaceFileKind {
	if (fileName === WORKSPACE_FILE_NAME) return "workspace-config";
	if (fileName === WORKSPACE_V1_BACKUP_FILE_NAME) {
		return "v1-migration-backup";
	}
	if (fileName === WORKSPACE_BOOTSTRAP_FILE_NAME) return "bootstrap-marker";
	if (
		data.publishTargets.some((target) => target.fileName === fileName) ||
		data.clientExports.some((profile) => profile.fileName === fileName)
	) {
		return "managed-output";
	}
	return "external-file";
}

export function canDeleteWorkspaceFile(fileName: string): boolean {
	return !WORKSPACE_RESERVED_FILE_NAMES.has(fileName);
}

export function getWorkspaceBootstrapStatus(
	fileNames: readonly string[],
): "incomplete" | "stale" | "invalid" | null {
	if (!fileNames.includes(WORKSPACE_BOOTSTRAP_FILE_NAME)) return null;
	if (fileNames.includes(WORKSPACE_FILE_NAME)) return "stale";
	return fileNames.length === 1 ? "incomplete" : "invalid";
}
