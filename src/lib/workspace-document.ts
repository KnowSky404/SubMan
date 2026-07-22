import type {
	AggregatePublishTarget,
	AggregateRule,
	ClientExportProfile,
	GistMeta,
	NodeItem,
	NodeTag,
	ProxyType,
	PublishTransitionOutcome,
	SingBoxClientExportOptions,
	SortMode,
	SourceType,
	SubscriptionItem,
} from "$lib/models";
import type { SyncBaselineEnvelope } from "$lib/workspace-data";

export const WORKSPACE_SCHEMA_VERSION = 2 as const;
export const WORKSPACE_FILE_NAME = "subman.json";
export const WORKSPACE_V1_BACKUP_FILE_NAME = "subman.v1.backup.json";
export const WORKSPACE_BOOTSTRAP_FILE_NAME = "subman.bootstrap.json";

export const WORKSPACE_RESERVED_FILE_NAMES = new Set([
	WORKSPACE_FILE_NAME,
	WORKSPACE_V1_BACKUP_FILE_NAME,
	WORKSPACE_BOOTSTRAP_FILE_NAME,
]);

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
const SORT_MODES = new Set<SortMode>(["none", "name", "type", "region"]);
const PUBLISH_TRANSITION_OUTCOMES = new Set<PublishTransitionOutcome>([
	"auto_deleted",
	"kept_shared",
	"kept_external",
	"kept_manual",
]);
const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkspaceData = {
	nodes: NodeItem[];
	subscriptions: SubscriptionItem[];
	aggregates: AggregateRule[];
	publishTargets: AggregatePublishTarget[];
	clientExports: ClientExportProfile[];
};

export type WorkspaceTombstone = {
	id: string;
	deletedAt: string;
	deletedRevision: number;
	mutationId: string;
};

export type WorkspaceTombstones = {
	nodes: WorkspaceTombstone[];
	subscriptions: WorkspaceTombstone[];
	aggregates: WorkspaceTombstone[];
	publishTargets: WorkspaceTombstone[];
	clientExports: WorkspaceTombstone[];
};

export type WorkspaceDocumentV2 = {
	version: 2;
	schemaVersion: 2;
	workspaceId: string;
	revision: number;
	updatedAt: string;
	lastMutationId: string | null;
	data: WorkspaceData;
	tombstones: WorkspaceTombstones;
};

export type WorkspaceDocumentV1 = {
	version: 1;
	exportedAt?: string;
	data: WorkspaceData & {
		gists: GistMeta[];
		activeGistId: string | null;
		activeGistFile: string;
		lastUpdated: string;
	};
};

export type LocalWorkspaceBinding = {
	gistId: string | null;
	fileName: string;
	syncMode: "automatic" | "manual" | "paused-conflict";
	baseline: SyncBaselineEnvelope | null;
};

export type ParsedWorkspaceDocument =
	| { schemaVersion: 1; document: WorkspaceDocumentV1 }
	| { schemaVersion: 2; document: WorkspaceDocumentV2 };

export class WorkspaceDocumentError extends Error {
	constructor(
		readonly code:
			| "invalid_workspace_document"
			| "unsupported_schema"
			| "workspace_mismatch",
		message: string,
	) {
		super(message);
		this.name = "WorkspaceDocumentError";
	}
}

function invalid(message: string): never {
	throw new WorkspaceDocumentError("invalid_workspace_document", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) invalid(`${path} must be an object`);
	return value;
}

function keys(
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

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		invalid(`${path} must be a non-empty string`);
	}
	return value;
}

function nullableString(value: unknown, path: string): string | null {
	if (value === null) return null;
	return string(value, path);
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") invalid(`${path} must be a boolean`);
	return value;
}

function integer(
	value: unknown,
	path: string,
	options: { minimum?: number; maximum?: number } = {},
): number {
	if (!Number.isSafeInteger(value)) invalid(`${path} must be a safe integer`);
	const result = value as number;
	if (options.minimum !== undefined && result < options.minimum) {
		invalid(`${path} must be at least ${options.minimum}`);
	}
	if (options.maximum !== undefined && result > options.maximum) {
		invalid(`${path} must be at most ${options.maximum}`);
	}
	return result;
}

function timestamp(value: unknown, path: string): string {
	if (
		typeof value !== "string" ||
		!CANONICAL_ISO_TIMESTAMP.test(value) ||
		Number.isNaN(Date.parse(value)) ||
		new Date(value).toISOString() !== value
	) {
		invalid(`${path} must be an ISO timestamp`);
	}
	return value;
}

