import { readBoundedJson } from "$lib/server/api/bounded-json";
import { ApiError } from "$lib/server/api/errors";
import { parseNodePatchPayload } from "$lib/server/api/nodes";
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
	params,
}: {
	request: Request;
	platform?: App.Platform;
	params: { id: string };
}) {
	try {
		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadServerWorkspace(githubToken);
		const node = workspace.data.nodes.find((item) => item.id === params.id);
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
		const payload = parseNodePatchPayload(await readBoundedJson(request));
		const workspace = await loadServerWorkspace(githubToken);
		const mutation = {
			...createServerMutationIdentity(workspace),
			kind: "node.upsert",
			payload: { operation: "patch", nodeId: params.id, patch: payload },
		} satisfies WorkspaceMutation;
		const result = await submitServerWorkspaceMutation(
			platform?.env?.WORKSPACE_COORDINATOR,
			githubToken,
			workspace.gist,
			mutation,
		);
		const node = result.document.data.nodes.find(
			(item) => item.id === params.id,
		);
		if (!node)
			throw new ApiError(500, "server_error", "Node was not committed");
		return Response.json({
			data: node,
			workspace: {
				gistId: workspace.gist.id,
				file: WORKSPACE_FILE_NAME,
				revision: result.committedRevision,
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
		const workspace = await loadServerWorkspace(githubToken);
		const mutation = {
			...createServerMutationIdentity(workspace),
			kind: "node.delete",
			payload: { id: params.id },
		} satisfies WorkspaceMutation;
		const result = await submitServerWorkspaceMutation(
			platform?.env?.WORKSPACE_COORDINATOR,
			githubToken,
			workspace.gist,
			mutation,
		);
		return Response.json({
			data: { deleted: true },
			workspace: {
				gistId: workspace.gist.id,
				file: WORKSPACE_FILE_NAME,
				revision: result.committedRevision,
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
}
