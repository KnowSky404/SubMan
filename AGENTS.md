# Codex Context - SubMan

## Product

SubMan manages VLESS, VMess, and related proxy resources. It has two runtime
modes:

- Local mode stores business data in the browser.
- Workspace mode stores the authoritative document and generated outputs in one
  private GitHub Gist described as `SubMan-Data`.

The application is not purely frontend. SvelteKit runs on Cloudflare Workers,
and one SQLite-backed `WorkspaceCoordinator` Durable Object serializes every
Workspace mutation.

## Workspace Invariants

- `subman.json` is the authoritative Workspace Schema V2 document.
- One coordinator is addressed by `workspaceId = "gist:" + gistId`.
- The coordinator is the only runtime component allowed to create, replace, or
  mutate `subman.json`.
- Browser pages and Server API routes submit revisioned mutation envelopes; they
  never PATCH the configuration file directly.
- Generated output and the corresponding Workspace document update use the same
  Gist PATCH.
- Tombstones prevent ordinary upsert and reconcile operations from reviving a
  deleted ID.
- Browser retries reuse the original mutation ID.
- GitHub tokens are request-scoped coordinator arguments. They are excluded from
  mutation envelopes, IndexedDB, diagnostics, logs, and Durable Object SQLite.

Reserved Gist files are:

- `subman.json`
- `subman.v1.backup.json`
- `subman.bootstrap.json`

## Browser Persistence

The current V2 baseline persists the business snapshot, Workspace binding, and
all Workspace queues in separate localStorage records. This is a known
non-atomic boundary being replaced by the transactional persistence design in
`docs/superpowers/plans/2026-07-23-workspace-v2-hardening.md`. Do not add another
browser storage key or bypass that migration boundary.

GitHub authentication remains outside that database:

- Session-only is the default and uses `sessionStorage`.
- Persistent storage uses `localStorage` only after explicit user opt-in.
- Persistent browser storage does not protect a token from active XSS.

## Migration And Recovery

- The coordinator migrates V1 `subman.json` on the first accepted mutation.
- The first V1 migration creates an immutable, byte-exact
  `subman.v1.backup.json`; a mismatching existing backup stops migration.
- Corrupt browser records are quarantined as metadata plus inaccessible raw
  storage. Diagnostics never export quarantine contents.
- Tombstone compaction and processed-mutation pruning require a separate protocol
  design and must not be implemented as time-based deletion.

## Key Areas

- Browser persistence and dispatch:
  - `src/lib/stores/app.ts`
  - `src/lib/workspace-mutation-queue.ts`
  - `src/lib/workspace-mutation-sync.ts`
  - `src/lib/workspace-mutation-sync-browser.ts`
  - `src/lib/workspace-sync-status.ts`
- Workspace protocol:
  - `src/lib/workspace-document.ts`
  - `src/lib/workspace-mutation.ts`
  - `src/lib/workspace-data.ts`
- Coordinator and GitHub gateway:
  - `src/lib/server/workspace-coordinator.ts`
  - `src/lib/server/workspace-coordinator-core.ts`
  - `src/lib/server/workspace-coordinator-journal.ts`
  - `src/lib/server/workspace-gist.ts`
- UI:
  - `src/routes/auth/+page.svelte`
  - `src/routes/gists/+page.svelte`
  - `src/routes/nodes/+page.svelte`
  - `src/routes/aggregate/+page.svelte`
  - `src/routes/exports/+page.svelte`

## Commands

Use Bun for package management and scripts:

```bash
bun install --frozen-lockfile
bun test
bun run check
bun run lint
bun run build
bun run test:cf
```

Use `bun add`, `bun add -d`, and `bun remove` for dependency changes.

## Delivery Rules

- Follow `design.md` for UI behavior and styling.
- Keep code identifiers and comments ASCII.
- Add behavior tests before changing established protocol behavior.
- Commit each independent feature, UI change, refactor, or bug fix immediately
  with an atomic Conventional Commit.
- Do not add another `subman.json` writer or weaken revision, tombstone,
  Workspace identity, backup, request-hash, or idempotency checks.
- Do not log credentials, raw mutation payloads, full outputs, or full Workspace
  documents.
- By default, do not deploy, run `wrangler deploy`, access or mutate a real Gist,
  push commits, create releases, or use production secrets. Those operations
  require explicit user authorization.

## Design References

- `docs/superpowers/specs/2026-07-22-workspace-v2-coordinator-design.md`
- `docs/workspace-v2-operations.md`
- `docs/superpowers/plans/2026-07-23-workspace-v2-hardening.md`
