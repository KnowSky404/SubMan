# Server API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated server-side API endpoints that let trusted scripts create, update, list, and delete SubMan nodes through the workspace Gist.

**Architecture:** Implement focused server helpers under `src/lib/server/api` and SvelteKit `+server.ts` routes under `src/routes/api`. API routes authenticate a SubMan bearer token, use a Cloudflare secret GitHub token to read/write the existing workspace Gist, and reuse the existing SubMan sync payload format.

**Tech Stack:** SvelteKit server routes, Cloudflare Workers runtime env via `platform.env`, TypeScript, Bun test.

---

## File Map

- Create `src/lib/server/api/auth.ts`: bearer token parsing and constant-time comparison.
- Create `src/lib/server/api/errors.ts`: JSON error response helpers.
- Create `src/lib/server/api/nodes.ts`: node payload validation, tag conversion, create/update/delete mutations.
- Create `src/lib/server/api/workspace.ts`: server-side workspace Gist loading and saving.
- Create `src/lib/server/api/env.ts`: Cloudflare/SvelteKit env extraction.
- Create `src/lib/server/api/*.test.ts`: focused Bun tests for pure helpers.
- Modify `src/app.d.ts`: type the Cloudflare env bindings used by API routes.
- Create `src/routes/api/health/+server.ts`: API health response.
- Create `src/routes/api/nodes/+server.ts`: list and create nodes.
- Create `src/routes/api/nodes/[id]/+server.ts`: get, patch, and delete nodes.
- Create `src/routes/api/nodes/by-key/[externalKey]/+server.ts`: idempotent external-key upsert.
- Modify `README.md` and `README.en.md`: document secrets and first API examples.

## Task 1: Pure API Helper Tests and Implementation

**Files:**
- Create: `src/lib/server/api/auth.ts`
- Create: `src/lib/server/api/errors.ts`
- Create: `src/lib/server/api/nodes.ts`
- Test: `src/lib/server/api/auth.test.ts`
- Test: `src/lib/server/api/nodes.test.ts`

- [ ] **Step 1: Write failing auth helper tests**

Create `src/lib/server/api/auth.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { getBearerToken, isAuthorized } from "./auth";

describe("getBearerToken", () => {
	it("extracts a bearer token from an authorization header", () => {
		expect(getBearerToken("Bearer subman-secret")).toBe("subman-secret");
	});

	it("rejects missing or non-bearer authorization values", () => {
		expect(getBearerToken(null)).toBeNull();
		expect(getBearerToken("Basic abc")).toBeNull();
		expect(getBearerToken("Bearer ")).toBeNull();
	});
});

describe("isAuthorized", () => {
	it("accepts matching bearer tokens", async () => {
		expect(await isAuthorized("Bearer subman-secret", "subman-secret")).toBe(true);
	});

	it("rejects missing configured tokens and mismatched request tokens", async () => {
		expect(await isAuthorized("Bearer subman-secret", "")).toBe(false);
		expect(await isAuthorized("Bearer wrong", "subman-secret")).toBe(false);
		expect(await isAuthorized(null, "subman-secret")).toBe(false);
	});
});
```

- [ ] **Step 2: Run auth tests to verify they fail**

Run: `bun test src/lib/server/api/auth.test.ts`

Expected: FAIL because `src/lib/server/api/auth.ts` does not exist.

- [ ] **Step 3: Implement auth helper**

Create `src/lib/server/api/auth.ts`:

```ts
const BEARER_PREFIX = "Bearer ";

function toBytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

async function sha256(value: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest("SHA-256", toBytes(value));
}

export function getBearerToken(authorization: string | null): string | null {
	if (!authorization?.startsWith(BEARER_PREFIX)) {
		return null;
	}

	const token = authorization.slice(BEARER_PREFIX.length).trim();
	return token ? token : null;
}

export async function isAuthorized(
	authorization: string | null,
	configuredToken: string | undefined,
): Promise<boolean> {
	const requestToken = getBearerToken(authorization);
	if (!requestToken || !configuredToken) {
		return false;
	}

	const [requestHash, configuredHash] = await Promise.all([
		sha256(requestToken),
		sha256(configuredToken),
	]);

	return crypto.subtle.timingSafeEqual(requestHash, configuredHash);
}
```

