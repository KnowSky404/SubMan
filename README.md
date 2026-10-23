# SubMan

English | [简体中文](README.zh-CN.md)

[Documentation](docs/README.md) · [Server API](docs/api/server-api.md) · [sing-box-vps integration](docs/integrations/sing-box-vps.md)

A proxy subscription manager for VLESS, VMess, TUIC, AnyTLS, and more, with
sing-box client exports and a trusted automation API. Built with SvelteKit on
Cloudflare Workers, SubMan keeps business data in one private GitHub Gist.
A SQLite-backed Durable Object coordinates every revisioned write.

Default workspace identity:

- Description: `SubMan-Data`
- Config file: `subman.json`

## Key Features

- One cloud data source: one bound private GitHub Gist with authoritative business data in `subman.json`
- Fresh reads: load the latest cloud data on startup before allowing edits
- Immediate synchronization: journal every change transactionally, then send it to the Cloudflare Durable Object and wait for cloud confirmation
- Recovery: retry the original request after a network failure; resolve a revision conflict by confirming complete-queue discard and loading the latest cloud state
- One binding: no Workspace list or switching; retained historical queues remain available for recovery inspection
- Nodes and subscriptions: add, edit, enable/disable, tag, search, and filter
- Batch import: multi-line import with dedupe and preview; supports base64 subscription content
- Aggregation rules: select nodes/subscriptions, exclude tags, filter by proxy types, regex renaming, region flags
- sing-box client exports against an explicit sing-box 1.14 target: VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC, and AnyTLS; SSR remains aggregatable but is skipped with a warning
- Result sorting: support automatic sorting by name, protocol, or region (flags), and fully custom ordering via priority keywords or manual drag-and-drop
- Custom region rules: custom flag map with built-in template and lookup
- Publish targets: bind a rule to multiple targets with filename, description, and visibility metadata; outputs use the current Workspace Gist and inherit its actual GitHub visibility
- Stable links: same Gist + same file name keeps a stable raw URL; rename guidance with cleanup outcomes
- Workspace file manager: list files, copy raw links, delete outputs, clean non-config files in bulk
- Auto-cleanup mechanism: automatically remove invalid associations in aggregate rules when nodes or subscriptions are deleted
- Activity log: records workspace setup, sync, and repair actions

## Typical Flow

Connect GitHub and load cloud data before managing nodes, subscriptions, or
rules. There is no local business mode, JSON business backup or restore, manual
push, or local overwrite/merge flow. Browser caches and delivery journals serve
synchronization reliability.

1. Save a GitHub token in `/auth` (requires `gist` scope; session-only unless Remember token is selected), verify the one Gist identity, and wait for the cloud load. Enter the original Gist ID if discovery finds multiple documents; setup does not choose one arbitrarily or create another
2. Add nodes and subscriptions in `/nodes` (batch import supported)
3. Build rules in `/aggregate`, configure sorting and renaming, then preview output
4. Select an aggregate rule in `/exports`, then preview, copy, or download a sing-box config
5. Create publish targets and publish to the workspace gist, then copy the stable subscription link

## Pages

- `/auth`: cloud connection, sync status, cloud reload, legacy upgrade, and safe diagnostics
- `/gists`: workspace file list, raw link copy, file cleanup
- `/nodes`: nodes and subscriptions management (search, filters, batch import)
- `/aggregate`: rule editor, visual drag-and-drop sorting, publish target management, output publishing
- `/exports`: sing-box client configuration preview, copy, download, and Workspace publishing

## Aggregation and Publishing

- Rule options: node/subscription selection, tag exclusions, proxy type filtering, regex renaming map
- Sorting engine: hybrid sort mode supporting priority keywords and syncing manual preview reordering to config
- Subscription fetch: pulls subscription URLs at publish time and decodes base64 content when detected
- Subscription limits: browser fetches use a 15 second timeout and 4 MiB response limit, with separate CORS/network, HTTP, size, encoding, and empty-content states
- Region flags: detect region keywords in names and prepend flags automatically
- Preview: line count, protocol hints, warnings, and errors; supports real-time drag-and-drop reordering
- sing-box export: TUIC and AnyTLS use the current outbound field mappings; SSR and unknown or malformed lines do not block other convertible entries
- Publish strategy: keep file name for stable links; renames create a new stable link and provide cleanup guidance

