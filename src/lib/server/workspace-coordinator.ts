import { DurableObject } from "cloudflare:workers";
import {
	WorkspaceCoordinatorCore,
	WorkspaceCoordinatorError,
	type WorkspaceCoordinatorErrorCode,
	type WorkspaceCoordinatorResult,
} from "$lib/server/workspace-coordinator-core";
import { SqlWorkspaceCoordinatorJournal } from "$lib/server/workspace-coordinator-journal";
import { createWorkspaceGistGateway } from "$lib/server/workspace-gist";
import {
	WorkspaceDocumentError,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
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
		const outcome = await this.core.mutateSettled({
			githubToken,
			gistId: command.gistId,
			mutation: command.mutation,
		});
		return outcome.ok
			? { ok: true, result: outcome.result }
			: { ok: false, error: rpcError(outcome.error) };
	}
}