function uuid(value: unknown, path: string): string {
	if (typeof value !== "string" || !UUID.test(value)) {
		invalid(`${path} must be a UUID`);
	}
	return value;
}

export function validateWorkspaceTimestamp(
	value: unknown,
	path = "timestamp",
): string {
	return timestamp(value, path);
}

export function validateWorkspaceUuid(value: unknown, path = "id"): string {
	return uuid(value, path);
}

function nullableTimestamp(value: unknown, path: string): string | null {
	if (value === null) return null;
	return timestamp(value, path);
}

function array<T>(
	value: unknown,
	path: string,
	parse: (entry: unknown, path: string) => T,
): T[] {
	if (!Array.isArray(value)) invalid(`${path} must be an array`);
	return value.map((entry, index) => parse(entry, `${path}[${index}]`));
}

function stringArray(value: unknown, path: string): string[] {
	return array(value, path, string);
}

function enumValue<T extends string>(
	value: unknown,
	path: string,
	allowed: ReadonlySet<T>,
): T {
	const result = string(value, path) as T;
	if (!allowed.has(result)) invalid(`${path} is unsupported`);
	return result;
}

function parseTag(value: unknown, path: string): NodeTag {
	const input = record(value, path);
	keys(input, path, ["id", "label"]);
	return {
		id: string(input.id, `${path}.id`),
		label: string(input.label, `${path}.label`),
	};
}

function parseNode(value: unknown, path: string): NodeItem {
	const input = record(value, path);
	keys(input, path, [
		"id",
		"name",
		"type",
		"raw",
		"tags",
		"enabled",
		"updatedAt",
		"source",
	]);
	const tags = array(input.tags, `${path}.tags`, parseTag);
	assertUniqueIds(tags, `${path}.tags`);
	assertUniqueTagLabels(tags, `${path}.tags`);
	return {
		id: string(input.id, `${path}.id`),
		name: string(input.name, `${path}.name`),
		type: enumValue(input.type, `${path}.type`, PROXY_TYPES),
		raw: string(input.raw, `${path}.raw`),
		tags,
		enabled: boolean(input.enabled, `${path}.enabled`),
		updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`),
		source: enumValue(input.source, `${path}.source`, SOURCE_TYPES),
	};
}

function parseSubscription(value: unknown, path: string): SubscriptionItem {
	const input = record(value, path);
	keys(input, path, ["id", "name", "url", "enabled", "tags", "updatedAt"]);
	const tags = array(input.tags, `${path}.tags`, parseTag);
	assertUniqueIds(tags, `${path}.tags`);
	assertUniqueTagLabels(tags, `${path}.tags`);
	return {
		id: string(input.id, `${path}.id`),
		name: string(input.name, `${path}.name`),
		url: string(input.url, `${path}.url`),
		enabled: boolean(input.enabled, `${path}.enabled`),
		tags,
		updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`),
	};
}

function parseRenameMap(value: unknown, path: string): Record<string, string> {
	const input = record(value, path);
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(input)) {
		if (!key) invalid(`${path} contains an empty key`);
		result[key] = string(entry, `${path}.${key}`);
	}
	return result;
}

