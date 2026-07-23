import type { GistMeta } from "$lib/models";
import {
	getWorkspaceContentSignature,
	migrateWorkspaceDocumentV1ToV2,
	parseWorkspaceDocument,
	serializeWorkspaceDocumentV2,
	validateWorkspaceDocumentV2,
	WORKSPACE_BOOTSTRAP_FILE_NAME,
	WORKSPACE_FILE_NAME,
	WORKSPACE_V1_BACKUP_FILE_NAME,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import {
	applyWorkspaceMutation,
	getWorkspaceMutationSignature,
	parseWorkspaceMutation,
	type WorkspaceFiles,
	type WorkspaceMutation,
	type WorkspaceMutationApplication,
	WorkspaceMutationError,
	type WorkspaceMutationErrorCode,
	type WorkspaceMutationReceipt,
} from "$lib/workspace-mutation";

const RESERVED_CONTENT_FILES = [
	WORKSPACE_FILE_NAME,
	WORKSPACE_V1_BACKUP_FILE_NAME,
	WORKSPACE_BOOTSTRAP_FILE_NAME,
] as const;

export type WorkspaceGistSnapshot = {
	gist: Pick<GistMeta, "id" | "ownerLogin" | "files">;
	contents: Readonly<Record<string, string>>;
};

export type WorkspaceCoordinatorGateway = {
	read: (
		githubToken: string,
		gistId: string,
		requiredFiles?: readonly string[],
	) => Promise<WorkspaceGistSnapshot>;
	patch: (
		githubToken: string,
		gistId: string,
		files: WorkspaceFiles,
	) => Promise<void>;
};

export type WorkspaceCoordinatorPendingMutation = {
	mutationId: string;
	workspaceId: string;
	requestHash: string;
	baseRevision: number;
	baseDocumentHash: string;
	candidateRevision: number;
	candidateDocumentHash: string;
	resultJson: string;
	expectedFilesJson: string;
	committedAt: string;
};

export type WorkspaceCoordinatorProcessedMutation = {
	mutationId: string;
	workspaceId: string;
	requestHash: string;
	committedRevision: number;
	resultJson: string;
	committedAt: string;
};

export type WorkspaceCoordinatorJournal = {
	getProcessed: (
		mutationId: string,
	) => WorkspaceCoordinatorProcessedMutation | null;
	getPendingByWorkspace: (
		workspaceId: string,
	) => WorkspaceCoordinatorPendingMutation | null;
	putPending: (entry: WorkspaceCoordinatorPendingMutation) => void;
	commitPending: (entry: WorkspaceCoordinatorPendingMutation) => void;
	deletePending: (mutationId: string) => void;
};

export type WorkspaceCoordinatorResult = {
	document: WorkspaceDocumentV2;
	mutationId: string;
	workspaceId: string;
	committedRevision: number;
	committedAt: string;
	receipt: WorkspaceMutationReceipt | null;
	status: "committed" | "already-committed";
};

export type WorkspaceCoordinatorOutcome =
	| { ok: true; result: WorkspaceCoordinatorResult }
	| { ok: false; error: unknown };

type StoredCoordinatorResult = Omit<
	WorkspaceCoordinatorResult,
	"document" | "status"
>;

type ExpectedFile = {
	fileName: string;
	contentHash: string | null;
};

type LoadedWorkspace = {
	document: WorkspaceDocumentV2;
	baseDocumentHash: string;
	reservedFiles: WorkspaceFiles;
};

const MUTATION_KINDS = new Set<WorkspaceMutation["kind"]>([
	"node.upsert",
	"node.delete",
	"subscription.upsert",
	"subscription.delete",
	"aggregate.upsert",
	"aggregate.delete",
	"publish-target.upsert",
	"publish-target.delete",
	"client-export.upsert",
	"client-export.delete",
	"aggregate.publish",
	"client-export.publish",
	"output.delete",
	"workspace.reconcile",
]);

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type WorkspaceCoordinatorErrorCode =
	| WorkspaceMutationErrorCode
	| "workspace_not_found"
	| "workspace_mismatch"
	| "migration_backup_conflict"
	| "mutation_id_reused"
	| "mutation_recovery_failed"
	| "gist_read_failed"
	| "gist_write_failed"
	| "write_verification_failed"
	| "commit_index_failed"
	| "invalid_gateway_response"
	| "invalid_journal_record";

export class WorkspaceCoordinatorError extends Error {
	constructor(
		readonly code: WorkspaceCoordinatorErrorCode,
		message: string,
		readonly latestDocument?: WorkspaceDocumentV2,
	) {
		super(message);
		this.name = "WorkspaceCoordinatorError";
	}
}

function coordinatorError(
	code: WorkspaceCoordinatorErrorCode,
	message: string,
): never {
	throw new WorkspaceCoordinatorError(code, message);
}

function hasGistFile(
	snapshot: WorkspaceGistSnapshot,
	fileName: string,
): boolean {
	return snapshot.gist.files.some((file) => file.filename === fileName);
}

function requireGistContent(
	snapshot: WorkspaceGistSnapshot,
	fileName: string,
): string {
	const content = snapshot.contents[fileName];
	if (typeof content !== "string") {
		coordinatorError(
			"invalid_gateway_response",
			`Gist content was not loaded for ${fileName}`,
		);
	}
	return content;
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

async function getDocumentHash(document: WorkspaceDocumentV2): Promise<string> {
	return sha256(getWorkspaceContentSignature(document));
}

async function getReservedStateHash(
	snapshot: WorkspaceGistSnapshot,
): Promise<string> {
	const state: Record<string, string | null> = {};
	for (const fileName of RESERVED_CONTENT_FILES) {
		state[fileName] = hasGistFile(snapshot, fileName)
			? requireGistContent(snapshot, fileName)
			: null;
	}
	return sha256(JSON.stringify(state));
}

function emptyWorkspaceDocument(
	gistId: string,
	committedAt: string,
): WorkspaceDocumentV2 {
	return validateWorkspaceDocumentV2({
		version: 2,
		schemaVersion: 2,
		workspaceId: `gist:${gistId}`,
		revision: 0,
		updatedAt: committedAt,
		lastMutationId: null,
		data: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	});
}

async function loadWorkspace(
	snapshot: WorkspaceGistSnapshot,
	gistId: string,
	committedAt: string,
): Promise<LoadedWorkspace> {
	if (snapshot.gist.id !== gistId) {
		coordinatorError(
			"workspace_mismatch",
			"Gist response identity does not match",
		);
	}
	const baseDocumentHash = await getReservedStateHash(snapshot);
	if (!hasGistFile(snapshot, WORKSPACE_FILE_NAME)) {
		if (!hasGistFile(snapshot, WORKSPACE_BOOTSTRAP_FILE_NAME)) {
			coordinatorError(
				"workspace_not_found",
				"Workspace configuration was not found",
			);
		}
		return {
			document: emptyWorkspaceDocument(gistId, committedAt),
			baseDocumentHash,
			reservedFiles: { [WORKSPACE_BOOTSTRAP_FILE_NAME]: null },
		};
	}

	const raw = requireGistContent(snapshot, WORKSPACE_FILE_NAME);
	const parsed = parseWorkspaceDocument(raw, {
		expectedWorkspaceId: `gist:${gistId}`,
	});
	if (parsed.schemaVersion === 2) {
		return {
			document: parsed.document,
			baseDocumentHash,
			reservedFiles: {},
		};
	}

	if (hasGistFile(snapshot, WORKSPACE_V1_BACKUP_FILE_NAME)) {
		if (requireGistContent(snapshot, WORKSPACE_V1_BACKUP_FILE_NAME) !== raw) {
			coordinatorError(
				"migration_backup_conflict",
				"The immutable V1 backup does not match subman.json",
			);
		}
	}
	const migrated = migrateWorkspaceDocumentV1ToV2(parsed.document, {
		gistId,
		now: committedAt,
	});
	return {
		document: migrated.document,
		baseDocumentHash,
		reservedFiles: hasGistFile(snapshot, WORKSPACE_V1_BACKUP_FILE_NAME)
			? {}
			: { [WORKSPACE_V1_BACKUP_FILE_NAME]: { content: raw } },
	};
}

function hasExactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
): boolean {
	return (
		Object.keys(value).length === required.length &&
		required.every((key) => key in value)
	);
}

function isReceipt(value: unknown): value is WorkspaceMutationReceipt | null {
	if (value === null) return true;
	if (typeof value !== "object" || Array.isArray(value)) return false;
	const receipt = value as Record<string, unknown>;
	const keys = [
		"kind",
		...(receipt.entityId === undefined ? [] : ["entityId"]),
		...(receipt.deleted === undefined ? [] : ["deleted"]),
	];
	return (
		hasExactKeys(receipt, keys) &&
		typeof receipt.kind === "string" &&
		MUTATION_KINDS.has(receipt.kind as WorkspaceMutation["kind"]) &&
		(receipt.entityId === undefined || typeof receipt.entityId === "string") &&
		(receipt.deleted === undefined || receipt.deleted === true)
	);
}

function parseStoredResult(
	value: string,
	row: WorkspaceCoordinatorProcessedMutation,
): StoredCoordinatorResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		coordinatorError(
			"invalid_journal_record",
			"Stored mutation result is invalid",
		);
	}
	const result = parsed as Record<string, unknown>;
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		!hasExactKeys(result, [
			"mutationId",
			"workspaceId",
			"committedRevision",
			"committedAt",
			"receipt",
		]) ||
		typeof result.mutationId !== "string" ||
		!UUID.test(result.mutationId) ||
		typeof result.workspaceId !== "string" ||
		!Number.isSafeInteger(result.committedRevision) ||
		(result.committedRevision as number) < 0 ||
		typeof result.committedAt !== "string" ||
		!CANONICAL_ISO_TIMESTAMP.test(result.committedAt) ||
		!isReceipt(result.receipt) ||
		result.mutationId !== row.mutationId ||
		result.workspaceId !== row.workspaceId ||
		result.committedRevision !== row.committedRevision ||
		result.committedAt !== row.committedAt ||
		!SHA256.test(row.requestHash)
	) {
		coordinatorError(
			"invalid_journal_record",
			"Stored mutation result is invalid",
		);
	}
	return result as StoredCoordinatorResult;
}

