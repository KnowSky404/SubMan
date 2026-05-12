# sing-box Client Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Exports workflow that generates complete sing-box bare-core client configs from existing Aggregate rules, with preview, copy, download, and optional Workspace Gist publishing.

**Architecture:** Persist reusable client export profiles in `AppState`, reuse `buildAggregateOutput()` as the source of URI lines, and add focused `src/lib/client-export/` modules for profile validation and sing-box generation. The Svelte route owns UI state and Gist publishing, while generation modules stay framework-independent.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Bun test, existing GitHub Gist helpers, existing GitHub-style CSS primitives.

---

## File Map

- Modify `src/lib/models.ts`
  - Add client export profile and sing-box options types.
  - Add `clientExports` to `AppState`.
- Modify `src/lib/stores/app.ts`
  - Add default `clientExports`.
  - Add `upsertClientExport()` and `removeClientExport()`.
- Modify `src/lib/serialization.ts`
  - Include `clientExports` in synced state.
- Modify `src/lib/merge.ts`
  - Merge `clientExports` by `updatedAt`.
- Modify `src/lib/server/api/workspace.ts`
  - Add `clientExports` to server default state.
- Modify affected server tests if the default app state fixtures require the new field.
- Create `src/lib/client-export/profile.ts`
  - Profile defaults, filename protection, option validation.
- Create `src/lib/client-export/uri.ts`
  - URI parsers for VLESS, VMess, Trojan, Shadowsocks, and Hysteria2.
- Create `src/lib/client-export/sing-box.ts`
  - Build full sing-box client config from an Aggregate rule.
- Create `src/lib/client-export/sing-box.test.ts`
  - Unit tests for supported protocols, warnings, tag uniqueness, selector/urltest, and validation.
- Modify `src/routes/+layout.svelte`
  - Add top-level `Exports` nav item.
- Modify `src/routes/layout-source.test.ts`
  - Assert `Exports` nav exists in the right order.
- Create `src/routes/exports/+page.svelte`
  - Export profile UI, preview, copy, download, publish.
- Create `src/routes/exports/page-source.test.ts`
  - Source-level page tests for Aggregate source selector and actions.
- Modify `src/lib/i18n.ts`
  - Add user-facing strings used by the new page.

## Task 1: Persist Client Export Profiles

**Files:**
- Modify: `src/lib/models.ts`
- Modify: `src/lib/stores/app.ts`
- Modify: `src/lib/serialization.ts`
- Modify: `src/lib/merge.ts`
- Modify: `src/lib/server/api/workspace.ts`
- Test: existing Bun tests that import state fixtures

- [ ] **Step 1: Add model types**

In `src/lib/models.ts`, add these types after `AggregatePublishTarget`:

```ts
export type ClientExportType = "sing-box-client";

export type SingBoxClientExportOptions = {
	listenAddress: string;
	listenPort: number;
	inboundType: "mixed";
	dnsMode: "conservative";
	routeMode: "global-proxy";
	includeExperimental: boolean;
	selectorTag: string;
	urlTestTag: string;
};

export type ClientExportProfile = {
	id: string;
	name: string;
	type: ClientExportType;
	ruleId: string;
	fileName: string;
	options: SingBoxClientExportOptions;
	lastGeneratedAt: string | null;
	lastPublishedAt: string | null;
	lastPublishedUrl: string | null;
	updatedAt: string;
};
```

Then extend `AppState`:

```ts
export type AppState = {
	nodes: NodeItem[];
	subscriptions: SubscriptionItem[];
	aggregates: AggregateRule[];
	publishTargets: AggregatePublishTarget[];
	clientExports: ClientExportProfile[];
	gists: GistMeta[];
	activeGistId: string | null;
	activeGistFile: string;
	lastUpdated: string;
};
```

- [ ] **Step 2: Update store defaults and mutators**

In `src/lib/stores/app.ts`, import `ClientExportProfile`, add `clientExports: []` to `defaultState`, and add:

```ts
export function upsertClientExport(profile: ClientExportProfile): void {
	appState.update((state) => {
		const index = state.clientExports.findIndex((item) => item.id === profile.id);
		if (index >= 0) {
			const clientExports = [...state.clientExports];
			clientExports[index] = profile;
			return { ...state, clientExports, lastUpdated: nowIso() };
		}
		return { ...state, clientExports: [profile, ...state.clientExports], lastUpdated: nowIso() };
	});
}

export function removeClientExport(profileId: string): void {
	appState.update((state) => ({
		...state,
		clientExports: state.clientExports.filter((profile) => profile.id !== profileId),
		lastUpdated: nowIso()
	}));
}
```

Also update `removeAggregate()` so deleting a rule removes related client export profiles:

```ts
clientExports: state.clientExports.filter((profile) => profile.ruleId !== ruleId),
```

- [ ] **Step 3: Update serialization**

In `src/lib/serialization.ts`, include `clientExports` in `buildSyncState()`:

