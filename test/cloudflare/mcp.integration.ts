import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSubManMcp } from "../../src/lib/server/mcp/handler";
import {
	createWorkspaceBootstrapContent,
	parseWorkspaceDocument,
	serializeWorkspaceDocumentV2,
	type WorkspaceDocumentV2,
} from "../../src/lib/workspace-document";

const {
	GITHUB_TOKEN,
	SUBMAN_API_TOKEN,
	SUBMAN_MCP_GIST_ID,
	SUBMAN_MCP_READ_TOKEN,
	SUBMAN_MCP_WRITE_TOKEN,
} = env as typeof env & Record<string, string>;
const protocolVersion = "2025-11-25";
const mcpUrl = "https://subman.example/mcp";
const proxySecret = "proxy-credential-must-not-leak";
const now = "2026-11-01T10:00:00.000Z";

function fakeGithub() {
	const document: WorkspaceDocumentV2 = {
		version: 2,
		schemaVersion: 2,
		workspaceId: `gist:${SUBMAN_MCP_GIST_ID}`,
		revision: 1,
		updatedAt: now,
		lastMutationId: null,
		data: {
			nodes: ["HK-A", "HK-B", "SG-A"].map((name) => ({
				id: `node-${name.toLowerCase()}`,
				name:
					name === "SG-A"
						? `SG-A https://example.invalid/?token=${proxySecret}`
						: name,
				type: "vless",
				raw: `vless://${proxySecret}@${name.toLowerCase()}.invalid`,
				tags: [
					{
						id: name.slice(0, 2).toLowerCase(),
						label:
							name === "SG-A"
								? `vless://${proxySecret}@sg.invalid`
								: name.slice(0, 2).toLowerCase(),
					},
				],
				enabled: true,
				source: "single",
				updatedAt: now,
			})),
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
	const fixture = {
		responseGistId: SUBMAN_MCP_GIST_ID,
		description: "SubMan-Data",
		isPublic: false,
		failNextVerification: false,
		files: {
			"subman.json": serializeWorkspaceDocumentV2(document),
			"published.txt": "unchanged published bytes\n",
		} as Record<string, string>,
		patches: [] as Array<Record<string, { content: string }>>,
	};
	let failRead = false;
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		expect(String(input)).toBe(
			`https://api.github.com/gists/${SUBMAN_MCP_GIST_ID}`,
		);
		expect(new Headers(init?.headers).get("Authorization")).toBe(
			`Bearer ${GITHUB_TOKEN}`,
		);
		if (init?.method === "PATCH") {
			const { files } = JSON.parse(String(init.body)) as {
				files: Record<string, { content: string }>;
			};
			fixture.patches.push(files);
			for (const [name, file] of Object.entries(files)) {
				fixture.files[name] = file.content;
			}
			failRead = fixture.failNextVerification;
			return Response.json({ ok: true });
		}
		expect(init?.method ?? "GET").toBe("GET");
		if (failRead) {
			failRead = false;
			return new Response(proxySecret, { status: 504 });
		}
		return Response.json({
			id: fixture.responseGistId,
			description: fixture.description,
			public: fixture.isPublic,
			owner: { login: "fixture-owner" },
			files: Object.fromEntries(
				Object.entries(fixture.files).map(([filename, content]) => [
					filename,
					{ filename, content, size: content.length, language: "Text" },
				]),
			),
		});
	});
	return fixture;
}

