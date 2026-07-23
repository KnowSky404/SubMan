import { toStableGistRawUrl } from "$lib/gist-raw-url";
import type {
	AggregatePublishTarget,
	AggregateRule,
	ClientExportProfile,
	GistMeta,
	NodeItem,
	NodeTag,
	ProxyType,
	SourceType,
	SubscriptionItem,
} from "$lib/models";
import {
	findDuplicateNodeRaw,
	findDuplicateSubscriptionUrl,
	formatResourceNameTimestamp,
	makeUniqueResourceName,
} from "$lib/resource-dedupe";
import {
	serializeWorkspaceDocumentV2,
	validateWorkspaceAggregate,
	validateWorkspaceClientExport,
	validateWorkspaceData,
	validateWorkspaceDocumentV2,
	validateWorkspaceNode,
	validateWorkspaceOutputFileName,
	validateWorkspacePublishTarget,
	validateWorkspaceSubscription,
	validateWorkspaceTimestamp,
	validateWorkspaceUuid,
	type WorkspaceData,
	WorkspaceDocumentError,
	type WorkspaceDocumentV2,
	type WorkspaceTombstone,
	type WorkspaceTombstones,
} from "$lib/workspace-document";
import { utf8ByteLength, WORKSPACE_LIMITS } from "$lib/workspace-limits";
import {
	findWorkspaceOutputConflicts,
	getConflictingOutputOwners,
	getWorkspaceOutputOwners,
	isCurrentClientExportOutputPublished,
	isCurrentPublishTargetOutputPublished,
} from "$lib/workspace-output";

export type WorkspaceMutationSource = "browser" | "server-api";

export type WorkspaceNodeInput = {
	name: string;
	type: ProxyType;
	raw: string;
	tags: NodeTag[];
	enabled: boolean;
	source: SourceType;
};

export type WorkspaceNodePatch = Partial<WorkspaceNodeInput>;
export type WorkspaceOutputCleanupPolicy = "keep" | "delete-if-unreferenced";

type MutationBase<Kind extends string, Payload> = {
	mutationId: string;
	workspaceId: string;
	expectedRevision: number;
	source: WorkspaceMutationSource;
	createdAt: string;
	kind: Kind;
	payload: Payload;
};

export type NodeUpsertMutation = MutationBase<
	"node.upsert",
	| { operation: "replace"; node: NodeItem }
	| { operation: "create"; nodeId: string; node: WorkspaceNodeInput }
	| { operation: "patch"; nodeId: string; patch: WorkspaceNodePatch }
	| {
			operation: "upsert-by-external-key";
			nodeId: string;
			externalKey: string;
			node: WorkspaceNodeInput;
	  }
>;

export type WorkspaceMutation =
	| NodeUpsertMutation
	| MutationBase<"node.delete", { id: string }>
	| MutationBase<"subscription.upsert", { subscription: SubscriptionItem }>
	| MutationBase<"subscription.delete", { id: string }>
	| MutationBase<"aggregate.upsert", { aggregate: AggregateRule }>
	| MutationBase<
			"aggregate.delete",
			{ id: string; cleanupUnreferencedOutputs?: boolean }
	  >
	| MutationBase<
			"publish-target.upsert",
			{
				target: AggregatePublishTarget;
				previousFileCleanup?: WorkspaceOutputCleanupPolicy;
			}
	  >
	| MutationBase<
			"publish-target.delete",
			{ id: string; cleanupUnreferencedOutputs?: boolean }
	  >
	| MutationBase<"client-export.upsert", { profile: ClientExportProfile }>
	| MutationBase<"client-export.delete", { id: string }>
	| MutationBase<
			"aggregate.publish",
			{
				targetId: string;
				output: { fileName: string; content: string };
			}
	  >
	| MutationBase<
			"client-export.publish",
			{
				profileId: string;
				output: { fileName: string; content: string };
			}
	  >
	| MutationBase<"output.delete", { fileName: string }>
	| MutationBase<"workspace.bootstrap.cleanup", Record<string, never>>
	| MutationBase<
			"workspace.reconcile",
			{ baselineRevision: number; data: WorkspaceData }
	  >;

export type WorkspaceFiles = Record<string, { content: string } | null>;

export type WorkspaceMutationReceipt = {
	kind: WorkspaceMutation["kind"];
	entityId?: string;
	deleted?: true;
};

export type WorkspaceMutationApplication = {
	document: WorkspaceDocumentV2;
	files: WorkspaceFiles;
	receipt: WorkspaceMutationReceipt;
};

export type WorkspaceMutationContext = {
	committedAt: string;
	gist: Pick<GistMeta, "id" | "ownerLogin" | "files">;
};

export type WorkspaceMutationErrorCode =
	| "invalid_mutation"
	| "workspace_size_limit"
	| "workspace_mismatch"
	| "revision_conflict"
	| "entity_deleted"
	| "entity_not_found"
	| "entity_exists"
	| "duplicate_node_raw"
	| "duplicate_subscription_url"
	| "output_file_conflict"
	| "publication_file_mismatch";

export class WorkspaceMutationError extends Error {
	constructor(
		readonly code: WorkspaceMutationErrorCode,
		message: string,
	) {
		super(message);
		this.name = "WorkspaceMutationError";
	}
}

function fail(code: WorkspaceMutationErrorCode, message: string): never {
	throw new WorkspaceMutationError(code, message);
}

function invalid(message: string): never {
	return fail("invalid_mutation", message);
}

function byteLimit(value: string, path: string, limit: number): void {
	if (utf8ByteLength(value) > limit) {
		invalid(`${path} exceeds ${limit} UTF-8 bytes`);
	}
}

function tagsLimit(tags: NodeTag[], path: string): void {
	if (tags.length > WORKSPACE_LIMITS.tagsPerEntity) {
		invalid(`${path} exceeds ${WORKSPACE_LIMITS.tagsPerEntity} entries`);
	}
	for (const [index, tag] of tags.entries()) {
		byteLimit(
			tag.label,
			`${path}[${index}].label`,
			WORKSPACE_LIMITS.labelBytes,
		);
	}
}

function nodeLimits(node: WorkspaceNodeInput | NodeItem, path: string): void {
	byteLimit(node.name, `${path}.name`, WORKSPACE_LIMITS.nameBytes);
	byteLimit(node.raw, `${path}.raw`, WORKSPACE_LIMITS.nodeRawBytes);
	tagsLimit(node.tags, `${path}.tags`);
}