```ts
function buildSyncState(state: AppState): AppState {
	return {
		...defaultState,
		nodes: state.nodes,
		subscriptions: state.subscriptions,
		aggregates: state.aggregates,
		publishTargets: state.publishTargets,
		clientExports: state.clientExports,
		lastUpdated: state.lastUpdated,
	};
}
```

- [ ] **Step 4: Update merge behavior**

In `src/lib/merge.ts`, import `ClientExportProfile` and add `clientExports` to the local/remote/result shapes:

```ts
export function mergeSyncState(
	local: {
		nodes: NodeItem[];
		subscriptions: SubscriptionItem[];
		aggregates: AggregateRule[];
		publishTargets: AggregatePublishTarget[];
		clientExports?: ClientExportProfile[];
	},
	remote: {
		nodes: NodeItem[];
		subscriptions: SubscriptionItem[];
		aggregates: AggregateRule[];
		publishTargets: AggregatePublishTarget[];
		clientExports?: ClientExportProfile[];
	},
): {
	nodes: NodeItem[];
	subscriptions: SubscriptionItem[];
	aggregates: AggregateRule[];
	publishTargets: AggregatePublishTarget[];
	clientExports: ClientExportProfile[];
} {
	return {
		nodes: mergeByUpdatedAt(local.nodes, remote.nodes),
		subscriptions: mergeByUpdatedAt(local.subscriptions, remote.subscriptions),
		aggregates: mergeByUpdatedAt(local.aggregates, remote.aggregates),
		publishTargets: mergeByUpdatedAt(
			local.publishTargets,
			remote.publishTargets,
		),
		clientExports: mergeByUpdatedAt(
			local.clientExports ?? [],
			remote.clientExports ?? [],
		),
	};
}
```

- [ ] **Step 5: Update server workspace defaults**

In `src/lib/server/api/workspace.ts`, add `clientExports: []` to the server-side default state and any serialized state projection that currently lists `nodes`, `subscriptions`, `aggregates`, and `publishTargets`.

- [ ] **Step 6: Run focused checks**

Run:

```bash
bun test src/lib/server/api/workspace.test.ts src/lib/server/api/nodes.test.ts
```

Expected: PASS. If fixtures fail because they assert exact state shapes, add `clientExports: []` to those fixtures.

- [ ] **Step 7: Commit**

```bash
git add src/lib/models.ts src/lib/stores/app.ts src/lib/serialization.ts src/lib/merge.ts src/lib/server/api/workspace.ts src/lib/server/api/*.test.ts
git commit -m "feat: persist client export profiles"
```

## Task 2: Add Profile Defaults and Validation

**Files:**
- Create: `src/lib/client-export/profile.ts`
- Test: `src/lib/client-export/sing-box.test.ts`

- [ ] **Step 1: Create failing profile tests**

Create `src/lib/client-export/sing-box.test.ts` with:

```ts
import { describe, expect, it } from "bun:test";
import {
	createDefaultSingBoxClientProfile,
	validateSingBoxClientProfile,
} from "./profile";

describe("sing-box client export profile", () => {
	it("creates a default profile for an aggregate rule", () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", "2026-05-12T00:00:00.000Z");

		expect(profile.name).toBe("sing-box Client");
		expect(profile.type).toBe("sing-box-client");
		expect(profile.ruleId).toBe("rule-1");
		expect(profile.fileName).toBe("sing-box-client.json");
		expect(profile.options.listenAddress).toBe("127.0.0.1");
		expect(profile.options.listenPort).toBe(2080);
		expect(profile.options.inboundType).toBe("mixed");
		expect(profile.options.routeMode).toBe("global-proxy");
		expect(profile.options.includeExperimental).toBe(true);
	});

	it("blocks invalid listen ports and protected filenames", () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", "2026-05-12T00:00:00.000Z");

		expect(validateSingBoxClientProfile({ ...profile, fileName: "subman.json" }).errors).toContain(
			"Output filename cannot replace subman.json",
		);
		expect(
			validateSingBoxClientProfile({
				...profile,
				options: { ...profile.options, listenPort: 70000 },
			}).errors,
		).toContain("Listen port must be between 1 and 65535");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/lib/client-export/sing-box.test.ts
```

Expected: FAIL because `src/lib/client-export/profile.ts` does not exist.

- [ ] **Step 3: Implement profile helpers**

Create `src/lib/client-export/profile.ts`:

