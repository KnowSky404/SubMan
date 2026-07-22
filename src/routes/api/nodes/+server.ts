import { ApiError } from "$lib/server/api/errors";
import { parseNodePayload } from "$lib/server/api/nodes";
import { handleApiError, requireApiAccess } from "$lib/server/api/routes";
import {
	createServerMutationIdentity,
	loadServerWorkspace,
	submitServerWorkspaceMutation,
} from "$lib/server/api/workspace";
import { WORKSPACE_FILE_NAME } from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";

export async function GET({
	request,
	platform,
}: {
	request: Request;
	platform?: App.Platform;
}) {
	try {
		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadServerWorkspace(githubToken);
		return Response.json({
			data: workspace.data.nodes,
			workspace: {
				gistId: workspace.gist.id,
				file: WORKSPACE_FILE_NAME,
				revision: workspace.revision,
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
		const payload = parseNodePayload(await request.json());
		const workspace = await loadServerWorkspace(githubToken);
		const nodeId = crypto.randomUUID();
		const mutation = {
			...createServerMutationIdentity(workspace),
			kind: "node.upsert",
			payload: { operation: "create", nodeId, node: payload },
		} satisfies WorkspaceMutation;
		const result = await submitServerWorkspaceMutation(
			platform?.env?.WORKSPACE_COORDINATOR,
			githubToken,
			workspace.gist,
			mutation,
		);
		const node = result.document.data.nodes.find((item) => item.id === nodeId);
		if (!node)
			throw new ApiError(500, "server_error", "Node was not committed");

		return Response.json(
			{
				data: node,
				workspace: {
					gistId: workspace.gist.id,
					file: WORKSPACE_FILE_NAME,
					revision: result.committedRevision,
				},
			},
			{ status: 201 },
		);
	} catch (error) {
		return handleApiError(error);
	}
}