function renameMapLimits(
	renameMap: AggregateRule["renameMap"],
	path: string,
): void {
	const entries = Object.entries(renameMap);
	if (entries.length > WORKSPACE_LIMITS.renameMapEntries) {
		invalid(`${path} exceeds ${WORKSPACE_LIMITS.renameMapEntries} entries`);
	}
	byteLimit(JSON.stringify(renameMap), path, WORKSPACE_LIMITS.renameMapBytes);
}

function targetLimits(target: AggregatePublishTarget, path: string): void {
	byteLimit(target.name, `${path}.name`, WORKSPACE_LIMITS.nameBytes);
}

function mutationLimits(mutation: WorkspaceMutation): void {
	switch (mutation.kind) {
		case "node.upsert": {
			const payload = mutation.payload;
			if (payload.operation === "patch") {
				if (payload.patch.name !== undefined) {
					byteLimit(
						payload.patch.name,
						"payload.patch.name",
						WORKSPACE_LIMITS.nameBytes,
					);
				}
				if (payload.patch.raw !== undefined) {
					byteLimit(
						payload.patch.raw,
						"payload.patch.raw",
						WORKSPACE_LIMITS.nodeRawBytes,
					);
				}
				if (payload.patch.tags !== undefined) {
					tagsLimit(payload.patch.tags, "payload.patch.tags");
				}
			} else if (payload.operation === "create") {
				nodeLimits(payload.node, "payload.node");
			} else if (payload.operation === "upsert-by-external-key") {
				byteLimit(
					payload.externalKey,
					"payload.externalKey",
					WORKSPACE_LIMITS.externalKeyBytes,
				);
			}
			break;
		}
		case "aggregate.publish":
		case "client-export.publish":
			byteLimit(
				mutation.payload.output.content,
				"payload.output.content",
				WORKSPACE_LIMITS.outputContentBytes,
			);
			break;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) invalid(`${path} must be an object`);
	return value;
}

function exactKeys(
	value: Record<string, unknown>,
	path: string,
	required: readonly string[],
	optional: readonly string[] = [],
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of required) {
		if (!(key in value)) invalid(`${path}.${key} is required`);
	}
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) invalid(`${path}.${key} is not supported`);
	}
}

function nonempty(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		invalid(`${path} must be a non-empty string`);
	}
	return value;
}

function bool(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") invalid(`${path} must be a boolean`);
	return value;
}

function safeRevision(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		invalid(`${path} must be a non-negative safe integer`);
	}
	return value as number;
}

function documentValue<T>(parse: () => T): T {
	try {
		return parse();
	} catch (error) {
		if (error instanceof WorkspaceDocumentError) invalid(error.message);
		throw error;
	}
}

function parseTags(value: unknown, path: string): NodeTag[] {
	const validated = documentValue(() =>
		validateWorkspaceNode({
			id: "validation-node",
			name: "validation",
			type: "vless",
			raw: "vless://validation",
			tags: value,
			enabled: true,
			updatedAt: "2000-01-01T00:00:00.000Z",
			source: "single",
		}),
	);
	if (!Array.isArray(value)) invalid(`${path} must be an array`);
	return validated.tags;
}

function parseNodeInput(value: unknown, path: string): WorkspaceNodeInput {
	const input = record(value, path);
	exactKeys(input, path, ["name", "type", "raw", "tags", "enabled", "source"]);
	const validated = documentValue(() =>
		validateWorkspaceNode({
			id: "validation-node",
			...input,
			updatedAt: "2000-01-01T00:00:00.000Z",
		}),
	);
	if (
		validated.tags.some(
			(tag) =>
				tag.id.toLowerCase().startsWith("external:") ||
				tag.label.toLowerCase().startsWith("external:"),
		)
	) {
		invalid(`${path}.tags cannot claim the reserved external namespace`);
	}
	return {
		name: validated.name,
		type: validated.type,
		raw: validated.raw,
		tags: validated.tags,
		enabled: validated.enabled,
		source: validated.source,
	};
}

function parseNodePatch(value: unknown, path: string): WorkspaceNodePatch {
	const input = record(value, path);
	const fields = ["name", "type", "raw", "tags", "enabled", "source"] as const;
	exactKeys(input, path, [], fields);
	if (Object.keys(input).length === 0) invalid(`${path} must not be empty`);
	const patch: WorkspaceNodePatch = {};
	if (input.name !== undefined)
		patch.name = nonempty(input.name, `${path}.name`);
	if (input.type !== undefined) {
		patch.type = parseNodeInput(
			{
				name: "validation",
				type: input.type,
				raw: "vless://validation",
				tags: [],
				enabled: true,
				source: "single",
			},
			path,
		).type;
	}
	if (input.raw !== undefined) patch.raw = nonempty(input.raw, `${path}.raw`);
	if (input.tags !== undefined)
		patch.tags = parseTags(input.tags, `${path}.tags`);
	if (input.enabled !== undefined) {
		patch.enabled = bool(input.enabled, `${path}.enabled`);
	}
	if (input.source !== undefined) {
		patch.source = parseNodeInput(
			{
				name: "validation",
				type: "vless",
				raw: "vless://validation",
				tags: [],
				enabled: true,
				source: input.source,
			},
			path,
		).source;
	}
	return patch;
}

function parseDeletePayload(value: unknown, path: string): { id: string } {
	const input = record(value, path);
	exactKeys(input, path, ["id"]);
	return { id: nonempty(input.id, `${path}.id`) };
}

function parseCleanupDeletePayload(
	value: unknown,
	path: string,
): { id: string; cleanupUnreferencedOutputs?: boolean } {
	const input = record(value, path);
	exactKeys(input, path, ["id"], ["cleanupUnreferencedOutputs"]);
	if (
		input.cleanupUnreferencedOutputs !== undefined &&
		typeof input.cleanupUnreferencedOutputs !== "boolean"
	) {
		invalid(`${path}.cleanupUnreferencedOutputs must be a boolean`);
	}
	return {
		id: nonempty(input.id, `${path}.id`),
		...(input.cleanupUnreferencedOutputs === undefined
			? {}
			: { cleanupUnreferencedOutputs: input.cleanupUnreferencedOutputs }),
	};
}

function parseOutputCleanupPolicy(
	value: unknown,
	path: string,
): WorkspaceOutputCleanupPolicy {
	if (value === "keep" || value === "delete-if-unreferenced") return value;
	return invalid(`${path} is unsupported`);
}

