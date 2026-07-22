import { getGist, getGistFileContent, updateGist } from "$lib/gist";
import type { AppState, GistMeta } from "$lib/models";
import {
	createSyncBaselineEnvelope,
	getWorkspaceSignature,
	hydrateWorkspaceState,
	isTrustedSyncBaseline,
	mergeWorkspaceStateFromBaseline,
	parseWorkspaceState,
	reconcileWorkspaceState,
	type SyncBaselineEnvelope,
	serializeWorkspaceState,
	WORKSPACE_FILE,
} from "$lib/workspace-data";
import { broadcastWorkspaceEvent } from "$lib/workspace-events";
import { withWorkspaceLock } from "$lib/workspace-lock";

export type WorkspaceFiles = Record<string, { content: string } | null>;

export type WorkspaceSnapshot = {
	gist: GistMeta;
	state: AppState;
};

export type WorkspaceTransactionTransport = {
	read: (
		token: string,
		gistId: string,
		fileName: string,
	) => Promise<WorkspaceSnapshot>;
	write: (
		token: string,
		input: { gistId: string; files: WorkspaceFiles },
	) => Promise<GistMeta>;
};

export type WorkspaceMutationContext = {
	gist: GistMeta;
	gistId: string;
	fileName: string;
};

export type WorkspaceMutationResult = {
	state: AppState;
	files?: WorkspaceFiles;
};

export type WorkspaceTransactionInput = {
	token: string;
	gistId: string;
	fileName?: string;
	localState?: AppState;
	baseline?: SyncBaselineEnvelope | null;
	force?: boolean;
	mutate?: (
		state: AppState,
		context: WorkspaceMutationContext,
	) =>
		| AppState
		| WorkspaceMutationResult
		| Promise<AppState | WorkspaceMutationResult>;
	maxAttempts?: number;
};

export type WorkspaceTransactionResult = {
	status: "already-synced" | "committed";
	gist: GistMeta;
	state: AppState;
	baseline: SyncBaselineEnvelope;
	attempts: number;
};

export class WorkspaceBaselineError extends Error {
	constructor() {
		super("A trusted sync baseline is required for this workspace file");
		this.name = "WorkspaceBaselineError";
	}
}

export class WorkspaceConflictError extends Error {
	readonly code = "workspace_conflict";

	constructor() {
		super("Workspace changed during commit; retry limit exceeded");
		this.name = "WorkspaceConflictError";
	}
}

const defaultTransport: WorkspaceTransactionTransport = {
	async read(token, gistId, fileName) {
		const [gist, content] = await Promise.all([
			getGist(token, gistId),
			getGistFileContent(token, gistId, fileName),
		]);
		return {
			gist,
			state: hydrateWorkspaceState(
				parseWorkspaceState(content),
				gistId,
				fileName,
			),
		};
	},
	write(token, input) {
		return updateGist(token, input);
	},
};

export function readWorkspaceSnapshot(
	token: string,
	gistId: string,
	fileName = WORKSPACE_FILE,
): Promise<WorkspaceSnapshot> {
	return defaultTransport.read(token, gistId, fileName);
}

function unpackMutationResult(
	result: AppState | WorkspaceMutationResult,
): WorkspaceMutationResult {
	return "state" in result ? result : { state: result };
}

function verifyFiles(gist: GistMeta, files: WorkspaceFiles): boolean {
	const fileNames = new Set(gist.files.map((file) => file.filename));
	return Object.entries(files).every(([fileName, file]) =>
		file === null ? !fileNames.has(fileName) : fileNames.has(fileName),
	);
}

function finishResult(
	status: WorkspaceTransactionResult["status"],
	snapshot: WorkspaceSnapshot,
	gistId: string,
	fileName: string,
	attempts: number,
): WorkspaceTransactionResult {
	const baseline = createSyncBaselineEnvelope(snapshot.state, gistId, fileName);
	const result = { status, ...snapshot, baseline, attempts };
	broadcastWorkspaceEvent({
		type: "transaction-result",
		gistId,
		fileName,
		state: snapshot.state,
		baseline,
		status,
	});
	return result;
}