## Workspace Model

- Initial setup discovers the fixed identity or checks an explicit original Gist ID. Only an absent candidate permits creating an empty private bootstrap Gist; ambiguous or invalid results never select, create, or overwrite a different document
- A device keeps one Gist binding across login and token replacement. Workspace lists, switching, and rebinding controls are removed
- Startup loads the latest cloud snapshot before editing. Legacy manual bindings return to automatic delivery only after a safe refresh; a browser cache is not a business data source
- Browser and Server API changes use `WorkspaceCoordinator`, the sole `subman.json` writer. Configuration and output changes use one revisioned Gist commit
- Each business action sends immediately and waits for cloud confirmation. Queued, peer-owned, and retry-scheduled results retain the original mutation ID and do not report a successful save
- Pending or blocked delivery prevents further business changes. Retry the original request after reconnecting; abandoning work requires confirmation to discard the complete queue and reload cloud data
- There is no local overwrite, merge, bind-only, manual-sync, or business JSON backup/import flow
- `subman.json`, `subman.v1.backup.json`, and `subman.bootstrap.json` are reserved and cannot be used as outputs or deleted from the file manager
- Recognized V1 data requires a migration preview and confirmation in the original Gist, preserving exact backup bytes, output filenames/content, publication timestamps, and URLs
- Bootstrap starts from empty cloud data instead of uploading a previous browser cache. Historical queues for other Gists remain recovery evidence and are never automatically rebound or delivered

See [Workspace V2 Operations](docs/workspace-v2-operations.md) for deployment,
migration verification, and rollback.
If historical rules or publication records disappear after an upgrade, follow
the [legacy data migration guide](docs/legacy-workspace-migration.md)
to check Gist identity, document validity, and output files. It includes an
operator-only offline audit and V1 recovery workflow.
See the [Roadmap](docs/ROADMAP.md) for current work and deferred protocol items.
See [sing-box Export](docs/sing-box-export.md) for the protocol matrix,
subscription CORS/size limits, and the export publication boundary.

## FAQ

### Why are old rules or publication records missing while Gist output files remain?

Rules and last-publication metadata come from `subman.json` collections
`aggregates`, `publishTargets`, and `clientExports`. Output files do not reconstruct
those records. Early versions did not persist publish targets; fixed Gist identity,
strict validation, and browser cache migration can also prevent old data from loading.
Back up the sources and follow the [migration guide](docs/legacy-workspace-migration.md)
before overwriting a Gist. Recognized V1 documents require upgrade confirmation; arbitrary historical
files are not guaranteed to load.

### Which data wins when the cloud and browser cache differ?

Cloud `subman.json` is authoritative. Startup and Reload from Cloud load its latest
state. Connecting does not upload old cached data. Each change supplies
`expectedRevision`; the coordinator accepts only the next change for that
revision, and remote tombstones prevent old cached entities from returning.

### What happens to an operation when the network fails?

A request that reached the local transaction remains in the technical delivery
journal and retries with the same mutation ID. Queued, peer-owned, and retrying
states are not successful saves; only `remote-committed` proves cloud persistence.
Further business changes wait for settlement. No JSON backup or restore is needed.

### What happens when another device changes the cloud data?

A revision conflict pauses delivery and retains pending work. Review recovery
metadata, then confirm whether to discard the complete pending queue and reload
the latest cloud state. Reapply any intended edit against that state. Local
overwrite, merge, bind-only, and manual synchronization controls are removed.

### What if the account contains several SubMan Gists?

Enter the original Gist ID during initial setup. The device keeps that one
binding; login, token replacement, and a temporarily inaccessible Gist never
silently select or create another one. Historical queues for other Gists remain
visible as recovery evidence and are not sent automatically.

## Development

Use Bun **1.3.14**, as declared by `package.json` and CI, with the lockfile:

```bash
bun install --frozen-lockfile
bun run dev -- --host :: --port 5173
```

Vite is the fast UI development path; use `dev:cf` for Worker routes, SQLite,
and coordinator behavior. Build before previewing, in a separate terminal or
after stopping the development server:

```bash
bun run build
bun run preview -- --host :: --port 4173
```

