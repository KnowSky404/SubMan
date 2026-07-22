import { handleBrowserWorkspaceMutation } from "$lib/server/api/workspace-mutations";

export async function POST({
	request,
	platform,
	params,
}: {
	request: Request;
	platform?: App.Platform;
	params: { workspaceId: string };
}) {
	return handleBrowserWorkspaceMutation(
		request,
		params.workspaceId,
		platform?.env?.WORKSPACE_COORDINATOR,
	);
}
