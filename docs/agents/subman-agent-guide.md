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
- Legacy discovery, migration, and offline recovery: `docs/legacy-workspace-migration.md`
- CI and manual production deployment: `docs/ci-cd.md`
- Workspace data reference: `docs/agents/subman-skill/references/workspace-data.md`
- Automation API reference: `docs/agents/subman-skill/references/server-api.md`
- sing-box export contract: `docs/sing-box-export.md`

Agents that support skills should load `docs/agents/subman-skill/SKILL.md` when
working on SubMan deployment, automation, API integration, workspace sync, or
Gist-backed data changes.

## Common Commands

Use Bun 1.3.14, matching `package.json` and CI, and install from `bun.lock`.

```bash
bun install --frozen-lockfile
bun test
bun run test:sing-box
bun run check
bun run lint
bun run test:cf
bun run test:e2e
bun run deploy:check
```

`test:cf` and `deploy:check` build first. `check` includes reproducible Worker
types; regenerate with `bun run generate:worker-types` after binding changes.
The sing-box gate needs Docker. Prepare E2E with
`bunx playwright install --with-deps chromium` when Chromium is missing.
Tests use synthetic/mocked data and do not prove real Gist or production behavior.

For UI iteration use `bun run dev -- --host :: --port 5173`.
For the Cloudflare Workers local runtime:

```bash
bun run dev:cf -- --ip :: --port 8787
```

On this VPS open `http://oc-de-fra-1.knowsky.uk:5173` or
`http://oc-de-fra-1.knowsky.uk:8787`; verify IPv4/IPv6 listeners with `ss -lntp`.
Without local secrets, health returns HTTP 200 with `ok: false`. Do not add real
GitHub credentials to local write tests.

Production commands require explicit authorization. For an authorized Server API
setup, store Worker secrets interactively:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

Secret writes change the remote Worker. Deployment uses `bun run deploy` or the
manual production workflow; see `docs/ci-cd.md`. Neither is part of local checks.

## Task Workflow

1. Inspect `git status --short`, the current diff, package scripts, and the
   relevant implementation before editing. Preserve unrelated changes.
2. Select the matching source paths in the architecture reference. Read
   `design.md` for UI work and the operations runbook for persistence/protocol work.
3. Add behavior tests before changing an established protocol. Browser business
   actions must pass through persistence and await `handle.completion`;
   `submitted` does not establish a local save or remote publication.
4. Update both READMEs and matching agent references with final behavior. Public
   API changes also require OpenAPI, the narrative API guide, and contract tests.
5. Run relevant checks; runtime/binding changes require the Worker/DO suite,
   browser-flow changes require E2E, and exporter changes require sing-box checks.
6. Commit each independent change with a Conventional Commit. Report the commit,
   checks, and proof boundary; push/deploy/real Gist operations need authorization.

## Legacy Workspace Recovery

Start with `/auth` **Manual Workspace migration**. A blank Gist ID checks all
matching Workspaces without preferring the current binding; a specific ID checks
that Gist. This discovery is read-only and never creates a Gist. Enter the token
and check without first connecting if normal login picked another Workspace.
Select the original V1 candidate and review counts, output names, and old URLs.

Preserve local-only data before confirming migration. Pending queues and repair
evidence need explicit resolution. Migration uses the internal `workspace.migrate`
mutation, checks the exact V1 source hash, retains a byte-exact backup, and leaves
output files and publication metadata unchanged. Only `remote-committed` proves
completion. On changed source, recheck; on `migration_backup_conflict`, preserve
both sources and investigate rather than deleting or replacing the backup.

For a downloaded private configuration, audit offline:

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json --gist-id YOUR_GIST_ID
```

`--export-v1 /private/path/new-import.json` converts valid V1 into a business
import file, exclusively created with mode `0600`. It is not a Workspace document
and cannot replace `subman.json`. Diagnostics are metadata, not a recovery backup.
Follow `docs/legacy-workspace-migration.md` for import and recovery details.

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
successful update can advance the Workspace revision. A write `2xx` response proves
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

API integration details, including the effective 119-byte external-key limit,
63 caller-tag limit, full-field PUT defaults, and uncertain-write recovery, are in
[the Server API guide](../api/server-api.md). API discovery uses Worker credentials independently of
browser binding; check the returned Gist identity before writing. Node updates do
not republish output files, and GET/health success does not prove a remote commit.

## Development Boundaries

- Keep Workspace configuration and outputs in one Gist; local business state
  stays within `WorkspacePersistence` in IndexedDB.
- Keep `subman.json` protected from UI deletion.
- Protect `subman.v1.backup.json` and `subman.bootstrap.json` too; output cleanup
  must preserve all reserved files and retained migration/recovery evidence.
- Route every config mutation through `WorkspaceCoordinator`; do not add a
  direct full-state Gist writer.
- Prefer `PUT /api/nodes/by-key/:externalKey` for machine-created nodes.
- Treat only health and node routes as supported public API. The Workspace
  mutation route is browser-internal and must not be called by integrations.
- Branch on stable error `code` and `disposition`, not human-readable `message`.
- Treat queued, peer-owned, and retry-scheduled browser results as durable pending
  work. Keep original mutation IDs; repair/discard complete Workspace queues.
- Merge and Use Local preserve remote tombstones; client timestamps do not grant
  overwrite authority. Unknown storage failures remain read-only.
- Handle `409 duplicate_node_raw` explicitly in automation scripts; it means the
  submitted URI is already stored on another node.
- Do not expose `GITHUB_TOKEN` to external scripts; only Cloudflare Secrets
  should hold it.
- External scripts should receive only `SUBMAN_API_TOKEN`.
- Treat `SUBMAN_API_TOKEN` as a shared full-access credential without scopes or
  per-client revocation. Use TLS, avoid logs and URLs, and rotate it regularly.
- Keep code ASCII unless the edited file already uses non-ASCII intentionally.
- Commit atomically after each independent feature, UI improvement, or bug fix.
- Do not push, deploy, create releases, access/mutate real Gists, or use production
  secrets without explicit user authorization.
