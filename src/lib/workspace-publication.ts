import { buildAggregateOutput } from "$lib/aggregate";
import { normalizeExportFileName } from "$lib/client-export/profile";
import {
	buildSingBoxClientConfig,
	type SingBoxClientBuildResult,
} from "$lib/client-export/sing-box";
import { buildStableGistRawUrl } from "$lib/gist";
import type { AppState, GistMeta } from "$lib/models";
import type { WorkspaceMutationResult } from "$lib/workspace-transaction";

export class WorkspacePublicationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkspacePublicationError";
	}
}

export async function buildAggregatePublication(
	state: AppState,
	gist: GistMeta,
	targetId: string,
	now: string,
): Promise<WorkspaceMutationResult> {
	const target = state.publishTargets.find((item) => item.id === targetId);
	if (!target) throw new WorkspacePublicationError("Publish target not found");
	const rule = state.aggregates.find((item) => item.id === target.ruleId);
	if (!rule) throw new WorkspacePublicationError("Aggregate rule not found");

	const output = await buildAggregateOutput(
		rule,
		state.nodes,
		state.subscriptions,
	);
	if (output.errors.length > 0) {
		throw new WorkspacePublicationError(output.errors[0] ?? "Publish failed");
	}
	const lastPublishedUrl = buildStableGistRawUrl(gist, target.fileName);
	const nextTarget = {
		...target,
		lastPublishedAt: now,
		lastPublishedUrl,
		updatedAt: now,
	};

	return {
		state: {
			...state,
			publishTargets: state.publishTargets.map((item) =>
				item.id === targetId ? nextTarget : item,
			),
		},
		files: { [target.fileName]: { content: output.content } },
	};
}

export async function buildClientExportPublication(
	state: AppState,
	gist: GistMeta,
	profileId: string,
	now: string,
): Promise<WorkspaceMutationResult & { build: SingBoxClientBuildResult }> {
	const profile = state.clientExports.find((item) => item.id === profileId);
	if (!profile) throw new WorkspacePublicationError("Export profile not found");
	const rule = state.aggregates.find((item) => item.id === profile.ruleId);
	const build = await buildSingBoxClientConfig(
		profile,
		rule,
		state.nodes,
		state.subscriptions,
	);
	if (build.errors.length > 0 || !build.content || build.outbounds <= 0) {
		throw new WorkspacePublicationError(
			build.errors[0] ?? "No output generated",
		);
	}

	const fileName = normalizeExportFileName(profile.fileName);
	const nextProfile = {
		...profile,
		fileName,
		lastGeneratedAt: now,
		lastPublishedAt: now,
		lastPublishedUrl: buildStableGistRawUrl(gist, fileName),
		updatedAt: now,
	};
	return {
		state: {
			...state,
			clientExports: state.clientExports.map((item) =>
				item.id === profileId ? nextProfile : item,
			),
		},
		files: { [fileName]: { content: build.content } },
		build,
	};
}