```ts
import type {
	ClientExportProfile,
	SingBoxClientExportOptions,
} from "$lib/models";
import { createId } from "$lib/utils/id";

export const DEFAULT_SING_BOX_CLIENT_OPTIONS: SingBoxClientExportOptions = {
	listenAddress: "127.0.0.1",
	listenPort: 2080,
	inboundType: "mixed",
	dnsMode: "conservative",
	routeMode: "global-proxy",
	includeExperimental: true,
	selectorTag: "proxy",
	urlTestTag: "auto",
};

export function createDefaultSingBoxClientProfile(
	ruleId: string,
	now: string,
): ClientExportProfile {
	return {
		id: createId("export"),
		name: "sing-box Client",
		type: "sing-box-client",
		ruleId,
		fileName: "sing-box-client.json",
		options: { ...DEFAULT_SING_BOX_CLIENT_OPTIONS },
		lastGeneratedAt: null,
		lastPublishedAt: null,
		lastPublishedUrl: null,
		updatedAt: now,
	};
}

export function normalizeExportFileName(value: string): string {
	return value.trim().replace(/^\/+/, "");
}

export function validateSingBoxClientProfile(profile: ClientExportProfile): {
	errors: string[];
} {
	const errors: string[] = [];
	const fileName = normalizeExportFileName(profile.fileName);

	if (!profile.ruleId) {
		errors.push("Select an Aggregate rule");
	}
	if (!fileName) {
		errors.push("Output filename is required");
	}
	if (fileName.toLowerCase() === "subman.json") {
		errors.push("Output filename cannot replace subman.json");
	}
	if (!Number.isInteger(profile.options.listenPort) || profile.options.listenPort < 1 || profile.options.listenPort > 65535) {
		errors.push("Listen port must be between 1 and 65535");
	}
	if (!profile.options.listenAddress.trim()) {
		errors.push("Listen address is required");
	}
	if (!profile.options.selectorTag.trim()) {
		errors.push("Selector tag is required");
	}
	if (!profile.options.urlTestTag.trim()) {
		errors.push("URL test tag is required");
	}

	return { errors };
}
```

- [ ] **Step 4: Run focused test**

Run:

```bash
bun test src/lib/client-export/sing-box.test.ts
```

Expected: PASS for profile tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-export/profile.ts src/lib/client-export/sing-box.test.ts
git commit -m "feat: add sing-box export profile defaults"
```

## Task 3: Parse Supported URI Lines

**Files:**
- Create: `src/lib/client-export/uri.ts`
- Modify: `src/lib/client-export/sing-box.test.ts`

- [ ] **Step 1: Add failing URI parser tests**

Append to `src/lib/client-export/sing-box.test.ts`:

```ts
import { parseProxyUriToSingBoxOutbound } from "./uri";

