---
name: subman-project
description: Use when working on the SubMan repository, including Gist workspace behavior, Cloudflare Workers deployment, trusted automation API integration, node sync scripts, or aggregate publishing.
---

# SubMan Project

Use this skill when modifying or operating SubMan. SubMan is a SvelteKit app that
stores its workspace in a fixed GitHub Gist and can expose trusted automation
API endpoints from the same Cloudflare Worker.

## First Checks

Paths outside `references/` below are relative to the repository root.

1. Inspect the current worktree and read `AGENTS.md` for repository rules.
2. Read `docs/agents/subman-agent-guide.md` for the agent-facing overview.
3. Pick only the reference needed for the task:
   - Architecture and file map: `references/architecture.md`
   - Cloudflare deployment and verification: `references/deployment.md`
   - Gist workspace and `subman.json`: `references/workspace-data.md`
   - Trusted backend/API integration: `references/server-api.md`

## Working Rules

- Use Bun 1.3.14 and `bun install --frozen-lockfile`; follow current package scripts.
- Workspace mode stores business configuration and outputs in one Gist. Local
  mode stores business data in the transactional IndexedDB persistence root.
- Keep the workspace identity stable: description `SubMan-Data`, file
  `subman.json`.
- Do not give external automation the GitHub token. Store `GITHUB_TOKEN` in
  Cloudflare Secrets and give scripts only `SUBMAN_API_TOKEN`.
- For machine-managed nodes, prefer `PUT /api/nodes/by-key/:externalKey`.
- Treat that endpoint as resource-identity idempotent, not request-replay
  idempotent. The API does not support `Idempotency-Key`.
- A public Node API write `2xx` response proves a verified remote commit. Use response
  `ETag` values with optional `If-Match` for optimistic concurrency.
- Treat `/api/workspaces/:workspaceId/mutations` as an internal browser protocol,
  never as an integration surface.
- Node names must remain distinguishable for aggregate filtering. UI and API
  writes automatically add a timestamp suffix on name collision.
- Treat duplicate node raw URIs as content duplicates. UI and API writes reject
  raw collisions instead of creating another node with a different name.
- Preserve existing conflict handling: local overwrite, remote overwrite, merge
  and save, bind only.
- Await `WorkspaceActionHandle.completion`; `submitted` only accepts the task.
  Use the shared presenter for operation outcomes and keep durable queued,
  peer-owned, or retry-scheduled work distinct from publication success.
- Preserve revisions, tombstones, mutation IDs, fencing tokens, and the complete
  Workspace queue during repair. Diagnostics must never read raw quarantine data.
- Run `bun run check` after TypeScript or Svelte changes. Run `bun run build`
  before deployment-related completion claims.
- Make atomic commits after independent changes.
- Default to local/mock checks. Do not push, deploy, access/mutate real Gists,
  create releases, or use production secrets without explicit authorization.

API integration details, including the effective 119-byte external-key limit,
63 caller-tag limit, full-field PUT defaults, and uncertain-write recovery, are in
[the Server API guide](../../api/server-api.md). API discovery uses Worker credentials independently of
browser binding; check the returned Gist identity before writing. Node updates do
not republish output files, and GET/health success does not prove a remote commit.

## Common Tasks

### Add or update an automation script

Read `references/server-api.md` and `docs/api/openapi.yaml`. Use stable external
keys and `curl --fail-with-body -sS` or equivalent status-plus-body handling.
Treat SubMan as a low-frequency Gist-backed write target, not a high-concurrency
database. Branch on stable error codes and dispositions, preserve retry timing,
and handle `409 duplicate_node_raw` as "this node URI already exists elsewhere".
When changing the public API, update `docs/api/openapi.yaml`,
`docs/api/server-api.md`, both READMEs, and `references/server-api.md` together.
Run `bun test src/lib/server/api` plus runtime gates for route changes.

### Change workspace behavior

Read `references/workspace-data.md` and inspect `src/lib/workspace.ts`,
`src/lib/workspace-browser-session-v2.ts`,
`src/lib/workspace-persistence.ts`, `src/lib/workspace-mutation-sync.ts`,
`src/lib/workspace-operation-result.ts`, and
`src/lib/server/workspace-coordinator-core.ts`. Preserve the protected
`subman.json` file, revisioned mutation queue, and same-gist publishing model.
Read `src/lib/workspace-merge.ts` for tombstone-aware conflict resolution and
`src/lib/workspace-settings-controller.ts` for persisted settings/repair behavior.
Add protocol behavior tests first, then run unit, type, lint, Cloudflare, and
relevant browser gates.

### Discover or migrate an old Workspace

Read `docs/legacy-workspace-migration.md` and `references/workspace-data.md`.
Use `/auth` Manual Workspace migration for read-only discovery; normal connection
can create a bootstrap Gist and prefers a saved binding. Confirm the original
Gist and preview before migration. Retain local-only data and repair evidence;
do not clear queues, regenerate output files, or change old subscription links.
Offline audit uses `scripts/audit-workspace.ts` with no network or credentials.

### Change UI flows

Inspect the matching route under `src/routes`. Keep the current product shape:
`/auth` for workspace/token/sync, `/gists` for workspace files, `/nodes` for
node and subscription management, `/aggregate` for output rules and
publishing, and `/exports` for sing-box profiles and publication. Follow
`design.md`, retain drafts until completion, and verify changed browser flows.

### Deploy or debug Cloudflare runtime

Read `references/deployment.md` and `docs/workspace-v2-operations.md`. Use
Wrangler through bun. Verify the Durable Object migration and secrets after
deployment.
