import { DurableObject } from "cloudflare:workers";
import {
	WorkspaceCoordinatorCore,
	type WorkspaceCoordinatorResult,
} from "$lib/server/workspace-coordinator-core";
import { SqlWorkspaceCoordinatorJournal } from "$lib/server/workspace-coordinator-journal";
import { createWorkspaceGistGateway } from "$lib/server/workspace-gist";
import type { WorkspaceMutation } from "$lib/workspace-mutation";

export type WorkspaceCoordinatorCommand = {
	gistId: string;
	mutation: WorkspaceMutation;
};

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

	mutate(
		command: WorkspaceCoordinatorCommand,
		githubToken: string,
	): Promise<WorkspaceCoordinatorResult> {
		return this.core.mutate({
			githubToken,
			gistId: command.gistId,
			mutation: command.mutation,
		});
	}
}
