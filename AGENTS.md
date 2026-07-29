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

Browser business state uses the `subman-workspace` IndexedDB database, schema
version 1. Its single transactional root contains the validated snapshot,
Workspace binding and baseline, per-Workspace mutation queues, retry and blocked
metadata, dispatcher leases, quarantine metadata, and migration evidence.
Business actions commit the snapshot, binding, and queue change atomically before
Svelte memory is updated. Do not add another browser storage path or bypass the
`WorkspacePersistence` boundary.

`WorkspaceActionHandle.submitted` means only that synchronous validation accepted
the request and created its asynchronous task. Only `completion` reports the
authoritative operation outcome. Pages must await it before clearing a form,
closing an editor, ending a destructive-action loading state, or reporting a
save. The shared operation presenter is the sole interpretation boundary for
durable, queued, peer-owned, retrying, blocked, rejected, uncertain, and remote
results; stores return structured results and do not own operation toasts.

Initialization migrates these legacy keys without writing new business state to
them:

- `subman:state:v1`
- `subman:workspace-state:v2`
- `subman:workspace-mutation-queue:v1`

Migration progresses through `not-started`, `copied`, `validated`, and
`confirmed`. Unsupported IndexedDB, quota, upgrade, transaction, or corrupt-data
failures enter a fail-closed repair state; they never fall back to split
localStorage writes. Corrupt records retain separately inaccessible raw data and
safe quarantine metadata. Diagnostics never read or export quarantine contents.

GitHub authentication remains outside that database:

- Session-only is the default and uses `sessionStorage`.
- Persistent storage uses `localStorage` only after explicit user opt-in.
- Persistent browser storage does not protect a token from active XSS.

## Delivery And Repair

- Queue order and `expectedRevision` are preserved per Workspace. Active and
  orphan Workspace queues remain visible to repair tooling.
- Discard, rebind, and repair operate on a complete Workspace queue. Never remove
  only the head unless the remaining revisions are atomically rebased or replaced
  by an explicit reconcile.
- One dispatcher owns a persisted lease with an owner ID, monotonically allocated
  fencing token, expiry, and heartbeat. Web Locks and BroadcastChannel are
  optional coordination aids, not correctness boundaries.
- Retryable upstream failures use persisted bounded exponential backoff with
  jitter and honor safe GitHub retry timing. Authentication and explicit Retry
  actions reset only eligible retry state.
- Busy/stale peers, deferred delivery, and retryable upstream failures are safe
  nonterminal outcomes while the original mutation remains durable. Re-read
  IndexedDB before classifying them, preserve the mutation ID, and never present
  them as a final publish failure.
- Only `remote-committed` proves Workspace publication. A post-commit cache read,
  lease release, or broadcast failure cannot turn a durable commit into a
  pre-persistence rejection; recover from IndexedDB or return acknowledgement
  uncertainty.
- A normal stale binding is a bounded concurrent-update/rebase case, not corrupt
  storage. Refresh the persistent record and replay the intent against the latest
  snapshot before retrying once.
- `state-conflict`, `domain-conflict`, `auth-required`, `queue-corruption`,
  `operator-repair`, `retryable-upstream`, `permanent-upstream`, and
  `invalid-request` are distinct dispositions. Unknown failures fail closed.
- Merge and Use Local are tombstone-aware. Client timestamps never grant
  overwrite authority, and remote tombstoned IDs are not restored by ordinary
  upsert or reconcile mutations.

## Migration And Recovery

- The coordinator migrates V1 `subman.json` on the first accepted mutation.
- The first V1 migration creates an immutable, byte-exact
  `subman.v1.backup.json`; a mismatching existing backup stops migration.
- Corrupt browser records are quarantined as metadata plus inaccessible raw
  storage. Diagnostics never export quarantine contents.
- Diagnostics contain only counts, safe Workspace/revision/mode metadata,
  mutation identity plus payload byte length/hash, retry/disposition metadata,
  and quarantine key/bytes/time. Raw payloads, messages, stacks, documents,
  outputs, and credentials are excluded.
- Tombstone compaction and processed-mutation pruning require a separate protocol
  design and must not be implemented as time-based deletion.

## Key Areas

- Browser persistence and dispatch:
  - `src/lib/stores/app.ts`
  - `src/lib/workspace-operation-result.ts`
  - `src/lib/workspace-operation-presenter.ts`
  - `src/lib/workspace-queue-metrics.ts`
  - `src/lib/workspace-mutation-queue.ts`
  - `src/lib/workspace-mutation-sync.ts`
  - `src/lib/workspace-mutation-sync-browser.ts`
  - `src/lib/workspace-persistence.ts`
  - `src/lib/workspace-sync-state-machine.ts`
  - `src/lib/workspace-sync-status.ts`
- Workspace protocol:
  - `src/lib/workspace-document.ts`
  - `src/lib/workspace-mutation.ts`
  - `src/lib/workspace-data.ts`
  - `src/lib/workspace-merge.ts`
  - `src/lib/workspace-limits.ts`
- Coordinator and GitHub gateway:
  - `src/lib/server/workspace-coordinator.ts`
  - `src/lib/server/workspace-coordinator-core.ts`
  - `src/lib/server/workspace-coordinator-journal.ts`
  - `src/lib/server/workspace-gist.ts`
  - `src/lib/server/api/bounded-json.ts`
- Security and diagnostics:
  - `src/lib/workspace-diagnostics.ts`
  - `src/hooks.server.ts`
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
bun run test:e2e
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
- Enforce byte/count limits on new or edited values while allowing unrelated
  changes to preserve oversized legacy fields. Tombstone thresholds are
  observability warnings, not permission to compact them.
- Preserve the response security-header contract, including CSP and
  `frame-ancestors`; keep the first-paint theme script compatible with that CSP.
- By default, do not deploy, run `wrangler deploy`, access or mutate a real Gist,
  push commits, create releases, or use production secrets. Those operations
  require explicit user authorization.

## Design References

- `docs/superpowers/specs/2026-07-22-workspace-v2-coordinator-design.md`
- `docs/workspace-v2-operations.md`
- `docs/superpowers/plans/2026-07-23-workspace-v2-hardening.md`