function parseAggregate(
	value: unknown,
	path: string,
	legacy = false,
): AggregateRule {
	const input = record(value, path);
	keys(
		input,
		path,
		[
			"id",
			"name",
			"nodeIds",
			"subscriptionIds",
			"excludeTagIds",
			"renameMap",
			"updatedAt",
		],
		[
			"allowedTypes",
			"renameRules",
			"prependRegionFlags",
			"customRegionFlagMap",
			"sortMode",
			"sortPriority",
		],
	);
	if (!legacy && !("allowedTypes" in input)) {
		invalid(`${path}.allowedTypes is required`);
	}
	const result: AggregateRule = {
		id: string(input.id, `${path}.id`),
		name: string(input.name, `${path}.name`),
		nodeIds: stringArray(input.nodeIds, `${path}.nodeIds`),
		subscriptionIds: stringArray(
			input.subscriptionIds,
			`${path}.subscriptionIds`,
		),
		excludeTagIds: stringArray(input.excludeTagIds, `${path}.excludeTagIds`),
		renameMap: parseRenameMap(input.renameMap, `${path}.renameMap`),
		allowedTypes:
			input.allowedTypes === undefined
				? []
				: array(input.allowedTypes, `${path}.allowedTypes`, (entry, itemPath) =>
						enumValue(entry, itemPath, PROXY_TYPES),
					),
		updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`),
	};
	if (input.renameRules !== undefined) {
		result.renameRules = stringArray(input.renameRules, `${path}.renameRules`);
	}
	if (input.prependRegionFlags !== undefined) {
		result.prependRegionFlags = boolean(
			input.prependRegionFlags,
			`${path}.prependRegionFlags`,
		);
	}
	if (input.customRegionFlagMap !== undefined) {
		if (typeof input.customRegionFlagMap !== "string") {
			invalid(`${path}.customRegionFlagMap must be a string`);
		}
		result.customRegionFlagMap = input.customRegionFlagMap;
	}
	if (input.sortMode !== undefined) {
		result.sortMode = enumValue(input.sortMode, `${path}.sortMode`, SORT_MODES);
	}
	if (input.sortPriority !== undefined) {
		if (typeof input.sortPriority !== "string") {
			invalid(`${path}.sortPriority must be a string`);
		}
		result.sortPriority = input.sortPriority;
	}
	return result;
}

function assertOutputFileName(value: unknown, path: string): string {
	const fileName = string(value, path);
	const normalized = fileName.trim().replace(/^\/+/, "").toLowerCase();
	if (WORKSPACE_RESERVED_FILE_NAMES.has(normalized)) {
		invalid(`${path} is reserved for workspace coordination`);
	}
	return fileName;
}

export function validateWorkspaceOutputFileName(
	value: unknown,
	path = "fileName",
): string {
	return assertOutputFileName(value, path);
}

function parsePublishTarget(
	value: unknown,
	path: string,
	legacy = false,
): AggregatePublishTarget {
	const input = record(value, path);
	const transitionFields = [
		"lastPublishTransitionAt",
		"lastPublishTransitionFromFileName",
		"lastPublishTransitionToFileName",
		"lastPublishTransitionOutcome",
	] as const;
	keys(
		input,
		path,
		[
			"id",
			"name",
			"ruleId",
			"fileName",
			"description",
			"isPublic",
			"lastPublishedAt",
			"lastPublishedUrl",
			...(!legacy ? transitionFields : []),
			"updatedAt",
		],
		legacy ? transitionFields : [],
	);
	const outcome = input.lastPublishTransitionOutcome ?? null;
	return {
		id: string(input.id, `${path}.id`),
		name: string(input.name, `${path}.name`),
		ruleId: string(input.ruleId, `${path}.ruleId`),
		fileName: assertOutputFileName(input.fileName, `${path}.fileName`),
		description:
			typeof input.description === "string"
				? input.description
				: invalid(`${path}.description must be a string`),
		isPublic: boolean(input.isPublic, `${path}.isPublic`),
		lastPublishedAt: nullableTimestamp(
			input.lastPublishedAt,
			`${path}.lastPublishedAt`,
		),
		lastPublishedUrl: nullableString(
			input.lastPublishedUrl,
			`${path}.lastPublishedUrl`,
		),
		lastPublishTransitionAt: nullableTimestamp(
			input.lastPublishTransitionAt ?? null,
			`${path}.lastPublishTransitionAt`,
		),
		lastPublishTransitionFromFileName: nullableString(
			input.lastPublishTransitionFromFileName ?? null,
			`${path}.lastPublishTransitionFromFileName`,
		),
		lastPublishTransitionToFileName: nullableString(
			input.lastPublishTransitionToFileName ?? null,
			`${path}.lastPublishTransitionToFileName`,
		),
		lastPublishTransitionOutcome:
			outcome === null
				? null
				: enumValue(
						outcome,
						`${path}.lastPublishTransitionOutcome`,
						PUBLISH_TRANSITION_OUTCOMES,
					),
		updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`),
	};
}