function parseExpectedFiles(value: string): ExpectedFile[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		coordinatorError(
			"invalid_journal_record",
			"Stored file verification is invalid",
		);
	}
	if (
		!Array.isArray(parsed) ||
		parsed.some((item) => {
			const file = item as Record<string, unknown>;
			return (
				typeof item !== "object" ||
				item === null ||
				Array.isArray(item) ||
				!hasExactKeys(file, ["fileName", "contentHash"]) ||
				typeof file.fileName !== "string" ||
				(file.contentHash !== null &&
					(typeof file.contentHash !== "string" ||
						!SHA256.test(file.contentHash)))
			);
		})
	) {
		coordinatorError(
			"invalid_journal_record",
			"Stored file verification is invalid",
		);
	}
	return parsed as ExpectedFile[];
}

async function expectedFiles(files: WorkspaceFiles): Promise<ExpectedFile[]> {
	return Promise.all(
		Object.entries(files)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(async ([fileName, file]) => ({
				fileName,
				contentHash: file === null ? null : await sha256(file.content),
			})),
	);
}

async function verifyExpectedFiles(
	snapshot: WorkspaceGistSnapshot,
	expected: readonly ExpectedFile[],
): Promise<boolean> {
	for (const file of expected) {
		if (file.contentHash === null) {
			if (hasGistFile(snapshot, file.fileName)) return false;
			continue;
		}
		if (!hasGistFile(snapshot, file.fileName)) return false;
		if (
			(await sha256(requireGistContent(snapshot, file.fileName))) !==
			file.contentHash
		) {
			return false;
		}
	}
	return true;
}

