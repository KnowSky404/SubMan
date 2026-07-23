import type { AppState, GistFile, GistMeta } from "$lib/models";
import {
	canonicalizeWorkspaceData,
	validateWorkspaceData,
	validateWorkspaceDocumentV2,
	validateWorkspaceTimestamp,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import type { WorkspaceFailureDisposition } from "$lib/workspace-failure-disposition";
import {
	applyWorkspaceMutation,
	parseWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	validateWorkspaceV2LocalState,
	type WorkspaceV2LocalState,
} from "$lib/workspace-v2-state";

export const WORKSPACE_PERSISTENCE_DATABASE = "subman-workspace";
export const WORKSPACE_PERSISTENCE_DATABASE_VERSION = 1;
export const WORKSPACE_PERSISTENCE_STORE = "workspace-state";
export const WORKSPACE_PERSISTENCE_ROOT_KEY = "root";

export const LEGACY_APP_STATE_KEY = "subman:state:v1";
export const LEGACY_WORKSPACE_STATE_KEY = "subman:workspace-state:v2";
export const LEGACY_MUTATION_QUEUE_KEY = "subman:workspace-mutation-queue:v1";

const LEGACY_KEYS = [
	LEGACY_APP_STATE_KEY,
	LEGACY_WORKSPACE_STATE_KEY,
	LEGACY_MUTATION_QUEUE_KEY,
] as const;

export type WorkspacePersistenceErrorCode =
	| "unsupported"
	| "quota-exceeded"
	| "transaction-aborted"
	| "upgrade-failed"
	| "corrupt-data";

export class WorkspacePersistenceError extends Error {
	constructor(
		readonly code: WorkspacePersistenceErrorCode,
		message: string,
		options: { cause?: unknown } = {},
	) {
		super(message, options);
		this.name = "WorkspacePersistenceError";
	}
}

export type WorkspacePersistenceFaultPoint =
	| "before-transaction"
	| "after-snapshot"
	| "after-binding"
	| "after-queue"
	| "before-commit"
	| "after-commit";

export type WorkspaceRetryMetadata = {
	attempt: number;
	nextAttemptAt: number | null;
	lastErrorCode: string | null;
};

export type WorkspaceBlockedMutationMetadata = {
	mutationId: string;
	kind: WorkspaceMutation["kind"];
	code: string;
	disposition: WorkspaceFailureDisposition;
	messageKey: string | null;
	createdAt: string;
	blockedAt: string;
};

export type WorkspaceDeadLetterMetadata = WorkspaceBlockedMutationMetadata & {
	payloadBytes: number;
};

export type WorkspaceDeliveryMetadata = {
	retry: WorkspaceRetryMetadata;
	blocked: WorkspaceBlockedMutationMetadata | null;
	deadLetters: WorkspaceDeadLetterMetadata[];
};

export type PersistedWorkspaceQueue = {
	workspaceId: string;
	mutations: WorkspaceMutation[];
	delivery: WorkspaceDeliveryMetadata;
};

export type WorkspaceDispatcherLease = {
	name: string;
	ownerId: string;
	fencingToken: number;
	expiresAt: number;
	heartbeatAt: number;
};

export type WorkspaceLeaseFence = {
	ownerId: string;
	fencingToken: number;
};

export type WorkspaceMutationDraft = WorkspaceMutation extends infer Mutation
	? Mutation extends WorkspaceMutation
		? Omit<Mutation, "expectedRevision">
		: never
	: never;

export type WorkspaceQuarantineMetadata = {
	id: string;
	source: string;
	reason: string;
	bytes: number;
	createdAt: string;
};

export type WorkspacePersistenceMigration = {
	version: 1;
	phase: "not-started" | "copied" | "validated" | "confirmed";
	startedAt: string | null;
	copiedAt: string | null;
	validatedAt: string | null;
	updatedAt: string | null;
	confirmedAt: string | null;
	cleanupCompletedAt: string | null;
};

export type WorkspacePersistenceRecord = {
	version: 1;
	snapshot: AppState | null;
	binding: WorkspaceV2LocalState | null;
	workspaces: Record<string, PersistedWorkspaceQueue>;
	leases: Record<string, WorkspaceDispatcherLease>;
	quarantines: WorkspaceQuarantineMetadata[];
	migration: WorkspacePersistenceMigration;
	nextFencingToken: number;
};

type WorkspacePersistenceRoot = WorkspacePersistenceRecord & {
	quarantinePayloads: Record<string, string>;
};

export type WorkspaceQueueMutationMetadata = Pick<
	WorkspaceMutation,
	"mutationId" | "workspaceId" | "expectedRevision" | "createdAt" | "kind"
> & { payloadBytes: number };

export type WorkspaceQueueInspection = {
	activeWorkspaceId: string | null;
	activeQueueCount: number;
	totalQueueCount: number;
	orphanedWorkspaceCount: number;
	blockedCount: number;
	deadLetterCount: number;
	workspaces: Array<{
		workspaceId: string;
		active: boolean;
		mutations: WorkspaceQueueMutationMetadata[];
		retry: WorkspaceRetryMetadata;
		blocked: WorkspaceBlockedMutationMetadata | null;
		deadLetters: WorkspaceDeadLetterMetadata[];
	}>;
};

export type WorkspaceLeaseAcquireResult =
	| { acquired: true; lease: WorkspaceDispatcherLease }
	| { acquired: false; lease: WorkspaceDispatcherLease };

type PersistenceCheckpoint = (point: WorkspacePersistenceFaultPoint) => void;

export interface WorkspacePersistenceBackend {
	read(): Promise<WorkspacePersistenceRoot>;
	readQuarantinePayloadForRepair(id: string): Promise<string | null>;
	transact<T>(
		mutate: (
			draft: WorkspacePersistenceRoot,
			checkpoint: PersistenceCheckpoint,
		) => T,
	): Promise<T>;
	close?(): void;
}

export interface BrowserWorkspacePersistence {
	read(): Promise<WorkspacePersistenceRecord>;
	readQuarantinePayloadForRepair(id: string): Promise<string | null>;
	commitAutomaticAction(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
		mutation: WorkspaceMutationDraft;
	}): Promise<WorkspaceMutation>;
	commitExplicitAction(input: {
		binding: WorkspaceV2LocalState;
		mutation: WorkspaceMutationDraft;
		snapshot?: AppState;
	}): Promise<WorkspaceMutation>;
	commitLocalAction(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState | null;
	}): Promise<void>;
	commitDeliverySuccess(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
		mutationId: string;
		fence: WorkspaceLeaseFence;
	}): Promise<void>;
	commitDeliveryConflict(input: {
		workspaceId: string;
		mutationId: string;
		document: WorkspaceDocumentV2;
		metadata: WorkspaceBlockedMutationMetadata;
		fence: WorkspaceLeaseFence;
	}): Promise<void>;
	commitRecoveredDelivery(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
		mutationId: string;
		committedBaseline: WorkspaceDocumentV2;
		blocked: WorkspaceBlockedMutationMetadata | null;
		fence: WorkspaceLeaseFence;
	}): Promise<void>;
	setRetryMetadata(
		workspaceId: string,
		mutationId: string,
		metadata: WorkspaceRetryMetadata,
		fence: WorkspaceLeaseFence,
	): Promise<void>;
	blockMutation(
		workspaceId: string,
		metadata: WorkspaceBlockedMutationMetadata,
		fence: WorkspaceLeaseFence,
	): Promise<void>;
	inspectQueues(
		activeWorkspaceId?: string | null,
	): Promise<WorkspaceQueueInspection>;
	discardWorkspaceQueue(input: {
		workspaceId: string;
		snapshot?: AppState;
		binding?: WorkspaceV2LocalState;
	}): Promise<number>;
	rebindWorkspace(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
	}): Promise<void>;
	repairWorkspaceQueue(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
		mutations: WorkspaceMutation[];
		blocked?: WorkspaceBlockedMutationMetadata;
	}): Promise<void>;
	quarantineWorkspaceQueue(input: {
		workspaceId: string;
		reason: string;
		code?: string;
		createdAt: string;
		fence: WorkspaceLeaseFence;
	}): Promise<void>;
	acquireLease(input: {
		name: string;
		ownerId: string;
		now: number;
		ttlMs: number;
	}): Promise<WorkspaceLeaseAcquireResult>;
	renewLease(input: {
		name: string;
		ownerId: string;
		fencingToken: number;
		now: number;
		ttlMs: number;
	}): Promise<WorkspaceDispatcherLease | null>;
	releaseLease(input: {
		name: string;
		ownerId: string;
		fencingToken: number;
	}): Promise<boolean>;
	importLegacy(input: LegacyWorkspaceImport): Promise<void>;
	validateLegacyMigration(validatedAt: string): Promise<void>;
	confirmLegacyMigration(confirmedAt: string): Promise<void>;
	completeLegacyCleanup(completedAt: string): Promise<void>;
	close(): void;
}

type LegacyWorkspaceImport = {
	snapshot: AppState | null;
	binding: WorkspaceV2LocalState | null;
	mutations: WorkspaceMutation[];
	quarantines: WorkspaceQuarantineMetadata[];
	quarantinePayloads: Record<string, string>;
	startedAt: string;
	copiedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
): void {
	const expected = new Set(required);
	if (
		Object.keys(value).length !== required.length ||
		required.some((key) => !(key in value)) ||
		Object.keys(value).some((key) => !expected.has(key))
	) {
		throw corrupt("Workspace persistence record has unsupported fields");
	}
}

function corrupt(message: string, cause?: unknown): WorkspacePersistenceError {
	return new WorkspacePersistenceError("corrupt-data", message, { cause });
}

function nonempty(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw corrupt(`${path} must be a non-empty string`);
	}
	return value;
}

function safeInteger(value: unknown, path: string, minimum = 0): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) {
		throw corrupt(`${path} must be a safe integer`);
	}
	return value as number;
}

function nullableTimestamp(value: unknown, path: string): string | null {
	if (value === null) return null;
	try {
		return validateWorkspaceTimestamp(value, path);
	} catch (error) {
		throw corrupt(`${path} must be a canonical timestamp`, error);
	}
}

function canonicalTimestamp(value: unknown, path: string): string {
	const parsed = nullableTimestamp(value, path);
	if (parsed === null) throw corrupt(`${path} must be a canonical timestamp`);
	return parsed;
}

function stableContentId(value: string): string {
	let hash = 0xcbf29ce484222325n;
	for (const byte of new TextEncoder().encode(value)) {
		hash ^= BigInt(byte);
		hash = BigInt.asUintN(64, hash * 0x100000001b3n);
	}
	return hash.toString(16).padStart(16, "0");
}