function parseOutput(
	value: unknown,
	path: string,
): {
	fileName: string;
	content: string;
} {
	const input = record(value, path);
	exactKeys(input, path, ["fileName", "content"]);
	if (typeof input.content !== "string")
		invalid(`${path}.content must be a string`);
	return {
		fileName: documentValue(() =>
			validateWorkspaceOutputFileName(input.fileName, `${path}.fileName`),
		),
		content: input.content,
	};
}

function parseNodeUpsertPayload(
	value: unknown,
	source: WorkspaceMutationSource,
): NodeUpsertMutation["payload"] {
	const input = record(value, "payload");
	const operation = nonempty(input.operation, "payload.operation");
	if (operation === "replace") {
		if (source !== "browser")
			invalid("node replace is limited to browser mutations");
		exactKeys(input, "payload", ["operation", "node"]);
		return {
			operation,
			node: documentValue(() => validateWorkspaceNode(input.node)),
		};
	}
	if (source !== "server-api") {
		invalid(`node ${operation} is limited to server-api mutations`);
	}
	if (operation === "create") {
		exactKeys(input, "payload", ["operation", "nodeId", "node"]);
		return {
			operation,
			nodeId: nonempty(input.nodeId, "payload.nodeId"),
			node: parseNodeInput(input.node, "payload.node"),
		};
	}
	if (operation === "patch") {
		exactKeys(input, "payload", ["operation", "nodeId", "patch"]);
		return {
			operation,
			nodeId: nonempty(input.nodeId, "payload.nodeId"),
			patch: parseNodePatch(input.patch, "payload.patch"),
		};
	}
	if (operation === "upsert-by-external-key") {
		exactKeys(input, "payload", ["operation", "nodeId", "externalKey", "node"]);
		return {
			operation,
			nodeId: nonempty(input.nodeId, "payload.nodeId"),
			externalKey: nonempty(input.externalKey, "payload.externalKey").trim(),
			node: parseNodeInput(input.node, "payload.node"),
		};
	}
	return invalid(`payload.operation is unsupported: ${operation}`);
}

const MUTATION_KINDS = new Set<WorkspaceMutation["kind"]>([
	"node.upsert",
	"node.delete",
	"subscription.upsert",
	"subscription.delete",
	"aggregate.upsert",
	"aggregate.delete",
	"publish-target.upsert",
	"publish-target.delete",
	"client-export.upsert",
	"client-export.delete",
	"aggregate.publish",
	"client-export.publish",
	"output.delete",
	"workspace.bootstrap.cleanup",
	"workspace.reconcile",
]);

function parseWorkspaceMutationShape(inputValue: unknown): WorkspaceMutation {
	const input = record(inputValue, "mutation");
	exactKeys(input, "mutation", [
		"mutationId",
		"workspaceId",
		"expectedRevision",
		"source",
		"createdAt",
		"kind",
		"payload",
	]);
	const mutationId = documentValue(() =>
		validateWorkspaceUuid(input.mutationId, "mutationId"),
	);
	const workspaceId = nonempty(input.workspaceId, "workspaceId");
	const expectedRevision = safeRevision(
		input.expectedRevision,
		"expectedRevision",
	);
	const sourceValue = nonempty(input.source, "source");
	if (sourceValue !== "browser" && sourceValue !== "server-api") {
		invalid(`source is unsupported: ${sourceValue}`);
	}
	const source: WorkspaceMutationSource = sourceValue;
	const createdAt = documentValue(() =>
		validateWorkspaceTimestamp(input.createdAt, "createdAt"),
	);
	const kind = nonempty(input.kind, "kind") as WorkspaceMutation["kind"];
	if (!MUTATION_KINDS.has(kind)) invalid(`kind is unsupported: ${kind}`);
	if (
		source === "server-api" &&
		kind !== "node.upsert" &&
		kind !== "node.delete"
	) {
		invalid(`server-api source cannot submit ${kind}`);
	}
	const base = {
		mutationId,
		workspaceId,
		expectedRevision,
		source,
		createdAt,
	};

	switch (kind) {
		case "node.upsert":
			return {
				...base,
				kind,
				payload: parseNodeUpsertPayload(input.payload, source),
			};
		case "node.delete":
		case "subscription.delete":
		case "client-export.delete":
			return {
				...base,
				kind,
				payload: parseDeletePayload(input.payload, "payload"),
			};
		case "aggregate.delete":
		case "publish-target.delete":
			return {
				...base,
				kind,
				payload: parseCleanupDeletePayload(input.payload, "payload"),
			};
		case "subscription.upsert": {
			const payload = record(input.payload, "payload");
			exactKeys(payload, "payload", ["subscription"]);
			return {
				...base,
				kind,
				payload: {
					subscription: documentValue(() =>
						validateWorkspaceSubscription(payload.subscription),
					),
				},
			};
		}
		case "aggregate.upsert": {
			const payload = record(input.payload, "payload");
			exactKeys(payload, "payload", ["aggregate"]);
			return {
				...base,
				kind,
				payload: {
					aggregate: documentValue(() =>
						validateWorkspaceAggregate(payload.aggregate),
					),
				},
			};
		}
		case "publish-target.upsert": {
			const payload = record(input.payload, "payload");
			exactKeys(payload, "payload", ["target"], ["previousFileCleanup"]);
			return {
				...base,
				kind,
				payload: {
					target: documentValue(() =>
						validateWorkspacePublishTarget(payload.target),
					),
					...(payload.previousFileCleanup === undefined
						? {}
						: {
								previousFileCleanup: parseOutputCleanupPolicy(
									payload.previousFileCleanup,
									"payload.previousFileCleanup",
								),
							}),
				},
			};
		}
		case "client-export.upsert": {
			const payload = record(input.payload, "payload");
			exactKeys(payload, "payload", ["profile"]);
			return {
				...base,
				kind,
				payload: {
					profile: documentValue(() =>
						validateWorkspaceClientExport(payload.profile),
					),
				},
			};
		}
		case "aggregate.publish": {
			const payload = record(input.payload, "payload");
			exactKeys(payload, "payload", ["targetId", "output"]);
			return {
				...base,
				kind,
				payload: {
					targetId: nonempty(payload.targetId, "payload.targetId"),
					output: parseOutput(payload.output, "payload.output"),
				},
			};
		}
		case "client-export.publish": {
			const payload = record(input.payload, "payload");
			exactKeys(payload, "payload", ["profileId", "output"]);
			return {
				...base,
				kind,
				payload: {
					profileId: nonempty(payload.profileId, "payload.profileId"),
					output: parseOutput(payload.output, "payload.output"),
				},
			};
		}
		case "output.delete": {
			const payload = record(input.payload, "payload");
			exactKeys(payload, "payload", ["fileName"]);
			return {
				...base,
				kind,
				payload: {
					fileName: documentValue(() =>
						validateWorkspaceOutputFileName(
							payload.fileName,
							"payload.fileName",
						),
					),
				},
			};
		}
		case "workspace.bootstrap.cleanup": {
			const payload = record(input.payload, "payload");
			exactKeys(payload, "payload", []);
			return { ...base, kind, payload: {} };
		}
		case "workspace.reconcile": {
			const payload = record(input.payload, "payload");
			exactKeys(payload, "payload", ["baselineRevision", "data"]);
			const baselineRevision = safeRevision(
				payload.baselineRevision,
				"payload.baselineRevision",
			);
			if (baselineRevision > expectedRevision) {
				invalid("payload.baselineRevision cannot exceed expectedRevision");
			}
			return {
				...base,
				kind,
				payload: {
					baselineRevision,
					data: documentValue(() => validateWorkspaceData(payload.data)),
				},
			};
		}
	}
}

