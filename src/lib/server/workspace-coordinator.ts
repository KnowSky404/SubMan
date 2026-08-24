import { DurableObject } from "cloudflare:workers";
import { hashWorkspaceId, logWorkerEvent } from "$lib/server/observability";
import {
	WorkspaceCoordinatorCore,
	WorkspaceCoordinatorError,
	type WorkspaceCoordinatorErrorCode,
	type WorkspaceCoordinatorResult,
} from "$lib/server/workspace-coordinator-core";
import { SqlWorkspaceCoordinatorJournal } from "$lib/server/workspace-coordinator-journal";
import {
	createWorkspaceGistGateway,
	type GitHubGatewayErrorMetadata,
} from "$lib/server/workspace-gist";
import {
	WorkspaceDocumentError,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import { classifyWorkspaceFailure } from "$lib/workspace-failure-disposition";
import {
	type WorkspaceMutation,
	WorkspaceMutationError,
	type WorkspaceMutationErrorCode,
} from "$lib/workspace-mutation";

export type WorkspaceCoordinatorCommand = {
	gistId: string;
	mutation: WorkspaceMutation;
};

export type WorkspaceCoordinatorRpcErrorCode =
	| WorkspaceCoordinatorErrorCode
	| WorkspaceMutationErrorCode
	| WorkspaceDocumentError["code"]
	| "server_error";

export type WorkspaceCoordinatorRpcError = {
	code: WorkspaceCoordinatorRpcErrorCode;
	message: string;
	document?: WorkspaceDocumentV2;
	revision?: number;
	gateway?: GitHubGatewayErrorMetadata;
};

export type WorkspaceCoordinatorRpcResponse =
	| { ok: true; result: WorkspaceCoordinatorResult }
	| { ok: false; error: WorkspaceCoordinatorRpcError };

const DOCUMENT_CONFLICTS = new Set<WorkspaceCoordinatorRpcErrorCode>([
	"revision_conflict",
	"entity_deleted",
	"workspace_mismatch",
]);

function rpcError(error: unknown): WorkspaceCoordinatorRpcError {
	if (error instanceof WorkspaceCoordinatorError) {
		return {
			code: error.code,
			message: error.message,
			...(error.gateway ? { gateway: error.gateway } : {}),
			...(error.latestDocument && DOCUMENT_CONFLICTS.has(error.code)
				? {
						document: error.latestDocument,
						revision: error.latestDocument.revision,
					}
				: {}),
		};
	}
	if (
		error instanceof WorkspaceMutationError ||
		error instanceof WorkspaceDocumentError
	) {
		return { code: error.code, message: error.message };
	}
	return { code: "server_error", message: "Workspace mutation failed" };
}

export class WorkspaceCoordinator extends DurableObject<Cloudflare.Env> {
	private readonly core: WorkspaceCoordinatorCore;

	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super(ctx, env);
		const journal = new SqlWorkspaceCoordinatorJournal(ctx.storage);
		void ctx.blockConcurrencyWhile(async () => journal.initialize());
		this.core = new WorkspaceCoordinatorCore({
			gateway: createWorkspaceGistGateway(),
			journal,
		});
	}

	async mutate(
		command: WorkspaceCoordinatorCommand,
		githubToken: string,
	): Promise<WorkspaceCoordinatorRpcResponse> {
		const startedAt = Date.now();
		const requestId = crypto.randomUUID();
		const workspaceHash = await hashWorkspaceId(`gist:${command.gistId}`);
		const baseFields = {
			requestId,
			operation: "workspace.mutation",
			...(workspaceHash ? { workspaceHash } : {}),
			mutationId: command.mutation.mutationId,
			mutationKind: command.mutation.kind,
			expectedRevision: command.mutation.expectedRevision,
		};
		logWorkerEvent("info", "workspace.mutation.started", baseFields);

		try {
			const outcome = await this.core.mutateSettled({
				githubToken,
				gistId: command.gistId,
				mutation: command.mutation,
			});
			const latencyMs = Date.now() - startedAt;
			if (outcome.ok) {
				logWorkerEvent("info", "workspace.mutation.completed", {
					...baseFields,
					latencyMs,
					committedRevision: outcome.result.committedRevision,
					disposition: outcome.result.status,
				});
				return { ok: true, result: outcome.result };
			}

			const error = rpcError(outcome.error);
			logWorkerEvent("warn", "workspace.mutation.rejected", {
				...baseFields,
				latencyMs,
				errorCode: error.code,
				disposition: classifyWorkspaceFailure({
					code: error.code,
					status: error.gateway?.status ?? undefined,
					hasTrustedLatestDocument: Boolean(error.document),
				}),
				...(error.gateway
					? {
							githubOperation: error.gateway.operation,
							githubStatus: error.gateway.status,
							githubCategory: error.gateway.category,
							githubRequestId: error.gateway.requestId,
						}
					: {}),
			});
			return { ok: false, error };
		} catch (error) {
			const rpc = rpcError(error);
			logWorkerEvent("error", "workspace.mutation.failed", {
				...baseFields,
				latencyMs: Date.now() - startedAt,
				errorCode: rpc.code,
				disposition: classifyWorkspaceFailure({ code: rpc.code }),
			});
			return { ok: false, error: rpc };
		}
	}
}