function validateMigrationEvidence(
	migration: WorkspacePersistenceMigration,
): void {
	const evidence = [
		migration.startedAt,
		migration.copiedAt,
		migration.validatedAt,
		migration.confirmedAt,
		migration.cleanupCompletedAt,
	].filter((value): value is string => value !== null);
	if (
		evidence.some((value, index) => index > 0 && value < evidence[index - 1])
	) {
		throw corrupt("Migration timestamps are not chronological");
	}
	if (
		migration.phase === "not-started" &&
		(evidence.length !== 0 || migration.updatedAt !== null)
	) {
		throw corrupt("Not-started migration cannot carry evidence");
	}
	if (
		migration.phase === "copied" &&
		(!migration.startedAt ||
			!migration.copiedAt ||
			migration.validatedAt ||
			migration.confirmedAt ||
			migration.cleanupCompletedAt ||
			migration.updatedAt !== migration.copiedAt)
	) {
		throw corrupt("Copied migration evidence is incomplete");
	}
	if (
		migration.phase === "validated" &&
		(!migration.startedAt ||
			!migration.copiedAt ||
			!migration.validatedAt ||
			migration.confirmedAt ||
			migration.cleanupCompletedAt ||
			migration.updatedAt !== migration.validatedAt)
	) {
		throw corrupt("Validated migration evidence is incomplete");
	}
	if (
		migration.phase === "confirmed" &&
		(!migration.startedAt ||
			!migration.copiedAt ||
			!migration.validatedAt ||
			!migration.confirmedAt ||
			migration.updatedAt !==
				(migration.cleanupCompletedAt ?? migration.confirmedAt))
	) {
		throw corrupt("Confirmed migration evidence is incomplete");
	}
}

const SAFE_METADATA_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_GIST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const WORKSPACE_ID_PREFIX = "gist:";
const DISPATCHER_LEASE_PREFIX = "dispatcher:";

const SAFE_ERROR_CODES = new Set([
	"unauthorized",
	"timeout",
	"upstream_timeout",
	"network_error",
	"rate_limit",
	"invalid_success_response",
	"invalid_failure_response",
	"workspace_sync_retry",
	"workspace_sync_failed",
	"workspace_sync_exception",
	"invalid_mutation",
	"workspace_size_limit",
	"workspace_mismatch",
	"revision_conflict",
	"entity_deleted",
	"entity_not_found",
	"entity_exists",
	"duplicate_node_raw",
	"duplicate_subscription_url",
	"output_file_conflict",
	"publication_file_mismatch",
	"workspace_not_found",
	"invalid_bootstrap_marker",
	"migration_backup_conflict",
	"mutation_id_reused",
	"mutation_recovery_failed",
	"gist_read_failed",
	"gist_write_failed",
	"write_verification_failed",
	"commit_index_failed",
	"invalid_gateway_response",
	"invalid_journal_record",
	"invalid_workspace_document",
	"unsupported_schema",
	"server_error",
	"queue_corruption",
]);

const SAFE_MESSAGE_KEYS = new Set([
	"workspace.domain-conflict",
	"workspace.state-conflict",
	"workspace.auth-required",
	"workspace.queue-corruption",
	"workspace.operator-repair",
	"workspace.retryable-upstream",
	"workspace.permanent-upstream",
	"workspace.invalid-request",
]);

const SAFE_QUARANTINE_REASONS = new Set([
	"invalid-persisted-queue",
	"invalid-legacy-snapshot",
	"invalid-legacy-binding",
	"invalid-legacy-queue",
	"legacy-identity-mismatch",
	"legacy-quarantine",
	"queue-corruption",
	"revision-gap",
]);

function safeMetadataKey(value: unknown, path: string): string {
	const parsed = nonempty(value, path);
	if (!SAFE_METADATA_KEY.test(parsed)) {
		throw corrupt(`${path} must be a safe metadata key`);
	}
	return parsed;
}

function allowedMetadata(
	value: unknown,
	path: string,
	allowed: ReadonlySet<string>,
): string {
	const parsed = safeMetadataKey(value, path);
	if (!allowed.has(parsed)) throw corrupt(`${path} is not allowed`);
	return parsed;
}

function nullableAllowedMetadata(
	value: unknown,
	path: string,
	allowed: ReadonlySet<string>,
): string | null {
	if (value === null) return null;
	return allowedMetadata(value, path, allowed);
}

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
	"workspace.bootstrap.cleanup",
	"workspace.reconcile",
]);

export function workspaceDispatcherLeaseName(workspaceId: string): string {
	return `${DISPATCHER_LEASE_PREFIX}${canonicalWorkspaceId(
		workspaceId,
		"workspaceId",
	)}`;
}

function canonicalWorkspaceId(value: unknown, path: string): string {
	const workspaceId = nonempty(value, path);
	if (!workspaceId.startsWith(WORKSPACE_ID_PREFIX)) {
		throw corrupt(`${path} must be a canonical Workspace identity`);
	}
	const gistId = workspaceId.slice(WORKSPACE_ID_PREFIX.length);
	if (!SAFE_GIST_ID.test(gistId) || UNSAFE_OBJECT_KEYS.has(gistId)) {
		throw corrupt(`${path} must be a canonical Workspace identity`);
	}
	return workspaceId;
}

function canonicalDispatcherLeaseName(value: unknown, path: string): string {
	const name = nonempty(value, path);
	if (!name.startsWith(DISPATCHER_LEASE_PREFIX)) {
		throw corrupt(`${path} must be a canonical dispatcher lease name`);
	}
	const workspaceId = canonicalWorkspaceId(
		name.slice(DISPATCHER_LEASE_PREFIX.length),
		`${path}.workspaceId`,
	);
	if (name !== `${DISPATCHER_LEASE_PREFIX}${workspaceId}`) {
		throw corrupt(`${path} must be a canonical dispatcher lease name`);
	}
	return name;
}