async function verifyCandidate(
	snapshot: WorkspaceGistSnapshot,
	pending: WorkspaceCoordinatorPendingMutation,
): Promise<WorkspaceDocumentV2 | null> {
	if (!hasGistFile(snapshot, WORKSPACE_FILE_NAME)) return null;
	let parsed: ReturnType<typeof parseWorkspaceDocument>;
	try {
		parsed = parseWorkspaceDocument(
			requireGistContent(snapshot, WORKSPACE_FILE_NAME),
			{
				expectedWorkspaceId: pending.workspaceId,
			},
		);
	} catch {
		return null;
	}
	if (
		parsed.schemaVersion !== 2 ||
		parsed.document.revision !== pending.candidateRevision ||
		parsed.document.lastMutationId !== pending.mutationId ||
		(await getDocumentHash(parsed.document)) !== pending.candidateDocumentHash
	) {
		return null;
	}
	return (await verifyExpectedFiles(
		snapshot,
		parseExpectedFiles(pending.expectedFilesJson),
	))
		? parsed.document
		: null;
}

function resultFromStored(
	stored: StoredCoordinatorResult,
	document: WorkspaceDocumentV2,
	status: WorkspaceCoordinatorResult["status"],
): WorkspaceCoordinatorResult {
	return { ...stored, document, status };
}

