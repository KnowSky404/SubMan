import type { AppState } from "$lib/models";
import type { WorkspaceFailureDisposition } from "$lib/workspace-failure-disposition";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import type { WorkspaceSyncMode } from "$lib/workspace-sync-state-machine";

const DIAGNOSTICS_KIND = "subman-workspace-diagnostics";
const SAFE_METADATA_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

const SYNC_MODES = new Set<WorkspaceSyncMode>([
	"local",
	"automatic",
	"manual",
	"paused-conflict",
	"disconnected",
]);

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

export type WorkspaceDiagnosticsMutationSource = {
	mutationId: string;
	workspaceId: string;
	expectedRevision: number;
	createdAt: string;
	kind: WorkspaceMutation["kind"];
	payload: unknown;
};

export type WorkspaceDiagnosticsMutation = Omit<
	WorkspaceDiagnosticsMutationSource,
	"payload"
> & {
	payloadBytes: number;
	payloadSha256: string;
};

export type WorkspaceDiagnosticsCounts = {
	nodes: number;
	subscriptions: number;
	aggregates: number;
	publishTargets: number;
	clientExports: number;
	activeQueue: number;
	totalQueue: number;
	orphanedWorkspaces: number;
	blockedMutations: number;
	deadLetters: number;
};

export type WorkspaceDiagnosticsRetry = {
	attempt: number;
	nextAttemptAt: number | null;
	retryAfterMs: number | null;
	lastErrorCode: string | null;
};

export type WorkspaceDiagnosticsError = {
	code: string;
	disposition: WorkspaceFailureDisposition;
};

export type WorkspaceDiagnosticsQuarantine = {
	key: string;
	bytes: number;
	createdAt: string;
};

export type WorkspaceDiagnosticsSnapshot = {
	workspace: {
		workspaceId: string;
		revision: number | null;
		mode: WorkspaceSyncMode;
	} | null;
	counts: WorkspaceDiagnosticsCounts;
	mutations: readonly WorkspaceDiagnosticsMutation[];
	retry: WorkspaceDiagnosticsRetry | null;
	errors: readonly WorkspaceDiagnosticsError[];
	quarantines: readonly WorkspaceDiagnosticsQuarantine[];
};

function invalidMetadata(): never {
	throw new TypeError("Workspace diagnostics metadata is invalid");
}

function safeMetadataKey(value: unknown): string {
	if (typeof value !== "string" || !SAFE_METADATA_KEY.test(value)) {
		invalidMetadata();
	}
	return value;
}

function safeTimestamp(value: unknown): string {
	if (
		typeof value !== "string" ||
		!CANONICAL_ISO_TIMESTAMP.test(value) ||
		!Number.isFinite(Date.parse(value))
	) {
		invalidMetadata();
	}
	return value;
}

function safeInteger(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) invalidMetadata();
	return value as number;
}

function safeNullableInteger(value: unknown): number | null {
	return value === null ? null : safeInteger(value);
}

function safeDisposition(value: unknown): WorkspaceFailureDisposition {
	if (
		typeof value !== "string" ||
		!DISPOSITIONS.has(value as WorkspaceFailureDisposition)
	) {
		invalidMetadata();
	}
	return value as WorkspaceFailureDisposition;
}

function safeMode(value: unknown): WorkspaceSyncMode {
	if (
		typeof value !== "string" ||
		!SYNC_MODES.has(value as WorkspaceSyncMode)
	) {
		invalidMetadata();
	}
	return value as WorkspaceSyncMode;
}

function hex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function createWorkspaceMutationDiagnostics(
	mutation: WorkspaceDiagnosticsMutationSource,
): Promise<WorkspaceDiagnosticsMutation> {
	const serializedPayload = JSON.stringify(mutation.payload);
	if (typeof serializedPayload !== "string") invalidMetadata();
	const payload = new TextEncoder().encode(serializedPayload);
	const payloadSha256 = hex(await crypto.subtle.digest("SHA-256", payload));
	if (!MUTATION_KINDS.has(mutation.kind)) invalidMetadata();
	return {
		mutationId: safeMetadataKey(mutation.mutationId),
		workspaceId: safeMetadataKey(mutation.workspaceId),
		expectedRevision: safeInteger(mutation.expectedRevision),
		createdAt: safeTimestamp(mutation.createdAt),
		kind: mutation.kind,
		payloadBytes: payload.byteLength,
		payloadSha256,
	};
}