- [ ] **Step 4: Run auth tests to verify they pass**

Run: `bun test src/lib/server/api/auth.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing node helper tests**

Create `src/lib/server/api/nodes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { AppState, NodeItem } from "$lib/models";
import {
	EXTERNAL_KEY_TAG_PREFIX,
	applyNodeDelete,
	applyNodeUpsertByExternalKey,
	parseNodePayload,
} from "./nodes";

function stateWith(nodes: NodeItem[] = []): AppState {
	return {
		nodes,
		subscriptions: [],
		aggregates: [
			{
				id: "rule-1",
				name: "Rule 1",
				nodeIds: ["node-1", "node-2"],
				subscriptionIds: [],
				excludeTagIds: [],
				renameMap: {},
				allowedTypes: ["vless"],
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		],
		publishTargets: [],
		gists: [],
		activeGistId: "gist-1",
		activeGistFile: "subman.json",
		lastUpdated: "2026-01-01T00:00:00.000Z",
	};
}

describe("parseNodePayload", () => {
	it("normalizes valid node input", () => {
		const parsed = parseNodePayload({
			name: "vps-1",
			type: "vless",
			raw: "vless://example",
			tags: ["sing-box-vps", { id: "region", label: "HK" }],
		});

		expect(parsed).toEqual({
			name: "vps-1",
			type: "vless",
			raw: "vless://example",
			enabled: true,
			source: "single",
			tags: [
				{ id: "sing-box-vps", label: "sing-box-vps" },
				{ id: "region", label: "HK" },
			],
		});
	});

	it("rejects missing required node fields", () => {
		expect(() => parseNodePayload({ type: "vless", raw: "vless://example" })).toThrow(
			"name is required",
		);
		expect(() => parseNodePayload({ name: "vps-1", raw: "vless://example" })).toThrow(
			"type is required",
		);
		expect(() => parseNodePayload({ name: "vps-1", type: "vless" })).toThrow(
			"raw is required",
		);
	});
});

describe("applyNodeUpsertByExternalKey", () => {
	it("creates a node with an external key tag", () => {
		const result = applyNodeUpsertByExternalKey(
			stateWith(),
			"vps-1-vless",
			parseNodePayload({
				name: "vps-1",
				type: "vless",
				raw: "vless://example",
				tags: ["sing-box-vps"],
			}),
			{
				id: () => "node-1",
				now: () => "2026-05-06T00:00:00.000Z",
			},
		);

		expect(result.node.id).toBe("node-1");
		expect(result.node.tags.map((tag) => tag.label)).toEqual([
			"sing-box-vps",
			`${EXTERNAL_KEY_TAG_PREFIX}vps-1-vless`,
		]);
		expect(result.state.nodes).toHaveLength(1);
	});

	it("updates an existing external-key node without duplicating it", () => {
		const existing = applyNodeUpsertByExternalKey(
			stateWith(),
			"vps-1-vless",
			parseNodePayload({
				name: "vps-1",
				type: "vless",
				raw: "vless://old",
			}),
			{
				id: () => "node-1",
				now: () => "2026-05-06T00:00:00.000Z",
			},
		).state;

		const result = applyNodeUpsertByExternalKey(
			existing,
			"vps-1-vless",
			parseNodePayload({
				name: "vps-1 new",
				type: "vless",
				raw: "vless://new",
			}),
			{
				id: () => "node-2",
				now: () => "2026-05-06T01:00:00.000Z",
			},
		);

		expect(result.state.nodes).toHaveLength(1);
		expect(result.node.id).toBe("node-1");
		expect(result.node.name).toBe("vps-1 new");
		expect(result.node.raw).toBe("vless://new");
	});
});

describe("applyNodeDelete", () => {
	it("deletes a node and removes it from aggregate rules", () => {
		const result = applyNodeDelete(stateWith(), "node-1", "2026-05-06T00:00:00.000Z");

		expect(result.deleted).toBe(true);
		expect(result.state.nodes).toEqual([]);
		expect(result.state.aggregates[0]?.nodeIds).toEqual(["node-2"]);
	});
});
```

- [ ] **Step 6: Run node helper tests to verify they fail**

Run: `bun test src/lib/server/api/nodes.test.ts`

Expected: FAIL because `src/lib/server/api/nodes.ts` does not exist.

- [ ] **Step 7: Implement node helpers and JSON error helper**

Create `src/lib/server/api/errors.ts`:

```ts
export type ApiErrorCode =
	| "bad_request"
	| "unauthorized"
	| "not_found"
	| "method_not_allowed"
	| "server_error";

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: ApiErrorCode,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export function jsonError(error: ApiError): Response {
	return Response.json(
		{
			error: {
				code: error.code,
				message: error.message,
			},
		},
		{ status: error.status },
	);
}
```

Create `src/lib/server/api/nodes.ts`:

```ts
import type { AppState, NodeItem, NodeTag, ProxyType, SourceType } from "$lib/models";
import { nowIso } from "$lib/utils/time";
import { ApiError } from "./errors";

const PROXY_TYPES = new Set<ProxyType>([
	"vless",
	"vmess",
	"trojan",
	"ss",
	"ssr",
	"hysteria2",
	"tuic",
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

export type NodeMutationClock = {
	id: () => string;
	now: () => string;
};

const defaultClock: NodeMutationClock = {
	id: () => crypto.randomUUID(),
	now: nowIso,
};

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new ApiError(400, "bad_request", `${field} is required`);
	}
	return value.trim();
}

function tagIdFromLabel(label: string): string {
	return label.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeTag(value: unknown): NodeTag {
	if (typeof value === "string") {
		const label = value.trim();
		if (!label) {
			throw new ApiError(400, "bad_request", "tag label is required");
		}
		return { id: tagIdFromLabel(label) || crypto.randomUUID(), label };
	}

	if (value && typeof value === "object") {
		const tag = value as Partial<NodeTag>;
		const label = requireString(tag.label, "tag label");
		const id = typeof tag.id === "string" && tag.id.trim() ? tag.id.trim() : tagIdFromLabel(label);
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
		typeof body.source === "string" && body.source.trim() ? body.source.trim() : "single";
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

export function applyNodeCreate(
	state: AppState,
	payload: NodePayload,
	clock: NodeMutationClock = defaultClock,
): { state: AppState; node: NodeItem } {
	const timestamp = clock.now();
	const node: NodeItem = {
		id: clock.id(),
		...payload,
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
	patch: Partial<NodePayload>,
	now = nowIso(),
): { state: AppState; node: NodeItem | null } {
	const index = state.nodes.findIndex((node) => node.id === nodeId);
	if (index < 0) {
		return { state, node: null };
	}

	const nodes = [...state.nodes];
	const node = {
		...nodes[index],
		...patch,
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
	now = nowIso(),
): { state: AppState; deleted: boolean } {
	const nodes = state.nodes.filter((node) => node.id !== nodeId);
	if (nodes.length === state.nodes.length) {
		return { state, deleted: false };
	}

	return {
		deleted: true,
		state: {
			...state,
			nodes,
			aggregates: state.aggregates.map((rule) => ({
				...rule,
				nodeIds: rule.nodeIds.filter((id) => id !== nodeId),
			})),
			lastUpdated: now,
		},
	};
}
```

- [ ] **Step 8: Run node helper tests to verify they pass**

Run: `bun test src/lib/server/api/auth.test.ts src/lib/server/api/nodes.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit helper layer**

Run:

```bash
git add src/lib/server/api/auth.ts src/lib/server/api/errors.ts src/lib/server/api/nodes.ts src/lib/server/api/auth.test.ts src/lib/server/api/nodes.test.ts
git commit -m "feat: add server api node helpers"
```

## Task 2: Server Workspace Access

**Files:**
- Create: `src/lib/server/api/env.ts`
- Create: `src/lib/server/api/workspace.ts`
- Modify: `src/app.d.ts`
- Test: `src/lib/server/api/workspace.test.ts`

- [ ] **Step 1: Write failing workspace tests**

Create `src/lib/server/api/workspace.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { defaultState } from "$lib/stores/app";
import { exportSyncState } from "$lib/serialization";
import { readStateFromWorkspaceContent } from "./workspace";

describe("readStateFromWorkspaceContent", () => {
	it("imports existing sync content", () => {
		const content = exportSyncState({
			...defaultState,
			nodes: [
				{
					id: "node-1",
					name: "vps-1",
					type: "vless",
					raw: "vless://example",
					tags: [],
					enabled: true,
					source: "single",
					updatedAt: "2026-05-06T00:00:00.000Z",
				},
			],
		});

		const state = readStateFromWorkspaceContent(content);

		expect(state.nodes).toHaveLength(1);
		expect(state.nodes[0]?.name).toBe("vps-1");
	});

	it("falls back to default state when workspace content is empty", () => {
		const state = readStateFromWorkspaceContent("");

		expect(state.nodes).toEqual([]);
		expect(state.activeGistFile).toBe("subman.json");
	});
});
```

- [ ] **Step 2: Run workspace tests to verify they fail**

Run: `bun test src/lib/server/api/workspace.test.ts`

Expected: FAIL because `src/lib/server/api/workspace.ts` does not exist.

- [ ] **Step 3: Implement env and workspace helpers**

Modify `src/app.d.ts`:

```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env?: {
				GITHUB_TOKEN?: string;
				SUBMAN_API_TOKEN?: string;
			};
		}
	}
}

export {};
```

Create `src/lib/server/api/env.ts`:

```ts
import { env as privateEnv } from "$env/dynamic/private";

export type ServerApiEnv = {
	githubToken?: string;
	submanApiToken?: string;
};

export function getServerApiEnv(platform: App.Platform | undefined): ServerApiEnv {
	return {
		githubToken: platform?.env?.GITHUB_TOKEN ?? privateEnv.GITHUB_TOKEN,
		submanApiToken: platform?.env?.SUBMAN_API_TOKEN ?? privateEnv.SUBMAN_API_TOKEN,
	};
}
```

Create `src/lib/server/api/workspace.ts`:

```ts
import type { AppState, GistMeta } from "$lib/models";
import { getGistFileContent, updateGist } from "$lib/gist";
import { exportSyncState, importState } from "$lib/serialization";
import { defaultState } from "$lib/stores/app";
import { ensureWorkspaceGist, WORKSPACE_FILE } from "$lib/workspace";

export type WorkspaceState = {
	gist: GistMeta;
	state: AppState;
};

export function readStateFromWorkspaceContent(content: string): AppState {
	if (!content.trim()) {
		return defaultState;
	}

	return importState(content);
}

export async function loadWorkspaceState(githubToken: string): Promise<WorkspaceState> {
	const initialContent = exportSyncState(defaultState);
	const { gist } = await ensureWorkspaceGist(githubToken, initialContent);
	const content = await getGistFileContent(githubToken, gist.id, WORKSPACE_FILE);

	return {
		gist,
		state: {
			...readStateFromWorkspaceContent(content),
			activeGistId: gist.id,
			activeGistFile: WORKSPACE_FILE,
		},
	};
}

export async function saveWorkspaceState(
	githubToken: string,
	gistId: string,
	state: AppState,
): Promise<GistMeta> {
	return updateGist(githubToken, {
		gistId,
		files: {
			[WORKSPACE_FILE]: { content: exportSyncState(state) },
		},
	});
}
```

- [ ] **Step 4: Run workspace tests to verify they pass**

Run: `bun test src/lib/server/api/workspace.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit workspace layer**

Run:

```bash
git add src/app.d.ts src/lib/server/api/env.ts src/lib/server/api/workspace.ts src/lib/server/api/workspace.test.ts
git commit -m "feat: add server api workspace access"
```

## Task 3: SvelteKit API Routes

**Files:**
- Create: `src/routes/api/health/+server.ts`
- Create: `src/routes/api/nodes/+server.ts`
- Create: `src/routes/api/nodes/[id]/+server.ts`
- Create: `src/routes/api/nodes/by-key/[externalKey]/+server.ts`

- [ ] **Step 1: Implement health route**

Create `src/routes/api/health/+server.ts`:

```ts
import { getServerApiEnv } from "$lib/server/api/env";

export function GET({ platform }: { platform?: App.Platform }) {
	const env = getServerApiEnv(platform);

	return Response.json({
		ok: Boolean(env.githubToken && env.submanApiToken),
		config: {
			githubToken: Boolean(env.githubToken),
			submanApiToken: Boolean(env.submanApiToken),
		},
	});
}
```

- [ ] **Step 2: Implement shared route helpers inline in node route**

Create `src/routes/api/nodes/+server.ts`:

```ts
import { ApiError, jsonError } from "$lib/server/api/errors";
import { getServerApiEnv } from "$lib/server/api/env";
import { isAuthorized } from "$lib/server/api/auth";
import { applyNodeCreate, parseNodePayload } from "$lib/server/api/nodes";
import { loadWorkspaceState, saveWorkspaceState } from "$lib/server/api/workspace";

async function requireApiAccess(request: Request, platform: App.Platform | undefined) {
	const env = getServerApiEnv(platform);
	if (!(await isAuthorized(request.headers.get("Authorization"), env.submanApiToken))) {
		throw new ApiError(401, "unauthorized", "Unauthorized");
	}
	if (!env.githubToken) {
		throw new ApiError(500, "server_error", "GITHUB_TOKEN is not configured");
	}
	return env.githubToken;
}

function handleError(error: unknown): Response {
	if (error instanceof ApiError) {
		return jsonError(error);
	}
	return jsonError(new ApiError(500, "server_error", "Internal server error"));
}

export async function GET({ request, platform }: { request: Request; platform?: App.Platform }) {
	try {
		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadWorkspaceState(githubToken);
		return Response.json({
			data: workspace.state.nodes,
			workspace: {
				gistId: workspace.gist.id,
				file: workspace.state.activeGistFile,
			},
		});
	} catch (error) {
		return handleError(error);
	}
}

export async function POST({ request, platform }: { request: Request; platform?: App.Platform }) {
	try {
		const githubToken = await requireApiAccess(request, platform);
		const workspace = await loadWorkspaceState(githubToken);
		const payload = parseNodePayload(await request.json());
		const result = applyNodeCreate(workspace.state, payload);
		const gist = await saveWorkspaceState(githubToken, workspace.gist.id, result.state);

		return Response.json(
			{
				data: result.node,
				workspace: {
					gistId: gist.id,
					file: result.state.activeGistFile,
				},
			},
			{ status: 201 },
		);
	} catch (error) {
		return handleError(error);
	}
}
```

- [ ] **Step 3: Implement node id route**

Create `src/routes/api/nodes/[id]/+server.ts`:

```ts
import { ApiError, jsonError } from "$lib/server/api/errors";
import { getServerApiEnv } from "$lib/server/api/env";
import { isAuthorized } from "$lib/server/api/auth";
import { applyNodeDelete, applyNodePatch, parseNodePayload } from "$lib/server/api/nodes";
import { loadWorkspaceState, saveWorkspaceState } from "$lib/server/api/workspace";
import { nowIso } from "$lib/utils/time";

async function requireApiAccess(request: Request, platform: App.Platform | undefined) {
	const env = getServerApiEnv(platform);
	if (!(await isAuthorized(request.headers.get("Authorization"), env.submanApiToken))) {
		throw new ApiError(401, "unauthorized", "Unauthorized");
	}
	if (!env.githubToken) {
		throw new ApiError(500, "server_error", "GITHUB_TOKEN is not configured");
	}
	return env.githubToken;
}

function handleError(error: unknown): Response {
	if (error instanceof ApiError) {
		return jsonError(error);
	}
	return jsonError(new ApiError(500, "server_error", "Internal server error"));
}

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
		const workspace = await loadWorkspaceState(githubToken);
		const node = workspace.state.nodes.find((item) => item.id === params.id);
		if (!node) {
			throw new ApiError(404, "not_found", "Node not found");
		}
		return Response.json({ data: node });
	} catch (error) {
		return handleError(error);
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
		const workspace = await loadWorkspaceState(githubToken);
		const payload = parseNodePayload(await request.json());
		const result = applyNodePatch(workspace.state, params.id, payload, nowIso());
		if (!result.node) {
			throw new ApiError(404, "not_found", "Node not found");
		}
		const gist = await saveWorkspaceState(githubToken, workspace.gist.id, result.state);
		return Response.json({
			data: result.node,
			workspace: {
				gistId: gist.id,
				file: result.state.activeGistFile,
			},
		});
	} catch (error) {
		return handleError(error);
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
		const workspace = await loadWorkspaceState(githubToken);
		const result = applyNodeDelete(workspace.state, params.id, nowIso());
		if (!result.deleted) {
			throw new ApiError(404, "not_found", "Node not found");
		}
		const gist = await saveWorkspaceState(githubToken, workspace.gist.id, result.state);
		return Response.json({
			data: { deleted: true },
			workspace: {
				gistId: gist.id,
				file: result.state.activeGistFile,
			},
		});
	} catch (error) {
		return handleError(error);
	}
}
```

- [ ] **Step 4: Implement external-key upsert route**

Create `src/routes/api/nodes/by-key/[externalKey]/+server.ts`:

```ts
import { ApiError, jsonError } from "$lib/server/api/errors";
import { getServerApiEnv } from "$lib/server/api/env";
import { isAuthorized } from "$lib/server/api/auth";
import { applyNodeUpsertByExternalKey, parseNodePayload } from "$lib/server/api/nodes";
import { loadWorkspaceState, saveWorkspaceState } from "$lib/server/api/workspace";

async function requireApiAccess(request: Request, platform: App.Platform | undefined) {
	const env = getServerApiEnv(platform);
	if (!(await isAuthorized(request.headers.get("Authorization"), env.submanApiToken))) {
		throw new ApiError(401, "unauthorized", "Unauthorized");
	}
	if (!env.githubToken) {
		throw new ApiError(500, "server_error", "GITHUB_TOKEN is not configured");
	}
	return env.githubToken;
}

function handleError(error: unknown): Response {
	if (error instanceof ApiError) {
		return jsonError(error);
	}
	return jsonError(new ApiError(500, "server_error", "Internal server error"));
}

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
		const workspace = await loadWorkspaceState(githubToken);
		const payload = parseNodePayload(await request.json());
		const result = applyNodeUpsertByExternalKey(workspace.state, externalKey, payload);
		const gist = await saveWorkspaceState(githubToken, workspace.gist.id, result.state);

		return Response.json({
			data: result.node,
			workspace: {
				gistId: gist.id,
				file: result.state.activeGistFile,
			},
		});
	} catch (error) {
		return handleError(error);
	}
}
```

- [ ] **Step 5: Run type check**

Run: `bun run check`

Expected: PASS.

- [ ] **Step 6: Commit routes**

Run:

```bash
git add src/routes/api/health/+server.ts src/routes/api/nodes/+server.ts src/routes/api/nodes/[id]/+server.ts src/routes/api/nodes/by-key/[externalKey]/+server.ts
git commit -m "feat: add server api node routes"
```

## Task 4: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`

- [ ] **Step 1: Add API documentation**

Add an "API" section to both READMEs with:

```md
## Server API

SubMan can expose owner-operated API endpoints for backend scripts such as
`sing-box-vps`. The API uses Cloudflare Worker secrets:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

Example node upsert:

```bash
curl -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

The first API version is intended for trusted backend scripts, so it does not
enable broad browser CORS by default.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
bun test src/lib/server/api/auth.test.ts src/lib/server/api/nodes.test.ts src/lib/server/api/workspace.test.ts
bun run check
bun run lint
bun run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit documentation**

Run:

```bash
git add README.md README.en.md
git commit -m "docs: document server api"
```

## Self-Review

- Spec coverage: plan covers bearer auth, Cloudflare secrets, health, node CRUD, external-key upsert, Gist read/write, JSON errors, docs, and tests. Aggregate CRUD is intentionally deferred as lower priority.
- Placeholder scan: no open placeholders are used as implementation instructions.
- Type consistency: helper names and route imports are consistent across tasks.