On this VPS open `http://oc-de-fra-1.knowsky.uk:5173` or
`http://oc-de-fra-1.knowsky.uk:4173`. Inspect the listener with `ss -lntp`;
if it accepts IPv6 only, verify IPv4 separately with `--host 0.0.0.0`.

Full local verification:

```bash
bun test
bun run test:sing-box
bun run check
bun run lint
bun run build
bun run test:cf
bun run test:e2e
bun run deploy:check
```

`check` includes generated Worker type verification. Regenerate types with
`bun run generate:worker-types` after binding changes. The sing-box gate needs
Docker; prepare Chromium and system dependencies for E2E with
`bunx playwright install --with-deps chromium`.

GitHub Actions runs the same checks with a digest-pinned sing-box 1.14.0
container and synthetic exporter data. It does not read repository secrets,
fetch a real subscription, deploy, or touch a real Gist.

## Cloudflare Workers Deployment

Complete the gates above and verify the account, Worker, routes, and bindings.
The deploy script already builds and uses Wrangler `--strict`. Run only after
explicit authorization for the production change:

```bash
bun run deploy
```

Local preview for Workers:
```bash
bun run dev:cf -- --ip :: --port 8787
```

On this VPS open `http://oc-de-fra-1.knowsky.uk:8787`. This uses local simulated
bindings; do not configure a real GitHub token for test writes. Unit, Cloudflare,
and browser tests use synthetic data or mocks. `deploy:check` validates packaging
without uploading and does not prove production resource health. Production
GitHub Actions deployment is manual; see [CI/CD](docs/ci-cd.md).

Worker Observability is enabled with structured logs. Application events use
an allowlisted set of operation, revision, error-class, and safe GitHub fields;
Workspace identifiers are hashed, and tokens, raw mutations, full documents,
outputs, and exception messages are excluded. Regenerate types with
`bun run generate:worker-types`; the compatibility date should change only
after the complete runtime gates pass.

## Server API

For server provisioning tools, start with the
[sing-box-vps integration guide](docs/integrations/sing-box-vps.md), including
caller limits, revision checks, conditional deletion, and uncertain-write recovery.

SubMan can expose owner-operated API endpoints for backend scripts such as
`sing-box-vps`. See the full API reference in
[docs/api/server-api.md](docs/api/server-api.md) and the machine-readable
[OpenAPI 3.1 contract](docs/api/openapi.yaml). The staged design for future
resource endpoints is in the [API Roadmap](docs/api/roadmap.md).

Usage flow:

1. Create a GitHub token with `gist` permission.
2. Create a long custom `SUBMAN_API_TOKEN` for scripts that call SubMan.
3. Store both values as Cloudflare Worker secrets:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

4. Deploy after explicit production authorization (setting secrets also changes the remote Worker):

```bash
bun run deploy
```

5. Check API configuration:

```bash
curl -sS "https://subman.example.com/api/health"
```

An `ok: true` response means both `GITHUB_TOKEN` and `SUBMAN_API_TOKEN` are
configured. It does not verify GitHub permissions, Workspace identity, or write readiness.

6. Use `SUBMAN_API_TOKEN` from your backend script to sync a node:

```bash
curl --fail-with-body -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://11111111-1111-4111-8111-111111111111@vps.example.com:443?security=tls&sni=vps.example.com#vps-1","enabled":true,"tags":["sing-box-vps"]}'
```

Scripts should prefer `PUT /api/nodes/by-key/:externalKey` because one stable
`externalKey` always addresses the same node instead of creating duplicates.
This is resource-identity idempotency, not request-replay idempotency: every
successful update may advance the Workspace revision, and the API does not
currently support `Idempotency-Key`.
When nodes are created or updated through either the UI or API, duplicate names
receive a timestamp suffix so aggregate filtering remains distinguishable.
Duplicate raw URIs are treated as duplicate content and rejected.

By-key PUT replaces writable fields; omitted tags, enabled, and source use create
defaults. URL-encode keys once. New/changed keys fit 119 UTF-8 bytes, with at most
63 ordinary tags to leave room for the generated `external:` marker. PATCH tags
replace the full list, including that marker; use by-key PUT for managed-node
tags. Node updates do not republish aggregate or sing-box output files.

