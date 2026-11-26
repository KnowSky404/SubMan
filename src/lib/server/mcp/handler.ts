import {
	type CallToolResult,
	createMcpHandler,
	McpServer,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { isAuthorized } from "$lib/server/api/auth";
import {
	getMcpNode,
	listMcpNodes,
	MCP_NODE_PAGE_MAX,
	type McpNodeContext,
	McpToolError,
	setMcpNodeEnabled,
} from "$lib/server/mcp/nodes";

const nodeId = z.string().min(1).max(4096);

const nodeLookup = z.strictObject({ nodeId });
const nodeList = z.strictObject({
	name: z.string().trim().min(1).max(256).optional(),
	tag: z.string().min(1).max(128).optional(),
	enabled: z.boolean().optional(),
	offset: z.int().nonnegative().optional(),
	limit: z.int().min(1).max(MCP_NODE_PAGE_MAX).optional(),
});
const nodeToggle = nodeLookup.extend({
	enabled: z.boolean(),
	workspace: z.string().regex(/^[a-f0-9]{64}$/),
	expectedRevision: z.int().nonnegative(),
});

async function toolResult(
	action: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
	try {
		const data = await action();
		return {
			structuredContent: data,
			content: [{ type: "text", text: JSON.stringify(data) }],
		};
	} catch (error) {
		const data =
			error instanceof McpToolError
				? {
						code: error.code,
						message: error.message,
						...(error.revision === undefined
							? {}
							: { revision: error.revision }),
					}
				: { code: "server_error", message: "SubMan could not run this tool." };
		return {
			isError: true,
			structuredContent: data,
			content: [{ type: "text", text: JSON.stringify(data) }],
		};
	}
}

function createServer(context: McpNodeContext, canWrite: boolean): McpServer {
	const server = new McpServer(
		{ name: "SubMan", version: "1.0.0" },
		{ capabilities: { tools: { listChanged: false } } },
	);
	const readOnly = { readOnlyHint: true, openWorldHint: false };
	server.registerTool(
		"list_nodes",
		{
			description:
				"List a page of node summaries and the current Workspace revision. Filter by case-insensitive name substring, exact tag, or enabled state.",
			inputSchema: nodeList,
			annotations: readOnly,
		},
		(input) => toolResult(() => listMcpNodes(context, input)),
	);
	server.registerTool(
		"get_node",
		{
			description:
				"Read one node summary by its exact ID and return the current Workspace revision.",
			inputSchema: nodeLookup,
			annotations: readOnly,
		},
		(input) => toolResult(() => getMcpNode(context, input)),
	);
	if (canWrite) {
		server.registerTool(
			"set_node_enabled",
			{
				description:
					"Enable or disable one node. Use its exact ID, workspace, and revision from a fresh read. This changes the Workspace configuration. Published outputs need a separate publication.",
				inputSchema: nodeToggle,
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
					openWorldHint: false,
				},
			},
			(input) => toolResult(() => setMcpNodeEnabled(context, input)),
		);
	}
	return server;
}

async function signWorkspace(
	gistId: string,
	token: string,
	githubToken: string,
): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(githubToken),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const digest = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(`subman:mcp:workspace:${gistId}:${token}`),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function validToken(token: string | undefined): token is string {
	return typeof token === "string" && /^[A-Za-z0-9_-]{32,512}$/.test(token);
}

function reject(
	status: number,
	message: string,
	headers: Record<string, string> = {},
): Response {
	return Response.json(
		{ error: message },
		{ status, headers: { "Cache-Control": "no-store", ...headers } },
	);
}

export async function handleSubManMcp(
	request: Request,
	env: App.Platform["env"],
): Promise<Response> {
	const gistId = env?.SUBMAN_MCP_GIST_ID;
	const githubToken = env?.GITHUB_TOKEN;
	const readToken = env?.SUBMAN_MCP_READ_TOKEN;
	const writeToken = env?.SUBMAN_MCP_WRITE_TOKEN || undefined;
	const apiToken = env?.SUBMAN_API_TOKEN;
	if (
		!gistId ||
		!/^[a-fA-F0-9]{1,64}$/.test(gistId) ||
		!githubToken ||
		!validToken(readToken) ||
		(writeToken !== undefined && !validToken(writeToken)) ||
		readToken === githubToken ||
		readToken === apiToken ||
		(writeToken !== undefined &&
			(writeToken === readToken ||
				writeToken === githubToken ||
				writeToken === apiToken))
	) {
		return reject(404, "SubMan MCP is unavailable.");
	}

	const origin = request.headers.get("Origin");
	if (origin !== null && origin !== new URL(request.url).origin) {
		return reject(403, "Origin is not allowed.");
	}
	const authorization = request.headers.get("Authorization");
	const [canRead, canWrite] = await Promise.all([
		isAuthorized(authorization, readToken),
		isAuthorized(authorization, writeToken),
	]);
	const token = canWrite ? writeToken : canRead ? readToken : undefined;
	if (!token) {
		return reject(401, "A SubMan MCP token is required.", {
			"WWW-Authenticate": 'Bearer realm="SubMan MCP"',
		});
	}
	if (request.method !== "POST") {
		return reject(405, "Use POST for SubMan MCP.", { Allow: "POST" });
	}

	const context: McpNodeContext = {
		gistId,
		githubToken,
		workspace: await signWorkspace(gistId, token, githubToken),
		coordinator: env?.WORKSPACE_COORDINATOR,
	};
	const response = await createMcpHandler(
		() => createServer(context, canWrite),
		{
			maxRequestBodySize: 16 * 1024,
		},
	).fetch(request);
	const headers = new Headers(response.headers);
	headers.set("Cache-Control", "no-store");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
