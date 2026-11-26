import type { NodeItem } from "$lib/models";
import { ApiError } from "$lib/server/api/errors";
import {
	createServerMutationIdentity,
	submitServerWorkspaceMutation,
} from "$lib/server/api/workspace";
import type { WorkspaceCoordinatorNamespace } from "$lib/server/api/workspace-mutations";
import { readWorkspaceGistSnapshot } from "$lib/server/workspace-gist";
import { WORKSPACE_DESCRIPTION } from "$lib/workspace-data";
import {
	parseWorkspaceDocument,
	WORKSPACE_BOOTSTRAP_FILE_NAME,
	WORKSPACE_FILE_NAME,
} from "$lib/workspace-document";
import { WORKSPACE_LIMITS } from "$lib/workspace-limits";

export type McpNodeContext = {
	githubToken: string;
	gistId: string;
	workspace: string;
	coordinator: WorkspaceCoordinatorNamespace | undefined;
};

const TOOL_ERRORS = {
	workspace_unavailable: "The configured SubMan Workspace is unavailable.",
	state_conflict:
		"Read the current Workspace state before applying the change.",
	not_found: "The node was not found.",
	outcome_uncertain:
		"The write outcome is uncertain. Read the node before acting again.",
} as const;

export class McpToolError extends Error {
	constructor(
		public readonly code: keyof typeof TOOL_ERRORS,
		public readonly revision?: number,
	) {
		super(TOOL_ERRORS[code]);
		this.name = "McpToolError";
	}
}

export const MCP_NODE_PAGE_MAX = 50;

const MCP_NODE_PAGE_DEFAULT = 20;
const MCP_NODE_TAG_MAX = 8;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

async function readPinnedWorkspace({ githubToken, gistId }: McpNodeContext) {
	try {
		const { gist, contents } = await readWorkspaceGistSnapshot(
			githubToken,
			gistId,
			[WORKSPACE_FILE_NAME],
		);
		const content = contents[WORKSPACE_FILE_NAME];
		if (
			gist.id === gistId &&
			gist.description === WORKSPACE_DESCRIPTION &&
			gist.public === false &&
			!gist.files.some(
				(file) => file.filename === WORKSPACE_BOOTSTRAP_FILE_NAME,
			) &&
			typeof content === "string"
		) {
			const parsed = parseWorkspaceDocument(content, {
				expectedWorkspaceId: `gist:${gistId}`,
			});
			if (parsed.schemaVersion === 2) return { gist, ...parsed.document };
		}
	} catch {
		throw new McpToolError("workspace_unavailable");
	}
	throw new McpToolError("workspace_unavailable");
}

function summaryLabel(value: string, maxBytes: number): string {
	const text = value
		.slice(0, maxBytes + 32)
		.replace(/[a-z][a-z0-9+.-]{0,31}:\/\/\S*/gi, "[redacted URL]");
	const buffer = new Uint8Array(maxBytes);
	const { read, written } = encoder.encodeInto(text, buffer);
	return read === text.length
		? text
		: decoder.decode(buffer.subarray(0, written));
}

function summarizeNode(node: NodeItem) {
	return {
		id: node.id,
		name: summaryLabel(node.name, WORKSPACE_LIMITS.nameBytes),
		type: node.type,
		enabled: node.enabled,
		source: node.source,
		updatedAt: node.updatedAt,
		tags: node.tags
			.slice(0, MCP_NODE_TAG_MAX)
			.map((tag) => summaryLabel(tag.label, WORKSPACE_LIMITS.labelBytes)),
	};
}

function findNode(nodes: NodeItem[], nodeId: string): NodeItem {
	const node = nodes.find(({ id }) => id === nodeId);
	if (!node) throw new McpToolError("not_found");
	return node;
}

export async function listMcpNodes(
	context: McpNodeContext,
	input: {
		name?: string;
		tag?: string;
		enabled?: boolean;
		offset?: number;
		limit?: number;
	},
) {
	const document = await readPinnedWorkspace(context);
	const name = input.name?.toLowerCase();
	const tag = input.tag;
	const tagIsDisplayable =
		tag === undefined || tag === summaryLabel(tag, WORKSPACE_LIMITS.labelBytes);
	const matches = document.data.nodes.filter(
		(node) =>
			(name === undefined ||
				summaryLabel(node.name, WORKSPACE_LIMITS.nameBytes)
					.toLowerCase()
					.includes(name)) &&
			(tag === undefined ||
				(tagIsDisplayable && node.tags.some((entry) => entry.label === tag))) &&
			(input.enabled === undefined || node.enabled === input.enabled),
	);
	const offset = input.offset ?? 0;
	const end = offset + (input.limit ?? MCP_NODE_PAGE_DEFAULT);
	return {
		workspace: context.workspace,
		revision: document.revision,
		nodes: matches.slice(offset, end).map(summarizeNode),
		total: matches.length,
		...(end < matches.length ? { nextOffset: end } : {}),
	};
}

export async function getMcpNode(
	context: McpNodeContext,
	input: { nodeId: string },
) {
	const document = await readPinnedWorkspace(context);
	return {
		workspace: context.workspace,
		revision: document.revision,
		node: summarizeNode(findNode(document.data.nodes, input.nodeId)),
	};
}

export async function setMcpNodeEnabled(
	context: McpNodeContext,
	input: {
		nodeId: string;
		enabled: boolean;
		workspace: string;
		expectedRevision: number;
	},
) {
	if (input.workspace !== context.workspace)
		throw new McpToolError("state_conflict");
	const document = await readPinnedWorkspace(context);
	if (document.revision !== input.expectedRevision) {
		throw new McpToolError("state_conflict", document.revision);
	}
	const node = findNode(document.data.nodes, input.nodeId);
	if (node.enabled === input.enabled) {
		return {
			status: "no_change" as const,
			workspace: context.workspace,
			revision: document.revision,
			node: summarizeNode(node),
		};
	}
	if (!context.coordinator) throw new McpToolError("workspace_unavailable");
	try {
		const result = await submitServerWorkspaceMutation(
			context.coordinator,
			context.githubToken,
			document.gist,
			{
				...createServerMutationIdentity(document),
				kind: "node.upsert",
				payload: {
					operation: "patch",
					nodeId: input.nodeId,
					patch: { enabled: input.enabled },
				},
			},
		);
		const committed = result.document.data.nodes.find(
			({ id }) => id === input.nodeId,
		);
		if (committed?.enabled !== input.enabled)
			throw new McpToolError("outcome_uncertain");
		return {
			status: "committed" as const,
			workspace: context.workspace,
			revision: result.committedRevision,
			node: summarizeNode(committed),
		};
	} catch (error) {
		if (error instanceof ApiError) {
			if (
				error.code === "revision_conflict" ||
				error.code === "workspace_mismatch"
			) {
				throw new McpToolError("state_conflict", error.details.revision);
			}
			if (
				error.code === "entity_not_found" ||
				error.code === "entity_deleted"
			) {
				throw new McpToolError("not_found");
			}
			if (
				error.code === "workspace_not_found" ||
				error.code === "gist_read_failed"
			) {
				throw new McpToolError("workspace_unavailable");
			}
		}
		throw new McpToolError("outcome_uncertain");
	}
}