function safeCounts(
	counts: WorkspaceDiagnosticsCounts,
): WorkspaceDiagnosticsCounts {
	return {
		nodes: safeInteger(counts.nodes),
		subscriptions: safeInteger(counts.subscriptions),
		aggregates: safeInteger(counts.aggregates),
		publishTargets: safeInteger(counts.publishTargets),
		clientExports: safeInteger(counts.clientExports),
		activeQueue: safeInteger(counts.activeQueue),
		totalQueue: safeInteger(counts.totalQueue),
		orphanedWorkspaces: safeInteger(counts.orphanedWorkspaces),
		blockedMutations: safeInteger(counts.blockedMutations),
		deadLetters: safeInteger(counts.deadLetters),
	};
}

function safeMutation(
	mutation: WorkspaceDiagnosticsMutation,
): WorkspaceDiagnosticsMutation {
	if (
		!MUTATION_KINDS.has(mutation.kind) ||
		!SHA256.test(mutation.payloadSha256)
	) {
		invalidMetadata();
	}
	return {
		mutationId: safeMetadataKey(mutation.mutationId),
		workspaceId: safeMetadataKey(mutation.workspaceId),
		expectedRevision: safeInteger(mutation.expectedRevision),
		createdAt: safeTimestamp(mutation.createdAt),
		kind: mutation.kind,
		payloadBytes: safeInteger(mutation.payloadBytes),
		payloadSha256: mutation.payloadSha256,
	};
}

function safeRetry(
	retry: WorkspaceDiagnosticsRetry | null,
): WorkspaceDiagnosticsRetry | null {
	if (retry === null) return null;
	return {
		attempt: safeInteger(retry.attempt),
		nextAttemptAt: safeNullableInteger(retry.nextAttemptAt),
		retryAfterMs: safeNullableInteger(retry.retryAfterMs),
		lastErrorCode:
			retry.lastErrorCode === null
				? null
				: safeMetadataKey(retry.lastErrorCode),
	};
}

function safeExportedAt(now: () => Date): string {
	const exportedAt = now().toISOString();
	return safeTimestamp(exportedAt);
}

export async function exportWorkspaceDiagnosticsSnapshot(
	snapshot: WorkspaceDiagnosticsSnapshot,
	now: () => Date = () => new Date(),
): Promise<string> {
	const workspace = snapshot.workspace
		? {
				workspaceId: safeMetadataKey(snapshot.workspace.workspaceId),
				revision: safeNullableInteger(snapshot.workspace.revision),
				mode: safeMode(snapshot.workspace.mode),
			}
		: null;
	const diagnostics = {
		version: 2,
		kind: DIAGNOSTICS_KIND,
		exportedAt: safeExportedAt(now),
		workspace,
		counts: safeCounts(snapshot.counts),
		mutations: snapshot.mutations.map(safeMutation),
		retry: safeRetry(snapshot.retry),
		errors: snapshot.errors.map((error) => ({
			code: safeMetadataKey(error.code),
			disposition: safeDisposition(error.disposition),
		})),
		quarantines: snapshot.quarantines.map((quarantine) => ({
			key: safeMetadataKey(quarantine.key),
			bytes: safeInteger(quarantine.bytes),
			createdAt: safeTimestamp(quarantine.createdAt),
		})),
	};
	return JSON.stringify(diagnostics, null, 2);
}

// Compatibility path until the UI is wired to the async persistence snapshot.
export function exportWorkspaceDiagnostics(
	state: AppState,
	now: () => Date = () => new Date(),
): string {
	const workspaceId = state.activeGistId
		? `gist:${safeMetadataKey(state.activeGistId)}`
		: null;
	return JSON.stringify(
		{
			version: 2,
			kind: DIAGNOSTICS_KIND,
			exportedAt: safeExportedAt(now),
			workspace: workspaceId
				? { workspaceId, revision: null, mode: null }
				: null,
			counts: {
				nodes: state.nodes.length,
				subscriptions: state.subscriptions.length,
				aggregates: state.aggregates.length,
				publishTargets: state.publishTargets.length,
				clientExports: state.clientExports.length,
			},
			mutations: [],
			retry: null,
			errors: [],
			quarantines: [],
		},
		null,
		2,
	);
}