function parseClientExportOptions(
	value: unknown,
	path: string,
): SingBoxClientExportOptions {
	const input = record(value, path);
	keys(input, path, [
		"listenAddress",
		"listenPort",
		"inboundType",
		"dnsMode",
		"routeMode",
		"includeExperimental",
		"selectorTag",
		"urlTestTag",
	]);
	const inboundType = string(input.inboundType, `${path}.inboundType`);
	if (inboundType !== "mixed") invalid(`${path}.inboundType is unsupported`);
	const dnsMode = string(input.dnsMode, `${path}.dnsMode`);
	if (dnsMode !== "conservative") invalid(`${path}.dnsMode is unsupported`);
	const routeMode = string(input.routeMode, `${path}.routeMode`);
	if (routeMode !== "global-proxy") invalid(`${path}.routeMode is unsupported`);
	return {
		listenAddress: string(input.listenAddress, `${path}.listenAddress`),
		listenPort: integer(input.listenPort, `${path}.listenPort`, {
			minimum: 1,
			maximum: 65535,
		}),
		inboundType,
		dnsMode,
		routeMode,
		includeExperimental: boolean(
			input.includeExperimental,
			`${path}.includeExperimental`,
		),
		selectorTag: string(input.selectorTag, `${path}.selectorTag`),
		urlTestTag: string(input.urlTestTag, `${path}.urlTestTag`),
	};
}