function validatePersistenceBinding(value: unknown): WorkspaceV2LocalState {
	try {
		const binding = validateWorkspaceV2LocalState(value);
		canonicalWorkspaceId(binding.workspaceId, "binding.workspaceId");
		return binding;
	} catch (error) {
		if (error instanceof WorkspacePersistenceError) throw error;
		throw corrupt("Workspace binding is invalid", error);
	}
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function validateGistFile(value: unknown): GistFile {
	if (!isRecord(value)) throw corrupt("snapshot.gists.files must be objects");
	const allowed = new Set(["filename", "language", "size", "rawUrl"]);
	if (
		!["filename", "language", "size"].every((key) => key in value) ||
		Object.keys(value).some((key) => !allowed.has(key))
	) {
		throw corrupt("snapshot.gists.files have unsupported fields");
	}
	if (value.language !== null && typeof value.language !== "string") {
		throw corrupt("snapshot.gists.files.language is invalid");
	}
	if (value.rawUrl !== undefined && typeof value.rawUrl !== "string") {
		throw corrupt("snapshot.gists.files.rawUrl is invalid");
	}
	return {
		filename: nonempty(value.filename, "snapshot.gists.files.filename"),
		language: value.language as string | null,
		size: safeInteger(value.size, "snapshot.gists.files.size"),
		...(value.rawUrl === undefined ? {} : { rawUrl: value.rawUrl }),
	};
}

function validateGist(value: unknown): GistMeta {
	if (!isRecord(value)) throw corrupt("snapshot.gists must contain objects");
	const allowed = new Set([
		"id",
		"ownerLogin",
		"description",
		"files",
		"updatedAt",
		"url",
	]);
	if (
		!["id", "description", "files", "updatedAt", "url"].every(
			(key) => key in value,
		) ||
		Object.keys(value).some((key) => !allowed.has(key)) ||
		!Array.isArray(value.files)
	) {
		throw corrupt("snapshot.gists have unsupported fields");
	}
	if (value.description !== null && typeof value.description !== "string") {
		throw corrupt("snapshot.gists.description is invalid");
	}
	if (value.ownerLogin !== undefined && typeof value.ownerLogin !== "string") {
		throw corrupt("snapshot.gists.ownerLogin is invalid");
	}
	return {
		id: nonempty(value.id, "snapshot.gists.id"),
		...(value.ownerLogin === undefined ? {} : { ownerLogin: value.ownerLogin }),
		description: value.description as string | null,
		files: value.files.map(validateGistFile),
		updatedAt: nonempty(value.updatedAt, "snapshot.gists.updatedAt"),
		url: nonempty(value.url, "snapshot.gists.url"),
	};
}

export function validateWorkspacePersistenceSnapshot(value: unknown): AppState {
	if (!isRecord(value)) throw corrupt("snapshot must be an object");
	exactKeys(value, [
		"nodes",
		"subscriptions",
		"aggregates",
		"publishTargets",
		"clientExports",
		"gists",
		"activeGistId",
		"activeGistFile",
		"lastUpdated",
	]);
	if (!Array.isArray(value.gists))
		throw corrupt("snapshot.gists must be an array");
	if (value.activeGistId !== null && typeof value.activeGistId !== "string") {
		throw corrupt("snapshot.activeGistId is invalid");
	}
	try {
		const business = validateWorkspaceData({
			nodes: value.nodes,
			subscriptions: value.subscriptions,
			aggregates: value.aggregates,
			publishTargets: value.publishTargets,
			clientExports: value.clientExports,
		});
		return {
			...business,
			gists: value.gists.map(validateGist),
			activeGistId: value.activeGistId as string | null,
			activeGistFile: nonempty(value.activeGistFile, "snapshot.activeGistFile"),
			lastUpdated: nonempty(value.lastUpdated, "snapshot.lastUpdated"),
		};
	} catch (error) {
		if (error instanceof WorkspacePersistenceError) throw error;
		throw corrupt("snapshot business data is invalid", error);
	}
}

function validateMutation(value: unknown): WorkspaceMutation {
	try {
		const mutation = parseWorkspaceMutation(value);
		if (mutation.source !== "browser") {
			throw corrupt("Only browser mutations may be persisted");
		}
		canonicalWorkspaceId(mutation.workspaceId, "mutation.workspaceId");
		return mutation;
	} catch (error) {
		if (error instanceof WorkspacePersistenceError) throw error;
		throw corrupt("Persisted mutation is invalid", error);
	}
}

export function validateWorkspaceMutationSequence(
	mutationsValue: readonly unknown[],
	expectedWorkspaceId?: string,
	expectedFirstRevision?: number,
): WorkspaceMutation[] {
	if (expectedWorkspaceId !== undefined) {
		canonicalWorkspaceId(expectedWorkspaceId, "expectedWorkspaceId");
	}
	const mutations = mutationsValue.map(validateMutation);
	const ids = new Set<string>();
	const lastRevision = new Map<string, number>();
	for (const mutation of mutations) {
		if (expectedWorkspaceId && mutation.workspaceId !== expectedWorkspaceId) {
			throw corrupt("Mutation belongs to another Workspace");
		}
		if (ids.has(mutation.mutationId)) {
			throw corrupt("Persisted mutation IDs must be unique");
		}
		ids.add(mutation.mutationId);
		const previous = lastRevision.get(mutation.workspaceId);
		if (previous !== undefined && mutation.expectedRevision !== previous + 1) {
			throw corrupt("Persisted mutation revisions are not contiguous");
		}
		if (
			expectedWorkspaceId === mutation.workspaceId &&
			previous === undefined &&
			expectedFirstRevision !== undefined &&
			mutation.expectedRevision !== expectedFirstRevision
		) {
			throw corrupt("Persisted mutation queue does not start at the baseline");
		}
		lastRevision.set(mutation.workspaceId, mutation.expectedRevision);
	}
	return mutations;
}

function defaultRetry(): WorkspaceRetryMetadata {
	return { attempt: 0, nextAttemptAt: null, lastErrorCode: null };
}

function defaultDelivery(): WorkspaceDeliveryMetadata {
	return { retry: defaultRetry(), blocked: null, deadLetters: [] };
}

function createQueue(
	workspaceId: string,
	mutations: WorkspaceMutation[] = [],
): PersistedWorkspaceQueue {
	return {
		workspaceId: canonicalWorkspaceId(workspaceId, "queue.workspaceId"),
		mutations,
		delivery: defaultDelivery(),
	};
}

export function createEmptyWorkspacePersistenceRecord(): WorkspacePersistenceRecord {
	const record: WorkspacePersistenceRoot = {
		version: 1,
		snapshot: null,
		binding: null,
		workspaces: {},
		leases: {},
		quarantines: [],
		migration: {
			version: 1,
			phase: "not-started",
			startedAt: null,
			copiedAt: null,
			validatedAt: null,
			updatedAt: null,
			confirmedAt: null,
			cleanupCompletedAt: null,
		},
		quarantinePayloads: {},
		nextFencingToken: 1,
	};
	return record;
}

function validateRetry(value: unknown): WorkspaceRetryMetadata {
	if (!isRecord(value)) throw corrupt("retry metadata must be an object");
	exactKeys(value, ["attempt", "nextAttemptAt", "lastErrorCode"]);
	if (
		value.nextAttemptAt !== null &&
		(!Number.isSafeInteger(value.nextAttemptAt) ||
			(value.nextAttemptAt as number) < 0)
	) {
		throw corrupt("retry nextAttemptAt is invalid");
	}
	return {
		attempt: safeInteger(value.attempt, "retry.attempt"),
		nextAttemptAt: value.nextAttemptAt as number | null,
		lastErrorCode: nullableAllowedMetadata(
			value.lastErrorCode,
			"retry.lastErrorCode",
			SAFE_ERROR_CODES,
		),
	};
}

const DISPOSITIONS = new Set<WorkspaceFailureDisposition>([
	"state-conflict",
	"domain-conflict",
	"auth-required",
	"queue-corruption",
	"operator-repair",
	"retryable-upstream",
	"permanent-upstream",
	"invalid-request",
]);

function validateBlocked(value: unknown): WorkspaceBlockedMutationMetadata {
	if (!isRecord(value)) throw corrupt("blocked metadata must be an object");
	exactKeys(value, [
		"mutationId",
		"kind",
		"code",
		"disposition",
		"messageKey",
		"createdAt",
		"blockedAt",
	]);
	if (!DISPOSITIONS.has(value.disposition as WorkspaceFailureDisposition)) {
		throw corrupt("blocked disposition is invalid");
	}
	if (!MUTATION_KINDS.has(value.kind as WorkspaceMutation["kind"])) {
		throw corrupt("blocked kind is invalid");
	}
	return {
		mutationId: nonempty(value.mutationId, "blocked.mutationId"),
		kind: value.kind as WorkspaceMutation["kind"],
		code: allowedMetadata(value.code, "blocked.code", SAFE_ERROR_CODES),
		disposition: value.disposition as WorkspaceFailureDisposition,
		messageKey: nullableAllowedMetadata(
			value.messageKey,
			"blocked.messageKey",
			SAFE_MESSAGE_KEYS,
		),
		createdAt: canonicalTimestamp(value.createdAt, "blocked.createdAt"),
		blockedAt: canonicalTimestamp(value.blockedAt, "blocked.blockedAt"),
	};
}

function validateDelivery(value: unknown): WorkspaceDeliveryMetadata {
	if (!isRecord(value)) throw corrupt("delivery metadata must be an object");
	exactKeys(value, ["retry", "blocked", "deadLetters"]);
	if (!Array.isArray(value.deadLetters)) {
		throw corrupt("deadLetters must be an array");
	}
	return {
		retry: validateRetry(value.retry),
		blocked: value.blocked === null ? null : validateBlocked(value.blocked),
		deadLetters: value.deadLetters.map((entry) => {
			if (!isRecord(entry)) throw corrupt("dead letter must be an object");
			const { payloadBytes, ...blocked } = entry;
			return {
				...validateBlocked(blocked),
				payloadBytes: safeInteger(payloadBytes, "deadLetter.payloadBytes"),
			};
		}),
	};
}

function validateQueue(value: unknown): PersistedWorkspaceQueue {
	if (!isRecord(value)) throw corrupt("Workspace queue must be an object");
	exactKeys(value, ["workspaceId", "mutations", "delivery"]);
	if (!Array.isArray(value.mutations))
		throw corrupt("mutations must be an array");
	const workspaceId = canonicalWorkspaceId(
		value.workspaceId,
		"queue.workspaceId",
	);
	return {
		workspaceId,
		mutations: validateWorkspaceMutationSequence(value.mutations, workspaceId),
		delivery: validateDelivery(value.delivery),
	};
}

function validateLease(value: unknown, name: string): WorkspaceDispatcherLease {
	if (!isRecord(value)) throw corrupt("lease must be an object");
	exactKeys(value, [
		"name",
		"ownerId",
		"fencingToken",
		"expiresAt",
		"heartbeatAt",
	]);
	const canonicalName = canonicalDispatcherLeaseName(name, "lease.name");
	if (value.name !== canonicalName) throw corrupt("lease name is invalid");
	return {
		name: canonicalName,
		ownerId: safeMetadataKey(value.ownerId, "lease.ownerId"),
		fencingToken: safeInteger(value.fencingToken, "lease.fencingToken", 1),
		expiresAt: safeInteger(value.expiresAt, "lease.expiresAt"),
		heartbeatAt: safeInteger(value.heartbeatAt, "lease.heartbeatAt"),
	};
}

type WorkspacePersistenceValidationOptions = {
	recoverCorruptQueues?: boolean;
	recoveredAt?: string;
};

export function validateWorkspacePersistenceRecord(
	value: unknown,
): WorkspacePersistenceRecord {
	return publicWorkspacePersistenceRecord(
		validateWorkspacePersistenceRecordInternal(value),
	);
}

function publicWorkspacePersistenceRecord(
	root: WorkspacePersistenceRoot,
): WorkspacePersistenceRecord {
	const { quarantinePayloads: _repairOnly, ...record } = root;
	return clone(record);
}

function persistenceRootInput(value: unknown): unknown {
	return isRecord(value) && !isRecord(value.quarantinePayloads)
		? { ...value, quarantinePayloads: {} }
		: value;
}

function recoverWorkspacePersistenceRecord(
	value: unknown,
	recoveredAt: string,
): WorkspacePersistenceRoot {
	return validateWorkspacePersistenceRecordInternal(value, {
		recoverCorruptQueues: true,
		recoveredAt,
	});
}

function validateWorkspacePersistenceRecordInternal(
	value: unknown,
	options: WorkspacePersistenceValidationOptions = {},
): WorkspacePersistenceRoot {
	if (!isRecord(value)) throw corrupt("Workspace persistence root is invalid");
	exactKeys(value, [
		"version",
		"snapshot",
		"binding",
		"workspaces",
		"leases",
		"quarantines",
		"quarantinePayloads",
		"migration",
		"nextFencingToken",
	]);
	if (
		value.version !== 1 ||
		!isRecord(value.workspaces) ||
		!isRecord(value.leases)
	) {
		throw corrupt("Workspace persistence version is unsupported");
	}
	const snapshot =
		value.snapshot === null
			? null
			: validateWorkspacePersistenceSnapshot(value.snapshot);
	let binding: WorkspaceV2LocalState | null = null;
	try {
		binding =
			value.binding === null ? null : validatePersistenceBinding(value.binding);
	} catch (error) {
		throw corrupt("Workspace binding is invalid", error);
	}
	const workspaces: Record<string, PersistedWorkspaceQueue> = {};
	const mutationIds = new Set<string>();
	const recoveredQuarantines: WorkspaceQuarantineMetadata[] = [];
	const recoveredPayloads: Record<string, string> = {};
	const reservedQuarantineIds = new Set(
		Array.isArray(value.quarantines)
			? value.quarantines.flatMap((entry) =>
					isRecord(entry) && typeof entry.id === "string" ? [entry.id] : [],
				)
			: [],
	);
	for (const [workspaceId, queueValue] of Object.entries(value.workspaces)) {
		try {
			canonicalWorkspaceId(workspaceId, "Workspace queue key");
			const queue = validateQueue(queueValue);
			const queueMutationIds = new Set<string>();
			if (queue.workspaceId !== workspaceId) {
				throw corrupt("Workspace queue key is invalid");
			}
			if (binding && queue.workspaceId === binding.workspaceId) {
				if (queue.mutations.length > 0 && binding.revision === null) {
					throw corrupt("Active Workspace queue has no baseline revision");
				}
				if (queue.mutations.length > 0) {
					const expectedFirstRevision =
						binding.syncMode === "paused-conflict"
							? (binding.conflictBaseline?.revision ?? binding.revision)
							: binding.revision;
					validateWorkspaceMutationSequence(
						queue.mutations,
						binding.workspaceId,
						expectedFirstRevision as number,
					);
				}
			}
			for (const mutation of queue.mutations) {
				if (
					mutationIds.has(mutation.mutationId) ||
					queueMutationIds.has(mutation.mutationId)
				) {
					throw corrupt("Mutation IDs must be globally unique");
				}
				queueMutationIds.add(mutation.mutationId);
			}
			for (const mutationId of queueMutationIds) mutationIds.add(mutationId);
			workspaces[workspaceId] = queue;
		} catch (error) {
			if (!options.recoverCorruptQueues) throw error;
			const raw = JSON.stringify(queueValue) ?? "null";
			const createdAt = options.recoveredAt ?? new Date().toISOString();
			const baseId = `queue:${workspaceId}:${stableContentId(raw)}`;
			let id = baseId;
			let suffix = 2;
			while (reservedQuarantineIds.has(id)) {
				id = `${baseId}:${suffix}`;
				suffix += 1;
			}
			reservedQuarantineIds.add(id);
			recoveredQuarantines.push({
				id,
				source: `queue:${workspaceId}`,
				reason: "invalid-persisted-queue",
				bytes: new TextEncoder().encode(raw).byteLength,
				createdAt,
			});
			recoveredPayloads[id] = raw;
		}
	}
	if (binding) {
		if (snapshot && snapshot.activeGistId !== binding.gistId) {
			throw corrupt("Snapshot and Workspace binding identities differ");
		}
	}
	const leases: Record<string, WorkspaceDispatcherLease> = {};
	for (const [name, lease] of Object.entries(value.leases)) {
		leases[name] = validateLease(lease, name);
	}
	if (!Array.isArray(value.quarantines)) {
		throw corrupt("quarantines must be an array");
	}
	const quarantines = value.quarantines.map((entry) => {
		if (!isRecord(entry)) throw corrupt("quarantine metadata is invalid");
		exactKeys(entry, ["id", "source", "reason", "bytes", "createdAt"]);
		return {
			id: nonempty(entry.id, "quarantine.id"),
			source: nonempty(entry.source, "quarantine.source"),
			reason: allowedMetadata(
				entry.reason,
				"quarantine.reason",
				SAFE_QUARANTINE_REASONS,
			),
			bytes: safeInteger(entry.bytes, "quarantine.bytes"),
			createdAt: canonicalTimestamp(entry.createdAt, "quarantine.createdAt"),
		};
	});
	if (
		new Set(quarantines.map((entry) => entry.id)).size !== quarantines.length
	) {
		throw corrupt("quarantine IDs must be unique");
	}
	for (const recovered of recoveredQuarantines) {
		if (!quarantines.some((entry) => entry.id === recovered.id)) {
			quarantines.push(recovered);
		}
	}
	if (!isRecord(value.quarantinePayloads)) {
		throw corrupt("quarantinePayloads must be an object");
	}
	const quarantineIds = new Set(quarantines.map((entry) => entry.id));
	const quarantinePayloads: Record<string, string> = {};
	for (const [id, raw] of Object.entries(value.quarantinePayloads)) {
		if (!quarantineIds.has(id) || typeof raw !== "string") {
			throw corrupt("quarantine payload is invalid");
		}
		quarantinePayloads[id] = raw;
	}
	Object.assign(quarantinePayloads, recoveredPayloads);
	if (!isRecord(value.migration))
		throw corrupt("migration metadata is invalid");
	exactKeys(value.migration, [
		"version",
		"phase",
		"startedAt",
		"copiedAt",
		"validatedAt",
		"updatedAt",
		"confirmedAt",
		"cleanupCompletedAt",
	]);
	if (
		value.migration.version !== 1 ||
		!new Set(["not-started", "copied", "validated", "confirmed"]).has(
			value.migration.phase as string,
		)
	) {
		throw corrupt("migration phase is invalid");
	}
	const migration: WorkspacePersistenceMigration = {
		version: 1,
		phase: value.migration.phase as WorkspacePersistenceMigration["phase"],
		startedAt: nullableTimestamp(
			value.migration.startedAt,
			"migration.startedAt",
		),
		copiedAt: nullableTimestamp(value.migration.copiedAt, "migration.copiedAt"),
		validatedAt: nullableTimestamp(
			value.migration.validatedAt,
			"migration.validatedAt",
		),
		updatedAt: nullableTimestamp(
			value.migration.updatedAt,
			"migration.updatedAt",
		),
		confirmedAt: nullableTimestamp(
			value.migration.confirmedAt,
			"migration.confirmedAt",
		),
		cleanupCompletedAt: nullableTimestamp(
			value.migration.cleanupCompletedAt,
			"migration.cleanupCompletedAt",
		),
	};
	validateMigrationEvidence(migration);
	const nextFencingToken = safeInteger(
		value.nextFencingToken,
		"nextFencingToken",
		1,
	);
	if (
		Object.values(leases).some(
			(lease) => lease.fencingToken >= nextFencingToken,
		)
	) {
		throw corrupt("nextFencingToken must exceed every active lease token");
	}
	return {
		version: 1,
		snapshot,
		binding,
		workspaces,
		leases,
		quarantines,
		quarantinePayloads,
		migration,
		nextFencingToken,
	};
}

function normalizeError(
	error: unknown,
	fallback: Exclude<
		WorkspacePersistenceErrorCode,
		"unsupported" | "corrupt-data"
	>,
): WorkspacePersistenceError {
	if (error instanceof WorkspacePersistenceError) return error;
	const name =
		isRecord(error) && typeof error.name === "string" ? error.name : "";
	if (name === "QuotaExceededError") {
		return new WorkspacePersistenceError(
			"quota-exceeded",
			"Browser storage quota was exceeded",
			{ cause: error },
		);
	}
	if (name === "VersionError" || name === "InvalidStateError") {
		return new WorkspacePersistenceError(
			"upgrade-failed",
			"Browser storage upgrade failed",
			{ cause: error },
		);
	}
	return new WorkspacePersistenceError(
		fallback,
		fallback === "upgrade-failed"
			? "Browser storage upgrade failed"
			: "Browser storage transaction was aborted",
		{ cause: error },
	);
}

function payloadBytes(mutation: WorkspaceMutation): number {
	return new TextEncoder().encode(JSON.stringify(mutation.payload)).byteLength;
}

function ensureIdentity(
	snapshot: AppState,
	binding: WorkspaceV2LocalState,
): void {
	if (snapshot.activeGistId !== binding.gistId) {
		throw corrupt("Snapshot and Workspace binding identities differ");
	}
}

function workspaceBindingsEqual(
	left: WorkspaceV2LocalState | null,
	right: WorkspaceV2LocalState | null,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function replayWorkspaceMutations(
	snapshot: AppState,
	baseline: WorkspaceDocumentV2,
	mutations: readonly WorkspaceMutation[],
): WorkspaceDocumentV2 {
	const gist = snapshot.gists.find(
		(entry) => entry.id === snapshot.activeGistId,
	) ?? {
		id: baseline.workspaceId.slice("gist:".length),
		files: [],
	};
	try {
		return mutations.reduce(
			(document, mutation) =>
				applyWorkspaceMutation(document, mutation, {
					committedAt: mutation.createdAt,
					gist,
				}).document,
			baseline,
		);
	} catch (error) {
		throw corrupt("Persisted mutation sequence cannot be replayed", error);
	}
}

function ensureSnapshotMatchesDocument(
	snapshot: AppState,
	binding: WorkspaceV2LocalState,
	document: WorkspaceDocumentV2,
): void {
	if (
		snapshot.activeGistFile !== binding.fileName ||
		snapshot.lastUpdated !== document.updatedAt
	) {
		throw corrupt(
			"Persisted snapshot timestamp does not match mutation replay",
		);
	}
	const snapshotData = canonicalizeWorkspaceData({
		nodes: snapshot.nodes,
		subscriptions: snapshot.subscriptions,
		aggregates: snapshot.aggregates,
		publishTargets: snapshot.publishTargets,
		clientExports: snapshot.clientExports,
	});
	const replayedData = canonicalizeWorkspaceData(document.data);
	if (JSON.stringify(snapshotData) !== JSON.stringify(replayedData)) {
		throw corrupt("Persisted snapshot differs from mutation replay");
	}
}

function ensureCommittedHead(
	binding: WorkspaceV2LocalState,
	mutation: WorkspaceMutation,
): WorkspaceDocumentV2 {
	if (
		(binding.syncMode !== "automatic" && binding.syncMode !== "manual") ||
		binding.revision === null ||
		binding.baseline === null ||
		binding.revision !== mutation.expectedRevision + 1 ||
		binding.baseline.revision !== binding.revision ||
		binding.baseline.lastMutationId !== mutation.mutationId
	) {
		throw corrupt("Delivery binding does not prove the committed queue head");
	}
	return binding.baseline;
}

function ensureActiveDeliveryBinding(
	active: WorkspaceV2LocalState | null,
	committed: WorkspaceV2LocalState,
	mutation: WorkspaceMutation,
): void {
	if (
		!active ||
		active.workspaceId !== committed.workspaceId ||
		active.syncMode !== committed.syncMode ||
		active.revision !== mutation.expectedRevision ||
		active.baseline === null ||
		active.baseline.workspaceId !== mutation.workspaceId ||
		active.baseline.revision !== mutation.expectedRevision
	) {
		throw corrupt("Delivery commit uses a stale Workspace binding");
	}
}

function ensureSnapshotMatchesQueue(
	snapshot: AppState,
	binding: WorkspaceV2LocalState,
	mutations: readonly WorkspaceMutation[],
): void {
	if (!binding.baseline) {
		if (mutations.length > 0) {
			throw corrupt("A nonempty queue requires a committed baseline");
		}
		return;
	}
	const replayed = replayWorkspaceMutations(
		snapshot,
		binding.baseline,
		mutations,
	);
	ensureSnapshotMatchesDocument(snapshot, binding, replayed);
}

function validateFence(fence: WorkspaceLeaseFence): WorkspaceLeaseFence {
	if (!isRecord(fence)) throw corrupt("fence must be an object");
	exactKeys(fence, ["ownerId", "fencingToken"]);
	return {
		ownerId: safeMetadataKey(fence.ownerId, "fence.ownerId"),
		fencingToken: safeInteger(fence.fencingToken, "fence.fencingToken", 1),
	};
}

function assertActiveWorkspaceFence(
	draft: WorkspacePersistenceRecord,
	workspaceId: string,
	fenceValue: WorkspaceLeaseFence,
	now: number,
): void {
	const fence = validateFence(fenceValue);
	const lease = draft.leases[workspaceDispatcherLeaseName(workspaceId)];
	if (
		!lease ||
		lease.ownerId !== fence.ownerId ||
		lease.fencingToken !== fence.fencingToken ||
		lease.expiresAt <= now
	) {
		throw corrupt("Workspace dispatcher lease fence is stale");
	}
}

function validateRetryInput(
	value: WorkspaceRetryMetadata,
): WorkspaceRetryMetadata {
	return validateRetry(value);
}

export class TransactionalWorkspacePersistence
	implements BrowserWorkspacePersistence
{
	constructor(
		protected readonly backend: WorkspacePersistenceBackend,
		private readonly nowMs: () => number = () => Date.now(),
	) {}

	async read(): Promise<WorkspacePersistenceRecord> {
		return publicWorkspacePersistenceRecord(
			validateWorkspacePersistenceRecordInternal(await this.backend.read()),
		);
	}

	async readQuarantinePayloadForRepair(id: string): Promise<string | null> {
		return this.backend.readQuarantinePayloadForRepair(
			nonempty(id, "quarantine.id"),
		);
	}

	async commitAutomaticAction(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
		mutation: WorkspaceMutationDraft;
	}): Promise<WorkspaceMutation> {
		const snapshot = validateWorkspacePersistenceSnapshot(input.snapshot);
		const binding = validatePersistenceBinding(input.binding);
		ensureIdentity(snapshot, binding);
		if (binding.syncMode !== "automatic" || binding.revision === null) {
			throw corrupt(
				"Automatic action requires an initialized automatic binding",
			);
		}
		return this.backend.transact((draft, checkpoint) => {
			if (
				!draft.binding ||
				draft.binding.syncMode !== "automatic" ||
				!workspaceBindingsEqual(draft.binding, binding)
			) {
				throw corrupt("Automatic action uses a stale Workspace binding");
			}
			const queue =
				draft.workspaces[binding.workspaceId] ??
				createQueue(binding.workspaceId);
			const expected =
				queue.mutations.at(-1)?.expectedRevision === undefined
					? binding.revision
					: (queue.mutations.at(-1)?.expectedRevision as number) + 1;
			const mutation = validateMutation({
				...input.mutation,
				expectedRevision: expected,
			});
			if (mutation.workspaceId !== binding.workspaceId) {
				throw corrupt("Mutation and binding identities differ");
			}
			if (
				Object.values(draft.workspaces).some((workspace) =>
					workspace.mutations.some(
						(item) => item.mutationId === mutation.mutationId,
					),
				)
			) {
				throw corrupt("Mutation ID is already persisted");
			}
			const baseline = binding.baseline;
			if (!baseline) {
				throw corrupt("Automatic action requires a committed baseline");
			}
			const optimisticDocument = replayWorkspaceMutations(snapshot, baseline, [
				...queue.mutations,
				mutation,
			]);
			ensureSnapshotMatchesDocument(snapshot, binding, optimisticDocument);
			draft.snapshot = snapshot;
			checkpoint("after-snapshot");
			draft.binding = binding;
			checkpoint("after-binding");
			queue.mutations.push(mutation);
			draft.workspaces[binding.workspaceId] = queue;
			checkpoint("after-queue");
			return mutation;
		});
	}

	async commitExplicitAction(input: {
		binding: WorkspaceV2LocalState;
		mutation: WorkspaceMutationDraft;
		snapshot?: AppState;
	}): Promise<WorkspaceMutation> {
		const binding = validatePersistenceBinding(input.binding);
		const snapshot =
			input.snapshot === undefined
				? undefined
				: validateWorkspacePersistenceSnapshot(input.snapshot);
		if (
			(binding.syncMode !== "automatic" && binding.syncMode !== "manual") ||
			binding.revision === null ||
			binding.baseline === null
		) {
			throw corrupt(
				"Explicit actions require an initialized active Workspace binding",
			);
		}
		const baseline = binding.baseline;
		const bindingRevision = binding.revision;
		if (snapshot) ensureIdentity(snapshot, binding);
		return this.backend.transact((draft, checkpoint) => {
			if (!draft.binding || !workspaceBindingsEqual(draft.binding, binding)) {
				throw corrupt("Explicit action uses a stale Workspace binding");
			}
			const queue =
				draft.workspaces[binding.workspaceId] ??
				createQueue(binding.workspaceId);
			const expected =
				queue.mutations.at(-1)?.expectedRevision === undefined
					? bindingRevision
					: (queue.mutations.at(-1)?.expectedRevision as number) + 1;
			const mutation = validateMutation({
				...input.mutation,
				expectedRevision: expected,
			});
			if (mutation.workspaceId !== binding.workspaceId) {
				throw corrupt("Mutation and binding identities differ");
			}
			if (
				Object.values(draft.workspaces).some((workspace) =>
					workspace.mutations.some(
						(item) => item.mutationId === mutation.mutationId,
					),
				)
			) {
				throw corrupt("Mutation ID is already persisted");
			}
			const snapshotSource = snapshot ?? draft.snapshot;
			if (!snapshotSource) {
				throw corrupt("Explicit action requires a persisted snapshot");
			}
			const optimisticDocument = replayWorkspaceMutations(
				snapshotSource,
				baseline,
				[...queue.mutations, mutation],
			);
			const committedSnapshot =
				snapshot ??
				hydrateAppStateFromWorkspaceDocument(
					snapshotSource,
					optimisticDocument,
					binding.gistId,
				);
			if (snapshot) {
				ensureSnapshotMatchesDocument(snapshot, binding, optimisticDocument);
			}
			draft.snapshot = committedSnapshot;
			checkpoint("after-snapshot");
			draft.binding = binding;
			checkpoint("after-binding");
			queue.mutations.push(mutation);
			draft.workspaces[binding.workspaceId] = queue;
			checkpoint("after-queue");
			return mutation;
		});
	}

	async commitLocalAction(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState | null;
	}): Promise<void> {
		const snapshot = validateWorkspacePersistenceSnapshot(input.snapshot);
		const binding = input.binding
			? validatePersistenceBinding(input.binding)
			: null;
		if (binding) ensureIdentity(snapshot, binding);
		if (binding?.syncMode === "automatic") {
			throw corrupt("Automatic bindings require an automatic action commit");
		}
		await this.backend.transact((draft, checkpoint) => {
			if (!workspaceBindingsEqual(draft.binding, binding)) {
				throw corrupt("Local action uses a stale Workspace binding");
			}
			draft.snapshot = snapshot;
			checkpoint("after-snapshot");
			draft.binding = binding;
			checkpoint("after-binding");
		});
	}

	async commitDeliverySuccess(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
		mutationId: string;
		fence: WorkspaceLeaseFence;
	}): Promise<void> {
		const snapshot = validateWorkspacePersistenceSnapshot(input.snapshot);
		const binding = validatePersistenceBinding(input.binding);
		ensureIdentity(snapshot, binding);
		await this.backend.transact((draft, checkpoint) => {
			const queue = draft.workspaces[binding.workspaceId];
			if (!queue || queue.mutations[0]?.mutationId !== input.mutationId) {
				throw corrupt("Delivery commit does not match the queue head");
			}
			const mutation = queue.mutations[0];
			ensureActiveDeliveryBinding(draft.binding, binding, mutation);
			assertActiveWorkspaceFence(
				draft,
				binding.workspaceId,
				input.fence,
				this.nowMs(),
			);
			const committedBaseline = ensureCommittedHead(binding, mutation);
			const remaining = queue.mutations.slice(1);
			validateWorkspaceMutationSequence(
				remaining,
				binding.workspaceId,
				committedBaseline.revision,
			);
			const optimisticDocument = replayWorkspaceMutations(
				snapshot,
				committedBaseline,
				remaining,
			);
			ensureSnapshotMatchesDocument(snapshot, binding, optimisticDocument);
			draft.snapshot = snapshot;
			checkpoint("after-snapshot");
			draft.binding = binding;
			checkpoint("after-binding");
			queue.mutations.shift();
			queue.delivery.retry = defaultRetry();
			queue.delivery.blocked = null;
			checkpoint("after-queue");
		});
	}

	async commitDeliveryConflict(input: {
		workspaceId: string;
		mutationId: string;
		document: WorkspaceDocumentV2;
		metadata: WorkspaceBlockedMutationMetadata;
		fence: WorkspaceLeaseFence;
	}): Promise<void> {
		const workspaceId = canonicalWorkspaceId(input.workspaceId, "workspaceId");
		const document = validateWorkspaceDocumentV2(input.document, {
			expectedWorkspaceId: workspaceId,
		});
		const blocked = validateBlocked(input.metadata);
		if (
			blocked.disposition !== "state-conflict" ||
			blocked.mutationId !== input.mutationId
		) {
			throw corrupt("Conflict metadata does not identify a state conflict");
		}
		await this.backend.transact((draft, checkpoint) => {
			const binding = draft.binding;
			const queue = draft.workspaces[workspaceId];
			const mutation = queue?.mutations[0];
			if (
				!binding ||
				binding.workspaceId !== workspaceId ||
				binding.syncMode === "paused-conflict" ||
				!mutation ||
				mutation.mutationId !== input.mutationId
			) {
				throw corrupt("Conflict commit uses a stale Workspace binding");
			}
			if (
				mutation.kind !== blocked.kind ||
				mutation.createdAt !== blocked.createdAt
			) {
				throw corrupt("Conflict metadata does not match the queue head");
			}
			assertActiveWorkspaceFence(draft, workspaceId, input.fence, this.nowMs());
			const paused = createWorkspaceV2LocalState(binding.gistId, {
				baseline: document,
				conflictBaseline: binding.conflictBaseline ?? binding.baseline,
				syncMode: "paused-conflict",
			});
			draft.binding = paused;
			checkpoint("after-binding");
			queue.delivery.blocked = blocked;
			queue.delivery.retry = defaultRetry();
			delete draft.leases[workspaceDispatcherLeaseName(workspaceId)];
			checkpoint("after-queue");
		});
	}

	async commitRecoveredDelivery(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
		mutationId: string;
		committedBaseline: WorkspaceDocumentV2;
		blocked: WorkspaceBlockedMutationMetadata | null;
		fence: WorkspaceLeaseFence;
	}): Promise<void> {
		const snapshot = validateWorkspacePersistenceSnapshot(input.snapshot);
		const binding = validatePersistenceBinding(input.binding);
		const committedBaseline = validateWorkspaceDocumentV2(
			input.committedBaseline,
			{ expectedWorkspaceId: binding.workspaceId },
		);
		const blocked =
			input.blocked === null ? null : validateBlocked(input.blocked);
		if (binding.revision === null || binding.baseline === null) {
			throw corrupt("Recovered delivery requires an initialized binding");
		}
		const bindingRevision = binding.revision;
		ensureIdentity(snapshot, binding);
		await this.backend.transact((draft, checkpoint) => {
			const active = draft.binding;
			const queue = draft.workspaces[binding.workspaceId];
			const mutation = queue?.mutations[0];
			if (
				!active ||
				active.workspaceId !== binding.workspaceId ||
				(active.syncMode !== "automatic" && active.syncMode !== "manual") ||
				active.revision !== mutation?.expectedRevision ||
				active.baseline === null ||
				!mutation ||
				mutation.mutationId !== input.mutationId
			) {
				throw corrupt("Recovered delivery uses a stale Workspace binding");
			}
			assertActiveWorkspaceFence(
				draft,
				binding.workspaceId,
				input.fence,
				this.nowMs(),
			);
			const gist: Pick<GistMeta, "id" | "ownerLogin" | "files"> =
				snapshot.gists.find((entry) => entry.id === active.gistId) ?? {
					id: active.gistId,
					files: [],
				};
			let recoveredHead: WorkspaceDocumentV2;
			try {
				recoveredHead = applyWorkspaceMutation(active.baseline, mutation, {
					committedAt: committedBaseline.updatedAt,
					gist,
				}).document;
			} catch (error) {
				throw corrupt("Recovered delivery head cannot be replayed", error);
			}
			if (JSON.stringify(recoveredHead) !== JSON.stringify(committedBaseline)) {
				throw corrupt("Recovered delivery does not prove the queue head");
			}
			const remaining = queue.mutations.slice(1);
			if (remaining.length === 0) {
				if (
					blocked !== null ||
					binding.syncMode !== active.syncMode ||
					binding.conflictBaseline !== null ||
					binding.baseline === null ||
					bindingRevision <= mutation.expectedRevision + 1
				) {
					throw corrupt("Recovered delivery state is invalid");
				}
				ensureSnapshotMatchesQueue(snapshot, binding, []);
			} else {
				const recoveredBaseline = binding.conflictBaseline;
				const next = remaining[0];
				if (
					binding.syncMode !== "paused-conflict" ||
					binding.baseline === null ||
					bindingRevision <= mutation.expectedRevision + 1 ||
					!recoveredBaseline ||
					JSON.stringify(recoveredBaseline) !==
						JSON.stringify(committedBaseline) ||
					!blocked ||
					blocked.disposition !== "state-conflict" ||
					blocked.mutationId !== next?.mutationId ||
					blocked.kind !== next.kind ||
					blocked.createdAt !== next.createdAt
				) {
					throw corrupt("Recovered delivery conflict state is invalid");
				}
				validateWorkspaceMutationSequence(
					remaining,
					binding.workspaceId,
					recoveredBaseline.revision,
				);
				const optimisticDocument = replayWorkspaceMutations(
					snapshot,
					recoveredBaseline,
					remaining,
				);
				ensureSnapshotMatchesDocument(snapshot, binding, optimisticDocument);
			}
			draft.snapshot = snapshot;
			checkpoint("after-snapshot");
			draft.binding = binding;
			checkpoint("after-binding");
			queue.mutations.shift();
			queue.delivery.retry = defaultRetry();
			queue.delivery.blocked = blocked;
			if (blocked) {
				delete draft.leases[workspaceDispatcherLeaseName(binding.workspaceId)];
			}
			checkpoint("after-queue");
		});
	}

	async setRetryMetadata(
		workspaceId: string,
		mutationId: string,
		metadata: WorkspaceRetryMetadata,
		fence: WorkspaceLeaseFence,
	): Promise<void> {
		workspaceId = canonicalWorkspaceId(workspaceId, "workspaceId");
		const retry = validateRetryInput(metadata);
		await this.backend.transact((draft) => {
			assertActiveWorkspaceFence(draft, workspaceId, fence, this.nowMs());
			const queue = draft.workspaces[workspaceId];
			if (!queue || queue.mutations[0]?.mutationId !== mutationId) {
				throw corrupt("Retry metadata does not match the queue head");
			}
			queue.delivery.retry = retry;
		});
	}

	async blockMutation(
		workspaceId: string,
		metadata: WorkspaceBlockedMutationMetadata,
		fence: WorkspaceLeaseFence,
	): Promise<void> {
		workspaceId = canonicalWorkspaceId(workspaceId, "workspaceId");
		const blocked = validateBlocked(metadata);
		await this.backend.transact((draft) => {
			assertActiveWorkspaceFence(draft, workspaceId, fence, this.nowMs());
			const queue = draft.workspaces[workspaceId];
			if (queue?.mutations[0]?.mutationId !== blocked.mutationId) {
				throw corrupt("Blocked mutation does not match the queue head");
			}
			if (
				queue.mutations[0].kind !== blocked.kind ||
				queue.mutations[0].createdAt !== blocked.createdAt
			) {
				throw corrupt("Blocked metadata does not match the queue head");
			}
			queue.delivery.blocked = blocked;
			queue.delivery.retry = defaultRetry();
		});
	}

	async inspectQueues(
		activeWorkspaceId: string | null = null,
	): Promise<WorkspaceQueueInspection> {
		if (activeWorkspaceId !== null) {
			activeWorkspaceId = canonicalWorkspaceId(
				activeWorkspaceId,
				"activeWorkspaceId",
			);
		}
		const record = await this.read();
		const workspaces = Object.values(record.workspaces)
			.filter(
				(queue) =>
					queue.mutations.length > 0 ||
					queue.delivery.blocked !== null ||
					queue.delivery.deadLetters.length > 0,
			)
			.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))
			.map((queue) => ({
				workspaceId: queue.workspaceId,
				active: queue.workspaceId === activeWorkspaceId,
				mutations: queue.mutations.map((mutation) => ({
					mutationId: mutation.mutationId,
					workspaceId: mutation.workspaceId,
					expectedRevision: mutation.expectedRevision,
					createdAt: mutation.createdAt,
					kind: mutation.kind,
					payloadBytes: payloadBytes(mutation),
				})),
				retry: queue.delivery.retry,
				blocked: queue.delivery.blocked,
				deadLetters: queue.delivery.deadLetters,
			}));
		return {
			activeWorkspaceId,
			activeQueueCount:
				workspaces.find((workspace) => workspace.active)?.mutations.length ?? 0,
			totalQueueCount: workspaces.reduce(
				(total, workspace) => total + workspace.mutations.length,
				0,
			),
			orphanedWorkspaceCount: workspaces.filter(
				(workspace) => !workspace.active,
			).length,
			blockedCount: workspaces.filter((workspace) => workspace.blocked).length,
			deadLetterCount: workspaces.reduce(
				(total, workspace) => total + workspace.deadLetters.length,
				0,
			),
			workspaces,
		};
	}

	async discardWorkspaceQueue(input: {
		workspaceId: string;
		snapshot?: AppState;
		binding?: WorkspaceV2LocalState;
	}): Promise<number> {
		const workspaceId = canonicalWorkspaceId(input.workspaceId, "workspaceId");
		return this.backend.transact((draft, checkpoint) => {
			const count = draft.workspaces[workspaceId]?.mutations.length ?? 0;
			const active = draft.binding?.workspaceId === workspaceId;
			if (active) {
				if (!input.snapshot || !input.binding) {
					throw corrupt("Active queue discard requires baseline realignment");
				}
				const snapshot = validateWorkspacePersistenceSnapshot(input.snapshot);
				const binding = validatePersistenceBinding(input.binding);
				ensureIdentity(snapshot, binding);
				if (binding.workspaceId !== workspaceId) {
					throw corrupt("Discard realignment belongs to another Workspace");
				}
				ensureSnapshotMatchesQueue(snapshot, binding, []);
				draft.snapshot = snapshot;
				draft.binding = binding;
			}
			delete draft.workspaces[workspaceId];
			delete draft.leases[workspaceDispatcherLeaseName(workspaceId)];
			checkpoint("after-queue");
			return count;
		});
	}

	async rebindWorkspace(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
	}): Promise<void> {
		const snapshot = validateWorkspacePersistenceSnapshot(input.snapshot);
		const binding = validatePersistenceBinding(input.binding);
		ensureIdentity(snapshot, binding);
		await this.backend.transact((draft, checkpoint) => {
			const previousWorkspaceId = draft.binding?.workspaceId;
			const queue = draft.workspaces[binding.workspaceId];
			if (queue?.mutations.length && binding.revision === null) {
				throw corrupt("Cannot rebind a nonempty queue without a revision");
			}
			if (queue?.mutations.length) {
				validateWorkspaceMutationSequence(
					queue.mutations,
					binding.workspaceId,
					binding.revision as number,
				);
			}
			ensureSnapshotMatchesQueue(snapshot, binding, queue?.mutations ?? []);
			draft.snapshot = snapshot;
			checkpoint("after-snapshot");
			draft.binding = binding;
			if (previousWorkspaceId) {
				delete draft.leases[workspaceDispatcherLeaseName(previousWorkspaceId)];
			}
			delete draft.leases[workspaceDispatcherLeaseName(binding.workspaceId)];
			checkpoint("after-binding");
		});
	}

	async repairWorkspaceQueue(input: {
		snapshot: AppState;
		binding: WorkspaceV2LocalState;
		mutations: WorkspaceMutation[];
		blocked?: WorkspaceBlockedMutationMetadata;
	}): Promise<void> {
		const snapshot = validateWorkspacePersistenceSnapshot(input.snapshot);
		const binding = validatePersistenceBinding(input.binding);
		ensureIdentity(snapshot, binding);
		const mutations = validateWorkspaceMutationSequence(
			input.mutations,
			binding.workspaceId,
			binding.revision ?? undefined,
		);
		if (mutations.length > 0 && binding.revision === null) {
			throw corrupt("Cannot repair a nonempty queue without a revision");
		}
		const blocked = input.blocked ? validateBlocked(input.blocked) : null;
		if (blocked) {
			const head = mutations[0];
			if (
				binding.syncMode !== "paused-conflict" ||
				blocked.disposition !== "state-conflict" ||
				!head ||
				blocked.mutationId !== head.mutationId ||
				blocked.kind !== head.kind ||
				blocked.createdAt !== head.createdAt
			) {
				throw corrupt(
					"Blocked queue repair must identify a paused state conflict",
				);
			}
		}
		ensureSnapshotMatchesQueue(snapshot, binding, mutations);
		await this.backend.transact((draft, checkpoint) => {
			const previousWorkspaceId = draft.binding?.workspaceId;
			draft.snapshot = snapshot;
			checkpoint("after-snapshot");
			draft.binding = binding;
			checkpoint("after-binding");
			const queue = createQueue(binding.workspaceId, mutations);
			queue.delivery.blocked = blocked;
			draft.workspaces[binding.workspaceId] = queue;
			if (previousWorkspaceId) {
				delete draft.leases[workspaceDispatcherLeaseName(previousWorkspaceId)];
			}
			delete draft.leases[workspaceDispatcherLeaseName(binding.workspaceId)];
			checkpoint("after-queue");
		});
	}

	async quarantineWorkspaceQueue(input: {
		workspaceId: string;
		reason: string;
		code?: string;
		createdAt: string;
		fence: WorkspaceLeaseFence;
	}): Promise<void> {
		const workspaceId = canonicalWorkspaceId(input.workspaceId, "workspaceId");
		const code = allowedMetadata(
			input.code ?? "queue_corruption",
			"quarantine.code",
			SAFE_ERROR_CODES,
		);
		await this.backend.transact((draft, checkpoint) => {
			assertActiveWorkspaceFence(draft, workspaceId, input.fence, this.nowMs());
			const queue = draft.workspaces[workspaceId];
			if (!queue) return;
			const raw = JSON.stringify(queue.mutations);
			const bytes = new TextEncoder().encode(raw).byteLength;
			const id = `queue:${workspaceId}:${input.createdAt}`;
			if (draft.quarantines.some((entry) => entry.id === id)) {
				throw corrupt("Workspace queue is already quarantined");
			}
			draft.quarantines.push({
				id,
				source: `queue:${workspaceId}`,
				reason: allowedMetadata(
					input.reason,
					"quarantine.reason",
					SAFE_QUARANTINE_REASONS,
				),
				bytes,
				createdAt: canonicalTimestamp(input.createdAt, "quarantine.createdAt"),
			});
			draft.quarantinePayloads[id] = raw;
			queue.delivery.deadLetters.push(
				...queue.mutations.map((mutation) => ({
					mutationId: mutation.mutationId,
					kind: mutation.kind,
					code,
					disposition: "queue-corruption" as const,
					messageKey: null,
					createdAt: mutation.createdAt,
					blockedAt: input.createdAt,
					payloadBytes: payloadBytes(mutation),
				})),
			);
			queue.mutations = [];
			queue.delivery.blocked = null;
			queue.delivery.retry = defaultRetry();
			checkpoint("after-queue");
		});
	}

	async acquireLease(input: {
		name: string;
		ownerId: string;
		now: number;
		ttlMs: number;
	}): Promise<WorkspaceLeaseAcquireResult> {
		const name = validateLeaseInput(
			input.name,
			input.ownerId,
			input.now,
			input.ttlMs,
		);
		return this.backend.transact((draft) => {
			const current = draft.leases[name];
			if (
				current &&
				current.expiresAt > input.now &&
				current.ownerId !== input.ownerId
			) {
				return { acquired: false as const, lease: current };
			}
			if (
				current &&
				current.expiresAt > input.now &&
				current.ownerId === input.ownerId
			) {
				current.heartbeatAt = input.now;
				current.expiresAt = input.now + input.ttlMs;
				return { acquired: true as const, lease: current };
			}
			const lease: WorkspaceDispatcherLease = {
				name,
				ownerId: input.ownerId,
				fencingToken: draft.nextFencingToken,
				expiresAt: input.now + input.ttlMs,
				heartbeatAt: input.now,
			};
			draft.nextFencingToken += 1;
			draft.leases[name] = lease;
			return { acquired: true as const, lease };
		});
	}

	async renewLease(input: {
		name: string;
		ownerId: string;
		fencingToken: number;
		now: number;
		ttlMs: number;
	}): Promise<WorkspaceDispatcherLease | null> {
		const name = validateLeaseInput(
			input.name,
			input.ownerId,
			input.now,
			input.ttlMs,
		);
		return this.backend.transact((draft) => {
			const current = draft.leases[name];
			if (
				!current ||
				current.ownerId !== input.ownerId ||
				current.fencingToken !== input.fencingToken ||
				current.expiresAt <= input.now
			) {
				return null;
			}
			current.heartbeatAt = input.now;
			current.expiresAt = input.now + input.ttlMs;
			return current;
		});
	}

	async releaseLease(input: {
		name: string;
		ownerId: string;
		fencingToken: number;
	}): Promise<boolean> {
		const name = canonicalDispatcherLeaseName(input.name, "lease.name");
		const ownerId = safeMetadataKey(input.ownerId, "lease.ownerId");
		const fencingToken = safeInteger(
			input.fencingToken,
			"lease.fencingToken",
			1,
		);
		return this.backend.transact((draft) => {
			const current = draft.leases[name];
			if (
				!current ||
				current.ownerId !== ownerId ||
				current.fencingToken !== fencingToken
			) {
				return false;
			}
			delete draft.leases[name];
			return true;
		});
	}

	async importLegacy(input: LegacyWorkspaceImport): Promise<void> {
		const snapshot = input.snapshot
			? validateWorkspacePersistenceSnapshot(input.snapshot)
			: null;
		const binding = input.binding
			? validatePersistenceBinding(input.binding)
			: null;
		const mutations = validateWorkspaceMutationSequence(input.mutations);
		await this.backend.transact((draft, checkpoint) => {
			if (draft.migration.phase !== "not-started") return;
			if (draft.snapshot === null && snapshot) draft.snapshot = snapshot;
			checkpoint("after-snapshot");
			if (draft.binding === null && binding) draft.binding = binding;
			checkpoint("after-binding");
			for (const mutation of mutations) {
				const queue =
					draft.workspaces[mutation.workspaceId] ??
					createQueue(mutation.workspaceId);
				if (queue.mutations.length === 0) queue.mutations = [];
				queue.mutations.push(mutation);
				draft.workspaces[mutation.workspaceId] = queue;
			}
			draft.quarantines.push(...input.quarantines);
			Object.assign(draft.quarantinePayloads, input.quarantinePayloads);
			draft.migration = {
				version: 1,
				phase: "copied",
				startedAt: input.startedAt,
				copiedAt: input.copiedAt,
				validatedAt: null,
				updatedAt: input.copiedAt,
				confirmedAt: null,
				cleanupCompletedAt: null,
			};
			checkpoint("after-queue");
		});
	}

	async validateLegacyMigration(validatedAt: string): Promise<void> {
		await this.backend.transact((draft) => {
			if (
				draft.migration.phase === "validated" ||
				draft.migration.phase === "confirmed"
			) {
				return;
			}
			if (draft.migration.phase !== "copied") {
				throw corrupt("Legacy migration has not been copied");
			}
			draft.migration = {
				...draft.migration,
				phase: "validated",
				updatedAt: nonempty(validatedAt, "migration.validatedAt"),
				validatedAt: nonempty(validatedAt, "migration.validatedAt"),
			};
		});
	}

	async confirmLegacyMigration(confirmedAt: string): Promise<void> {
		await this.backend.transact((draft) => {
			if (draft.migration.phase === "confirmed") return;
			if (draft.migration.phase !== "validated") {
				throw corrupt("Legacy migration has not been validated");
			}
			draft.migration = {
				...draft.migration,
				phase: "confirmed",
				updatedAt: nonempty(confirmedAt, "migration.confirmedAt"),
				confirmedAt: nonempty(confirmedAt, "migration.confirmedAt"),
			};
		});
	}

	async completeLegacyCleanup(completedAt: string): Promise<void> {
		await this.backend.transact((draft) => {
			if (draft.migration.phase !== "confirmed") {
				throw corrupt("Legacy migration has not been confirmed");
			}
			if (draft.migration.cleanupCompletedAt !== null) return;
			draft.migration = {
				...draft.migration,
				updatedAt: nonempty(completedAt, "migration.cleanupCompletedAt"),
				cleanupCompletedAt: nonempty(
					completedAt,
					"migration.cleanupCompletedAt",
				),
			};
		});
	}

	close(): void {
		this.backend.close?.();
	}
}

