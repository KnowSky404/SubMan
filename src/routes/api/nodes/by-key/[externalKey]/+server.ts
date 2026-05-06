import { ApiError } from "$lib/server/api/errors";
import {
	applyNodeUpsertByExternalKey,
	parseNodePayload,
} from "$lib/server/api/nodes";
import { handleApiError, requireApiAccess } from "$lib/server/api/routes";
import {
	loadWorkspaceState,
	saveWorkspaceState,
} from "$lib/server/api/workspace";

export async function PUT({
	request,
	platform,
	params,
}: {
	request: Request;
	platform?: App.Platform;
	params: { externalKey: string };
}) {
	try {
		const externalKey = decodeURIComponent(params.externalKey).trim();
		if (!externalKey) {
			throw new ApiError(400, "bad_request", "externalKey is required");
		}

		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadWorkspaceState(githubToken);
		const payload = parseNodePayload(await request.json());
		const result = applyNodeUpsertByExternalKey(
			workspace.state,
			externalKey,
			payload,
		);
		const gist = await saveWorkspaceState(
			githubToken,
			workspace.gist.id,
			result.state,
		);

		return Response.json({
			data: result.node,
			workspace: {
				gistId: gist.id,
				file: result.state.activeGistFile,
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
}
