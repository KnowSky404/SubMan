import type { AppState, GistMeta } from "$lib/models";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import {
	WORKSPACE_COORDINATOR_FAILURE_DISPOSITIONS,
	type WorkspaceFailureDisposition,
} from "$lib/workspace-failure-disposition";
import {
	applyWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import {
	submitWorkspaceMutation,
	type WorkspaceMutationDeliveryResult,
	type WorkspaceMutationSubmissionOptions,
	type WorkspaceMutationSubmissionResult,
} from "$lib/workspace-mutation-queue";
import {
	type BrowserWorkspacePersistence,
	type WorkspaceBlockedMutationMetadata,
	type WorkspaceLeaseFence,
	WorkspacePersistenceError,
	workspaceDispatcherLeaseName,
} from "$lib/workspace-persistence";
import { scheduleWorkspaceRetry } from "$lib/workspace-retry";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	type WorkspaceV2LocalState,
} from "$lib/workspace-v2-state";

const DEFAULT_LEASE_TTL_MS = 30_000;

const SAFE_FAILURE_CODES = new Set<string>([
	...Object.keys(WORKSPACE_COORDINATOR_FAILURE_DISPOSITIONS),
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
]);

const MESSAGE_KEYS: Record<
	Exclude<WorkspaceFailureDisposition, "retryable-upstream">,
	string
> = {
	"state-conflict": "workspace.state-conflict",
	"domain-conflict": "workspace.domain-conflict",
	"auth-required": "workspace.auth-required",
	"queue-corruption": "workspace.queue-corruption",
	"operator-repair": "workspace.operator-repair",
	"permanent-upstream": "workspace.permanent-upstream",
	"invalid-request": "workspace.invalid-request",
};

export type WorkspacePersistenceDispatchResult =
	| WorkspaceMutationDeliveryResult
	| { status: "busy" | "stale" }
	| { status: "deferred"; nextAttemptAt: number };

export type WorkspacePersistenceDispatcherOptions = {
	persistence: BrowserWorkspacePersistence;
	githubToken: string | null;
	allowManual?: boolean;
	ownerId?: string;
	leaseTtlMs?: number;
	leaseHeartbeatIntervalMs?: number;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	now?: () => number;
	random?: () => number;
	submit?: typeof submitWorkspaceMutation;
};

function startLeaseHeartbeat(
	renew: () => Promise<boolean>,
	intervalMs: number,
): () => Promise<boolean> {
	let active = true;
	let healthy = true;
	let failure: unknown;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: Promise<void> | null = null;
	const schedule = () => {
		timer = setTimeout(() => {
			if (!active) return;
			pending = (async () => {
				try {
					healthy = await renew();
				} catch (error) {
					failure = error;
					healthy = false;
				} finally {
					pending = null;
					if (active && healthy) schedule();
				}
			})();
		}, intervalMs);
	};
	schedule();
	return async () => {
		active = false;
		if (timer !== null) clearTimeout(timer);
		if (pending) await pending;
		if (failure !== undefined) throw failure;
		return healthy;
	};
}

function dispatcherOwnerId(): string {
	return `dispatcher-${crypto.randomUUID()}`;
}

function safeFailureCode(code: string | undefined): string {
	return code && SAFE_FAILURE_CODES.has(code) ? code : "workspace_sync_failed";
}

function blockedMetadata(
	mutation: WorkspaceMutation,
	disposition: Exclude<WorkspaceFailureDisposition, "retryable-upstream">,
	code: string | undefined,
	blockedAt: string,
): WorkspaceBlockedMutationMetadata {
	return {
		mutationId: mutation.mutationId,
		kind: mutation.kind,
		code: safeFailureCode(code),
		disposition,
		messageKey: MESSAGE_KEYS[disposition],
		createdAt: mutation.createdAt,
		blockedAt,
	};
}

function replayOptimisticSnapshot(
	snapshot: AppState,
	committed: WorkspaceDocumentV2,
	mutations: readonly WorkspaceMutation[],
	gistId: string,
): AppState {
	const gist: Pick<GistMeta, "id" | "ownerLogin" | "files"> =
		snapshot.gists.find((entry) => entry.id === gistId) ?? {
			id: gistId,
			files: [],
		};
	const optimistic = mutations.reduce(
		(document, mutation) =>
			applyWorkspaceMutation(document, mutation, {
				committedAt: mutation.createdAt,
				gist,
			}).document,
		committed,
	);
	return hydrateAppStateFromWorkspaceDocument(snapshot, optimistic, gistId);
}

