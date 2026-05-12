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

Without a GitHub token, the UI works in localStorage-only mode. With a token and
an active workspace gist, local changes sync to the workspace gist.

## Agent Entry Points

- Project rules: `AGENTS.md`
- Human README: `README.md`
- Server API: `docs/api/server-api.md`
- Agent skill: `docs/agents/subman-skill/SKILL.md`
- Architecture reference: `docs/agents/subman-skill/references/architecture.md`
- Deployment reference: `docs/agents/subman-skill/references/deployment.md`
- Workspace data reference: `docs/agents/subman-skill/references/workspace-data.md`
- Automation API reference: `docs/agents/subman-skill/references/server-api.md`

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

The endpoint is idempotent. It stores the external key as a node tag label:

```text
external:<externalKey>
```

Use this endpoint for VPS installers and other repeatable node updates. Avoid
`POST /api/nodes` for automation unless duplicates are intended.

Example:

```bash
curl -fsS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer ${SUBMAN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

## Development Boundaries

- Keep runtime data in the single workspace gist.
- Keep `subman.json` protected from UI deletion.
- Prefer `PUT /api/nodes/by-key/:externalKey` for machine-created nodes.
- Do not expose `GITHUB_TOKEN` to external scripts; only Cloudflare Secrets
  should hold it.
- External scripts should receive only `SUBMAN_API_TOKEN`.
- Keep code ASCII unless the edited file already uses non-ASCII intentionally.
- Commit atomically after each independent feature, UI improvement, or bug fix.