export function parseWorkspaceMutation(inputValue: unknown): WorkspaceMutation {
	const mutation = parseWorkspaceMutationShape(inputValue);
	mutationLimits(mutation);
	return mutation;
}

function canonicalizeValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalizeValue);
	if (!isRecord(value)) return value;
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		result[key] = canonicalizeValue(value[key]);
	}
	return result;
}

function sameValue(left: unknown, right: unknown): boolean {
	return (
		JSON.stringify(canonicalizeValue(left)) ===
		JSON.stringify(canonicalizeValue(right))
	);
}

function reconcileChangedValueLimits(
	current: WorkspaceData,
	next: WorkspaceData,
): void {
	const previousNodes = new Map(current.nodes.map((item) => [item.id, item]));
	for (const item of next.nodes) {
		const previous = previousNodes.get(item.id);
		if (!previous || item.name !== previous.name) {
			byteLimit(item.name, `nodes.${item.id}.name`, WORKSPACE_LIMITS.nameBytes);
		}
		if (!previous || item.raw !== previous.raw) {
			byteLimit(
				item.raw,
				`nodes.${item.id}.raw`,
				WORKSPACE_LIMITS.nodeRawBytes,
			);
		}
		if (!previous || !sameValue(item.tags, previous.tags)) {
			tagsLimit(item.tags, `nodes.${item.id}.tags`);
		}
	}

	const previousSubscriptions = new Map(
		current.subscriptions.map((item) => [item.id, item]),
	);
	for (const item of next.subscriptions) {
		const previous = previousSubscriptions.get(item.id);
		if (!previous || item.name !== previous.name) {
			byteLimit(
				item.name,
				`subscriptions.${item.id}.name`,
				WORKSPACE_LIMITS.nameBytes,
			);
		}
		if (!previous || item.url !== previous.url) {
			byteLimit(
				item.url,
				`subscriptions.${item.id}.url`,
				WORKSPACE_LIMITS.subscriptionUrlBytes,
			);
		}
		if (!previous || !sameValue(item.tags, previous.tags)) {
			tagsLimit(item.tags, `subscriptions.${item.id}.tags`);
		}
	}

	const previousAggregates = new Map(
		current.aggregates.map((item) => [item.id, item]),
	);
	for (const item of next.aggregates) {
		const previous = previousAggregates.get(item.id);
		if (!previous || item.name !== previous.name) {
			byteLimit(
				item.name,
				`aggregates.${item.id}.name`,
				WORKSPACE_LIMITS.nameBytes,
			);
		}
		if (!previous || !sameValue(item.renameMap, previous.renameMap)) {
			renameMapLimits(item.renameMap, `aggregates.${item.id}.renameMap`);
		}
	}

	const previousTargets = new Map(
		current.publishTargets.map((item) => [item.id, item]),
	);
	for (const item of next.publishTargets) {
		const previous = previousTargets.get(item.id);
		if (!previous || item.name !== previous.name) {
			targetLimits(item, `publishTargets.${item.id}`);
		}
	}

	const previousProfiles = new Map(
		current.clientExports.map((item) => [item.id, item]),
	);
	for (const item of next.clientExports) {
		const previous = previousProfiles.get(item.id);
		if (!previous || item.name !== previous.name) {
			byteLimit(
				item.name,
				`clientExports.${item.id}.name`,
				WORKSPACE_LIMITS.nameBytes,
			);
		}
		if (
			!previous ||
			item.options.selectorTag !== previous.options.selectorTag
		) {
			byteLimit(
				item.options.selectorTag,
				`clientExports.${item.id}.options.selectorTag`,
				WORKSPACE_LIMITS.labelBytes,
			);
		}
		if (!previous || item.options.urlTestTag !== previous.options.urlTestTag) {
			byteLimit(
				item.options.urlTestTag,
				`clientExports.${item.id}.options.urlTestTag`,
				WORKSPACE_LIMITS.labelBytes,
			);
		}
	}
}

function assertEntityCountGrowth(
	current: WorkspaceData,
	next: WorkspaceData,
): void {
	for (const collection of Object.keys(next) as Array<keyof WorkspaceData>) {
		if (
			next[collection].length > current[collection].length &&
			next[collection].length > WORKSPACE_LIMITS.entitiesPerCollection
		) {
			invalid(
				`${collection} exceeds ${WORKSPACE_LIMITS.entitiesPerCollection} entities`,
			);
		}
	}
}

function assertWorkspaceDocumentSize(
	current: WorkspaceDocumentV2,
	next: WorkspaceDocumentV2,
): void {
	const currentBytes = utf8ByteLength(serializeWorkspaceDocumentV2(current));
	const nextBytes = utf8ByteLength(serializeWorkspaceDocumentV2(next));
	if (nextBytes <= WORKSPACE_LIMITS.workspaceDocumentBytes) return;
	if (currentBytes <= WORKSPACE_LIMITS.workspaceDocumentBytes) {
		invalid(
			`Workspace document exceeds ${WORKSPACE_LIMITS.workspaceDocumentBytes} bytes`,
		);
	}
	if (nextBytes > currentBytes) {
		fail(
			"workspace_size_limit",
			`Workspace document exceeds ${WORKSPACE_LIMITS.workspaceDocumentBytes} bytes and requires repair`,
		);
	}
}

