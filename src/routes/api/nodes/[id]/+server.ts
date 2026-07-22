import { ApiError } from "$lib/server/api/errors";
import {
	applyNodeDelete,
	applyNodePatch,
	parseNodePatchPayload,
} from "$lib/server/api/nodes";
import { handleApiError, requireApiAccess } from "$lib/server/api/routes";
import {
	loadWorkspaceState,
	transactServerWorkspace,
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
		const payload = parseNodePatchPayload(await request.json());
		const workspace = await transactServerWorkspace(githubToken, (state) => {
			const result = applyNodePatch(state, params.id, payload);
			return { state: result.state, value: result.node };
		});
		if (!workspace.value) {
			throw new ApiError(404, "not_found", "Node not found");
		}
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
		const workspace = await transactServerWorkspace(githubToken, (state) => {
			const result = applyNodeDelete(state, params.id);
			return { state: result.state, value: result.deleted };
		});
		if (!workspace.value) {
			throw new ApiError(404, "not_found", "Node not found");
		}
		return Response.json({
			data: { deleted: true },
			workspace: {
				gistId: workspace.gist.id,
				file: workspace.state.activeGistFile,
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
}