function validateLeaseInput(
	name: string,
	ownerId: string,
	now: number,
	ttlMs: number,
): string {
	const canonicalName = canonicalDispatcherLeaseName(name, "lease.name");
	safeMetadataKey(ownerId, "lease.ownerId");
	safeInteger(now, "lease.now");
	safeInteger(ttlMs, "lease.ttlMs", 1);
	return canonicalName;
}

export class InMemoryWorkspacePersistenceBackend
	implements WorkspacePersistenceBackend
{
	private record: WorkspacePersistenceRoot;
	private fault: WorkspacePersistenceFaultPoint | null = null;
	private faultCode: Extract<
		WorkspacePersistenceErrorCode,
		"transaction-aborted" | "quota-exceeded" | "upgrade-failed"
	> = "transaction-aborted";

	constructor(
		initial: WorkspacePersistenceRecord = createEmptyWorkspacePersistenceRecord(),
		private readonly now: () => string = () => new Date().toISOString(),
	) {
		this.record = recoverWorkspacePersistenceRecord(
			persistenceRootInput(initial),
			this.now(),
		);
	}

	setFault(
		point: WorkspacePersistenceFaultPoint | null,
		code: Extract<
			WorkspacePersistenceErrorCode,
			"transaction-aborted" | "quota-exceeded" | "upgrade-failed"
		> = "transaction-aborted",
	): void {
		this.fault = point;
		this.faultCode = code;
	}

	async read(): Promise<WorkspacePersistenceRoot> {
		return clone(recoverWorkspacePersistenceRecord(this.record, this.now()));
	}

	async readQuarantinePayloadForRepair(id: string): Promise<string | null> {
		return (await this.read()).quarantinePayloads[id] ?? null;
	}

	async transact<T>(
		mutate: (
			draft: WorkspacePersistenceRoot,
			checkpoint: PersistenceCheckpoint,
		) => T,
	): Promise<T> {
		this.checkpoint("before-transaction");
		const draft = recoverWorkspacePersistenceRecord(this.record, this.now());
		const result = mutate(draft, (point) => this.checkpoint(point));
		this.checkpoint("before-commit");
		this.record = validateWorkspacePersistenceRecordInternal(draft);
		this.checkpoint("after-commit");
		return clone(result);
	}

	private checkpoint(point: WorkspacePersistenceFaultPoint): void {
		if (this.fault !== point) return;
		this.fault = null;
		throw new WorkspacePersistenceError(
			this.faultCode,
			`Injected persistence failure at ${point}`,
		);
	}
}

