import type { WorkspaceCoordinatorResult } from "$lib/server/workspace-coordinator-core";
import type { LocalWorkspaceBinding } from "$lib/workspace-document";
import {
	validateWorkspaceDocumentV2,
	validateWorkspaceTimestamp,
	validateWorkspaceUuid,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import { broadcastWorkspaceEvent } from "$lib/workspace-events";
import {
	classifyWorkspaceFailure,
	type WorkspaceFailureDisposition,
} from "$lib/workspace-failure-disposition";
import { withWorkspaceLock } from "$lib/workspace-lock";
import {
	parseWorkspaceMutation,
	serializeWorkspaceMutation,
	type WorkspaceMutation,
	type WorkspaceMutationReceipt,
} from "$lib/workspace-mutation";
import {
	reportWorkspaceStorageRecovery,
	updateWorkspaceQueueCount,
} from "$lib/workspace-sync-status";

const STORAGE_KEY = "subman:workspace-mutation-queue:v1";
const QUARANTINE_PREFIX = `${STORAGE_KEY}:quarantine:`;
const WRITE_LOCK = `${STORAGE_KEY}:write`;
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

type StoredQueue = {
	version: 2;
	mutations: WorkspaceMutation[];
};

type ParsedStoredQueue = {
	queue: StoredQueue;
	migrated: boolean;
};

type QueueChange = {
	workspaceId: string;
	mutationId: string;
	action: "enqueued" | "removed";
};

export type WorkspaceMutationConflict = {
	code: string;
	message: string;
	disposition: "state-conflict";
	document: WorkspaceDocumentV2;
	revision: number;
};

export type WorkspaceMutationDeliveryResult =
	| { status: "empty" | "blocked" | "committed" }
	| { status: "conflict"; code: string; disposition: "state-conflict" }
	| {
			status: "retryable-error" | "permanent-error";
			statusCode?: number;
			code?: string;
			disposition: Exclude<WorkspaceFailureDisposition, "state-conflict">;
	  };

type DeliveryOptions = {
	queue: WorkspaceMutationQueue;
	workspaceId: string;
	githubToken: string | null;
	syncMode: LocalWorkspaceBinding["syncMode"];
	fetchImpl?: typeof fetch;
	onCommitted: (result: WorkspaceCoordinatorResult) => void | Promise<void>;
	onConflict?: (conflict: WorkspaceMutationConflict) => void | Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

function defaultNotify(change: QueueChange): void {
	const gistId = change.workspaceId.startsWith("gist:")
		? change.workspaceId.slice("gist:".length)
		: null;
	broadcastWorkspaceEvent({
		type: "mutation-queue-changed",
		gistId,
		fileName: "subman.json",
		mutationId: change.mutationId,
		queueAction: change.action,
	});
}

function parseStoredQueue(raw: string | null): ParsedStoredQueue {
	if (raw === null) {
		return { queue: { version: 2, mutations: [] }, migrated: false };
	}
	const parsed = JSON.parse(raw) as unknown;
	if (!isRecord(parsed) || !hasExactKeys(parsed, ["version", "mutations"])) {
		throw new Error("invalid envelope");
	}
	if (
		(parsed.version !== 1 && parsed.version !== 2) ||
		!Array.isArray(parsed.mutations)
	) {
		throw new Error("invalid envelope");
	}
	const mutations = parsed.mutations.map((value) => {
		const mutation = parseWorkspaceMutation(value);
		if (mutation.source !== "browser") throw new Error("invalid source");
		return mutation;
	});
	if (
		new Set(mutations.map((item) => item.mutationId)).size !== mutations.length
	) {
		throw new Error("duplicate mutation ID");
	}
	return {
		queue: { version: 2, mutations },
		migrated: parsed.version === 1,
	};
}

export class WorkspaceMutationQueue {
	readonly storageKey = STORAGE_KEY;

	constructor(
		private readonly storage: Pick<
			Storage,
			"getItem" | "setItem" | "removeItem"
		> = localStorage,
		private readonly notify: (change: QueueChange) => void = defaultNotify,
		private readonly now: () => string = () => new Date().toISOString(),
	) {}

	list(workspaceId?: string): WorkspaceMutation[] {
		const mutations = this.read().mutations;
		return workspaceId
			? mutations.filter((item) => item.workspaceId === workspaceId)
			: mutations;
	}

	peek(workspaceId: string): WorkspaceMutation | null {
		return this.list(workspaceId)[0] ?? null;
	}

	enqueue(value: WorkspaceMutation): Promise<WorkspaceMutation> {
		const mutation = parseWorkspaceMutation(value);
		if (mutation.source !== "browser") {
			throw new Error("Only browser mutations can be queued");
		}
		return withWorkspaceLock(WRITE_LOCK, async () => {
			const stored = this.read();
			const existing = stored.mutations.find(
				(item) => item.mutationId === mutation.mutationId,
			);
			if (existing) {
				if (
					serializeWorkspaceMutation(existing) !==
					serializeWorkspaceMutation(mutation)
				) {
					throw new Error(
						"Mutation ID is already queued with different content",
					);
				}
				return existing;
			}
			stored.mutations.push(mutation);
			this.write(stored);
			this.notify({
				workspaceId: mutation.workspaceId,
				mutationId: mutation.mutationId,
				action: "enqueued",
			});
			return mutation;
		});
	}

	enqueueNext(
		workspaceId: string,
		committedRevision: number,
		build: (expectedRevision: number) => WorkspaceMutation,
	): Promise<WorkspaceMutation> {
		if (!Number.isSafeInteger(committedRevision) || committedRevision < 0) {
			throw new Error("Committed Workspace revision is invalid");
		}
		return withWorkspaceLock(WRITE_LOCK, async () => {
			const stored = this.read();
			const workspaceMutations = stored.mutations.filter(
				(item) => item.workspaceId === workspaceId,
			);
			const lastExpectedRevision =
				workspaceMutations.at(-1)?.expectedRevision ?? committedRevision - 1;
			const expectedRevision = Math.max(
				committedRevision,
				lastExpectedRevision + 1,
			);
			const mutation = parseWorkspaceMutation(build(expectedRevision));
			if (mutation.source !== "browser") {
				throw new Error("Only browser mutations can be queued");
			}
			if (
				mutation.workspaceId !== workspaceId ||
				mutation.expectedRevision !== expectedRevision
			) {
				throw new Error("Queued mutation revision allocation is invalid");
			}
			if (
				stored.mutations.some((item) => item.mutationId === mutation.mutationId)
			) {
				throw new Error("Mutation ID is already queued");
			}
			stored.mutations.push(mutation);
			this.write(stored);
			this.notify({
				workspaceId: mutation.workspaceId,
				mutationId: mutation.mutationId,
				action: "enqueued",
			});
			return mutation;
		});
	}

	remove(mutationId: string): Promise<boolean> {
		return withWorkspaceLock(WRITE_LOCK, async () => {
			const stored = this.read();
			const mutation = stored.mutations.find(
				(item) => item.mutationId === mutationId,
			);
			if (!mutation) return false;
			stored.mutations = stored.mutations.filter(
				(item) => item.mutationId !== mutationId,
			);
			this.write(stored);
			this.notify({
				workspaceId: mutation.workspaceId,
				mutationId,
				action: "removed",
			});
			return true;
		});
	}

	private write(queue: StoredQueue): void {
		if (queue.mutations.length === 0) {
			this.storage.removeItem(this.storageKey);
			updateWorkspaceQueueCount(0);
			return;
		}
		this.storage.setItem(this.storageKey, JSON.stringify(queue));
		updateWorkspaceQueueCount(queue.mutations.length);
	}

	private read(): StoredQueue {
		const raw = this.storage.getItem(this.storageKey);
		try {
			const parsed = parseStoredQueue(raw);
			if (parsed.migrated) this.write(parsed.queue);
			return parsed.queue;
		} catch {
			if (raw !== null) {
				const suffix = this.now().replace(/[^0-9A-Za-z]/g, "");
				this.storage.setItem(`${QUARANTINE_PREFIX}${suffix}`, raw);
				this.storage.removeItem(this.storageKey);
			}
			reportWorkspaceStorageRecovery(
				"queue",
				"Stored Workspace mutation queue was quarantined",
			);
			return { version: 2, mutations: [] };
		}
	}
}

function parseReceipt(value: unknown): WorkspaceMutationReceipt | null {
	if (value === null) return null;
	if (!isRecord(value)) throw new Error("Mutation response receipt is invalid");
	const allowed = new Set(["kind", "entityId", "deleted"]);
	if (Object.keys(value).some((key) => !allowed.has(key))) {
		throw new Error("Mutation response receipt is invalid");
	}
	if (
		typeof value.kind !== "string" ||
		!MUTATION_KINDS.has(value.kind as WorkspaceMutation["kind"])
	) {
		throw new Error("Mutation response receipt is invalid");
	}
	if (value.entityId !== undefined && typeof value.entityId !== "string") {
		throw new Error("Mutation response receipt is invalid");
	}
	if (value.deleted !== undefined && value.deleted !== true) {
		throw new Error("Mutation response receipt is invalid");
	}
	return {
		kind: value.kind as WorkspaceMutation["kind"],
		...(value.entityId === undefined ? {} : { entityId: value.entityId }),
		...(value.deleted === undefined ? {} : { deleted: true }),
	};
}

async function parseCommittedResponse(
	response: Response,
	mutation: WorkspaceMutation,
): Promise<WorkspaceCoordinatorResult> {
	const value = (await response.json()) as unknown;
	if (!isRecord(value)) throw new Error("Mutation response is invalid");
	if (
		!hasExactKeys(value, [
			"document",
			"mutationId",
			"workspaceId",
			"committedRevision",
			"committedAt",
			"receipt",
			"status",
		])
	) {
		throw new Error("Mutation response is invalid");
	}
	const document = validateWorkspaceDocumentV2(value.document);
	const mutationId = validateWorkspaceUuid(value.mutationId, "mutationId");
	const committedAt = validateWorkspaceTimestamp(
		value.committedAt,
		"committedAt",
	);
	const status = value.status;
	const committedRevision = value.committedRevision;
	if (
		mutationId !== mutation.mutationId ||
		value.workspaceId !== mutation.workspaceId ||
		document.workspaceId !== mutation.workspaceId ||
		!Number.isSafeInteger(committedRevision) ||
		committedRevision !== mutation.expectedRevision + 1 ||
		committedRevision > document.revision ||
		(status !== "committed" && status !== "already-committed") ||
		(status === "committed" &&
			(committedRevision !== document.revision ||
				committedAt !== document.updatedAt ||
				document.lastMutationId !== mutation.mutationId)) ||
		(status === "already-committed" &&
			committedRevision === document.revision &&
			(committedAt !== document.updatedAt ||
				document.lastMutationId !== mutation.mutationId))
	) {
		throw new Error("Mutation response is invalid");
	}
	const receipt = parseReceipt(value.receipt);
	if (receipt && receipt.kind !== mutation.kind) {
		throw new Error("Mutation response is invalid");
	}
	return {
		document,
		mutationId,
		workspaceId: mutation.workspaceId,
		committedRevision,
		committedAt,
		receipt,
		status,
	};
}

type WorkspaceMutationFailure =
	| WorkspaceMutationConflict
	| {
			code: string;
			message: string;
			disposition: Exclude<WorkspaceFailureDisposition, "state-conflict">;
	  };

async function parseFailureResponse(
	response: Response,
	workspaceId: string,
): Promise<WorkspaceMutationFailure> {
	const value = (await response.json()) as unknown;
	if (!isRecord(value) || !isRecord(value.error)) {
		throw new Error("Mutation failure response is invalid");
	}
	if (
		typeof value.error.code !== "string" ||
		typeof value.error.message !== "string" ||
		(value.error.disposition !== undefined &&
			typeof value.error.disposition !== "string")
	) {
		throw new Error("Mutation failure response is invalid");
	}
	let document: WorkspaceDocumentV2 | undefined;
	if (value.document !== undefined) {
		document = validateWorkspaceDocumentV2(value.document);
		if (
			document.workspaceId !== workspaceId ||
			value.revision !== document.revision
		) {
			throw new Error("Mutation failure response is invalid");
		}
	}
	const disposition = classifyWorkspaceFailure({
		code: value.error.code,
		status: response.status,
		hasTrustedLatestDocument: Boolean(document),
	});
	if (
		(value.error.disposition !== undefined &&
			value.error.disposition !== disposition) ||
		(disposition === "state-conflict" && !document) ||
		(disposition !== "state-conflict" && document)
	) {
		throw new Error("Mutation failure response is invalid");
	}
	return disposition === "state-conflict"
		? {
				code: value.error.code,
				message: value.error.message,
				disposition,
				document: document as WorkspaceDocumentV2,
				revision: (document as WorkspaceDocumentV2).revision,
			}
		: { code: value.error.code, message: value.error.message, disposition };
}

export async function deliverNextWorkspaceMutation(
	options: DeliveryOptions,
): Promise<WorkspaceMutationDeliveryResult> {
	if (!options.githubToken || options.syncMode === "paused-conflict") {
		return { status: "blocked" };
	}
	return withWorkspaceLock(
		`subman:workspace-mutation-delivery:${options.workspaceId}`,
		async () => {
			const mutation = options.queue.peek(options.workspaceId);
			if (!mutation) return { status: "empty" };
			let response: Response;
			try {
				response = await (options.fetchImpl ?? fetch)(
					`/api/workspaces/${encodeURIComponent(options.workspaceId)}/mutations`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${options.githubToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(mutation),
					},
				);
			} catch {
				return {
					status: "retryable-error",
					disposition: "retryable-upstream",
				};
			}

			if (response.ok) {
				let result: WorkspaceCoordinatorResult;
				try {
					result = await parseCommittedResponse(response, mutation);
				} catch {
					return {
						status: "permanent-error",
						statusCode: response.status,
						code: "invalid_success_response",
						disposition: "queue-corruption",
					};
				}
				try {
					await options.onCommitted(result);
					await options.queue.remove(mutation.mutationId);
					return { status: "committed" };
				} catch {
					return {
						status: "retryable-error",
						statusCode: response.status,
						disposition: "retryable-upstream",
					};
				}
			}
			let failure: WorkspaceMutationFailure;
			try {
				failure = await parseFailureResponse(response, options.workspaceId);
			} catch {
				return {
					status: "permanent-error",
					statusCode: response.status,
					code: "invalid_failure_response",
					disposition: "queue-corruption",
				};
			}
			if (failure.disposition === "state-conflict") {
				try {
					await options.onConflict?.(failure);
					return {
						status: "conflict",
						code: failure.code,
						disposition: "state-conflict",
					};
				} catch {
					return {
						status: "retryable-error",
						statusCode: response.status,
						disposition: "retryable-upstream",
					};
				}
			}
			return {
				status:
					failure.disposition === "retryable-upstream"
						? "retryable-error"
						: "permanent-error",
				statusCode: response.status,
				code: failure.code,
				disposition: failure.disposition,
			};
		},
	);
}