export async function runWorkspaceTransaction(
	input: WorkspaceTransactionInput,
	options: {
		transport?: WorkspaceTransactionTransport;
		now?: () => string;
	} = {},
): Promise<WorkspaceTransactionResult> {
	const transport = options.transport ?? defaultTransport;
	const now = options.now ?? (() => new Date().toISOString());
	const fileName = input.fileName || WORKSPACE_FILE;
	const maxAttempts = Math.max(1, input.maxAttempts ?? 3);

	return withWorkspaceLock(
		`subman:workspace:write:${input.gistId}:${fileName}`,
		async () => {
			let intent: WorkspaceMutationResult | null = null;
			let intentBase: AppState | null = null;
			let retrySnapshot: WorkspaceSnapshot | null = null;

			for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
				const snapshot =
					retrySnapshot ??
					(await transport.read(input.token, input.gistId, fileName));
				retrySnapshot = null;

				if (!intent) {
					let baseState = snapshot.state;
					if (input.localState) {
						if (input.force) {
							baseState = hydrateWorkspaceState(
								input.localState,
								input.gistId,
								fileName,
							);
						} else if (
							getWorkspaceSignature(input.localState) !==
							getWorkspaceSignature(snapshot.state)
						) {
							const baseline = input.baseline ?? null;
							if (!isTrustedSyncBaseline(baseline, input.gistId, fileName)) {
								throw new WorkspaceBaselineError();
							}
							baseState = mergeWorkspaceStateFromBaseline(
								input.localState,
								snapshot.state,
								baseline.state,
							);
						}
					}

					intent = input.mutate
						? unpackMutationResult(
								await input.mutate(baseState, {
									gist: snapshot.gist,
									gistId: input.gistId,
									fileName,
								}),
							)
						: { state: baseState };
					intentBase = snapshot.state;
				} else if (intentBase) {
					const currentIntent: WorkspaceMutationResult = intent;
					intent = {
						...currentIntent,
						state: mergeWorkspaceStateFromBaseline(
							intent.state,
							snapshot.state,
							intentBase,
						),
					};
					intentBase = snapshot.state;
				}

				if (!intent) {
					throw new Error("Workspace transaction did not produce an intent");
				}
				const reconciled = reconcileWorkspaceState(intent.state, now());
				const stateChanged =
					getWorkspaceSignature(reconciled) !==
					getWorkspaceSignature(snapshot.state);
				const stateToWrite = hydrateWorkspaceState(
					stateChanged ? { ...reconciled, lastUpdated: now() } : reconciled,
					input.gistId,
					fileName,
				);
				intent = { ...intent, state: stateToWrite };
				const outputFiles = intent.files ?? {};

				if (!stateChanged && Object.keys(outputFiles).length === 0) {
					return finishResult(
						"already-synced",
						{ gist: snapshot.gist, state: stateToWrite },
						input.gistId,
						fileName,
						attempt,
					);
				}

				const files: WorkspaceFiles = {
					...outputFiles,
					[fileName]: { content: serializeWorkspaceState(stateToWrite) },
				};
				await transport.write(input.token, { gistId: input.gistId, files });
				const verified = await transport.read(
					input.token,
					input.gistId,
					fileName,
				);
				if (
					getWorkspaceSignature(verified.state) ===
						getWorkspaceSignature(stateToWrite) &&
					verifyFiles(verified.gist, outputFiles)
				) {
					return finishResult(
						"committed",
						verified,
						input.gistId,
						fileName,
						attempt,
					);
				}
				retrySnapshot = verified;
			}

			broadcastWorkspaceEvent({
				type: "transaction-result",
				gistId: input.gistId,
				fileName,
				status: "conflict",
			});
			throw new WorkspaceConflictError();
		},
	);
}
