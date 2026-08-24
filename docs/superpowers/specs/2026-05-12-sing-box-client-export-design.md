# sing-box Client Export for SubMan

## Overview
SubMan should add a client configuration export feature for sing-box bare-core clients. The first version will generate a complete runnable `config.json` from an existing Aggregate rule, then let users copy, download, or publish that file to the Workspace Gist.

The design follows the direction used by `KnowSky404/sing-box-vps`: export a full client config rather than asking users to assemble outbound fragments manually. SubMan will adapt that idea to its existing browser-only, Gist-first workflow.

## Goals
- Add a top-level export workflow without overloading the existing Aggregate page.
- Reuse Aggregate rules as the source of selected nodes, subscriptions, filtering, renaming, and ordering.
- Generate a complete sing-box client configuration with local inbound, DNS, selector, urltest, real proxy outbounds, direct, block, route, and optional experimental settings.
- Support copy and download in local mode.
- Support optional publishing to the same Workspace Gist when GitHub Workspace is connected.
- Keep sing-box generation logic independent from Svelte UI and GitHub API calls.

## Non-Goals
- Do not add Clash, Mihomo, Surge, or other client formats in the first version.
- Do not implement China mainland split routing in the first version.
- Do not add a separate node-selection model inside Exports.
- Do not require GitHub login for local generation, preview, copy, or download.
- Do not validate the generated JSON by running the sing-box binary in the browser.

## Menu and Routing
Add a new top-level navigation item named `Exports` between `Aggregate` and `Gists`:

`Overview / Nodes / Aggregate / Exports / Gists / Settings`

Add a new route:

- [`src/routes/exports/+page.svelte`](/root/Clouds/SubMan/src/routes/exports/+page.svelte)

The first version of this page will contain one export type: `sing-box Client`.

## Page Layout
The Exports page should use the existing GitHub-style layout language. It should be a dense tool surface, not a marketing or landing page.

Main column:
- Export profile selector and editor.
- Source Aggregate rule selector.
- sing-box client options.
- JSON preview with copy affordance.

Right sidebar:
- Generation summary: total entries, converted outbounds, skipped entries, warning count.
- Primary actions: Copy, Download, Publish.
- Publish state: target filename, raw URL, last published time.

Empty states:
- If there are no Aggregate rules, direct the user to create one on the Aggregate page.
- If a selected rule produces no supported nodes, show warnings and keep Publish disabled.
- If Workspace is not connected, keep Copy and Download enabled and explain that Publish needs Workspace.

## Data Model
Add a persisted export profile model:

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

Extend `AppState` with:

```ts
clientExports: ClientExportProfile[];
```

`clientExports` must be included in:
- `defaultState`
- merge behavior
- `exportSyncState`
- `importState`
- server-side workspace default state, if needed by existing API tests

This keeps export profiles synchronized through `subman.json` in both Local and Workspace modes.

## Export Profile Defaults
Default profile:

```ts
{
	name: "sing-box Client",
	type: "sing-box-client",
	fileName: "sing-box-client.json",
	options: {
		listenAddress: "127.0.0.1",
		listenPort: 2080,
		inboundType: "mixed",
		dnsMode: "conservative",
		routeMode: "global-proxy",
		includeExperimental: true,
		selectorTag: "proxy",
		urlTestTag: "auto"
	}
}
```

The filename should be user-editable but normalized enough to avoid empty names and accidental `subman.json` replacement.

## Generator Architecture
Add focused modules under `src/lib/client-export/`:

- `sing-box.ts`
  - Builds the complete sing-box client config.
  - Accepts an Aggregate rule, node state, subscription state, and export options.
  - Returns generated JSON plus warnings and conversion metrics.

- `uri.ts`
  - Parses supported proxy URI lines into sing-box outbound objects.
  - Does not know about Gists, Svelte stores, or UI state.

- `profile.ts`
  - Provides default options, profile creation helpers, validation, and filename checks.

Suggested result type:

```ts
export type SingBoxClientBuildResult = {
	content: string;
	config: unknown;
	totalLines: number;
	outbounds: number;
	skipped: number;
	warnings: string[];
	errors: string[];
};
```

The page should call the generator and then decide whether to preview, copy, download, or publish.

## Input Flow
Exports will not perform its own node and subscription selection. It will:

