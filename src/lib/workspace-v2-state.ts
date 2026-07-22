import type { AppState } from "$lib/models";
import {
	validateWorkspaceDocumentV2,
	WORKSPACE_FILE_NAME,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";

const STORAGE_KEY = "subman:workspace-state:v2";
const SYNC_MODES = new Set<WorkspaceV2LocalState["syncMode"]>([
	"automatic",
	"manual",
	"paused-conflict",
]);

export type WorkspaceV2LocalState = {
	version: 2;
	gistId: string;
	fileName: typeof WORKSPACE_FILE_NAME;
	workspaceId: string;
	revision: number | null;
	syncMode: "automatic" | "manual" | "paused-conflict";
	baseline: WorkspaceDocumentV2 | null;
	conflictBaseline: WorkspaceDocumentV2 | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean {
	const allowed = new Set([...required, ...optional]);
	return (
		required.every((key) => key in value) &&
		Object.keys(value).every((key) => allowed.has(key))
	);
}

function parseGistId(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "" || /[\s/]/.test(value)) {
		throw new Error("Workspace Gist ID is invalid");
	}
	return value;
}

export function validateWorkspaceV2LocalState(
	value: unknown,
): WorkspaceV2LocalState {
	if (
		!isRecord(value) ||
		!hasExactKeys(
			value,
			[
				"version",
				"gistId",
				"fileName",
				"workspaceId",
				"revision",
				"syncMode",
				"baseline",
			],
			["conflictBaseline"],
		) ||
		value.version !== 2 ||
		value.fileName !== WORKSPACE_FILE_NAME ||
		typeof value.workspaceId !== "string" ||
		typeof value.syncMode !== "string" ||
		!SYNC_MODES.has(value.syncMode as WorkspaceV2LocalState["syncMode"])
	) {
		throw new Error("Workspace V2 local state is invalid");
	}
	const gistId = parseGistId(value.gistId);
	const workspaceId = `gist:${gistId}`;
	if (value.workspaceId !== workspaceId) {
		throw new Error("Workspace V2 local state identity is invalid");
	}
	if (value.revision === null) {
		if (value.baseline !== null || value.conflictBaseline != null) {
			throw new Error("Workspace V2 local state baseline is invalid");
		}
		return {
			version: 2,
			gistId,
			fileName: WORKSPACE_FILE_NAME,
			workspaceId,
			revision: null,
			syncMode: value.syncMode as WorkspaceV2LocalState["syncMode"],
			baseline: null,
			conflictBaseline: null,
		};
	}
	if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
		throw new Error("Workspace V2 local state revision is invalid");
	}
	const baseline = validateWorkspaceDocumentV2(value.baseline, {
		expectedWorkspaceId: workspaceId,
	});
	if (baseline.revision !== value.revision) {
		throw new Error("Workspace V2 local state baseline revision is invalid");
	}
	const syncMode = value.syncMode as WorkspaceV2LocalState["syncMode"];
	const conflictBaseline =
		value.conflictBaseline == null
			? null
			: validateWorkspaceDocumentV2(value.conflictBaseline, {
					expectedWorkspaceId: workspaceId,
				});
	if (
		(syncMode !== "paused-conflict" && conflictBaseline !== null) ||
		(conflictBaseline !== null && conflictBaseline.revision > baseline.revision)
	) {
		throw new Error("Workspace V2 conflict baseline is invalid");
	}
	return {
		version: 2,
		gistId,
		fileName: WORKSPACE_FILE_NAME,
		workspaceId,
		revision: value.revision as number,
		syncMode,
		baseline,
		conflictBaseline,
	};
}

export function createWorkspaceV2LocalState(
	gistIdValue: string,
	options: {
		syncMode?: WorkspaceV2LocalState["syncMode"];
		baseline?: WorkspaceDocumentV2 | null;
		conflictBaseline?: WorkspaceDocumentV2 | null;
	} = {},
): WorkspaceV2LocalState {
	const gistId = parseGistId(gistIdValue);
	const workspaceId = `gist:${gistId}`;
	const baseline =
		options.baseline === undefined || options.baseline === null
			? null
			: validateWorkspaceDocumentV2(options.baseline, {
					expectedWorkspaceId: workspaceId,
				});
	const conflictBaseline =
		options.conflictBaseline === undefined || options.conflictBaseline === null
			? null
			: validateWorkspaceDocumentV2(options.conflictBaseline, {
					expectedWorkspaceId: workspaceId,
				});
	return validateWorkspaceV2LocalState({
		version: 2,
		gistId,
		fileName: WORKSPACE_FILE_NAME,
		workspaceId,
		revision: baseline?.revision ?? null,
		syncMode: options.syncMode ?? "automatic",
		baseline,
		conflictBaseline,
	});
}

export function hydrateAppStateFromWorkspaceDocument(
	current: AppState,
	documentValue: WorkspaceDocumentV2,
	gistIdValue: string,
): AppState {
	const gistId = parseGistId(gistIdValue);
	const document = validateWorkspaceDocumentV2(documentValue, {
		expectedWorkspaceId: `gist:${gistId}`,
	});
	return {
		...current,
		...document.data,
		activeGistId: gistId,
		activeGistFile: WORKSPACE_FILE_NAME,
		lastUpdated: document.updatedAt,
	};
}

export class WorkspaceV2StateStore {
	readonly storageKey = STORAGE_KEY;

	constructor(
		private readonly storage: Pick<
			Storage,
			"getItem" | "setItem" | "removeItem"
		> = localStorage,
	) {}

	read(): WorkspaceV2LocalState | null {
		const raw = this.storage.getItem(this.storageKey);
		if (raw === null) return null;
		try {
			return validateWorkspaceV2LocalState(JSON.parse(raw) as unknown);
		} catch {
			throw new Error("Stored Workspace V2 local state is invalid");
		}
	}

	write(value: WorkspaceV2LocalState): WorkspaceV2LocalState {
		const state = validateWorkspaceV2LocalState(value);
		this.storage.setItem(this.storageKey, JSON.stringify(state));
		return state;
	}

	clear(): void {
		this.storage.removeItem(this.storageKey);
	}
}
