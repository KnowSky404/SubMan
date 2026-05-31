# SubMan

[中文 README](README.md)

A Gist-first, frontend-only subscription manager for VLESS/VMess and more.
The core idea is to manage data and publish stable subscriptions within a single GitHub Workspace Gist.

Default workspace identity:
- Description: `SubMan-Data`
- Config file: `subman.json`

## Key Features
- Workspace Gist: finds or creates the fixed workspace Gist after token setup
- Local and cloud modes: localStorage only without token; auto sync with Gist when token is present
- Conflict handling and repair: local overwrite, remote overwrite, merge, or bind only; health check and config repair
- Auto sync: local changes are pushed to the workspace gist and sync status is tracked
- Nodes and subscriptions: add, edit, enable/disable, tag, search, and filter
- Batch import: multi-line import with dedupe and preview; supports base64 subscription content
- Aggregation rules: select nodes/subscriptions, exclude tags, filter by proxy types, regex renaming, region flags
- Result sorting: support automatic sorting by name, protocol, or region (flags), and fully custom ordering via priority keywords or manual drag-and-drop
- Custom region rules: custom flag map with built-in template and lookup
- Publish targets: bind a rule to multiple targets with file name, description, and visibility
- Stable links: same Gist + same file name keeps a stable raw URL; rename guidance with cleanup outcomes
- Workspace file manager: list files, copy raw links, delete outputs, clean non-config files in bulk
- Auto-cleanup mechanism: automatically remove invalid associations in aggregate rules when nodes or subscriptions are deleted
- Activity log: records workspace setup, sync, and repair actions

## Typical Flow
1. Save a GitHub token in `/auth` (requires `gist` scope) and bind the workspace
2. Add nodes and subscriptions in `/nodes` (batch import supported)
3. Build rules in `/aggregate`, configure sorting and renaming, then preview output
4. Create publish targets and publish to the workspace gist, then copy the stable subscription link

## Pages
- `/auth`: workspace settings, conflict handling, health check, import/export, sync status
- `/gists`: workspace file list, raw link copy, file cleanup
- `/nodes`: nodes and subscriptions management (search, filters, batch import)
- `/aggregate`: rule editor, visual drag-and-drop sorting, publish target management, output publishing

## Aggregation and Publishing
- Rule options: node/subscription selection, tag exclusions, proxy type filtering, regex renaming map
- Sorting engine: hybrid sort mode supporting priority keywords and syncing manual preview reordering to config
- Subscription fetch: pulls subscription URLs at publish time and decodes base64 content when detected
- Region flags: detect region keywords in names and prepend flags automatically
- Preview: line count, protocol hints, warnings, and errors; supports real-time drag-and-drop reordering
- Publish strategy: keep file name for stable links; renames create a new stable link and provide cleanup guidance

## Workspace Model
- After token setup, SubMan finds or creates the fixed workspace gist and writes `subman.json`
- All data lives in a single workspace gist, and the config file is protected from deletion in UI
- Conflict resolution options: local overwrite, remote overwrite, merge, or bind only
- Health check and repair are available from workspace settings

## FAQ

### Will auto sync overwrite remote data with my local copy?
Not blindly. After a workspace is connected, local browser edits trigger auto sync. Before writing to the Gist, SubMan reads the remote `subman.json` and compares it with the saved sync baseline.

- If the remote file has not changed, SubMan writes the current local state.
- If the remote file also changed, SubMan performs a three-way merge using the last sync baseline, the local state, and the remote state, then saves the merged result.
- If the remote side deleted an item and the local side only still has the old copy, auto-merge preserves the remote deletion instead of restoring that item to the Gist.
- If you keep editing while an auto sync is in flight, the older sync snapshot will not replace those newer local edits. The newer local edits are kept and handled by the next sync.

### Which actions still overwrite the remote workspace?
Manual Push Local and the conflict-resolution choice to overwrite remote with local are explicit overwrite actions. After confirmation, they write the current local state to the Workspace Gist. Use them when you know the local data is the source of truth.

### What should I choose when local and remote differ during workspace setup?
The `/auth` page shows conflict-resolution options:

- Pull Remote: replace the local view with remote data.
- Push Local: write current local data to the Gist.
- Merge & Save: merge local and remote items by `updatedAt`, then save.
- Bind only: bind the workspace without syncing immediately.

## Development
```bash
bun install
bun run dev
bun run preview
```

## Cloudflare Workers Deployment
```bash
bun run build
bun run deploy
```

Local preview for Workers:
```bash
bun run dev:cf
```

## Server API
SubMan can expose owner-operated API endpoints for backend scripts such as
`sing-box-vps`. See the full API reference in
[docs/api/server-api.md](docs/api/server-api.md).

Usage flow:

1. Create a GitHub token with `gist` permission.
2. Create a long custom `SUBMAN_API_TOKEN` for scripts that call SubMan.
3. Store both values as Cloudflare Worker secrets:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

4. Deploy SubMan:

```bash
bun run build
bun run deploy
```

5. Check API configuration:

```bash
curl -sS "https://subman.example.com/api/health"
```

An `ok: true` response means both `GITHUB_TOKEN` and `SUBMAN_API_TOKEN` are
configured.

6. Use `SUBMAN_API_TOKEN` from your backend script to sync a node:

```bash
curl -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

Scripts should prefer `PUT /api/nodes/by-key/:externalKey` because it is
idempotent: repeated calls with the same `externalKey` update the existing node
instead of creating duplicates.
When nodes are created or updated through either the UI or API, duplicate names
receive a timestamp suffix so aggregate filtering remains distinguishable.
Duplicate raw URIs are treated as duplicate content and rejected.

`GITHUB_TOKEN` stays in Cloudflare Secrets. External scripts do not need and
should not hold the GitHub token.
The first API version is intended for trusted backend scripts, so it does not
enable broad browser CORS by default.

## AI / Agent Adaptation
This repository includes project context and a skill for automation agents such
as Codex and Hermes agents:

- Agent Guide: [docs/agents/subman-agent-guide.md](docs/agents/subman-agent-guide.md)
- Project Skill: [docs/agents/subman-skill/SKILL.md](docs/agents/subman-skill/SKILL.md)

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
- Store all project data in the same workspace gist