export class InMemoryWorkspacePersistence extends TransactionalWorkspacePersistence {
	readonly memoryBackend: InMemoryWorkspacePersistenceBackend;

	constructor(
		initial?: WorkspacePersistenceRecord,
		nowMs: () => number = () => Date.now(),
	) {
		const backend = new InMemoryWorkspacePersistenceBackend(initial);
		super(backend, nowMs);
		this.memoryBackend = backend;
	}

	setFault(
		point: WorkspacePersistenceFaultPoint | null,
		code: Extract<
			WorkspacePersistenceErrorCode,
			"transaction-aborted" | "quota-exceeded" | "upgrade-failed"
		> = "transaction-aborted",
	): void {
		this.memoryBackend.setFault(point, code);
	}
}

export class IndexedDbWorkspacePersistenceBackend
	implements WorkspacePersistenceBackend
{
	private databasePromise: Promise<IDBDatabase> | null = null;

	constructor(
		private readonly factory: IDBFactory | undefined = typeof indexedDB ===
		"undefined"
			? undefined
			: indexedDB,
		private readonly databaseName = WORKSPACE_PERSISTENCE_DATABASE,
		private readonly now: () => string = () => new Date().toISOString(),
	) {}

	async read(): Promise<WorkspacePersistenceRoot> {
		const database = await this.open();
		return new Promise((resolve, reject) => {
			let settled = false;
			let result: WorkspacePersistenceRoot | null = null;
			const transaction = database.transaction(
				WORKSPACE_PERSISTENCE_STORE,
				"readonly",
			);
			const request = transaction
				.objectStore(WORKSPACE_PERSISTENCE_STORE)
				.get(WORKSPACE_PERSISTENCE_ROOT_KEY);
			request.onsuccess = () => {
				try {
					const value =
						request.result ?? createEmptyWorkspacePersistenceRecord();
					result = recoverWorkspacePersistenceRecord(
						persistenceRootInput(value),
						this.now(),
					);
				} catch (error) {
					settled = true;
					reject(normalizeError(error, "transaction-aborted"));
				}
			};
			request.onerror = () =>
				reject(normalizeError(request.error, "transaction-aborted"));
			transaction.onabort = () => {
				if (!settled)
					reject(normalizeError(transaction.error, "transaction-aborted"));
			};
			transaction.onerror = () => {
				if (!settled)
					reject(normalizeError(transaction.error, "transaction-aborted"));
			};
			transaction.oncomplete = () => {
				if (settled) return;
				settled = true;
				resolve(
					result ??
						recoverWorkspacePersistenceRecord(
							persistenceRootInput(createEmptyWorkspacePersistenceRecord()),
							this.now(),
						),
				);
			};
		});
	}

	async readQuarantinePayloadForRepair(id: string): Promise<string | null> {
		return (await this.read()).quarantinePayloads[id] ?? null;
	}

	async transact<T>(
		mutate: (
			draft: WorkspacePersistenceRoot,
			checkpoint: PersistenceCheckpoint,
		) => T,
	): Promise<T> {
		const database = await this.open();
		return new Promise((resolve, reject) => {
			let result: T;
			let completed = false;
			const transaction = database.transaction(
				WORKSPACE_PERSISTENCE_STORE,
				"readwrite",
			);
			const store = transaction.objectStore(WORKSPACE_PERSISTENCE_STORE);
			const request = store.get(WORKSPACE_PERSISTENCE_ROOT_KEY);
			request.onsuccess = () => {
				try {
					const draft = recoverWorkspacePersistenceRecord(
						persistenceRootInput(
							request.result ?? createEmptyWorkspacePersistenceRecord(),
						),
						this.now(),
					);
					result = mutate(draft, () => {});
					store.put(
						validateWorkspacePersistenceRecordInternal(draft),
						WORKSPACE_PERSISTENCE_ROOT_KEY,
					);
				} catch (error) {
					transaction.abort();
					reject(normalizeError(error, "transaction-aborted"));
				}
			};
			request.onerror = () =>
				reject(normalizeError(request.error, "transaction-aborted"));
			transaction.oncomplete = () => {
				completed = true;
				resolve(clone(result as T));
			};
			transaction.onerror = () => {
				if (!completed) {
					reject(normalizeError(transaction.error, "transaction-aborted"));
				}
			};
			transaction.onabort = () => {
				if (!completed) {
					reject(normalizeError(transaction.error, "transaction-aborted"));
				}
			};
		});
	}

	close(): void {
		void this.databasePromise?.then((database) => database.close());
		this.databasePromise = null;
	}

	private open(): Promise<IDBDatabase> {
		if (!this.factory) {
			return Promise.reject(
				new WorkspacePersistenceError(
					"unsupported",
					"This browser does not support transactional storage",
				),
			);
		}
		if (this.databasePromise) return this.databasePromise;
		this.databasePromise = new Promise((resolve, reject) => {
			let request: IDBOpenDBRequest;
			try {
				request = this.factory?.open(
					this.databaseName,
					WORKSPACE_PERSISTENCE_DATABASE_VERSION,
				) as IDBOpenDBRequest;
			} catch (error) {
				reject(normalizeError(error, "upgrade-failed"));
				return;
			}
			request.onupgradeneeded = () => {
				try {
					if (
						!request.result.objectStoreNames.contains(
							WORKSPACE_PERSISTENCE_STORE,
						)
					) {
						request.result.createObjectStore(WORKSPACE_PERSISTENCE_STORE);
					}
				} catch (error) {
					request.transaction?.abort();
					reject(normalizeError(error, "upgrade-failed"));
				}
			};
			request.onsuccess = () => {
				request.result.onversionchange = () => request.result.close();
				resolve(request.result);
			};
			request.onerror = () =>
				reject(normalizeError(request.error, "upgrade-failed"));
			request.onblocked = () =>
				reject(
					new WorkspacePersistenceError(
						"upgrade-failed",
						"Browser storage upgrade is blocked by another tab",
					),
				);
		});
		this.databasePromise.catch(() => {
			this.databasePromise = null;
		});
		return this.databasePromise;
	}
}

