import { applyNodeCreate, parseNodePayload } from "$lib/server/api/nodes";
import { handleApiError, requireApiAccess } from "$lib/server/api/routes";
import {
	loadWorkspaceState,
	saveWorkspaceState,
} from "$lib/server/api/workspace";

export async function GET({
	request,
	platform,
}: {
	request: Request;
	platform?: App.Platform;
}) {
	try {
		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadWorkspaceState(githubToken);
		return Response.json({
			data: workspace.state.nodes,
			workspace: {
				gistId: workspace.gist.id,
				file: workspace.state.activeGistFile,
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
}

export async function POST({
	request,
	platform,
}: {
	request: Request;
	platform?: App.Platform;
}) {
	try {
		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadWorkspaceState(githubToken);
		const payload = parseNodePayload(await request.json());
		const result = applyNodeCreate(workspace.state, payload);
		const gist = await saveWorkspaceState(
			githubToken,
			workspace.gist.id,
			result.state,
		);

		return Response.json(
			{
				data: result.node,
				workspace: {
					gistId: gist.id,
					file: result.state.activeGistFile,
				},
			},
			{ status: 201 },
		);
	} catch (error) {
		return handleApiError(error);
	}
}
