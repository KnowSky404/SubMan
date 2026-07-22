import { ApiError } from "$lib/server/api/errors";
import {
	applyNodeUpsertByExternalKey,
	parseNodePayload,
} from "$lib/server/api/nodes";
import { handleApiError, requireApiAccess } from "$lib/server/api/routes";
import { transactServerWorkspace } from "$lib/server/api/workspace";

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
		const payload = parseNodePayload(await request.json());
		const workspace = await transactServerWorkspace(githubToken, (state) => {
			const result = applyNodeUpsertByExternalKey(state, externalKey, payload);
			return { state: result.state, value: result.node };
		});

		return Response.json({
			data: workspace.value,
			workspace: {
				gistId: workspace.gist.id,
				file: workspace.state.activeGistFile,
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
}
