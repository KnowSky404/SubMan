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
- Aggregation rules: select nodes/subscriptions, exclude tags, filter by proxy types, rename mapping, region flags
- Custom region rules: custom flag map with built-in template and lookup
- Publish targets: bind a rule to multiple targets with file name, description, and visibility
- Stable links: same Gist + same file name keeps a stable raw URL; rename guidance with cleanup outcomes
- Workspace file manager: list files, copy raw links, delete outputs, clean non-config files in bulk
- Activity log: records workspace setup, sync, and repair actions

## Typical Flow
1. Save a GitHub token in `/auth` (requires `gist` scope) and bind the workspace
2. Add nodes and subscriptions in `/nodes` (batch import supported)
3. Build rules and preview output in `/aggregate`
4. Create publish targets and publish to the workspace gist, then copy the stable subscription link

## Pages
- `/auth`: workspace settings, conflict handling, health check, import/export, sync status
- `/gists`: workspace file list, raw link copy, file cleanup
- `/nodes`: nodes and subscriptions management (search, filters, batch import)
- `/aggregate`: rule editor, publish target management, output publishing

## Aggregation and Publishing
- Rule options: node/subscription selection, tag exclusions, proxy type filtering, rename map
- Subscription fetch: pulls subscription URLs at publish time and decodes base64 content when detected
- Region flags: detect region keywords in names and prepend flags automatically
- Preview: line count, protocol hints, warnings, and errors
- Publish strategy: keep file name for stable links; renames create a new stable link and provide cleanup guidance

## Workspace Model
- After token setup, SubMan finds or creates the fixed workspace gist and writes `subman.json`
- All data lives in a single workspace gist, and the config file is protected from deletion in UI
- Conflict resolution options: local overwrite, remote overwrite, merge, or bind only
- Health check and repair are available from workspace settings

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

## Stack
- SvelteKit + TypeScript
- TailwindCSS v4
- Biome
- bun

## Conventions
- Keep code ASCII-only
- Commit after each independent feature or fix
- Store all project data in the same workspace gist