export class IndexedDbWorkspacePersistence extends TransactionalWorkspacePersistence {
	constructor(
		options: {
			factory?: IDBFactory;
			databaseName?: string;
			now?: () => string;
			nowMs?: () => number;
		} = {},
	) {
		super(
			new IndexedDbWorkspacePersistenceBackend(
				options.factory,
				options.databaseName,
				options.now,
			),
			options.nowMs,
		);
	}
}

function quarantine(
	source: string,
	raw: string,
	reason: string,
	createdAt: string,
): WorkspaceQuarantineMetadata {
	return {
		id: `legacy:${source}:${createdAt}`,
		source,
		reason,
		bytes: new TextEncoder().encode(raw).byteLength,
		createdAt,
	};
}

function retainQuarantine(
	quarantines: WorkspaceQuarantineMetadata[],
	payloads: Record<string, string>,
	source: string,
	raw: string,
	reason: string,
	createdAt: string,
): void {
	const metadata = quarantine(source, raw, reason, createdAt);
	quarantines.push(metadata);
	payloads[metadata.id] = raw;
}

function legacyQuarantineKeys(
	storage: Pick<Storage, "length" | "key">,
): string[] {
	const keys: string[] = [];
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (
			key &&
			LEGACY_KEYS.some((legacyKey) =>
				key.startsWith(`${legacyKey}:quarantine:`),
			)
		) {
			keys.push(key);
		}
	}
	return keys.sort();
}