function parseClientExport(value: unknown, path: string): ClientExportProfile {
	const input = record(value, path);
	keys(input, path, [
		"id",
		"name",
		"type",
		"ruleId",
		"fileName",
		"options",
		"lastGeneratedAt",
		"lastPublishedAt",
		"lastPublishedUrl",
		"updatedAt",
	]);
	const type = string(input.type, `${path}.type`);
	if (type !== "sing-box-client") invalid(`${path}.type is unsupported`);
	return {
		id: string(input.id, `${path}.id`),
		name: string(input.name, `${path}.name`),
		type,
		ruleId: string(input.ruleId, `${path}.ruleId`),
		fileName: assertOutputFileName(input.fileName, `${path}.fileName`),
		options: parseClientExportOptions(input.options, `${path}.options`),
		lastGeneratedAt: nullableTimestamp(
			input.lastGeneratedAt,
			`${path}.lastGeneratedAt`,
		),
		lastPublishedAt: nullableTimestamp(
			input.lastPublishedAt,
			`${path}.lastPublishedAt`,
		),
		lastPublishedUrl: nullableString(
			input.lastPublishedUrl,
			`${path}.lastPublishedUrl`,
		),
		updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`),
	};
}

function assertUniqueIds(items: readonly { id: string }[], path: string): void {
	const seen = new Set<string>();
	for (const item of items) {
		if (seen.has(item.id)) invalid(`${path} contains duplicate id: ${item.id}`);
		seen.add(item.id);
	}
}

function assertUniqueStrings(items: readonly string[], path: string): void {
	const seen = new Set<string>();
	for (const item of items) {
		if (seen.has(item)) invalid(`${path} contains duplicate id: ${item}`);
		seen.add(item);
	}
}

function assertUniqueTagLabels(tags: readonly NodeTag[], path: string): void {
	const seen = new Set<string>();
	for (const tag of tags) {
		if (seen.has(tag.label)) {
			invalid(`${path} contains duplicate label: ${tag.label}`);
		}
		seen.add(tag.label);
	}
}

function parseWorkspaceData(
	value: unknown,
	path = "data",
	options: { legacy?: boolean } = {},
): WorkspaceData {
	const input = record(value, path);
	keys(input, path, [
		"nodes",
		"subscriptions",
		"aggregates",
		"publishTargets",
		"clientExports",
	]);
	const result: WorkspaceData = {
		nodes: array(input.nodes, `${path}.nodes`, parseNode),
		subscriptions: array(
			input.subscriptions,
			`${path}.subscriptions`,
			parseSubscription,
		),
		aggregates: array(
			input.aggregates,
			`${path}.aggregates`,
			(entry, itemPath) => parseAggregate(entry, itemPath, options.legacy),
		),
		publishTargets: array(
			input.publishTargets,
			`${path}.publishTargets`,
			(entry, itemPath) => parsePublishTarget(entry, itemPath, options.legacy),
		),
		clientExports: array(
			input.clientExports,
			`${path}.clientExports`,
			parseClientExport,
		),
	};
	for (const collection of Object.keys(result) as (keyof WorkspaceData)[]) {
		assertUniqueIds(result[collection], `${path}.${collection}`);
	}
	for (const [index, item] of result.aggregates.entries()) {
		const itemPath = `${path}.aggregates[${index}]`;
		assertUniqueStrings(item.nodeIds, `${itemPath}.nodeIds`);
		assertUniqueStrings(item.subscriptionIds, `${itemPath}.subscriptionIds`);
		assertUniqueStrings(item.excludeTagIds, `${itemPath}.excludeTagIds`);
		assertUniqueStrings(item.allowedTypes, `${itemPath}.allowedTypes`);
	}
	const externalOwners = new Map<string, string>();
	for (const item of result.nodes) {
		for (const tag of item.tags) {
			if (!tag.label.toLowerCase().startsWith("external:")) continue;
			const key = tag.label.toLowerCase();
			const owner = externalOwners.get(key);
			if (owner && owner !== item.id) {
				invalid(`data.nodes contains duplicate external key: ${tag.label}`);
			}
			externalOwners.set(key, item.id);
		}
	}
	assertReferences(result, path);
	return result;
}

export function validateWorkspaceData(value: unknown): WorkspaceData {
	return parseWorkspaceData(value);
}

export function validateWorkspaceNode(value: unknown): NodeItem {
	return parseNode(value, "node");
}

export function validateWorkspaceSubscription(
	value: unknown,
): SubscriptionItem {
	return parseSubscription(value, "subscription");
}

export function validateWorkspaceAggregate(value: unknown): AggregateRule {
	return parseAggregate(value, "aggregate");
}

export function validateWorkspacePublishTarget(
	value: unknown,
): AggregatePublishTarget {
	return parsePublishTarget(value, "publishTarget");
}

export function validateWorkspaceClientExport(
	value: unknown,
): ClientExportProfile {
	return parseClientExport(value, "clientExport");
}

function assertReferences(data: WorkspaceData, path: string): void {
	const nodeIds = new Set(data.nodes.map((item) => item.id));
	const subscriptionIds = new Set(data.subscriptions.map((item) => item.id));
	const aggregateIds = new Set(data.aggregates.map((item) => item.id));
	for (const item of data.aggregates) {
		for (const id of item.nodeIds) {
			if (!nodeIds.has(id))
				invalid(`${path}.aggregates references missing node: ${id}`);
		}
		for (const id of item.subscriptionIds) {
			if (!subscriptionIds.has(id)) {
				invalid(`${path}.aggregates references missing subscription: ${id}`);
			}
		}
	}
	for (const item of data.publishTargets) {
		if (!aggregateIds.has(item.ruleId)) {
			invalid(
				`${path}.publishTargets references missing aggregate: ${item.ruleId}`,
			);
		}
	}
	for (const item of data.clientExports) {
		if (!aggregateIds.has(item.ruleId)) {
			invalid(
				`${path}.clientExports references missing aggregate: ${item.ruleId}`,
			);
		}
	}
}

function parseTombstone(
	value: unknown,
	path: string,
	revision: number,
): WorkspaceTombstone {
	const input = record(value, path);
	keys(input, path, ["id", "deletedAt", "deletedRevision", "mutationId"]);
	const deletedRevision = integer(
		input.deletedRevision,
		`${path}.deletedRevision`,
		{ minimum: 1 },
	);
	if (deletedRevision > revision) {
		invalid(`${path}.deletedRevision cannot exceed revision`);
	}
	return {
		id: string(input.id, `${path}.id`),
		deletedAt: timestamp(input.deletedAt, `${path}.deletedAt`),
		deletedRevision,
		mutationId: uuid(input.mutationId, `${path}.mutationId`),
	};
}

function parseTombstones(
	value: unknown,
	revision: number,
	data: WorkspaceData,
): WorkspaceTombstones {
	const input = record(value, "tombstones");
	keys(input, "tombstones", [
		"nodes",
		"subscriptions",
		"aggregates",
		"publishTargets",
		"clientExports",
	]);
	const result = {} as WorkspaceTombstones;
	for (const collection of Object.keys(data) as (keyof WorkspaceData)[]) {
		const path = `tombstones.${collection}`;
		const tombstones = array(input[collection], path, (entry, itemPath) =>
			parseTombstone(entry, itemPath, revision),
		);
		assertUniqueIds(tombstones, path);
		const liveIds = new Set(data[collection].map((item) => item.id));
		for (const tombstone of tombstones) {
			if (liveIds.has(tombstone.id)) {
				invalid(
					`data.${collection} id is both live and tombstoned: ${tombstone.id}`,
				);
			}
		}
		result[collection] = tombstones;
	}
	return result;
}

function parseV2(
	value: Record<string, unknown>,
	expectedWorkspaceId?: string,
): WorkspaceDocumentV2 {
	keys(value, "workspace", [
		"version",
		"schemaVersion",
		"workspaceId",
		"revision",
		"updatedAt",
		"lastMutationId",
		"data",
		"tombstones",
	]);
	if (value.version !== 2) invalid("version must be 2 for Schema V2");
	if (value.schemaVersion !== 2) invalid("schemaVersion must be 2");
	const workspaceId = string(value.workspaceId, "workspaceId");
	if (expectedWorkspaceId && workspaceId !== expectedWorkspaceId) {
		throw new WorkspaceDocumentError(
			"workspace_mismatch",
			`Workspace ID mismatch: expected ${expectedWorkspaceId}`,
		);
	}
	const revision = integer(value.revision, "revision", { minimum: 0 });
	const data = parseWorkspaceData(value.data);
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId,
		revision,
		updatedAt: timestamp(value.updatedAt, "updatedAt"),
		lastMutationId:
			value.lastMutationId === null
				? null
				: uuid(value.lastMutationId, "lastMutationId"),
		data,
		tombstones: parseTombstones(value.tombstones, revision, data),
	};
}

function parseGistFile(
	value: unknown,
	path: string,
): GistMeta["files"][number] {
	const input = record(value, path);
	keys(input, path, ["filename", "language", "size"], ["rawUrl"]);
	const language = input.language;
	if (language !== null && typeof language !== "string") {
		invalid(`${path}.language must be a string or null`);
	}
	return {
		filename: string(input.filename, `${path}.filename`),
		language,
		size: integer(input.size, `${path}.size`, { minimum: 0 }),
		...(input.rawUrl === undefined
			? {}
			: { rawUrl: string(input.rawUrl, `${path}.rawUrl`) }),
	};
}

function parseGist(value: unknown, path: string): GistMeta {
	const input = record(value, path);
	keys(
		input,
		path,
		["id", "description", "files", "updatedAt", "url"],
		["ownerLogin"],
	);
	if (input.description !== null && typeof input.description !== "string") {
		invalid(`${path}.description must be a string or null`);
	}
	const files = array(input.files, `${path}.files`, parseGistFile);
	const fileNames = new Set<string>();
	for (const file of files) {
		if (fileNames.has(file.filename)) {
			invalid(`${path}.files contains duplicate filename: ${file.filename}`);
		}
		fileNames.add(file.filename);
	}
	return {
		id: string(input.id, `${path}.id`),
		...(input.ownerLogin === undefined
			? {}
			: { ownerLogin: string(input.ownerLogin, `${path}.ownerLogin`) }),
		description: input.description,
		files,
		updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`),
		url: string(input.url, `${path}.url`),
	};
}

