import type {
	AppState,
	NodeItem,
	NodeTag,
	ProxyType,
	SourceType,
} from "$lib/models";
import {
	findDuplicateNodeRaw,
	formatResourceNameTimestamp,
	makeUniqueResourceName,
} from "$lib/resource-dedupe";
import { reconcileWorkspaceState } from "$lib/workspace-data";
import { ApiError } from "./errors";

const PROXY_TYPES = new Set<ProxyType>([
	"vless",
	"vmess",
	"trojan",
	"ss",
	"ssr",
	"hysteria2",
	"tuic",
	"anytls",
	"other",
]);

const SOURCE_TYPES = new Set<SourceType>(["single", "subscription"]);

export const EXTERNAL_KEY_TAG_PREFIX = "external:";

export type NodePayload = {
	name: string;
	type: ProxyType;
	raw: string;
	tags: NodeTag[];
	enabled: boolean;
	source: SourceType;
};

export type NodePatchPayload = Partial<NodePayload>;

export type NodeMutationClock = {
	id: () => string;
	now: () => string;
};

const defaultClock: NodeMutationClock = {
	id: () => crypto.randomUUID(),
	now: () => new Date().toISOString(),
};

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new ApiError(400, "bad_request", `${field} is required`);
	}
	return value.trim();
}

