# SubMan Agent Guide

This guide is the entry point for AI agents, automation runners, and retrieval
systems that need to understand or operate this repository.

## Project Shape

SubMan is a Gist-first proxy subscription manager. The browser UI manages nodes,
subscriptions, aggregate rules, publish targets, and workspace sync state. The
same SvelteKit app also exposes a small owner-operated Server API for trusted
backend automation.

The canonical workspace is a GitHub Gist with:

- Description: `SubMan-Data`
- Config file: `subman.json`

Browser business state always uses the transactional `subman-workspace`
IndexedDB database. Without a GitHub token, changes remain local. With a token
and active Workspace binding, revisioned mutations synchronize to the Gist.

## Agent Entry Points

- Project rules: `AGENTS.md`
- Human README: `README.md`
- Server API: `docs/api/server-api.md`
- Machine-readable API contract: `docs/api/openapi.yaml`
- Agent skill: `docs/agents/subman-skill/SKILL.md`
- Architecture reference: `docs/agents/subman-skill/references/architecture.md`
- Deployment reference: `docs/agents/subman-skill/references/deployment.md`
- Workspace V2 operations: `docs/workspace-v2-operations.md`
- Workspace data reference: `docs/agents/subman-skill/references/workspace-data.md`
- Automation API reference: `docs/agents/subman-skill/references/server-api.md`
- sing-box export contract: `docs/sing-box-export.md`

Agents that support skills should load `docs/agents/subman-skill/SKILL.md` when
working on SubMan deployment, automation, API integration, workspace sync, or
Gist-backed data changes.

## Common Commands

Use bun for project commands.

```bash
bun install
bun run dev
bun run check
bun run lint
bun run build
bun run deploy
```

Cloudflare Workers local runtime:

```bash
bun run dev:cf
```

Server API secrets:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

## Automation API Summary

Trusted backend scripts should use:

```http
PUT /api/nodes/by-key/:externalKey
Authorization: Bearer <SUBMAN_API_TOKEN>
Content-Type: application/json
```

One external key always addresses the same node. The API stores it as a node tag
label:

```text
external:<externalKey>
```

Use this endpoint for VPS installers and other repeatable node updates. Avoid
`POST /api/nodes` for automation unless duplicates are intended.

This is resource-identity idempotency, not request-replay idempotency. Every
successful update can advance the Workspace revision. A `2xx` response proves
the coordinator committed and verified the remote Workspace. Read the returned
`ETag` and optionally send it as `If-Match` on the next write; handle
`412 precondition_failed` by re-reading state. Do not blindly replay an
unknown-outcome request because `Idempotency-Key` is not supported.

Node writes share the same duplicate rules as the browser UI: duplicate names
are saved with a timestamp suffix for easier aggregate filtering, while duplicate
raw URIs are rejected with `409 duplicate_node_raw`.

Example:

```bash
curl --fail-with-body -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer ${SUBMAN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

## Development Boundaries

- Keep runtime data in the single workspace gist.
- Keep `subman.json` protected from UI deletion.
- Route every config mutation through `WorkspaceCoordinator`; do not add a
  direct full-state Gist writer.
- Prefer `PUT /api/nodes/by-key/:externalKey` for machine-created nodes.
- Treat only health and node routes as supported public API. The Workspace
  mutation route is browser-internal and must not be called by integrations.
- Branch on stable error `code` and `disposition`, not human-readable `message`.
- Handle `409 duplicate_node_raw` explicitly in automation scripts; it means the
  submitted URI is already stored on another node.
- Do not expose `GITHUB_TOKEN` to external scripts; only Cloudflare Secrets
  should hold it.
- External scripts should receive only `SUBMAN_API_TOKEN`.
- Treat `SUBMAN_API_TOKEN` as a shared full-access credential without scopes or
  per-client revocation. Use TLS, avoid logs and URLs, and rotate it regularly.
- Keep code ASCII unless the edited file already uses non-ASCII intentionally.
- Commit atomically after each independent feature, UI improvement, or bug fix.