function parseV1(value: Record<string, unknown>): WorkspaceDocumentV1 {
	keys(value, "workspace", ["data"], ["version", "exportedAt"]);
	if (value.version !== undefined && value.version !== 1) {
		throw new WorkspaceDocumentError(
			"unsupported_schema",
			`Unsupported workspace version: ${String(value.version)}`,
		);
	}
	if (value.exportedAt !== undefined) timestamp(value.exportedAt, "exportedAt");
	const input = record(value.data, "data");
	keys(
		input,
		"data",
		[],
		[
			"nodes",
			"subscriptions",
			"aggregates",
			"publishTargets",
			"clientExports",
			"gists",
			"activeGistId",
			"activeGistFile",
			"lastUpdated",
		],
	);
	const business = parseWorkspaceData(
		{
			nodes: input.nodes ?? [],
			subscriptions: input.subscriptions ?? [],
			aggregates: input.aggregates ?? [],
			publishTargets: input.publishTargets ?? [],
			clientExports: input.clientExports ?? [],
		},
		"data",
		{ legacy: true },
	);
	const gists =
		input.gists === undefined
			? []
			: array(input.gists, "data.gists", parseGist);
	assertUniqueIds(gists, "data.gists");
	const activeGistId =
		input.activeGistId === undefined || input.activeGistId === null
			? null
			: string(input.activeGistId, "data.activeGistId");
	const activeGistFile =
		input.activeGistFile === undefined
			? WORKSPACE_FILE_NAME
			: string(input.activeGistFile, "data.activeGistFile");
	const lastUpdated =
		input.lastUpdated === undefined
			? new Date(0).toISOString()
			: timestamp(input.lastUpdated, "data.lastUpdated");
	return {
		version: 1,
		...(value.exportedAt === undefined
			? {}
			: { exportedAt: value.exportedAt as string }),
		data: {
			...business,
			gists,
			activeGistId,
			activeGistFile,
			lastUpdated,
		},
	};
}