export async function dispatchPersistedWorkspaceMutation(
	options: WorkspacePersistenceDispatcherOptions,
): Promise<WorkspacePersistenceDispatchResult> {
	const now = options.now ?? (() => Date.now());
	const random = options.random ?? Math.random;
	const submit = options.submit ?? submitWorkspaceMutation;
	const ownerId = options.ownerId ?? dispatcherOwnerId();
	const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
	const leaseHeartbeatIntervalMs =
		options.leaseHeartbeatIntervalMs ?? Math.max(1, Math.floor(leaseTtlMs / 3));
	if (
		!Number.isSafeInteger(leaseHeartbeatIntervalMs) ||
		leaseHeartbeatIntervalMs <= 0 ||
		leaseHeartbeatIntervalMs >= leaseTtlMs
	) {
		throw new TypeError(
			"Workspace dispatcher lease heartbeat must be shorter than the lease TTL",
		);
	}
	const initial = await options.persistence.read();
	const binding = initial.binding;
	if (!options.githubToken || !binding || binding.revision === null) {
		return { status: "blocked" };
	}
	if (
		binding.syncMode === "paused-conflict" ||
		(binding.syncMode === "manual" && !options.allowManual)
	) {
		return { status: "blocked" };
	}
	const queue = initial.workspaces[binding.workspaceId];
	const mutation = queue?.mutations[0];
	if (!mutation) return { status: "empty" };
	if (queue.delivery.blocked) return { status: "blocked" };
	if (
		queue.delivery.retry.nextAttemptAt !== null &&
		queue.delivery.retry.nextAttemptAt > now()
	) {
		return {
			status: "deferred",
			nextAttemptAt: queue.delivery.retry.nextAttemptAt,
		};
	}

	const leaseName = workspaceDispatcherLeaseName(binding.workspaceId);
	const acquired = await options.persistence.acquireLease({
		name: leaseName,
		ownerId,
		now: now(),
		ttlMs: leaseTtlMs,
	});
	if (!acquired.acquired) return { status: "busy" };
	const fence: WorkspaceLeaseFence = {
		ownerId,
		fencingToken: acquired.lease.fencingToken,
	};
	const renewFence = async (): Promise<boolean> =>
		Boolean(
			await options.persistence.renewLease({
				name: leaseName,
				ownerId,
				fencingToken: fence.fencingToken,
				now: now(),
				ttlMs: leaseTtlMs,
			}),
		);

	try {
		if (!(await renewFence())) return { status: "stale" };
		const submissionOptions: WorkspaceMutationSubmissionOptions = {
			mutation,
			githubToken: options.githubToken,
			fetchImpl: options.fetchImpl,
			timeoutMs: options.timeoutMs,
		};
		const stopHeartbeat = startLeaseHeartbeat(
			renewFence,
			leaseHeartbeatIntervalMs,
		);
		let submission: WorkspaceMutationSubmissionResult;
		let heartbeatHealthy = true;
		try {
			submission = await submit(submissionOptions);
		} finally {
			heartbeatHealthy = await stopHeartbeat();
		}
		if (!heartbeatHealthy) return { status: "stale" };
		if (!(await renewFence())) return { status: "stale" };

		if (submission.status === "committed") {
			const exactHead =
				submission.result.document.revision === mutation.expectedRevision + 1 &&
				submission.result.document.lastMutationId === mutation.mutationId;
			const recoveredAfterAdvance =
				submission.result.status === "already-committed" &&
				submission.result.committedRevision === mutation.expectedRevision + 1 &&
				submission.result.document.revision >
					submission.result.committedRevision;
			if (!exactHead && !recoveredAfterAdvance) {
				await options.persistence.commitDeliveryConflict({
					workspaceId: binding.workspaceId,
					mutationId: mutation.mutationId,
					document: submission.result.document,
					metadata: blockedMetadata(
						mutation,
						"state-conflict",
						"revision_conflict",
						new Date(now()).toISOString(),
					),
					fence,
				});
				return {
					status: "conflict",
					code: "revision_conflict",
					disposition: "state-conflict",
				};
			}
			const current = await options.persistence.read();
			if (!(await renewFence())) return { status: "stale" };
			const currentBinding = current.binding;
			const currentQueue = current.workspaces[binding.workspaceId];
			if (
				!current.snapshot ||
				!currentBinding ||
				currentBinding.workspaceId !== binding.workspaceId ||
				currentQueue?.mutations[0]?.mutationId !== mutation.mutationId
			) {
				return { status: "stale" };
			}
			let snapshot: AppState;
			let committedBinding: WorkspaceV2LocalState;
			let recoveredBaseline: WorkspaceDocumentV2 | null = null;
			try {
				const remaining = currentQueue.mutations.slice(1);
				if (recoveredAfterAdvance) {
					if (!currentBinding.baseline) {
						throw new Error("Recovered delivery requires a baseline");
					}
					const gist: Pick<GistMeta, "id" | "ownerLogin" | "files"> =
						current.snapshot.gists.find(
							(entry) => entry.id === currentBinding.gistId,
						) ?? { id: currentBinding.gistId, files: [] };
					recoveredBaseline = applyWorkspaceMutation(
						currentBinding.baseline,
						mutation,
						{ committedAt: submission.result.committedAt, gist },
					).document;
					if (
						recoveredBaseline.revision !==
							submission.result.committedRevision ||
						recoveredBaseline.lastMutationId !== mutation.mutationId
					) {
						throw new Error("Recovered delivery proof is invalid");
					}
					if (remaining.length === 0) {
						snapshot = hydrateAppStateFromWorkspaceDocument(
							current.snapshot,
							submission.result.document,
							currentBinding.gistId,
						);
						committedBinding = createWorkspaceV2LocalState(
							currentBinding.gistId,
							{
								baseline: submission.result.document,
								syncMode: currentBinding.syncMode,
							},
						);
					} else {
						snapshot = replayOptimisticSnapshot(
							current.snapshot,
							recoveredBaseline,
							remaining,
							currentBinding.gistId,
						);
						committedBinding = createWorkspaceV2LocalState(
							currentBinding.gistId,
							{
								baseline: submission.result.document,
								conflictBaseline: recoveredBaseline,
								syncMode: "paused-conflict",
							},
						);
					}
				} else {
					snapshot = replayOptimisticSnapshot(
						current.snapshot,
						submission.result.document,
						remaining,
						currentBinding.gistId,
					);
					committedBinding = createWorkspaceV2LocalState(
						currentBinding.gistId,
						{
							baseline: submission.result.document,
							syncMode: currentBinding.syncMode,
						},
					);
				}
			} catch {
				await options.persistence.quarantineWorkspaceQueue({
					workspaceId: binding.workspaceId,
					reason: "queue-corruption",
					createdAt: new Date(now()).toISOString(),
					fence,
				});
				return {
					status: "permanent-error",
					code: "queue_corruption",
					disposition: "queue-corruption",
				};
			}
			try {
				if (recoveredAfterAdvance) {
					const next = currentQueue.mutations[1];
					await options.persistence.commitRecoveredDelivery({
						snapshot,
						binding: committedBinding,
						mutationId: mutation.mutationId,
						committedBaseline: recoveredBaseline as WorkspaceDocumentV2,
						blocked: next
							? blockedMetadata(
									next,
									"state-conflict",
									"revision_conflict",
									new Date(now()).toISOString(),
								)
							: null,
						fence,
					});
					return next
						? {
								status: "conflict",
								code: "revision_conflict",
								disposition: "state-conflict",
							}
						: { status: "committed" };
				}
				await options.persistence.commitDeliverySuccess({
					snapshot,
					binding: committedBinding,
					mutationId: mutation.mutationId,
					fence,
				});
				return { status: "committed" };
			} catch (error) {
				if (
					error instanceof WorkspacePersistenceError &&
					error.code === "corrupt-data"
				) {
					return { status: "stale" };
				}
				throw error;
			}
		}

		if (submission.status === "conflict") {
			await options.persistence.commitDeliveryConflict({
				workspaceId: binding.workspaceId,
				mutationId: mutation.mutationId,
				document: submission.document,
				metadata: blockedMetadata(
					mutation,
					"state-conflict",
					submission.code,
					new Date(now()).toISOString(),
				),
				fence,
			});
			return {
				status: "conflict",
				code: safeFailureCode(submission.code),
				disposition: "state-conflict",
			};
		}

		if (submission.disposition === "retryable-upstream") {
			const schedule = scheduleWorkspaceRetry({
				previousAttempt: queue.delivery.retry.attempt,
				now: now(),
				random,
				guidance: {
					retryAfterMs: submission.retryAfterMs,
					rateLimitResetAt: submission.rateLimitResetAt,
				},
			});
			await options.persistence.setRetryMetadata(
				binding.workspaceId,
				mutation.mutationId,
				{
					attempt: schedule.attempt,
					nextAttemptAt: schedule.nextAttemptAt,
					lastErrorCode: safeFailureCode(
						submission.code ?? "workspace_sync_retry",
					),
				},
				fence,
			);
			return submission;
		}

		if (submission.disposition === "queue-corruption") {
			await options.persistence.quarantineWorkspaceQueue({
				workspaceId: binding.workspaceId,
				reason: "queue-corruption",
				code: safeFailureCode(submission.code),
				createdAt: new Date(now()).toISOString(),
				fence,
			});
			return submission;
		}

		await options.persistence.blockMutation(
			binding.workspaceId,
			blockedMetadata(
				mutation,
				submission.disposition,
				submission.code,
				new Date(now()).toISOString(),
			),
			fence,
		);
		return submission;
	} finally {
		try {
			await options.persistence.releaseLease({
				name: leaseName,
				ownerId,
				fencingToken: fence.fencingToken,
			});
		} catch {
			// The fenced lease expires by TTL; cleanup cannot revoke a durable commit.
		}
	}
}