function parseLegacySnapshot(raw: string): AppState {
	return validateWorkspacePersistenceSnapshot(JSON.parse(raw));
}

function parseLegacyBinding(raw: string): WorkspaceV2LocalState {
	const value = JSON.parse(raw) as unknown;
	const state =
		isRecord(value) && value.envelopeVersion === 1 && "state" in value
			? value.state
			: value;
	return validatePersistenceBinding(state);
}

function parseLegacyQueue(raw: string): WorkspaceMutation[] {
	const value = JSON.parse(raw) as unknown;
	if (
		!isRecord(value) ||
		(value.version !== 1 && value.version !== 2) ||
		!Array.isArray(value.mutations)
	) {
		throw corrupt("Legacy mutation queue is invalid");
	}
	return validateWorkspaceMutationSequence(value.mutations);
}

export async function migrateLegacyWorkspacePersistence(
	persistence: BrowserWorkspacePersistence,
	storage: Pick<Storage, "getItem" | "removeItem" | "length" | "key">,
	options: { now?: () => string } = {},
): Promise<WorkspacePersistenceMigration> {
	const now = options.now ?? (() => new Date().toISOString());
	let record = await persistence.read();

	if (record.migration.phase === "not-started") {
		const startedAt = now();
		const quarantines: WorkspaceQuarantineMetadata[] = [];
		const quarantinePayloads: Record<string, string> = {};
		let snapshot: AppState | null = null;
		let binding: WorkspaceV2LocalState | null = null;
		let mutations: WorkspaceMutation[] = [];
		const snapshotRaw = storage.getItem(LEGACY_APP_STATE_KEY);
		const bindingRaw = storage.getItem(LEGACY_WORKSPACE_STATE_KEY);
		const queueRaw = storage.getItem(LEGACY_MUTATION_QUEUE_KEY);
		if (snapshotRaw !== null) {
			try {
				snapshot = parseLegacySnapshot(snapshotRaw);
			} catch {
				retainQuarantine(
					quarantines,
					quarantinePayloads,
					LEGACY_APP_STATE_KEY,
					snapshotRaw,
					"invalid-legacy-snapshot",
					startedAt,
				);
			}
		}
		if (bindingRaw !== null) {
			try {
				binding = parseLegacyBinding(bindingRaw);
			} catch {
				retainQuarantine(
					quarantines,
					quarantinePayloads,
					LEGACY_WORKSPACE_STATE_KEY,
					bindingRaw,
					"invalid-legacy-binding",
					startedAt,
				);
			}
		}
		if (
			snapshot &&
			binding &&
			snapshot.activeGistId !== binding.gistId &&
			bindingRaw !== null
		) {
			retainQuarantine(
				quarantines,
				quarantinePayloads,
				LEGACY_WORKSPACE_STATE_KEY,
				bindingRaw,
				"legacy-identity-mismatch",
				startedAt,
			);
			binding = null;
		}
		if (queueRaw !== null) {
			try {
				mutations = parseLegacyQueue(queueRaw);
				if (binding?.revision !== null && binding) {
					const active = mutations.filter(
						(mutation) => mutation.workspaceId === binding?.workspaceId,
					);
					validateWorkspaceMutationSequence(
						active,
						binding.workspaceId,
						binding.revision,
					);
				}
			} catch {
				mutations = [];
				retainQuarantine(
					quarantines,
					quarantinePayloads,
					LEGACY_MUTATION_QUEUE_KEY,
					queueRaw,
					"invalid-legacy-queue",
					startedAt,
				);
			}
		}
		for (const key of legacyQuarantineKeys(storage)) {
			const raw = storage.getItem(key);
			if (raw === null) continue;
			retainQuarantine(
				quarantines,
				quarantinePayloads,
				key,
				raw,
				"legacy-quarantine",
				startedAt,
			);
		}
		await persistence.importLegacy({
			snapshot,
			binding,
			mutations,
			quarantines,
			quarantinePayloads,
			startedAt,
			copiedAt: now(),
		});
		record = await persistence.read();
	}

	if (record.migration.phase === "copied") {
		await persistence.validateLegacyMigration(now());
		record = await persistence.read();
	}
	if (record.migration.phase === "validated") {
		await persistence.confirmLegacyMigration(now());
		record = await persistence.read();
	}
	if (
		record.migration.phase === "confirmed" &&
		record.migration.cleanupCompletedAt === null
	) {
		const cleanupKeys = [...LEGACY_KEYS, ...legacyQuarantineKeys(storage)];
		for (const key of cleanupKeys) storage.removeItem(key);
		await persistence.completeLegacyCleanup(now());
	}
	return (await persistence.read()).migration;
}

export function classifyWorkspacePersistenceError(
	error: unknown,
): WorkspacePersistenceError {
	return normalizeError(error, "transaction-aborted");
}
