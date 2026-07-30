import { readBoundedJson } from "$lib/server/api/bounded-json";
import { ApiError } from "$lib/server/api/errors";
import { parseNodePayload } from "$lib/server/api/nodes";
import {
	assertWorkspacePrecondition,
	handleApiError,
	requireApiAccess,
	workspaceJson,
} from "$lib/server/api/routes";
import {
	createServerMutationIdentity,
	loadServerWorkspace,
	submitServerWorkspaceMutation,
} from "$lib/server/api/workspace";
import { WORKSPACE_FILE_NAME } from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";

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
		const payload = parseNodePayload(await readBoundedJson(request));
		const workspace = await loadServerWorkspace(githubToken);
		assertWorkspacePrecondition(request, workspace.revision);
		const nodeId = crypto.randomUUID();
		const mutation = {
			...createServerMutationIdentity(workspace),
			kind: "node.upsert",
			payload: {
				operation: "upsert-by-external-key",
				nodeId,
				externalKey,
				node: payload,
			},
		} satisfies WorkspaceMutation;
		const result = await submitServerWorkspaceMutation(
			platform?.env?.WORKSPACE_COORDINATOR,
			githubToken,
			workspace.gist,
			mutation,
		);
		const committedNodeId = result.receipt?.entityId ?? nodeId;
		const node = result.document.data.nodes.find(
			(item) => item.id === committedNodeId,
		);
		if (!node)
			throw new ApiError(500, "server_error", "Node was not committed");

		return workspaceJson(
			{
				data: node,
				workspace: {
					gistId: workspace.gist.id,
					file: WORKSPACE_FILE_NAME,
					revision: result.committedRevision,
				},
			},
			result.committedRevision,
		);
	} catch (error) {
		return handleApiError(error);
	}
}