function tagIdFromLabel(label: string): string {
	return label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9:_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function rejectReservedExternalTag(label: string): void {
	if (label.toLowerCase().startsWith(EXTERNAL_KEY_TAG_PREFIX)) {
		throw new ApiError(
			400,
			"bad_request",
			"external: tag namespace is reserved",
		);
	}
}

function normalizeTag(value: unknown): NodeTag {
	if (typeof value === "string") {
		const label = value.trim();
		if (!label) {
			throw new ApiError(400, "bad_request", "tag label is required");
		}
		rejectReservedExternalTag(label);
		return { id: tagIdFromLabel(label) || crypto.randomUUID(), label };
	}

	if (value && typeof value === "object") {
		const tag = value as Partial<NodeTag>;
		const label = requireString(tag.label, "tag label");
		rejectReservedExternalTag(label);
		const id =
			typeof tag.id === "string" && tag.id.trim()
				? tag.id.trim()
				: tagIdFromLabel(label);
		return { id, label };
	}

	throw new ApiError(400, "bad_request", "tag must be a string or object");
}

function dedupeTags(tags: NodeTag[]): NodeTag[] {
	const seen = new Set<string>();
	const result: NodeTag[] = [];
	for (const tag of tags) {
		const key = tag.label;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(tag);
	}
	return result;
}

function externalKeyTag(externalKey: string): NodeTag {
	const label = `${EXTERNAL_KEY_TAG_PREFIX}${externalKey}`;
	return { id: tagIdFromLabel(label), label };
}

function uniqueNodeNameForState(
	state: AppState,
	name: string,
	now: string,
	excludeId?: string,
): string {
	return makeUniqueResourceName(
		name,
		state.nodes
			.filter((node) => node.id !== excludeId)
			.map((node) => node.name),
		formatResourceNameTimestamp(new Date(now)),
	);
}

function duplicateRawError(node: NodeItem): ApiError {
	return new ApiError(
		409,
		"duplicate_node_raw",
		`A node with the same raw URI already exists: ${node.name}`,
	);
}

export function parseNodePayload(input: unknown): NodePayload {
	if (!input || typeof input !== "object") {
		throw new ApiError(400, "bad_request", "request body must be an object");
	}

	const body = input as Record<string, unknown>;
	const name = requireString(body.name, "name");
	const typeValue = requireString(body.type, "type");
	if (!PROXY_TYPES.has(typeValue as ProxyType)) {
		throw new ApiError(400, "bad_request", "type is unsupported");
	}

	const raw = requireString(body.raw, "raw");
	const sourceValue =
		typeof body.source === "string" && body.source.trim()
			? body.source.trim()
			: "single";
	if (!SOURCE_TYPES.has(sourceValue as SourceType)) {
		throw new ApiError(400, "bad_request", "source is unsupported");
	}

	const tagsInput = Array.isArray(body.tags) ? body.tags : [];
	return {
		name,
		type: typeValue as ProxyType,
		raw,
		enabled: typeof body.enabled === "boolean" ? body.enabled : true,
		source: sourceValue as SourceType,
		tags: dedupeTags(tagsInput.map(normalizeTag)),
	};
}

export function parseNodePatchPayload(input: unknown): NodePatchPayload {
	if (!input || typeof input !== "object") {
		throw new ApiError(400, "bad_request", "request body must be an object");
	}

	const body = input as Record<string, unknown>;
	const patch: NodePatchPayload = {};

	if ("name" in body) {
		patch.name = requireString(body.name, "name");
	}
	if ("type" in body) {
		const typeValue = requireString(body.type, "type");
		if (!PROXY_TYPES.has(typeValue as ProxyType)) {
			throw new ApiError(400, "bad_request", "type is unsupported");
		}
		patch.type = typeValue as ProxyType;
	}
	if ("raw" in body) {
		patch.raw = requireString(body.raw, "raw");
	}
	if ("enabled" in body) {
		if (typeof body.enabled !== "boolean") {
			throw new ApiError(400, "bad_request", "enabled must be a boolean");
		}
		patch.enabled = body.enabled;
	}
	if ("source" in body) {
		const sourceValue = requireString(body.source, "source");
		if (!SOURCE_TYPES.has(sourceValue as SourceType)) {
			throw new ApiError(400, "bad_request", "source is unsupported");
		}
		patch.source = sourceValue as SourceType;
	}
	if ("tags" in body) {
		if (!Array.isArray(body.tags)) {
			throw new ApiError(400, "bad_request", "tags must be an array");
		}
		patch.tags = dedupeTags(body.tags.map(normalizeTag));
	}

	return patch;
}

export function applyNodeCreate(
	state: AppState,
	payload: NodePayload,
	clock: NodeMutationClock = defaultClock,
): { state: AppState; node: NodeItem } {
	const timestamp = clock.now();
	const duplicate = findDuplicateNodeRaw(state.nodes, payload.raw);
	if (duplicate) {
		throw duplicateRawError(duplicate);
	}
	const node: NodeItem = {
		id: clock.id(),
		...payload,
		name: uniqueNodeNameForState(state, payload.name, timestamp),
		updatedAt: timestamp,
	};

	return {
		node,
		state: {
			...state,
			nodes: [node, ...state.nodes],
			lastUpdated: timestamp,
		},
	};
}

export function applyNodePatch(
	state: AppState,
	nodeId: string,
	patch: NodePatchPayload,
	now = new Date().toISOString(),
): { state: AppState; node: NodeItem | null } {
	const index = state.nodes.findIndex((node) => node.id === nodeId);
	if (index < 0) {
		return { state, node: null };
	}

	const raw = patch.raw ?? state.nodes[index]?.raw;
	const duplicate = raw ? findDuplicateNodeRaw(state.nodes, raw, nodeId) : null;
	if (duplicate) {
		throw duplicateRawError(duplicate);
	}

	const nodes = [...state.nodes];
	const node = {
		...nodes[index],
		...patch,
		name:
			patch.name !== undefined
				? uniqueNodeNameForState(state, patch.name, now, nodeId)
				: nodes[index].name,
		updatedAt: now,
	};
	nodes[index] = node;

	return {
		node,
		state: {
			...state,
			nodes,
			lastUpdated: now,
		},
	};
}

export function applyNodeUpsertByExternalKey(
	state: AppState,
	externalKey: string,
	payload: NodePayload,
	clock: NodeMutationClock = defaultClock,
): { state: AppState; node: NodeItem } {
	const keyTag = externalKeyTag(externalKey);
	const tags = dedupeTags([...payload.tags, keyTag]);
	const existing = state.nodes.find((node) =>
		node.tags.some((tag) => tag.label === keyTag.label),
	);

	if (!existing) {
		return applyNodeCreate(state, { ...payload, tags }, clock);
	}

	const patched = applyNodePatch(
		state,
		existing.id,
		{
			...payload,
			tags,
		},
		clock.now(),
	);

	if (!patched.node) {
		return applyNodeCreate(state, { ...payload, tags }, clock);
	}

	return { state: patched.state, node: patched.node };
}

export function applyNodeDelete(
	state: AppState,
	nodeId: string,
	now = new Date().toISOString(),
): { state: AppState; deleted: boolean } {
	const nodes = state.nodes.filter((node) => node.id !== nodeId);
	if (nodes.length === state.nodes.length) {
		return { state, deleted: false };
	}

	return {
		deleted: true,
		state: reconcileWorkspaceState({ ...state, nodes, lastUpdated: now }, now),
	};
}
