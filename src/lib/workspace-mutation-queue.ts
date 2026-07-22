import type { WorkspaceCoordinatorResult } from "$lib/server/workspace-coordinator-core";
import type { LocalWorkspaceBinding } from "$lib/workspace-document";
import {
	validateWorkspaceDocumentV2,
	validateWorkspaceTimestamp,
	validateWorkspaceUuid,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import { broadcastWorkspaceEvent } from "$lib/workspace-events";
import { withWorkspaceLock } from "$lib/workspace-lock";
import {
	parseWorkspaceMutation,
	serializeWorkspaceMutation,
	type WorkspaceMutation,
	type WorkspaceMutationReceipt,
} from "$lib/workspace-mutation";

const STORAGE_KEY = "subman:workspace-mutation-queue:v1";
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
	"workspace.reconcile",
]);

type StoredQueue = {
	version: 1;
	mutations: WorkspaceMutation[];
};

type QueueChange = {
	workspaceId: string;
	mutationId: string;
	action: "enqueued" | "removed";
};

export type WorkspaceMutationConflict = {
	code: string;
	message: string;
	document?: WorkspaceDocumentV2;
	revision?: number;
};

export type WorkspaceMutationDeliveryResult =
	| { status: "empty" | "blocked" | "committed" | "conflict" }
	| {
			status: "retryable-error" | "permanent-error";
			statusCode?: number;
			code?: string;
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

function parseStoredQueue(raw: string | null): StoredQueue {
	if (raw === null) return { version: 1, mutations: [] };
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed) || !hasExactKeys(parsed, ["version", "mutations"])) {
			throw new Error("invalid envelope");
		}
		if (parsed.version !== 1 || !Array.isArray(parsed.mutations)) {
			throw new Error("invalid envelope");
		}
		const mutations = parsed.mutations.map((value) => {
			const mutation = parseWorkspaceMutation(value);
			if (mutation.source !== "browser") {
				throw new Error("invalid source");
			}
			return mutation;
		});
		if (
			new Set(mutations.map((item) => item.mutationId)).size !==
			mutations.length
		) {
			throw new Error("duplicate mutation ID");
		}
		return { version: 1, mutations };
	} catch {
		throw new Error("Stored mutation queue is invalid");
	}
}

export class WorkspaceMutationQueue {
	readonly storageKey = STORAGE_KEY;

	constructor(
		private readonly storage: Pick<
			Storage,
			"getItem" | "setItem" | "removeItem"
		> = localStorage,
		private readonly notify: (change: QueueChange) => void = defaultNotify,
	) {}

	list(workspaceId?: string): WorkspaceMutation[] {
		const mutations = parseStoredQueue(
			this.storage.getItem(this.storageKey),
		).mutations;
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
			const stored = parseStoredQueue(this.storage.getItem(this.storageKey));
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

	remove(mutationId: string): Promise<boolean> {
		return withWorkspaceLock(WRITE_LOCK, async () => {
			const stored = parseStoredQueue(this.storage.getItem(this.storageKey));
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
			return;
		}
		this.storage.setItem(this.storageKey, JSON.stringify(queue));
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

async function parseConflictResponse(
	response: Response,
	workspaceId: string,
): Promise<WorkspaceMutationConflict> {
	const value = (await response.json()) as unknown;
	if (!isRecord(value) || !isRecord(value.error)) {
		throw new Error("Conflict response is invalid");
	}
	if (
		typeof value.error.code !== "string" ||
		typeof value.error.message !== "string"
	) {
		throw new Error("Conflict response is invalid");
	}
	if (value.document === undefined) {
		return { code: value.error.code, message: value.error.message };
	}
	const document = validateWorkspaceDocumentV2(value.document);
	if (
		document.workspaceId !== workspaceId ||
		value.revision !== document.revision
	) {
		throw new Error("Conflict response is invalid");
	}
	return {
		code: value.error.code,
		message: value.error.message,
		document,
		revision: document.revision,
	};
}

async function readPublicError(
	response: Response,
): Promise<string | undefined> {
	try {
		const value = (await response.json()) as unknown;
		return isRecord(value) &&
			isRecord(value.error) &&
			typeof value.error.code === "string"
			? value.error.code
			: undefined;
	} catch {
		return undefined;
	}
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
				return { status: "retryable-error" };
			}

			if (response.ok) {
				try {
					const result = await parseCommittedResponse(response, mutation);
					await options.onCommitted(result);
					await options.queue.remove(mutation.mutationId);
					return { status: "committed" };
				} catch {
					return { status: "retryable-error", statusCode: response.status };
				}
			}
			if (response.status === 409) {
				try {
					const conflict = await parseConflictResponse(
						response,
						options.workspaceId,
					);
					await options.onConflict?.(conflict);
					return { status: "conflict" };
				} catch {
					return { status: "retryable-error", statusCode: response.status };
				}
			}

			const code = await readPublicError(response);
			return {
				status:
					response.status === 408 ||
					response.status === 429 ||
					response.status >= 500
						? "retryable-error"
						: "permanent-error",
				statusCode: response.status,
				...(code ? { code } : {}),
			};
		},
	);
}