The API discovers Workspaces using Worker credentials, independently of browser
bindings. Check `workspace.gistId` before writing. Node GET can create a bootstrap
Gist when no Workspace exists; multiple/invalid candidates return sanitized
`502 gist_read_failed`. Health only checks secret presence: HTTP 200 or `ok: true`
does not prove GitHub access or write readiness.

`GITHUB_TOKEN` stays in Cloudflare Secrets. External scripts do not need and
should not hold the GitHub token.
Node API write `2xx` responses mean the coordinator committed and read-back verified
the remote Workspace. Responses include an `ETag` and `X-SubMan-Revision`;
clients may send that ETag in `If-Match` on a write and receive
`412 precondition_failed` when it is stale. A timeout, 5xx, or lost write response
may follow a commit; re-read state before deciding to replay.

`SUBMAN_API_TOKEN` is one shared, full-access bearer without scopes, per-client
revocation, or caller rate limits. Give it only to trusted backend scripts over
TLS and rotate it periodically. CORS is not an authentication boundary.

The supported public integration surface currently covers health and node
CRUD/external-key updates only. Subscriptions, aggregates, publication, and
exports do not yet have public REST endpoints. External programs must not PATCH
the Gist directly or call the internal browser mutation route at
`/api/workspaces/:workspaceId/mutations`.

See the [API Roadmap](docs/api/roadmap.md) for the staged design of future
subscription, aggregate, publication, and export endpoints.

## Browser Storage and Recovery

- Business snapshots, bindings, per-Workspace queues, retry/blocked metadata,
  leases, and migration evidence share the `subman-workspace` IndexedDB v1 root.
- Legacy localStorage data migrates through `copied -> validated -> confirmed`.
  Storage, quota, upgrade, or corruption failures enter read-only repair mode;
  there is no split-write localStorage fallback.
- GitHub tokens stay outside IndexedDB, mutations, SQLite, logs, and diagnostics.
  Session storage is the default. Explicit persistent token storage is readable
  to same-origin JavaScript and cannot protect against active XSS.
- Diagnostics export counts, safe metadata, payload byte lengths/hashes, retry
  classifications, and quarantine metadata. They do not include recovery data,
  raw payloads, quarantine contents, credentials, or error stacks.
- Settings no longer exports or imports business JSON. Historical
  `subman-business-configuration` files are not Workspace documents and cannot
  replace `subman.json`; diagnostics cannot restore business data either.
- Only `remote-committed` proves browser publication. Locally saved, queued,
  peer-owned, or retry-scheduled work still needs delivery; keep the original
  mutation ID and repair complete Workspace queues.
- Response security headers and UTF-8/count limits are part of the contract.
  Unchanged oversized legacy fields may remain readable; new/edited values must
  meet current limits.

See [Workspace V2 Operations](docs/workspace-v2-operations.md) for repair and
rollback. For an offline audit of a downloaded configuration, run:

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json --gist-id YOUR_GIST_ID
```

This checks schema and identity without network requests. It does not verify
output contents, URL availability, or publication freshness. The
[legacy migration guide](docs/legacy-workspace-migration.md) explains operator
recovery, V1 migration, and preserving old subscription links.

## Documentation and Language

English is the default documentation language. Choose **简体中文** at the top of
a maintained guide to open its Chinese version. The
[documentation index](docs/README.md) lists both languages for the README, API,
integration, operations, migration, export, roadmap, and agent guides.
`README.en.md` remains a compatibility link to this English README.
Historical design plans retain their original language and describe the design
at their recorded date; the maintained guides document current behavior.

## AI / Agent Adaptation

This repository includes project context and a skill for automation agents such
as Codex and Hermes agents:

- Agent Guide: [docs/agents/subman-agent-guide.md](docs/agents/subman-agent-guide.md)
- Project Skill: [docs/agents/subman-skill/SKILL.md](docs/agents/subman-skill/SKILL.md)
- sing-box Export: [docs/sing-box-export.md](docs/sing-box-export.md)

These documents cover the Workspace Gist, Cloudflare Workers deployment, Server
API automation, key source paths, and development boundaries.

## Stack

- SvelteKit + TypeScript
- TailwindCSS v4
- Biome
- bun

## License

GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).

## Conventions

- Keep code ASCII-only
- Commit after each independent feature or fix
- Keep business data and outputs in the one bound cloud Gist; IndexedDB holds caches, delivery journals, and recovery evidence