function request(
	method: string,
	params: Record<string, unknown>,
	token: string | null,
	headers: Record<string, string> = {},
) {
	return SELF.fetch(mcpUrl, {
		method: "POST",
		headers: {
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
			...(method === "initialize"
				? {}
				: { "MCP-Protocol-Version": protocolVersion }),
			...(token === null ? {} : { Authorization: `Bearer ${token}` }),
			...headers,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
}

function parseMcpResponse<T>(response: Response, raw: string): T {
	const sse = response.headers
		.get("Content-Type")
		?.includes("text/event-stream");
	const data = sse
		? raw
				.split("\n")
				.find((line) => line.startsWith("data: "))
				?.slice(6)
		: raw;
	if (!data) throw new Error("Missing MCP response frame");
	return JSON.parse(data) as T;
}

async function readMcpResponse<T = unknown>(response: Response): Promise<T> {
	return parseMcpResponse<T>(response, await response.text());
}

type ToolResult = {
	isError?: boolean;
	structuredContent: {
		workspace: string;
		revision: number;
		code?: string;
	};
};

async function call(
	name: string,
	args: Record<string, unknown>,
	token = SUBMAN_MCP_READ_TOKEN,
) {
	const response = await request(
		"tools/call",
		{ name, arguments: args },
		token,
	);
	expect(response.status).toBe(200);
	expect(response.headers.get("Cache-Control")).toContain("no-store");
	const raw = await response.text();
	for (const secret of [
		proxySecret,
		SUBMAN_MCP_GIST_ID,
		GITHUB_TOKEN,
		SUBMAN_MCP_READ_TOKEN,
		SUBMAN_MCP_WRITE_TOKEN,
	]) {
		expect(raw).not.toContain(secret);
	}
	const { result } = parseMcpResponse<{ result: ToolResult }>(response, raw);
	return result;
}

function rejectOutbound() {
	return vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Unexpected outbound request"));
}

afterEach(() => vi.restoreAllMocks());

describe("SubMan MCP Worker", () => {
	it("authenticates and advertises only scoped tool access", async () => {
		const outbound = rejectOutbound();
		for (const token of [null, GITHUB_TOKEN, SUBMAN_API_TOKEN]) {
			expect((await request("tools/list", {}, token)).status).toBe(401);
		}

		const initialized = await request(
			"initialize",
			{
				protocolVersion,
				capabilities: {},
				clientInfo: { name: "subman-test", version: "1" },
			},
			SUBMAN_MCP_READ_TOKEN,
		);
		expect(initialized.status).toBe(200);
		expect(await readMcpResponse(initialized)).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion,
				capabilities: { tools: expect.any(Object) },
			},
		});

		for (const [token, names] of [
			[SUBMAN_MCP_READ_TOKEN, ["get_node", "list_nodes"]],
			[SUBMAN_MCP_WRITE_TOKEN, ["get_node", "list_nodes", "set_node_enabled"]],
		] as const) {
			const response = await request("tools/list", {}, token);
			expect(response.status).toBe(200);
			expect(response.headers.get("Cache-Control")).toContain("no-store");
			const { result } = await readMcpResponse<{
				result: { tools: Array<{ name: string }> };
			}>(response);
			expect(result.tools.map((tool) => tool.name).sort()).toEqual(names);
		}

		const denied = await request(
			"tools/call",
			{
				name: "set_node_enabled",
				arguments: {
					nodeId: "node-hk-b",
					enabled: false,
					expectedRevision: 1,
					workspace: "denied-workspace",
				},
			},
			SUBMAN_MCP_READ_TOKEN,
		);
		expect(await readMcpResponse(denied)).toMatchObject({
			error: { code: -32602 },
		});
		expect(outbound).not.toHaveBeenCalled();
	});

	it("keeps MCP unavailable with missing or overlapping credentials", async () => {
		const outbound = rejectOutbound();
		const configuration = {
			...env,
			GITHUB_TOKEN,
			SUBMAN_API_TOKEN,
			SUBMAN_MCP_GIST_ID,
			SUBMAN_MCP_READ_TOKEN,
			SUBMAN_MCP_WRITE_TOKEN,
		};
		for (const bindings of [
			undefined,
			{ ...configuration, SUBMAN_MCP_READ_TOKEN: undefined },
			{ ...configuration, SUBMAN_MCP_WRITE_TOKEN: SUBMAN_MCP_READ_TOKEN },
		]) {
			const response = await handleSubManMcp(
				new Request(mcpUrl, {
					method: "POST",
					headers: { Authorization: `Bearer ${SUBMAN_MCP_READ_TOKEN}` },
				}),
				bindings,
			);
			expect(response.status).toBe(404);
		}
		expect(outbound).not.toHaveBeenCalled();
	});

	it("lists tools over the modern protocol without a legacy session", async () => {
		const outbound = rejectOutbound();
		const version = "2026-07-28";
		const response = await request(
			"tools/list",
			{
				_meta: {
					"io.modelcontextprotocol/protocolVersion": version,
					"io.modelcontextprotocol/clientInfo": {
						name: "subman-test",
						version: "1",
					},
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
			SUBMAN_MCP_READ_TOKEN,
			{
				Accept: "application/json",
				"Mcp-Method": "tools/list",
				"MCP-Protocol-Version": version,
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("application/json");
		const { result } = await readMcpResponse<{
			result: { tools: Array<{ name: string }> };
		}>(response);
		expect(result.tools.map((tool) => tool.name).sort()).toEqual([
			"get_node",
			"list_nodes",
		]);
		expect(outbound).not.toHaveBeenCalled();
	});

	it("rejects cross-origin and oversize requests before contacting GitHub", async () => {
		const outbound = rejectOutbound();
		const crossOrigin = await request("tools/list", {}, SUBMAN_MCP_READ_TOKEN, {
			Origin: "https://another.example",
		});
		expect(crossOrigin.status).toBe(403);

		const oversize = await request(
			"tools/call",
			{ name: "list_nodes", arguments: { name: "x".repeat(16_384) } },
			SUBMAN_MCP_READ_TOKEN,
		);
		expect(oversize.status).toBe(413);
		expect(outbound).not.toHaveBeenCalled();
	});

	it("reads bounded node summaries and combines filters with pagination", async () => {
		const github = fakeGithub();
		const list = { name: "hK", tag: "hk", enabled: true, limit: 1 };
		const first = await call("list_nodes", list);
		expect(first.structuredContent).toMatchObject({
			workspace: expect.any(String),
			revision: 1,
			total: 2,
			nextOffset: 1,
			nodes: [{ id: "node-hk-a", name: "HK-A", enabled: true, tags: ["hk"] }],
		});
		const next = await call("list_nodes", { ...list, offset: 1 });
		expect(next.structuredContent).toMatchObject({
			workspace: first.structuredContent.workspace,
			revision: 1,
			total: 2,
			nodes: [{ id: "node-hk-b" }],
		});
		expect(next.structuredContent).not.toHaveProperty("nextOffset");
		const node = await call("get_node", { nodeId: "node-hk-b" });
		expect(node.structuredContent).toMatchObject({
			workspace: first.structuredContent.workspace,
			revision: 1,
			node: {
				id: "node-hk-b",
				type: "vless",
				source: "single",
				updatedAt: now,
			},
		});
		expect(await call("get_node", { nodeId: "missing" })).toMatchObject({
			isError: true,
			structuredContent: { code: "not_found" },
		});
		const sensitive = await call("get_node", { nodeId: "node-sg-a" });
		expect(sensitive.structuredContent).toMatchObject({
			node: { name: "SG-A [redacted URL]", tags: ["[redacted URL]"] },
		});
		const searchForSecret = await call("list_nodes", { name: proxySecret });
		expect(searchForSecret.structuredContent).toMatchObject({ total: 0 });
		expect((await call("list_nodes", { limit: 51 })).isError).toBe(true);
		expect(github.patches).toEqual([]);
	});

	it("fails closed for wrong, public, missing and legacy Workspace documents", async () => {
		const github = fakeGithub();
		const expectUnavailable = async () => {
			expect(await call("list_nodes", {})).toMatchObject({
				isError: true,
				structuredContent: { code: "workspace_unavailable" },
			});
		};
		github.responseGistId = "abcdef0123456789abcdef0123456789";
		await expectUnavailable();
		github.responseGistId = SUBMAN_MCP_GIST_ID;

		github.isPublic = true;
		await expectUnavailable();
		github.isPublic = false;

		github.description = "Other";
		await expectUnavailable();
		github.description = "SubMan-Data";

		github.files["subman.bootstrap.json"] =
			createWorkspaceBootstrapContent(now);
		await expectUnavailable();

		delete github.files["subman.bootstrap.json"];
		github.files["subman.json"] = JSON.stringify({ version: 1, data: {} });
		await expectUnavailable();

		delete github.files["subman.json"];
		delete github.files["published.txt"];
		github.files["subman.bootstrap.json"] =
			createWorkspaceBootstrapContent(now);
		await expectUnavailable();
		expect(github.patches).toEqual([]);
	});

	it("commits one enabled-only change and distinguishes stale, unchanged and uncertain results", async () => {
		const github = fakeGithub();
		const nodeId = "node-hk-b";
		const { structuredContent: snapshot } = await call(
			"get_node",
			{ nodeId },
			SUBMAN_MCP_WRITE_TOKEN,
		);
		const change = {
			nodeId,
			enabled: false,
			workspace: snapshot.workspace,
			expectedRevision: snapshot.revision,
		};
		expect(
			await call(
				"set_node_enabled",
				{ ...change, workspace: "0".repeat(snapshot.workspace.length) },
				SUBMAN_MCP_WRITE_TOKEN,
			),
		).toMatchObject({
			isError: true,
			structuredContent: { code: "state_conflict" },
		});
		expect(
			await call(
				"set_node_enabled",
				{ ...change, name: "Unexpected rename" },
				SUBMAN_MCP_WRITE_TOKEN,
			),
		).toMatchObject({ isError: true });
		expect(github.patches).toEqual([]);

		const committed = await call(
			"set_node_enabled",
			change,
			SUBMAN_MCP_WRITE_TOKEN,
		);
		expect(committed.structuredContent).toMatchObject({
			status: "committed",
			workspace: snapshot.workspace,
			revision: 2,
			node: { id: nodeId, enabled: false },
		});
		expect(github.patches).toHaveLength(1);
		expect(Object.keys(github.patches[0])).toEqual(["subman.json"]);
		expect(github.files["published.txt"]).toBe("unchanged published bytes\n");
		const document = parseWorkspaceDocument(github.files["subman.json"]);
		expect(
			document.document.data.nodes.map(({ id, enabled }) => [id, enabled]),
		).toEqual([
			["node-hk-a", true],
			[nodeId, false],
			["node-sg-a", true],
		]);
		expect(
			await call("set_node_enabled", change, SUBMAN_MCP_WRITE_TOKEN),
		).toMatchObject({
			isError: true,
			structuredContent: { code: "state_conflict", revision: 2 },
		});
		const noChange = await call(
			"set_node_enabled",
			{
				...change,
				expectedRevision: 2,
			},
			SUBMAN_MCP_WRITE_TOKEN,
		);
		expect(noChange.structuredContent).toMatchObject({
			status: "no_change",
			revision: 2,
		});
		expect(github.patches).toHaveLength(1);

		github.failNextVerification = true;
		const secondNodeId = "node-hk-a";
		const secondChange = {
			...change,
			nodeId: secondNodeId,
			expectedRevision: noChange.structuredContent.revision,
		};
		expect(
			await call("set_node_enabled", secondChange, SUBMAN_MCP_WRITE_TOKEN),
		).toMatchObject({
			isError: true,
			structuredContent: { code: "outcome_uncertain" },
		});
		expect(github.patches).toHaveLength(2);
		const observed = await call("get_node", { nodeId: secondNodeId });
		expect(observed.structuredContent).toMatchObject({
			revision: 3,
			node: { id: secondNodeId, enabled: false },
		});
	});
});