export class WorkspaceCoordinatorCore {
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly options: {
			gateway: WorkspaceCoordinatorGateway;
			journal: WorkspaceCoordinatorJournal;
			now?: () => string;
		},
	) {}

	mutate(input: {
		githubToken: string;
		gistId: string;
		mutation: WorkspaceMutation;
	}): Promise<WorkspaceCoordinatorResult> {
		return this.mutateSettled(input).then((outcome) => {
			if (outcome.ok) return outcome.result;
			throw outcome.error;
		});
	}

	mutateSettled(input: {
		githubToken: string;
		gistId: string;
		mutation: WorkspaceMutation;
	}): Promise<WorkspaceCoordinatorOutcome> {
		const operation = this.queue.then(
			() => this.runMutationSettled(input),
			() => this.runMutationSettled(input),
		);
		this.queue = operation.then(() => undefined);
		return operation;
	}

	private async runMutationSettled(input: {
		githubToken: string;
		gistId: string;
		mutation: WorkspaceMutation;
	}): Promise<WorkspaceCoordinatorOutcome> {
		try {
			return { ok: true, result: await this.runMutation(input) };
		} catch (error) {
			return { ok: false, error };
		}
	}

	private async runMutation(input: {
		githubToken: string;
		gistId: string;
		mutation: WorkspaceMutation;
	}): Promise<WorkspaceCoordinatorResult> {
		const mutation = parseWorkspaceMutation(input.mutation);
		const workspaceId = `gist:${input.gistId}`;
		if (mutation.workspaceId !== workspaceId) {
			coordinatorError(
				"workspace_mismatch",
				"Mutation workspace does not match the Gist identity",
			);
		}
		const requestHash = await getWorkspaceMutationSignature(mutation);
		const existingPending =
			this.options.journal.getPendingByWorkspace(workspaceId);
		const initialFiles = new Set<string>(RESERVED_CONTENT_FILES);
		if (existingPending) {
			for (const file of parseExpectedFiles(
				existingPending.expectedFilesJson,
			)) {
				initialFiles.add(file.fileName);
			}
		}
		let snapshot: WorkspaceGistSnapshot;
		try {
			snapshot = await this.options.gateway.read(
				input.githubToken,
				input.gistId,
				[...initialFiles],
			);
		} catch {
			coordinatorError("gist_read_failed", "Unable to read the workspace Gist");
		}

		if (existingPending) {
			await this.reconcilePending(
				snapshot,
				existingPending,
				mutation,
				requestHash,
			);
		}

		const pending = this.options.journal.getPendingByWorkspace(workspaceId);
		if (pending && pending.mutationId !== mutation.mutationId) {
			coordinatorError(
				"mutation_recovery_failed",
				"A prior workspace mutation could not be reconciled",
			);
		}
		if (pending && pending.requestHash !== requestHash) {
			coordinatorError(
				"mutation_id_reused",
				"Mutation ID was already used for another request",
			);
		}

		const committedAt = pending?.committedAt ?? this.now();
		const loaded = await loadWorkspace(snapshot, input.gistId, committedAt);
		if (
			loaded.document.lastMutationId &&
			!this.options.journal.getProcessed(loaded.document.lastMutationId)
		) {
			coordinatorError(
				"mutation_recovery_failed",
				"Latest workspace mutation is missing its recovery journal",
			);
		}
		const processed = this.options.journal.getProcessed(mutation.mutationId);
		if (processed) {
			if (processed.requestHash !== requestHash) {
				coordinatorError(
					"mutation_id_reused",
					"Mutation ID was already used for another request",
				);
			}
			if (loaded.document.revision < processed.committedRevision) {
				coordinatorError(
					"mutation_recovery_failed",
					"Workspace revision predates the processed mutation",
				);
			}
			return resultFromStored(
				parseStoredResult(processed.resultJson, processed),
				loaded.document,
				"already-committed",
			);
		}
		let application: WorkspaceMutationApplication;
		try {
			application = applyWorkspaceMutation(loaded.document, mutation, {
				committedAt,
				gist: snapshot.gist,
			});
		} catch (error) {
			if (error instanceof WorkspaceMutationError) {
				throw new WorkspaceCoordinatorError(
					error.code,
					error.message,
					loaded.document,
				);
			}
			throw error;
		}
		const serializedDocument = serializeWorkspaceDocumentV2(
			application.document,
		);
		const files: WorkspaceFiles = {
			...application.files,
			...loaded.reservedFiles,
			[WORKSPACE_FILE_NAME]: { content: serializedDocument },
		};
		const verificationFiles: WorkspaceFiles = { ...files };
		if (
			hasGistFile(snapshot, WORKSPACE_V1_BACKUP_FILE_NAME) &&
			!(WORKSPACE_V1_BACKUP_FILE_NAME in verificationFiles)
		) {
			verificationFiles[WORKSPACE_V1_BACKUP_FILE_NAME] = {
				content: requireGistContent(snapshot, WORKSPACE_V1_BACKUP_FILE_NAME),
			};
		}
		const stored: StoredCoordinatorResult = {
			mutationId: mutation.mutationId,
			workspaceId,
			committedRevision: application.document.revision,
			committedAt,
			receipt: application.receipt,
		};
		const pendingEntry: WorkspaceCoordinatorPendingMutation = {
			mutationId: mutation.mutationId,
			workspaceId,
			requestHash,
			baseRevision: loaded.document.revision,
			baseDocumentHash: loaded.baseDocumentHash,
			candidateRevision: application.document.revision,
			candidateDocumentHash: await getDocumentHash(application.document),
			resultJson: JSON.stringify(stored),
			expectedFilesJson: JSON.stringify(await expectedFiles(verificationFiles)),
			committedAt,
		};
		this.options.journal.putPending(pendingEntry);

		let patchFailed = false;
		try {
			await this.options.gateway.patch(input.githubToken, input.gistId, files);
		} catch {
			patchFailed = true;
		}

		let verified: WorkspaceGistSnapshot;
		try {
			const verificationFileNames = new Set<string>(RESERVED_CONTENT_FILES);
			for (const file of parseExpectedFiles(pendingEntry.expectedFilesJson)) {
				verificationFileNames.add(file.fileName);
			}
			verified = await this.options.gateway.read(
				input.githubToken,
				input.gistId,
				[...verificationFileNames],
			);
		} catch {
			coordinatorError(
				"write_verification_failed",
				"Unable to verify the workspace write",
			);
		}
		const candidate = await verifyCandidate(verified, pendingEntry);
		if (candidate) {
			this.commitPending(pendingEntry);
			return resultFromStored(stored, candidate, "committed");
		}

		const unchanged =
			(await getReservedStateHash(verified)) === pendingEntry.baseDocumentHash;
		if (unchanged) {
			this.options.journal.deletePending(pendingEntry.mutationId);
			coordinatorError(
				patchFailed ? "gist_write_failed" : "write_verification_failed",
				patchFailed
					? "GitHub did not commit the workspace write"
					: "GitHub write verification did not match the candidate",
			);
		}
		coordinatorError(
			"write_verification_failed",
			"Workspace changed to an ambiguous state during write verification",
		);
	}

	private async reconcilePending(
		snapshot: WorkspaceGistSnapshot,
		pending: WorkspaceCoordinatorPendingMutation,
		incoming: WorkspaceMutation,
		requestHash: string,
	): Promise<void> {
		const candidate = await verifyCandidate(snapshot, pending);
		if (candidate) {
			this.commitPending(pending);
			return;
		}
		if ((await getReservedStateHash(snapshot)) !== pending.baseDocumentHash) {
			coordinatorError(
				"mutation_recovery_failed",
				"Pending mutation does not match the Gist base or candidate state",
			);
		}
		if (pending.mutationId === incoming.mutationId) {
			if (pending.requestHash !== requestHash) {
				coordinatorError(
					"mutation_id_reused",
					"Mutation ID was already used for another request",
				);
			}
			return;
		}
		this.options.journal.deletePending(pending.mutationId);
	}

	private commitPending(entry: WorkspaceCoordinatorPendingMutation): void {
		try {
			this.options.journal.commitPending(entry);
		} catch {
			coordinatorError(
				"commit_index_failed",
				"Workspace committed but its idempotency index was not updated",
			);
		}
	}

	private now(): string {
		return (this.options.now ?? (() => new Date().toISOString()))();
	}
}