describe("proxy URI to sing-box outbound", () => {
	it("parses vless reality URI", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"vless://00000000-0000-4000-8000-000000000001@example.com:443?security=reality&sni=www.cloudflare.com&pbk=pubkey&sid=abcd&flow=xtls-rprx-vision#HK%20VLESS",
			"HK VLESS",
		);

		expect(result.outbound).toMatchObject({
			type: "vless",
			tag: "HK VLESS",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000001",
			flow: "xtls-rprx-vision",
			tls: {
				enabled: true,
				server_name: "www.cloudflare.com",
				reality: { enabled: true, public_key: "pubkey", short_id: "abcd" },
			},
		});
		expect(result.warning).toBeNull();
	});

	it("parses trojan URI", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"trojan://password@example.com:443?sni=trojan.example.com#Trojan",
			"Trojan",
		);

		expect(result.outbound).toMatchObject({
			type: "trojan",
			tag: "Trojan",
			server: "example.com",
			server_port: 443,
			password: "password",
			tls: { enabled: true, server_name: "trojan.example.com" },
		});
	});

	it("parses shadowsocks URI with method and password", () => {
		const credentials = btoa("2022-blake3-aes-128-gcm:password");
		const result = parseProxyUriToSingBoxOutbound(
			`ss://${credentials}@example.com:8388#SS`,
			"SS",
		);

		expect(result.outbound).toMatchObject({
			type: "shadowsocks",
			tag: "SS",
			server: "example.com",
			server_port: 8388,
			method: "2022-blake3-aes-128-gcm",
			password: "password",
		});
	});

	it("parses hysteria2 URI", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"hysteria2://password@example.com:443?sni=hy2.example.com&obfs=salamander&obfs-password=obfs-pass#HY2",
			"HY2",
		);

		expect(result.outbound).toMatchObject({
			type: "hysteria2",
			tag: "HY2",
			server: "example.com",
			server_port: 443,
			password: "password",
			tls: { enabled: true, server_name: "hy2.example.com" },
			obfs: { type: "salamander", password: "obfs-pass" },
		});
	});

	it("warns for unsupported protocols", () => {
		const result = parseProxyUriToSingBoxOutbound("tuic://token@example.com:443#TUIC", "TUIC");

		expect(result.outbound).toBeNull();
		expect(result.warning).toContain("Unsupported protocol");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/lib/client-export/sing-box.test.ts
```

Expected: FAIL because `uri.ts` does not exist.

- [ ] **Step 3: Implement URI parser**

Create `src/lib/client-export/uri.ts`:

```ts
export type SingBoxOutbound = Record<string, unknown> & {
	type: string;
	tag: string;
};

export type UriParseResult = {
	outbound: SingBoxOutbound | null;
	warning: string | null;
};

function decodeBase64(value: string): string | null {
	try {
		const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
		return atob(normalized);
	} catch {
		return null;
	}
}

function parsePort(url: URL): number | null {
	const port = Number(url.port);
	return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function serverName(url: URL): string | null {
	return url.searchParams.get("sni") || url.searchParams.get("servername") || url.searchParams.get("peer") || null;
}

function tlsFromParams(url: URL): Record<string, unknown> | undefined {
	const security = url.searchParams.get("security");
	const sni = serverName(url);
	const tlsEnabled = security === "tls" || security === "reality" || Boolean(sni);
	if (!tlsEnabled) {
		return undefined;
	}

	const tls: Record<string, unknown> = {
		enabled: true,
	};
	if (sni) {
		tls.server_name = sni;
	}

	if (security === "reality") {
		const publicKey = url.searchParams.get("pbk") || url.searchParams.get("public_key");
		const shortId = url.searchParams.get("sid") || url.searchParams.get("short_id");
		tls.reality = {
			enabled: true,
			...(publicKey ? { public_key: publicKey } : {}),
			...(shortId ? { short_id: shortId } : {}),
		};
	}

	return tls;
}

function parseVmess(raw: string, fallbackTag: string): UriParseResult {
	const encoded = raw.slice("vmess://".length);
	const decoded = decodeBase64(encoded);
	if (!decoded) {
		return { outbound: null, warning: `Invalid VMess URI: ${fallbackTag}` };
	}

	try {
		const payload = JSON.parse(decoded) as Record<string, string | number | undefined>;
		const port = Number(payload.port);
		if (!payload.add || !payload.id || !Number.isInteger(port)) {
			return { outbound: null, warning: `Invalid VMess URI: ${fallbackTag}` };
		}

		const outbound: SingBoxOutbound = {
			type: "vmess",
			tag: fallbackTag,
			server: String(payload.add),
			server_port: port,
			uuid: String(payload.id),
			security: payload.scy ? String(payload.scy) : "auto",
		};
		if (payload.tls === "tls") {
			outbound.tls = {
				enabled: true,
				...(payload.sni ? { server_name: String(payload.sni) } : {}),
			};
		}
		return { outbound, warning: null };
	} catch {
		return { outbound: null, warning: `Invalid VMess URI: ${fallbackTag}` };
	}
}

export function parseProxyUriToSingBoxOutbound(raw: string, fallbackTag: string): UriParseResult {
	if (raw.startsWith("vmess://")) {
		return parseVmess(raw, fallbackTag);
	}

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { outbound: null, warning: `Invalid URI: ${fallbackTag}` };
	}

	const protocol = url.protocol.replace(":", "");
	const port = parsePort(url);
	if (!url.hostname || !port) {
		return { outbound: null, warning: `Invalid ${protocol.toUpperCase()} URI: ${fallbackTag}` };
	}

	const password = decodeURIComponent(url.username);
	const base = {
		tag: fallbackTag,
		server: url.hostname,
		server_port: port,
	};

	switch (protocol) {
		case "vless": {
			const tls = tlsFromParams(url);
			return {
				outbound: {
					type: "vless",
					...base,
					uuid: password,
					...(url.searchParams.get("flow") ? { flow: url.searchParams.get("flow") } : {}),
					...(tls ? { tls } : {}),
				},
				warning: null,
			};
		}
		case "trojan": {
			const tls = tlsFromParams(url) ?? { enabled: true };
			return {
				outbound: {
					type: "trojan",
					...base,
					password,
					tls,
				},
				warning: null,
			};
		}
		case "ss": {
			let method = decodeURIComponent(url.username);
			let ssPassword = decodeURIComponent(url.password);
			if (!ssPassword) {
				const decoded = decodeBase64(url.username);
				if (decoded?.includes(":")) {
					const separator = decoded.indexOf(":");
					method = decoded.slice(0, separator);
					ssPassword = decoded.slice(separator + 1);
				}
			}
			if (!method || !ssPassword) {
				return { outbound: null, warning: `Invalid Shadowsocks URI: ${fallbackTag}` };
			}
			return {
				outbound: {
					type: "shadowsocks",
					...base,
					method,
					password: ssPassword,
				},
				warning: null,
			};
		}
		case "hysteria2":
		case "hy2": {
			const tls = tlsFromParams(url) ?? { enabled: true };
			const obfsType = url.searchParams.get("obfs");
			const obfsPassword = url.searchParams.get("obfs-password") || url.searchParams.get("obfs_password");
			return {
				outbound: {
					type: "hysteria2",
					...base,
					password,
					tls,
					...(obfsType && obfsPassword ? { obfs: { type: obfsType, password: obfsPassword } } : {}),
				},
				warning: null,
			};
		}
		default:
			return { outbound: null, warning: `Unsupported protocol ${protocol}: ${fallbackTag}` };
	}
}
```

- [ ] **Step 4: Run focused test**

Run:

```bash
bun test src/lib/client-export/sing-box.test.ts
```

Expected: PASS for profile and URI parser tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-export/uri.ts src/lib/client-export/sing-box.test.ts
git commit -m "feat: parse sing-box export proxy uris"
```

## Task 4: Build Full sing-box Client Config

**Files:**
- Create: `src/lib/client-export/sing-box.ts`
- Modify: `src/lib/client-export/sing-box.test.ts`

- [ ] **Step 1: Add failing generator tests**

Append to `src/lib/client-export/sing-box.test.ts`:

```ts
import { buildSingBoxClientConfig } from "./sing-box";
import type { AggregateRule, NodeItem } from "$lib/models";

const rule: AggregateRule = {
	id: "rule-1",
	name: "Export Rule",
	nodeIds: ["node-1", "node-2"],
	subscriptionIds: [],
	excludeTagIds: [],
	renameMap: {},
	allowedTypes: [],
	prependRegionFlags: false,
	updatedAt: "2026-05-12T00:00:00.000Z",
};

const nodes: NodeItem[] = [
	{
		id: "node-1",
		name: "HK VLESS",
		type: "vless",
		raw: "vless://00000000-0000-4000-8000-000000000001@example.com:443?security=tls&sni=example.com#HK%20VLESS",
		tags: [],
		enabled: true,
		updatedAt: "2026-05-12T00:00:00.000Z",
		source: "single",
	},
	{
		id: "node-2",
		name: "TUIC",
		type: "tuic",
		raw: "tuic://token@example.com:443#TUIC",
		tags: [],
		enabled: true,
		updatedAt: "2026-05-12T00:00:00.000Z",
		source: "single",
	},
];

describe("buildSingBoxClientConfig", () => {
	it("builds a complete runnable sing-box config from an aggregate rule", async () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", "2026-05-12T00:00:00.000Z");
		const result = await buildSingBoxClientConfig(profile, rule, nodes, []);

		expect(result.errors).toEqual([]);
		expect(result.totalLines).toBe(2);
		expect(result.outbounds).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.warnings[0]).toContain("Unsupported protocol");

		const config = result.config as any;
		expect(config.inbounds[0]).toMatchObject({
			type: "mixed",
			tag: "mixed-in",
			listen: "127.0.0.1",
			listen_port: 2080,
		});
		expect(config.outbounds[0]).toMatchObject({
			type: "selector",
			tag: "proxy",
			outbounds: ["auto", "HK VLESS", "direct", "block"],
		});
		expect(config.outbounds[1]).toMatchObject({
			type: "urltest",
			tag: "auto",
			outbounds: ["HK VLESS"],
		});
		expect(config.route.final).toBe("proxy");
		expect(JSON.parse(result.content)).toEqual(config);
	});

	it("returns a blocking error when no supported outbounds exist", async () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", "2026-05-12T00:00:00.000Z");
		const unsupportedRule = { ...rule, nodeIds: ["node-2"] };
		const result = await buildSingBoxClientConfig(profile, unsupportedRule, nodes, []);

		expect(result.errors).toContain("No supported outbounds can be generated");
		expect(result.content).toBe("");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/lib/client-export/sing-box.test.ts
```

Expected: FAIL because `sing-box.ts` does not exist.

- [ ] **Step 3: Implement config generator**

Create `src/lib/client-export/sing-box.ts`:

```ts
import type {
	AggregateRule,
	ClientExportProfile,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";
import { buildAggregateOutput } from "$lib/aggregate";
import { inferNodeNameFromRaw } from "$lib/subscription";
import { validateSingBoxClientProfile } from "./profile";
import {
	parseProxyUriToSingBoxOutbound,
	type SingBoxOutbound,
} from "./uri";

export type SingBoxClientBuildResult = {
	content: string;
	config: unknown;
	totalLines: number;
	outbounds: number;
	skipped: number;
	warnings: string[];
	errors: string[];
};

function uniqueTag(baseTag: string, usedTags: Set<string>): string {
	const trimmed = baseTag.trim() || "proxy";
	if (!usedTags.has(trimmed)) {
		usedTags.add(trimmed);
		return trimmed;
	}

	let index = 2;
	while (usedTags.has(`${trimmed} ${index}`)) {
		index += 1;
	}
	const next = `${trimmed} ${index}`;
	usedTags.add(next);
	return next;
}

function buildConfig(profile: ClientExportProfile, remoteOutbounds: SingBoxOutbound[]): unknown {
	const remoteTags = remoteOutbounds.map((outbound) => outbound.tag);
	const selectorTag = profile.options.selectorTag;
	const urlTestTag = profile.options.urlTestTag;

	const config: Record<string, unknown> = {
		log: {
			level: "info",
			timestamp: true,
		},
		dns: {},
		inbounds: [
			{
				type: "mixed",
				tag: "mixed-in",
				listen: profile.options.listenAddress,
				listen_port: profile.options.listenPort,
			},
		],
		outbounds: [
			{
				type: "selector",
				tag: selectorTag,
				outbounds: [urlTestTag, ...remoteTags, "direct", "block"],
			},
			{
				type: "urltest",
				tag: urlTestTag,
				outbounds: remoteTags,
			},
			...remoteOutbounds,
			{
				type: "direct",
				tag: "direct",
			},
			{
				type: "block",
				tag: "block",
			},
			{
				type: "dns",
				tag: "dns-out",
			},
		],
		route: {
			final: selectorTag,
		},
	};

	if (profile.options.includeExperimental) {
		config.experimental = {
			cache_file: {
				enabled: true,
			},
			clash_api: {},
		};
	}

	return config;
}

export async function buildSingBoxClientConfig(
	profile: ClientExportProfile,
	rule: AggregateRule | undefined,
	nodes: NodeItem[],
	subscriptions: SubscriptionItem[],
): Promise<SingBoxClientBuildResult> {
	const profileErrors = validateSingBoxClientProfile(profile).errors;
	if (!rule) {
		profileErrors.push("Select an Aggregate rule");
	}
	if (profileErrors.length > 0 || !rule) {
		return {
			content: "",
			config: null,
			totalLines: 0,
			outbounds: 0,
			skipped: 0,
			warnings: [],
			errors: profileErrors,
		};
	}

	const aggregate = await buildAggregateOutput(rule, nodes, subscriptions);
	const warnings = [...aggregate.warnings];
	if (aggregate.errors.length > 0) {
		return {
			content: "",
			config: null,
			totalLines: 0,
			outbounds: 0,
			skipped: 0,
			warnings,
			errors: aggregate.errors,
		};
	}

	const lines = aggregate.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const usedTags = new Set<string>([
		profile.options.selectorTag,
		profile.options.urlTestTag,
		"direct",
		"block",
		"dns-out",
	]);
	const remoteOutbounds: SingBoxOutbound[] = [];
	let skipped = 0;

	for (const line of lines) {
		const displayName = inferNodeNameFromRaw(line, "proxy");
		const tag = uniqueTag(displayName, usedTags);
		const parsed = parseProxyUriToSingBoxOutbound(line, tag);
		if (!parsed.outbound) {
			skipped += 1;
			if (parsed.warning) {
				warnings.push(parsed.warning);
			}
			continue;
		}
		remoteOutbounds.push(parsed.outbound);
	}

	if (remoteOutbounds.length === 0) {
		return {
			content: "",
			config: null,
			totalLines: lines.length,
			outbounds: 0,
			skipped,
			warnings,
			errors: ["No supported outbounds can be generated"],
		};
	}

	const config = buildConfig(profile, remoteOutbounds);
	return {
		content: `${JSON.stringify(config, null, 2)}\n`,
		config,
		totalLines: lines.length,
		outbounds: remoteOutbounds.length,
		skipped,
		warnings,
		errors: [],
	};
}
```

- [ ] **Step 4: Run focused test**

Run:

```bash
bun test src/lib/client-export/sing-box.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-export/sing-box.ts src/lib/client-export/sing-box.test.ts
git commit -m "feat: build sing-box client config"
```

## Task 5: Add Exports Navigation and Page Source Tests

**Files:**
- Modify: `src/routes/+layout.svelte`
- Modify: `src/routes/layout-source.test.ts`
- Create: `src/routes/exports/page-source.test.ts`
- Create: `src/routes/exports/+page.svelte`

- [ ] **Step 1: Add failing source tests**

Append to `src/routes/layout-source.test.ts`:

```ts
test("primary navigation includes exports between aggregate and gists", () => {
	const aggregateIndex = layoutSource.indexOf('{ href: "/aggregate", label: "Aggregate"');
	const exportsIndex = layoutSource.indexOf('{ href: "/exports", label: "Exports"');
	const gistsIndex = layoutSource.indexOf('{ href: "/gists", label: "Gists"');

	expect(aggregateIndex).toBeGreaterThan(-1);
	expect(exportsIndex).toBeGreaterThan(aggregateIndex);
	expect(gistsIndex).toBeGreaterThan(exportsIndex);
});
```

Create `src/routes/exports/page-source.test.ts`:

```ts
// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("exports page is based on aggregate rules and sing-box profiles", () => {
	expect(pageSource).toContain("sing-box Client");
	expect(pageSource).toContain("Source Aggregate Rule");
	expect(pageSource).toContain("buildSingBoxClientConfig");
	expect(pageSource).toContain("clientExports");
});

test("exports page exposes copy download and publish actions", () => {
	expect(pageSource).toContain("Copy");
	expect(pageSource).toContain("Download");
	expect(pageSource).toContain("Publish");
	expect(pageSource).toContain("Workspace");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test src/routes/layout-source.test.ts src/routes/exports/page-source.test.ts
```

Expected: FAIL because the nav item and page do not exist.

- [ ] **Step 3: Add nav item**

In `src/routes/+layout.svelte`, add an icon import if needed. Reuse `workflow` if no better Octicon exists, or add `fileCode` from `$lib/octicons`. Then update `navItems`:

```ts
const navItems = [
	{ href: "/", label: "Overview", icon: home },
	{ href: "/nodes", label: "Nodes", icon: server },
	{ href: "/aggregate", label: "Aggregate", icon: workflow },
	{ href: "/exports", label: "Exports", icon: fileCode },
	{ href: "/gists", label: "Gists", icon: code },
	{ href: "/auth", label: "Settings", icon: gear },
];
```

- [ ] **Step 4: Create minimal Exports page shell**

Create `src/routes/exports/+page.svelte` with a compile-safe page shell:

```svelte
<script lang="ts">
import { t } from "$lib/i18n";
import { appState } from "$lib/stores/app";
import Octicon from "$lib/components/Octicon.svelte";
import { copy, download, fileCode, upload } from "$lib/octicons";
import { buildSingBoxClientConfig } from "$lib/client-export/sing-box";

$: selectedRuleId = $appState.aggregates[0]?.id ?? "";
$: selectedRule = $appState.aggregates.find((rule) => rule.id === selectedRuleId);
$: profileCount = $appState.clientExports.length;
</script>

<svelte:head>
	<title>{$t("Exports")} - SubMan</title>
</svelte:head>

<div class="space-y-4">
	<div class="gh-box">
		<div class="gh-box-header">
			<div class="flex items-center gap-2">
				<Octicon icon={fileCode} className="h-4 w-4" />
				<span>{$t("sing-box Client")}</span>
				<span class="gh-counter">{profileCount}</span>
			</div>
		</div>
		<div class="p-4">
			<label class="gh-label-block" for="export-rule">{$t("Source Aggregate Rule")}</label>
			<select id="export-rule" class="gh-select mt-2 w-full" bind:value={selectedRuleId}>
				{#each $appState.aggregates as rule}
					<option value={rule.id}>{rule.name}</option>
				{/each}
			</select>
			<p class="mt-2 text-sm text-fg-muted">
				{selectedRule ? selectedRule.name : $t("Create an Aggregate rule before exporting.")}
			</p>
		</div>
	</div>

	<div class="gh-box">
		<div class="gh-box-header">{$t("Actions")}</div>
		<div class="gh-toolbar p-4">
			<button type="button" class="gh-btn">
				<Octicon icon={copy} className="h-4 w-4" />
				{$t("Copy")}
			</button>
			<button type="button" class="gh-btn">
				<Octicon icon={download} className="h-4 w-4" />
				{$t("Download")}
			</button>
			<button type="button" class="gh-btn gh-btn-primary">
				<Octicon icon={upload} className="h-4 w-4" />
				{$t("Publish")}
			</button>
			<span class="text-sm text-fg-muted">{$t("Workspace")}</span>
		</div>
	</div>
</div>
```

- [ ] **Step 5: Run source tests**

Run:

```bash
bun test src/routes/layout-source.test.ts src/routes/exports/page-source.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/+layout.svelte src/routes/layout-source.test.ts src/routes/exports/+page.svelte src/routes/exports/page-source.test.ts
git commit -m "feat: add exports navigation shell"
```

## Task 6: Implement Exports Page Behavior

**Files:**
- Modify: `src/routes/exports/+page.svelte`
- Modify: `src/lib/i18n.ts`
- Modify: `src/routes/exports/page-source.test.ts`

- [ ] **Step 1: Replace shell with functional page state**

In `src/routes/exports/+page.svelte`, implement state for:

```ts
let selectedProfileId = "";
let previewContent = "";
let previewWarnings: string[] = [];
let previewErrors: string[] = [];
let totalLines = 0;
let outboundCount = 0;
let skippedCount = 0;
let publishing = false;
```

Add derived selected profile and selected rule:

```ts
$: selectedProfile = $appState.clientExports.find((profile) => profile.id === selectedProfileId);
$: selectedRule = $appState.aggregates.find((rule) => rule.id === selectedProfile?.ruleId);
```

If no profile exists and a rule exists, show a `New profile` action that calls `createDefaultSingBoxClientProfile($appState.aggregates[0].id, nowIso())` and `upsertClientExport()`.

- [ ] **Step 2: Add preview generation**

Add this function:

```ts
async function refreshPreview() {
	if (!selectedProfile) {
		previewContent = "";
		previewWarnings = [];
		previewErrors = [$t("Create an export profile first")];
		return;
	}

	const result = await buildSingBoxClientConfig(
		selectedProfile,
		selectedRule,
		$appState.nodes,
		$appState.subscriptions,
	);
	previewContent = result.content;
	previewWarnings = result.warnings;
	previewErrors = result.errors;
	totalLines = result.totalLines;
	outboundCount = result.outbounds;
	skippedCount = result.skipped;
}
```

- [ ] **Step 3: Add copy and download handlers**

Add:

```ts
async function copyPreview() {
	await refreshPreview();
	if (!previewContent) return;
	await navigator.clipboard.writeText(previewContent);
	showToast($t("Copied sing-box config"), "success");
}

async function downloadPreview() {
	await refreshPreview();
	if (!previewContent || !selectedProfile) return;

	const blob = new Blob([previewContent], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = normalizeExportFileName(selectedProfile.fileName) || "sing-box-client.json";
	link.click();
	URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Add publish handler**

Add imports for `authState`, Gist helpers, `exportSyncState`, `WORKSPACE_FILE`, `nowIso`, and `showToast`. Add:

```ts
async function publishPreview() {
	if (!$authState.token || !selectedProfile) return;
	publishing = true;
	try {
		const result = await buildSingBoxClientConfig(
			selectedProfile,
			selectedRule,
			$appState.nodes,
			$appState.subscriptions,
		);
		previewContent = result.content;
		previewWarnings = result.warnings;
		previewErrors = result.errors;
		totalLines = result.totalLines;
		outboundCount = result.outbounds;
		skippedCount = result.skipped;

		if (result.errors.length > 0 || !result.content) {
			showToast($t("Export failed: {error}", { error: result.errors[0] ?? "Unknown error" }), "error");
			return;
		}

		const now = nowIso();
		const fileName = normalizeExportFileName(selectedProfile.fileName);
		const nextProfile = { ...selectedProfile, lastGeneratedAt: now, updatedAt: now };
		const stateForSync = { ...$appState, clientExports: $appState.clientExports.map((profile) => profile.id === nextProfile.id ? nextProfile : profile) };
		const files = {
			[fileName]: { content: result.content },
			[WORKSPACE_FILE]: { content: exportSyncState(stateForSync) },
		};
		const response = $appState.activeGistId
			? await updateGist($authState.token, { gistId: $appState.activeGistId, files })
			: await createGist($authState.token, { description: "SubMan client exports", isPublic: false, files });
		const fileMeta = response.files.find((file) => file.filename === fileName);
		const lastPublishedUrl = toStableGistRawUrl(fileMeta?.rawUrl) || null;
		upsertClientExport({
			...nextProfile,
			lastPublishedAt: now,
			lastPublishedUrl,
			updatedAt: now,
		});
		appState.update((state) => ({ ...state, activeGistId: response.id }));
		showToast($t("Published sing-box config"), "success");
	} catch (error) {
		showToast($t("Publish failed: {error}", { error: error instanceof Error ? error.message : String(error) }), "error");
	} finally {
		publishing = false;
	}
}
```

- [ ] **Step 5: Complete markup**

Render:
- Profile select and `New profile` button.
- Rule select bound to selected profile's `ruleId`.
- Inputs for name, fileName, listenAddress, listenPort, selectorTag, urlTestTag, and includeExperimental.
- Summary sidebar with `totalLines`, `outboundCount`, `skippedCount`, warning count.
- `<pre>` preview area with `previewContent || $t("Generate a preview to inspect config.json")`.
- Buttons wired to `refreshPreview`, `copyPreview`, `downloadPreview`, and `publishPreview`.

Keep Publish disabled when:

```svelte
disabled={!$authState.token || !selectedProfile || previewErrors.length > 0 || publishing}
```

- [ ] **Step 6: Add i18n strings**

In `src/lib/i18n.ts`, add translations for the exact new labels used in the page:

```ts
Exports: "导出",
"sing-box Client": "sing-box 客户端",
"Source Aggregate Rule": "来源聚合规则",
"Create an Aggregate rule before exporting.": "导出前请先创建聚合规则。",
"Create an export profile first": "请先创建导出配置。",
"Copied sing-box config": "已复制 sing-box 配置",
"Published sing-box config": "已发布 sing-box 配置",
"Generate a preview to inspect config.json": "生成预览后查看 config.json。",
"Export failed: {error}": "导出失败：{error}",
```

- [ ] **Step 7: Run focused source and Svelte checks**

Run:

```bash
bun test src/routes/exports/page-source.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/exports/+page.svelte src/routes/exports/page-source.test.ts src/lib/i18n.ts
git commit -m "feat: implement sing-box exports page"
```

## Task 7: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run full tests**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run:

```bash
bun run build
```

Expected: SvelteKit build succeeds.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: clean working tree after commits, or only intentional uncommitted files that still need a final commit.

- [ ] **Step 4: Final commit if verification required fixes**

If verification required fixes, commit them:

```bash
git add src docs
git commit -m "fix: verify sing-box client export"
```

## Self-Review

- Spec coverage: The plan covers `Exports` nav, persisted profiles, generation from Aggregate rules, sing-box full config output, copy/download/publish behavior, Workspace Gist publishing, warnings/errors, and tests.
- Placeholder scan: No `TBD`, `TODO`, or open-ended implementation steps remain.
- Type consistency: The plan uses `ClientExportProfile`, `SingBoxClientExportOptions`, and `buildSingBoxClientConfig()` consistently across model, generator, and page tasks.
