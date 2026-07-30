---
name: subman-project
description: Use when working on the SubMan repository, including Gist workspace behavior, Cloudflare Workers deployment, trusted automation API integration, node sync scripts, or aggregate publishing.
---

# SubMan Project

Use this skill when modifying or operating SubMan. SubMan is a SvelteKit app that
stores its workspace in a fixed GitHub Gist and can expose trusted automation
API endpoints from the same Cloudflare Worker.

## First Checks

1. Read `AGENTS.md` for repository rules.
2. Read `docs/agents/subman-agent-guide.md` for the agent-facing overview.
3. Pick only the reference needed for the task:
   - Architecture and file map: `references/architecture.md`
   - Cloudflare deployment and verification: `references/deployment.md`
   - Gist workspace and `subman.json`: `references/workspace-data.md`
   - Trusted backend/API integration: `references/server-api.md`

## Working Rules

- Use bun commands by default.
- Keep all workspace data in the single GitHub Workspace Gist.
- Keep the workspace identity stable: description `SubMan-Data`, file
  `subman.json`.
- Do not give external automation the GitHub token. Store `GITHUB_TOKEN` in
  Cloudflare Secrets and give scripts only `SUBMAN_API_TOKEN`.
- For machine-managed nodes, prefer `PUT /api/nodes/by-key/:externalKey`.
- Treat that endpoint as resource-identity idempotent, not request-replay
  idempotent. The API does not support `Idempotency-Key`.
- A public Node API `2xx` response proves a verified remote commit. Use response
  `ETag` values with optional `If-Match` for optimistic concurrency.
- Treat `/api/workspaces/:workspaceId/mutations` as an internal browser protocol,
  never as an integration surface.
- Node names must remain distinguishable for aggregate filtering. UI and API
  writes automatically add a timestamp suffix on name collision.
- Treat duplicate node raw URIs as content duplicates. UI and API writes reject
  raw collisions instead of creating another node with a different name.
- Preserve existing conflict handling: local overwrite, remote overwrite, merge
  and save, bind only.
- Run `bun run check` after TypeScript or Svelte changes. Run `bun run build`
  before deployment-related completion claims.
- Make atomic commits after independent changes.

## Common Tasks

### Add or update an automation script

Read `references/server-api.md` and `docs/api/openapi.yaml`. Use stable external
keys and `curl --fail-with-body -sS` or equivalent status-plus-body handling.
Treat SubMan as a low-frequency Gist-backed write target, not a high-concurrency
database. Branch on stable error codes and dispositions, preserve retry timing,
and handle `409 duplicate_node_raw` as "this node URI already exists elsewhere".

### Change workspace behavior

Read `references/workspace-data.md` and inspect `src/lib/workspace.ts`,
`src/lib/workspace-browser-session-v2.ts`,
`src/lib/workspace-persistence.ts`, `src/lib/workspace-mutation-sync.ts`,
`src/lib/workspace-operation-result.ts`, and
`src/lib/server/workspace-coordinator-core.ts`. Preserve the protected
`subman.json` file, revisioned mutation queue, and same-gist publishing model.

### Change UI flows

Inspect the matching route under `src/routes`. Keep the current product shape:
`/auth` for workspace/token/sync, `/gists` for workspace files, `/nodes` for
node and subscription management, and `/aggregate` for output rules and
publishing.

### Deploy or debug Cloudflare runtime

Read `references/deployment.md` and `docs/workspace-v2-operations.md`. Use
Wrangler through bun. Verify the Durable Object migration and secrets after
deployment.