export function serializeWorkspaceMutation(
	mutation: WorkspaceMutation,
): string {
	return JSON.stringify(canonicalizeValue(parseWorkspaceMutation(mutation)));
}

export async function getWorkspaceMutationSignature(
	mutation: WorkspaceMutation,
): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(serializeWorkspaceMutation(mutation)),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function upsertById<T extends { id: string }>(items: T[], entity: T): T[] {
	const index = items.findIndex((item) => item.id === entity.id);
	if (index < 0) return [entity, ...items];
	const result = [...items];
	result[index] = entity;
	return result;
}

type EntityCollection = keyof WorkspaceData;

function isDeleted(
	tombstones: WorkspaceTombstones,
	collection: EntityCollection,
	id: string,
): boolean {
	return tombstones[collection].some((item) => item.id === id);
}

function requireNotDeleted(
	tombstones: WorkspaceTombstones,
	collection: EntityCollection,
	id: string,
): void {
	if (isDeleted(tombstones, collection, id)) {
		fail("entity_deleted", `${collection} entity was deleted: ${id}`);
	}
}

function appendTombstone(
	tombstones: WorkspaceTombstones,
	collection: EntityCollection,
	id: string,
	mutationId: string,
	deletedRevision: number,
	deletedAt: string,
): WorkspaceTombstones {
	if (isDeleted(tombstones, collection, id)) return tombstones;
	const tombstone: WorkspaceTombstone = {
		id,
		mutationId,
		deletedRevision,
		deletedAt,
	};
	return {
		...tombstones,
		[collection]: [...tombstones[collection], tombstone],
	};
}