1. Load the selected `AggregateRule`.
2. Call the existing `buildAggregateOutput(rule, nodes, subscriptions)`.
3. Parse the resulting URI lines into sing-box outbounds.
4. Generate a complete client config from those outbounds.

This preserves the current Aggregate behavior for:
- enabled node filtering
- subscription loading
- tag exclusions
- rename rules
- allowed protocol filtering
- region flags
- custom sorting

If Aggregate output contains invalid or unsupported lines, the sing-box generator skips those lines and records warnings.

## Generated sing-box Config Shape
The first version outputs a complete runnable config:

```json
{
  "log": {
    "level": "info",
    "timestamp": true
  },
  "dns": {},
  "inbounds": [
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "127.0.0.1",
      "listen_port": 2080
    }
  ],
  "outbounds": [
    {
      "type": "selector",
      "tag": "proxy",
      "outbounds": ["auto"]
    },
    {
      "type": "urltest",
      "tag": "auto",
      "outbounds": []
    },
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "block",
      "tag": "block"
    },
    {
      "type": "dns",
      "tag": "dns-out"
    }
  ],
  "route": {
    "final": "proxy"
  },
  "experimental": {
    "cache_file": {
      "enabled": true
    },
    "clash_api": {}
  }
}
```

Real remote outbounds are inserted after selector and urltest. The selector should include `auto`, each real outbound tag, `direct`, and `block`. The urltest should include only real remote outbound tags.

## Supported Protocol Scope
The parser should start with protocols already represented in SubMan's node model and common subscription output:

- VLESS
- VMess
- Trojan
- Shadowsocks
- Hysteria2

The current implementation extends this initial scope with TUIC and AnyTLS
mapping. ShadowsocksR remains in the model for import and aggregation, but is
skipped from sing-box output with a clear warning because the upstream
sing-box outbound is deprecated. `other` and malformed lines remain
warning-first and are skipped.

The implementation should be structured so more protocols can be added in `uri.ts` without changing the page.

## Publishing
Publishing writes to the same Workspace Gist:

- `subman.json`: updated serialized app state, including export profiles.
- `profile.fileName`: generated sing-box client config.

Publishing reuses existing Gist helpers:
- `createGist`
- `updateGist`
- `toStableGistRawUrl`

The generator must not call GitHub APIs directly.

Publish flow:

1. Ensure GitHub token and Workspace state are available.
2. Generate the current config from the selected profile and rule.
3. Write both `subman.json` and the generated config file.
4. Store `lastPublishedAt` and `lastPublishedUrl` on the export profile.
5. Show success or failure through the existing toast store.

Copy and download must work without publishing.

## Error Handling
Generation should separate errors from warnings:

- Errors block output and publishing.
- Warnings allow output but show skipped or degraded entries.

Blocking errors:
- Missing selected Aggregate rule.
- Aggregate generation fails.
- No supported outbound can be generated.
- Invalid listen port.
- Empty or protected output filename.

Warnings:
- Unsupported protocol line.
- Invalid URI line.
- Missing optional URI fields that can be safely defaulted.
- Duplicate outbound tag requiring suffix normalization.

## Testing Strategy
Add unit tests for generator behavior:

- VLESS, VMess, Trojan, Shadowsocks, and Hysteria2 URI lines become sing-box outbounds.
- Selector and urltest reference generated outbound tags correctly.
- Unsupported and invalid URI lines are skipped with warnings.
- Duplicate display names generate stable unique tags.
- Invalid profile options produce blocking errors.

Add source-level page tests:

- Layout navigation includes `Exports`.
- Exports page includes Aggregate rule selection.
- Exports page exposes Copy, Download, and Publish actions.
- Publish action is gated by Workspace availability.

Add serialization and store tests:

- `clientExports` is preserved through `exportSyncState` and `importState`.
- default state includes an empty `clientExports` array.
- merge behavior preserves profiles by `updatedAt`.

Verification should include:

- `bun test`
- `bun run build`

## Success Criteria
- Users can create or edit a sing-box client export profile.
- Users can select an existing Aggregate rule as the input source.
- Users can preview, copy, and download a complete sing-box client `config.json` in Local mode.
- Workspace users can publish the config into the active Workspace Gist and receive a stable raw URL.
- Unsupported nodes do not break the whole export when at least one supported node remains.
- The feature is isolated enough to add more client export formats later.