export function parseWorkspaceDocument(
	raw: string,
	options: { expectedWorkspaceId?: string } = {},
): ParsedWorkspaceDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		invalid("Invalid workspace JSON");
	}
	const input = record(parsed, "workspace");
	if (input.schemaVersion !== undefined && input.schemaVersion !== 2) {
		throw new WorkspaceDocumentError(
			"unsupported_schema",
			`Unsupported workspace schema version: ${String(input.schemaVersion)}`,
		);
	}
	if (input.schemaVersion === 2) {
		return {
			schemaVersion: 2,
			document: parseV2(input, options.expectedWorkspaceId),
		};
	}
	return { schemaVersion: 1, document: parseV1(input) };
}

export function migrateWorkspaceDocumentV1ToV2(
	document: WorkspaceDocumentV1,
	options: { gistId: string; now?: string },
): { document: WorkspaceDocumentV2; binding: LocalWorkspaceBinding } {
	const gistId = string(options.gistId, "gistId");
	const now = timestamp(options.now ?? new Date().toISOString(), "updatedAt");
	const data = parseWorkspaceData({
		nodes: document.data.nodes,
		subscriptions: document.data.subscriptions,
		aggregates: document.data.aggregates,
		publishTargets: document.data.publishTargets,
		clientExports: document.data.clientExports,
	});
	return {
		document: {
			version: 2,
			schemaVersion: 2,
			workspaceId: `gist:${gistId}`,
			revision: 0,
			updatedAt: now,
			lastMutationId: null,
			data,
			tombstones: {
				nodes: [],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			},
		},
		binding: {
			gistId,
			fileName: WORKSPACE_FILE_NAME,
			syncMode: "automatic",
			baseline: null,
		},
	};
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

export function canonicalizeWorkspaceData(data: WorkspaceData): WorkspaceData {
	const parsed = parseWorkspaceData(data);
	const normalized = {
		...parsed,
		aggregates: parsed.aggregates.map((item) => ({
			...item,
			nodeIds: [...item.nodeIds].sort(),
			subscriptionIds: [...item.subscriptionIds].sort(),
			excludeTagIds: [...item.excludeTagIds].sort(),
			allowedTypes: [...item.allowedTypes].sort(),
		})),
	};
	return canonicalizeValue(normalized) as WorkspaceData;
}

function canonicalizeTombstones(
	tombstones: WorkspaceTombstones,
	revision: number,
	data: WorkspaceData,
): WorkspaceTombstones {
	const parsed = parseTombstones(tombstones, revision, data);
	const result = {} as WorkspaceTombstones;
	for (const collection of Object.keys(
		parsed,
	) as (keyof WorkspaceTombstones)[]) {
		result[collection] = parsed[collection]
			.map((item) => canonicalizeValue(item) as WorkspaceTombstone)
			.sort((left, right) => left.id.localeCompare(right.id));
	}
	return result;
}

function normalizeV2(document: WorkspaceDocumentV2): WorkspaceDocumentV2 {
	return parseV2(document as unknown as Record<string, unknown>);
}

export function validateWorkspaceDocumentV2(
	value: unknown,
	options: { expectedWorkspaceId?: string } = {},
): WorkspaceDocumentV2 {
	return parseV2(record(value, "workspace"), options.expectedWorkspaceId);
}

export function serializeWorkspaceDocumentV2(
	document: WorkspaceDocumentV2,
): string {
	const parsed = normalizeV2(document);
	const data = canonicalizeWorkspaceData(parsed.data);
	return JSON.stringify(
		{
			version: 2,
			schemaVersion: 2,
			workspaceId: parsed.workspaceId,
			revision: parsed.revision,
			updatedAt: parsed.updatedAt,
			lastMutationId: parsed.lastMutationId,
			data,
			tombstones: canonicalizeTombstones(
				parsed.tombstones,
				parsed.revision,
				data,
			),
		},
		null,
		2,
	);
}

export function getWorkspaceContentSignature(
	document: WorkspaceDocumentV2,
): string {
	const parsed = normalizeV2(document);
	const data = canonicalizeWorkspaceData(parsed.data);
	return JSON.stringify({
		data,
		tombstones: canonicalizeTombstones(
			parsed.tombstones,
			parsed.revision,
			data,
		),
	});
}