function tagIdFromLabel(label: string): string {
	return label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9:_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function withExternalKey(tags: NodeTag[], externalKey: string): NodeTag[] {
	const label = `external:${externalKey}`;
	const result = [...tags, { id: tagIdFromLabel(label), label }];
	const seen = new Set<string>();
	return result.filter((tag) => {
		if (seen.has(tag.label)) return false;
		seen.add(tag.label);
		return true;
	});
}

function uniqueNodeName(
	data: WorkspaceData,
	name: string,
	committedAt: string,
	excludeId?: string,
): string {
	return makeUniqueResourceName(
		name,
		data.nodes.filter((item) => item.id !== excludeId).map((item) => item.name),
		formatResourceNameTimestamp(new Date(committedAt)),
	);
}

function assertNodeRawAvailable(
	data: WorkspaceData,
	raw: string,
	excludeId?: string,
): void {
	const duplicate = findDuplicateNodeRaw(data.nodes, raw, excludeId);
	if (duplicate) {
		fail(
			"duplicate_node_raw",
			`A node with the same raw URI already exists: ${duplicate.name}`,
		);
	}
}

function createServerNode(
	data: WorkspaceData,
	nodeId: string,
	input: WorkspaceNodeInput,
	committedAt: string,
): NodeItem {
	assertNodeRawAvailable(data, input.raw);
	return {
		id: nodeId,
		...input,
		name: uniqueNodeName(data, input.name, committedAt),
		updatedAt: committedAt,
	};
}

function patchServerNode(
	data: WorkspaceData,
	nodeId: string,
	patch: WorkspaceNodePatch,
	committedAt: string,
): NodeItem {
	const existing = data.nodes.find((item) => item.id === nodeId);
	if (!existing) fail("entity_not_found", `Node not found: ${nodeId}`);
	const raw = patch.raw ?? existing.raw;
	assertNodeRawAvailable(data, raw, nodeId);
	return {
		...existing,
		...patch,
		name:
			patch.name === undefined
				? existing.name
				: uniqueNodeName(data, patch.name, committedAt, nodeId),
		updatedAt: committedAt,
	};
}

function stableRawUrl(
	gist: WorkspaceMutationContext["gist"],
	fileName: string,
): string | null {
	if (gist.ownerLogin) {
		return `https://gist.githubusercontent.com/${encodeURIComponent(gist.ownerLogin)}/${encodeURIComponent(gist.id)}/raw/${encodeURIComponent(fileName)}`;
	}
	return (
		toStableGistRawUrl(
			gist.files.find((file) => file.filename === fileName)?.rawUrl,
		) ?? null
	);
}

function assertOutputOwnerAvailable(
	data: WorkspaceData,
	owner: {
		kind: "publish-target" | "client-export";
		id: string;
		fileName: string;
	},
): void {
	const conflicts = getConflictingOutputOwners(data, owner);
	if (conflicts.length === 0) return;
	fail(
		"output_file_conflict",
		`Output file ${owner.fileName} is already owned by ${conflicts
			.map((conflict) => `${conflict.kind}:${conflict.name}`)
			.join(", ")}`,
	);
}

function requireEntity<T extends { id: string }>(
	items: T[],
	tombstones: WorkspaceTombstones,
	collection: EntityCollection,
	id: string,
	label: string,
): T {
	requireNotDeleted(tombstones, collection, id);
	const item = items.find((entry) => entry.id === id);
	if (!item) fail("entity_not_found", `${label} not found: ${id}`);
	return item;
}

function reconcileReferences(
	data: WorkspaceData,
	committedAt: string,
): WorkspaceData {
	const nodeIds = new Set(data.nodes.map((item) => item.id));
	const subscriptionIds = new Set(data.subscriptions.map((item) => item.id));
	return {
		...data,
		aggregates: data.aggregates.map((item) => {
			const nextNodeIds = item.nodeIds.filter((id) => nodeIds.has(id));
			const nextSubscriptionIds = item.subscriptionIds.filter((id) =>
				subscriptionIds.has(id),
			);
			if (
				nextNodeIds.length === item.nodeIds.length &&
				nextSubscriptionIds.length === item.subscriptionIds.length
			) {
				return item;
			}
			return {
				...item,
				nodeIds: nextNodeIds,
				subscriptionIds: nextSubscriptionIds,
				updatedAt: committedAt,
			};
		}),
	};
}

function finalize(
	document: WorkspaceDocumentV2,
	mutation: WorkspaceMutation,
	data: WorkspaceData,
	tombstones: WorkspaceTombstones,
	committedAt: string,
): WorkspaceDocumentV2 {
	return documentValue(() =>
		validateWorkspaceDocumentV2(
			{
				...document,
				revision: document.revision + 1,
				updatedAt: committedAt,
				lastMutationId: mutation.mutationId,
				data,
				tombstones,
			},
			{ expectedWorkspaceId: document.workspaceId },
		),
	);
}

export function applyWorkspaceMutation(
	currentValue: WorkspaceDocumentV2,
	mutationValue: WorkspaceMutation,
	context: WorkspaceMutationContext,
): WorkspaceMutationApplication {
	const current = validateWorkspaceDocumentV2(currentValue, {
		expectedWorkspaceId: currentValue.workspaceId,
	});
	const mutation = parseWorkspaceMutation(mutationValue);
	const committedAt = documentValue(() =>
		validateWorkspaceTimestamp(context.committedAt, "committedAt"),
	);
	if (mutation.workspaceId !== current.workspaceId) {
		fail(
			"workspace_mismatch",
			"Mutation workspace does not match the document",
		);
	}
	if (`gist:${context.gist.id}` !== current.workspaceId) {
		fail("workspace_mismatch", "Gist does not match the document workspace");
	}
	if (mutation.expectedRevision !== current.revision) {
		fail(
			"revision_conflict",
			`Expected revision ${mutation.expectedRevision}, found ${current.revision}`,
		);
	}
	const nextRevision = current.revision + 1;
	let data = current.data;
	let tombstones = current.tombstones;
	let files: WorkspaceFiles = {};
	let receipt: WorkspaceMutationReceipt = { kind: mutation.kind };

	switch (mutation.kind) {
		case "node.upsert": {
			let entity: NodeItem;
			const payload = mutation.payload;
			if (payload.operation === "replace") {
				requireNotDeleted(tombstones, "nodes", payload.node.id);
				assertNodeRawAvailable(data, payload.node.raw, payload.node.id);
				entity = { ...payload.node, updatedAt: committedAt };
			} else if (payload.operation === "create") {
				requireNotDeleted(tombstones, "nodes", payload.nodeId);
				if (data.nodes.some((item) => item.id === payload.nodeId)) {
					fail("entity_exists", `Node already exists: ${payload.nodeId}`);
				}
				entity = createServerNode(
					data,
					payload.nodeId,
					payload.node,
					committedAt,
				);
			} else if (payload.operation === "patch") {
				requireNotDeleted(tombstones, "nodes", payload.nodeId);
				entity = patchServerNode(
					data,
					payload.nodeId,
					payload.patch,
					committedAt,
				);
			} else {
				const externalLabel = `external:${payload.externalKey}`;
				const matches = data.nodes.filter((item) =>
					item.tags.some((tag) => tag.label === externalLabel),
				);
				if (matches.length > 1) {
					invalid(`Multiple nodes claim external key: ${payload.externalKey}`);
				}
				const existing = matches[0];
				if (existing) {
					entity = patchServerNode(
						data,
						existing.id,
						{
							...payload.node,
							tags: withExternalKey(payload.node.tags, payload.externalKey),
						},
						committedAt,
					);
				} else {
					requireNotDeleted(tombstones, "nodes", payload.nodeId);
					if (data.nodes.some((item) => item.id === payload.nodeId)) {
						fail("entity_exists", `Node already exists: ${payload.nodeId}`);
					}
					entity = createServerNode(
						data,
						payload.nodeId,
						{
							...payload.node,
							tags: withExternalKey(payload.node.tags, payload.externalKey),
						},
						committedAt,
					);
				}
			}
			data = { ...data, nodes: upsertById(data.nodes, entity) };
			receipt = { kind: mutation.kind, entityId: entity.id };
			break;
		}
		case "node.delete": {
			const entity = requireEntity(
				data.nodes,
				tombstones,
				"nodes",
				mutation.payload.id,
				"Node",
			);
			data = reconcileReferences(
				{ ...data, nodes: data.nodes.filter((item) => item.id !== entity.id) },
				committedAt,
			);
			tombstones = appendTombstone(
				tombstones,
				"nodes",
				entity.id,
				mutation.mutationId,
				nextRevision,
				committedAt,
			);
			receipt = { kind: mutation.kind, entityId: entity.id, deleted: true };
			break;
		}
		case "subscription.upsert": {
			const entity = {
				...mutation.payload.subscription,
				updatedAt: committedAt,
			};
			requireNotDeleted(tombstones, "subscriptions", entity.id);
			const duplicate = findDuplicateSubscriptionUrl(
				data.subscriptions,
				entity.url,
				entity.id,
			);
			if (duplicate) {
				fail(
					"duplicate_subscription_url",
					`A subscription with the same URL already exists: ${duplicate.name}`,
				);
			}
			data = {
				...data,
				subscriptions: upsertById(data.subscriptions, entity),
			};
			receipt = { kind: mutation.kind, entityId: entity.id };
			break;
		}
		case "subscription.delete": {
			const entity = requireEntity(
				data.subscriptions,
				tombstones,
				"subscriptions",
				mutation.payload.id,
				"Subscription",
			);
			data = reconcileReferences(
				{
					...data,
					subscriptions: data.subscriptions.filter(
						(item) => item.id !== entity.id,
					),
				},
				committedAt,
			);
			tombstones = appendTombstone(
				tombstones,
				"subscriptions",
				entity.id,
				mutation.mutationId,
				nextRevision,
				committedAt,
			);
			receipt = { kind: mutation.kind, entityId: entity.id, deleted: true };
			break;
		}
		case "aggregate.upsert": {
			const entity = { ...mutation.payload.aggregate, updatedAt: committedAt };
			requireNotDeleted(tombstones, "aggregates", entity.id);
			data = { ...data, aggregates: upsertById(data.aggregates, entity) };
			receipt = { kind: mutation.kind, entityId: entity.id };
			break;
		}
		case "aggregate.delete": {
			const entity = requireEntity(
				data.aggregates,
				tombstones,
				"aggregates",
				mutation.payload.id,
				"Aggregate",
			);
			const targets = data.publishTargets.filter(
				(item) => item.ruleId === entity.id,
			);
			const exports = data.clientExports.filter(
				(item) => item.ruleId === entity.id,
			);
			const nextData = {
				...data,
				aggregates: data.aggregates.filter((item) => item.id !== entity.id),
				publishTargets: data.publishTargets.filter(
					(item) => item.ruleId !== entity.id,
				),
				clientExports: data.clientExports.filter(
					(item) => item.ruleId !== entity.id,
				),
			};
			if (mutation.payload.cleanupUnreferencedOutputs) {
				const removedOwners = [...targets, ...exports];
				for (const fileName of new Set(
					removedOwners.map((item) => item.fileName),
				)) {
					const wasPublished = removedOwners.some((item) => {
						if (item.fileName !== fileName) return false;
						return "lastPublishTransitionAt" in item
							? isCurrentPublishTargetOutputPublished(item)
							: isCurrentClientExportOutputPublished(item);
					});
					if (
						wasPublished &&
						getWorkspaceOutputOwners(nextData, fileName).length === 0
					) {
						files[fileName] = null;
					}
				}
			}
			data = nextData;
			tombstones = appendTombstone(
				tombstones,
				"aggregates",
				entity.id,
				mutation.mutationId,
				nextRevision,
				committedAt,
			);
			for (const item of targets) {
				tombstones = appendTombstone(
					tombstones,
					"publishTargets",
					item.id,
					mutation.mutationId,
					nextRevision,
					committedAt,
				);
			}
			for (const item of exports) {
				tombstones = appendTombstone(
					tombstones,
					"clientExports",
					item.id,
					mutation.mutationId,
					nextRevision,
					committedAt,
				);
			}
			receipt = { kind: mutation.kind, entityId: entity.id, deleted: true };
			break;
		}
		case "publish-target.upsert": {
			const requested = mutation.payload.target;
			requireNotDeleted(tombstones, "publishTargets", requested.id);
			assertOutputOwnerAvailable(data, {
				kind: "publish-target",
				id: requested.id,
				fileName: requested.fileName,
			});
			const existing = data.publishTargets.find(
				(item) => item.id === requested.id,
			);
			let entity: AggregatePublishTarget = {
				...requested,
				lastPublishedAt: null,
				lastPublishedUrl: null,
				lastPublishTransitionAt: null,
				lastPublishTransitionFromFileName: null,
				lastPublishTransitionToFileName: null,
				lastPublishTransitionOutcome: null,
				updatedAt: committedAt,
			};
			if (existing) {
				const outputChanged =
					existing.fileName !== requested.fileName ||
					existing.ruleId !== requested.ruleId;
				entity = {
					...existing,
					...requested,
					lastPublishedAt: existing.lastPublishedAt,
					lastPublishedUrl: existing.lastPublishedUrl,
					lastPublishTransitionAt: existing.lastPublishTransitionAt,
					lastPublishTransitionFromFileName:
						existing.lastPublishTransitionFromFileName,
					lastPublishTransitionToFileName:
						existing.lastPublishTransitionToFileName,
					lastPublishTransitionOutcome: existing.lastPublishTransitionOutcome,
					updatedAt: outputChanged ? committedAt : existing.updatedAt,
				};
				if (existing.fileName !== requested.fileName) {
					const otherOwners = getConflictingOutputOwners(data, {
						kind: "publish-target",
						id: existing.id,
						fileName: existing.fileName,
					});
					const cleanup = mutation.payload.previousFileCleanup ?? "keep";
					let outcome: AggregatePublishTarget["lastPublishTransitionOutcome"] =
						"kept_manual";
					if (cleanup === "delete-if-unreferenced") {
						if (otherOwners.length > 0) {
							outcome = "kept_shared";
						} else if (isCurrentPublishTargetOutputPublished(existing)) {
							files[existing.fileName] = null;
							outcome = "auto_deleted";
						} else {
							outcome = "kept_external";
						}
					}
					entity = {
						...entity,
						lastPublishTransitionAt: committedAt,
						lastPublishTransitionFromFileName: existing.fileName,
						lastPublishTransitionToFileName: requested.fileName,
						lastPublishTransitionOutcome: outcome,
					};
				}
			}
			data = {
				...data,
				publishTargets: upsertById(data.publishTargets, entity),
			};
			receipt = { kind: mutation.kind, entityId: entity.id };
			break;
		}
		case "publish-target.delete": {
			const entity = requireEntity(
				data.publishTargets,
				tombstones,
				"publishTargets",
				mutation.payload.id,
				"Publish target",
			);
			const otherOwners = getConflictingOutputOwners(data, {
				kind: "publish-target",
				id: entity.id,
				fileName: entity.fileName,
			});
			if (
				mutation.payload.cleanupUnreferencedOutputs &&
				isCurrentPublishTargetOutputPublished(entity) &&
				otherOwners.length === 0
			) {
				files[entity.fileName] = null;
			}
			data = {
				...data,
				publishTargets: data.publishTargets.filter(
					(item) => item.id !== entity.id,
				),
			};
			tombstones = appendTombstone(
				tombstones,
				"publishTargets",
				entity.id,
				mutation.mutationId,
				nextRevision,
				committedAt,
			);
			receipt = { kind: mutation.kind, entityId: entity.id, deleted: true };
			break;
		}
		case "client-export.upsert": {
			const requested = mutation.payload.profile;
			requireNotDeleted(tombstones, "clientExports", requested.id);
			assertOutputOwnerAvailable(data, {
				kind: "client-export",
				id: requested.id,
				fileName: requested.fileName,
			});
			const existing = data.clientExports.find(
				(item) => item.id === requested.id,
			);
			const outputChanged = Boolean(
				existing &&
					(existing.fileName !== requested.fileName ||
						existing.ruleId !== requested.ruleId ||
						JSON.stringify(existing.options) !==
							JSON.stringify(requested.options)),
			);
			const entity: ClientExportProfile = {
				...requested,
				lastGeneratedAt:
					existing && !outputChanged ? existing.lastGeneratedAt : null,
				lastPublishedAt:
					existing && !outputChanged ? existing.lastPublishedAt : null,
				lastPublishedUrl:
					existing && !outputChanged ? existing.lastPublishedUrl : null,
				updatedAt: committedAt,
			};
			data = {
				...data,
				clientExports: upsertById(data.clientExports, entity),
			};
			receipt = { kind: mutation.kind, entityId: entity.id };
			break;
		}
		case "client-export.delete": {
			const entity = requireEntity(
				data.clientExports,
				tombstones,
				"clientExports",
				mutation.payload.id,
				"Client export",
			);
			data = {
				...data,
				clientExports: data.clientExports.filter(
					(item) => item.id !== entity.id,
				),
			};
			tombstones = appendTombstone(
				tombstones,
				"clientExports",
				entity.id,
				mutation.mutationId,
				nextRevision,
				committedAt,
			);
			receipt = { kind: mutation.kind, entityId: entity.id, deleted: true };
			break;
		}
		case "aggregate.publish": {
			const entity = requireEntity(
				data.publishTargets,
				tombstones,
				"publishTargets",
				mutation.payload.targetId,
				"Publish target",
			);
			if (entity.fileName !== mutation.payload.output.fileName) {
				fail("publication_file_mismatch", "Publication filename changed");
			}
			assertOutputOwnerAvailable(data, {
				kind: "publish-target",
				id: entity.id,
				fileName: entity.fileName,
			});
			const updated = {
				...entity,
				lastPublishedAt: committedAt,
				lastPublishedUrl: stableRawUrl(context.gist, entity.fileName),
				updatedAt: committedAt,
			};
			data = {
				...data,
				publishTargets: upsertById(data.publishTargets, updated),
			};
			files = {
				[entity.fileName]: { content: mutation.payload.output.content },
			};
			receipt = { kind: mutation.kind, entityId: entity.id };
			break;
		}
		case "client-export.publish": {
			const entity = requireEntity(
				data.clientExports,
				tombstones,
				"clientExports",
				mutation.payload.profileId,
				"Client export",
			);
			if (entity.fileName !== mutation.payload.output.fileName) {
				fail("publication_file_mismatch", "Publication filename changed");
			}
			assertOutputOwnerAvailable(data, {
				kind: "client-export",
				id: entity.id,
				fileName: entity.fileName,
			});
			const updated = {
				...entity,
				lastGeneratedAt: committedAt,
				lastPublishedAt: committedAt,
				lastPublishedUrl: stableRawUrl(context.gist, entity.fileName),
				updatedAt: committedAt,
			};
			data = {
				...data,
				clientExports: upsertById(data.clientExports, updated),
			};
			files = {
				[entity.fileName]: { content: mutation.payload.output.content },
			};
			receipt = { kind: mutation.kind, entityId: entity.id };
			break;
		}
		case "output.delete": {
			const fileName = mutation.payload.fileName;
			data = {
				...data,
				publishTargets: data.publishTargets.map((target) =>
					target.fileName === fileName
						? {
								...target,
								lastPublishedAt: null,
								lastPublishedUrl: null,
								updatedAt: committedAt,
							}
						: target,
				),
				clientExports: data.clientExports.map((profile) =>
					profile.fileName === fileName
						? {
								...profile,
								lastPublishedAt: null,
								lastPublishedUrl: null,
								updatedAt: committedAt,
							}
						: profile,
				),
			};
			files = { [fileName]: null };
			receipt = { kind: mutation.kind, deleted: true };
			break;
		}
		case "workspace.bootstrap.cleanup": {
			receipt = { kind: mutation.kind, deleted: true };
			break;
		}
		case "workspace.reconcile": {
			const requested = mutation.payload.data;
			const resolved: WorkspaceData = {
				...requested,
				publishTargets: requested.publishTargets.map((target) => {
					const existing = data.publishTargets.find(
						(item) => item.id === target.id,
					);
					if (!existing) {
						return {
							...target,
							lastPublishedAt: null,
							lastPublishedUrl: null,
							lastPublishTransitionAt: null,
							lastPublishTransitionFromFileName: null,
							lastPublishTransitionToFileName: null,
							lastPublishTransitionOutcome: null,
						};
					}
					return {
						...target,
						lastPublishedAt: existing.lastPublishedAt,
						lastPublishedUrl: existing.lastPublishedUrl,
						lastPublishTransitionAt:
							existing.fileName === target.fileName
								? existing.lastPublishTransitionAt
								: committedAt,
						lastPublishTransitionFromFileName:
							existing.fileName === target.fileName
								? existing.lastPublishTransitionFromFileName
								: existing.fileName,
						lastPublishTransitionToFileName:
							existing.fileName === target.fileName
								? existing.lastPublishTransitionToFileName
								: target.fileName,
						lastPublishTransitionOutcome:
							existing.fileName === target.fileName
								? existing.lastPublishTransitionOutcome
								: "kept_manual",
						updatedAt:
							existing.fileName !== target.fileName ||
							existing.ruleId !== target.ruleId
								? committedAt
								: existing.updatedAt,
					};
				}),
				clientExports: requested.clientExports.map((profile) => {
					const existing = data.clientExports.find(
						(item) => item.id === profile.id,
					);
					const outputChanged = Boolean(
						existing &&
							(existing.fileName !== profile.fileName ||
								existing.ruleId !== profile.ruleId ||
								JSON.stringify(existing.options) !==
									JSON.stringify(profile.options)),
					);
					return {
						...profile,
						lastGeneratedAt:
							existing && !outputChanged ? existing.lastGeneratedAt : null,
						lastPublishedAt:
							existing && !outputChanged ? existing.lastPublishedAt : null,
						lastPublishedUrl:
							existing && !outputChanged ? existing.lastPublishedUrl : null,
					};
				}),
			};
			const outputConflicts = findWorkspaceOutputConflicts(resolved);
			if (outputConflicts.length > 0) {
				fail(
					"output_file_conflict",
					`Output file ${outputConflicts[0]?.fileName ?? "unknown"} has multiple owners`,
				);
			}
			for (const collection of Object.keys(resolved) as EntityCollection[]) {
				for (const item of resolved[collection]) {
					requireNotDeleted(tombstones, collection, item.id);
				}
				const resolvedIds = new Set(
					resolved[collection].map((item) => item.id),
				);
				for (const item of data[collection]) {
					if (!resolvedIds.has(item.id)) {
						tombstones = appendTombstone(
							tombstones,
							collection,
							item.id,
							mutation.mutationId,
							nextRevision,
							committedAt,
						);
					}
				}
			}
			data = resolved;
			receipt = { kind: mutation.kind };
			break;
		}
	}

	reconcileChangedValueLimits(current.data, data);
	assertEntityCountGrowth(current.data, data);
	const nextDocument = finalize(
		current,
		mutation,
		data,
		tombstones,
		committedAt,
	);
	assertWorkspaceDocumentSize(current, nextDocument);
	return {
		document: nextDocument,
		files,
		receipt,
	};
}
