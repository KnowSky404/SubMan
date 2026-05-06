import { ApiError } from "$lib/server/api/errors";
import {
	applyNodeDelete,
	applyNodePatch,
	parseNodePatchPayload,
} from "$lib/server/api/nodes";
import { handleApiError, requireApiAccess } from "$lib/server/api/routes";
import {
	loadWorkspaceState,
	saveWorkspaceState,
} from "$lib/server/api/workspace";

export async function GET({
	request,
	platform,
	params,
}: {
	request: Request;
	platform?: App.Platform;
	params: { id: string };
}) {
	try {
		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadWorkspaceState(githubToken);
		const node = workspace.state.nodes.find((item) => item.id === params.id);
		if (!node) {
			throw new ApiError(404, "not_found", "Node not found");
		}
		return Response.json({ data: node });
	} catch (error) {
		return handleApiError(error);
	}
}

export async function PATCH({
	request,
	platform,
	params,
}: {
	request: Request;
	platform?: App.Platform;
	params: { id: string };
}) {
	try {
		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadWorkspaceState(githubToken);
		const payload = parseNodePatchPayload(await request.json());
		const result = applyNodePatch(workspace.state, params.id, payload);
		if (!result.node) {
			throw new ApiError(404, "not_found", "Node not found");
		}
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

export async function DELETE({
	request,
	platform,
	params,
}: {
	request: Request;
	platform?: App.Platform;
	params: { id: string };
}) {
	try {
		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadWorkspaceState(githubToken);
		const result = applyNodeDelete(workspace.state, params.id);
		if (!result.deleted) {
			throw new ApiError(404, "not_found", "Node not found");
		}
		const gist = await saveWorkspaceState(
			githubToken,
			workspace.gist.id,
			result.state,
		);
		return Response.json({
			data: { deleted: true },
			workspace: {
				gistId: gist.id,
				file: result.state.activeGistFile,
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
}
