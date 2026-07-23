# Workspace V2 Reliability, Security, and Operations Hardening Plan

Date: 2026-07-23

Baseline: `main@d15e5b1e67368a399ab93326530327d4a4a06b96`

## Scope And Guardrails

This plan implements the Workspace V2 hardening goal without deploying a Worker,
using a real GitHub token, mutating a real Gist, pushing commits, or changing the
V2 wire format for design-only topics.

The following invariants remain unchanged:

- One `WorkspaceCoordinator` Durable Object serializes one `gist:<gist-id>`.
- Only the coordinator creates or changes `subman.json`.
- Mutation envelopes never contain GitHub credentials.
- Durable Object SQLite retains hashes and journal metadata, not credentials,
  complete payloads, outputs, or Workspace documents.
- V1 migration creates a byte-exact immutable backup and fails on mismatch.
- Tombstones continue to block implicit resurrection.
- Output content and document metadata commit in one Gist PATCH.
- Browser retry keeps the original mutation ID.
- `WorkspaceDocumentV2`, mutation envelope fields, revision semantics, and
  existing Server API success response shapes stay wire compatible.

The work adds browser persistence schema version 1 and additive error response
metadata. It does not add a Workspace V3 schema.

## Current Behavior And Reproduction

### A. Browser persistence is split across keys

Evidence:

- `src/lib/stores/app.ts` reads and subscribes directly to
  `subman:state:v1`.
- A normal action writes the next snapshot and updates the Svelte store before
  `enqueueAutomaticWorkspaceMutation()` settles.
- A deferred action can enqueue first and persist the snapshot later.
- `WorkspaceV2StateStore` and `WorkspaceMutationQueue` use independent
  localStorage keys.

Reproduce with injected storage/queue failures:

1. Make `localStorage.setItem("subman:state:v1", ...)` succeed and make queue
   `setItem` throw. The UI contains the edit but no mutation exists.
2. For a deferred delete, allow queue persistence and fail snapshot persistence.
   A remote delete can be delivered while the visible local snapshot still
   contains the entity.
3. Reload between the queue commit and Svelte update to observe a state assembled
   from independently committed records.
4. Clear authentication while an automatic binding and pending edits remain.
   Subsequent edits are saved locally but are not queued for later delivery.

Legacy queue parsing validates mutation schema and duplicate mutation IDs, but
does not validate contiguous expected revisions per Workspace.

### B. HTTP status drives conflict behavior

Evidence:

- The browser treats every HTTP 409 as `conflict`.
- The endpoint maps revision conflicts, domain conflicts, mutation ID reuse,
  migration backup conflict, and recovery failure to the same status.
- `persistConflict()` always changes the binding to `paused-conflict`.

Reproduce by returning 409 with `duplicate_node_raw` or
`mutation_id_reused`; both currently activate the full-state conflict path.

### C. Merge is not tombstone aware

Evidence:

- `src/lib/merge.ts` merges live arrays and chooses by client `updatedAt`.
- The auth conflict controller passes local and remote live state through this
  merge path.
- Existing baseline merge tests only cover a remote deletion when the local copy
  is unchanged.

Reproduce by modifying a local entity after its trusted baseline, adding a remote
tombstone for the same ID, and choosing Merge or Use Local. The current merge
cannot describe why the local entity must remain deleted.

### D. Sync status is a partial-patch bag

Evidence:

- `updateWorkspaceSyncStatus(Partial<WorkspaceSyncStatus>)` shallow-merges
  status.
- `repairRequired`, `recentError`, `retrying`, and `recoveryNotice` are cleared
  only by callers that remember each field.
- The layout derives UI from lifecycle plus several booleans.

Reproduce by reporting quarantined storage and then committing successfully; a
partial committed patch can leave the previous Repair indicator visible.

### E. Queue status is global

Evidence:

- Queue writes set `queueCount` to all stored mutations.
- Delivery peeks only the active binding's `workspaceId`.
- No grouped inspector exists, so orphan queues cannot be inspected, rebound, or
  transactionally discarded.

Reproduce by queueing Workspace A, binding Workspace B, and observing the header
report A's mutations even though the scheduler cannot send them.

### F. Timeout and retry metadata are absent

Evidence:

- GitHub gateway fetches have no abort timeout and throw generic errors.
- Browser delivery has no timeout and uses a fixed in-memory retry delay.
- Retry timing is lost on reload and does not honor `Retry-After`.

Reproduce with a fetch promise that never resolves or a 429 response containing
retry headers. Delivery hangs or retries without persistent server guidance.

### G. Lock fallback is realm local

Evidence:

- `workspace-lock.ts` falls back to a module-level `Map<string, Promise<void>>`.
- BroadcastChannel communicates events but does not grant a fenced lease.

Reproduce with two independent browser realms without `navigator.locks`; both can
enter the delivery callback and submit the same head mutation concurrently.

### H. Diagnostics include payloads

Evidence:

- `exportWorkspaceDiagnostics()` serializes full queued mutations.
- Mutation payloads can contain node raw URIs, subscription URLs, output content,
  and a full reconcile document.

Reproduce by placing unique canaries in each payload class and checking the
exported string.

### I. JSON and domain sizes are unbounded

Evidence:

- Browser and Server API routes use `request.json()` directly.
- No shared byte-counting reader or centralized domain limits exist.
- Gist response and output size failures are not distinguished from generic
  gateway failures.

Reproduce with chunked JSON larger than the intended limit and with oversized
node raw, subscription URL, rename map, output, or reconcile payloads.

### J-K-L. Validation and maintainability gaps

Evidence:

- There is no checked-in `.github/workflows/ci.yml` or browser E2E layer.
- The baseline test suite passes 325 tests, but several UI tests assert source
  strings rather than runtime behavior.
- `app.html` has an inline theme script and there is no CSP/security-header hook.
- `auth/+page.svelte` is 1060 lines and `stores/app.ts` is 607 lines.

## Target Browser Persistence

### Narrow adapter

Business code uses a `WorkspacePersistence` interface instead of IndexedDB:

```ts
interface WorkspacePersistence {
  initialize(): Promise<WorkspacePersistenceSnapshot>;
  read(): Promise<WorkspacePersistenceSnapshot>;
  commitLocalAction(input: LocalActionCommit): Promise<ActionCommitResult>;
  commitAutomaticAction(input: AutomaticActionCommit): Promise<ActionCommitResult>;
  updateDelivery(input: DeliveryCommit): Promise<void>;
  inspectQueues(): Promise<WorkspaceQueueGroup[]>;
  repairQueue(input: QueueRepairCommand): Promise<void>;
  acquireLease(input: LeaseAcquireCommand): Promise<DispatcherLease | null>;
  renewLease(input: LeaseRenewCommand): Promise<DispatcherLease | null>;
  releaseLease(input: LeaseReleaseCommand): Promise<void>;
}
```

The production adapter uses one IndexedDB database, `subman-workspace`, version
1. Tests use a deterministic in-memory implementation with transaction fault
injection. Business modules never call IndexedDB APIs directly.

### Stores

- `meta`: schema version, migration phase, confirmed-at, rollback markers.
- `snapshot`: one validated current business snapshot.
- `bindings`: Workspace identity, revision, baseline, conflict baseline, mode.
- `mutations`: mutation envelope plus status, keyed by mutation ID and indexed by
  Workspace/revision.
- `delivery`: per-Workspace retry/backoff and blocked metadata.
- `leases`: per-Workspace owner, fencing token, expiry, heartbeat, next attempt.
- `quarantine`: key, byte count, created time, category, and inaccessible raw
  record retained only for local repair.

No store accepts token, Authorization, cookie, headers, or arbitrary error stack.

### Transaction boundaries

- Automatic action: validate draft, derive and validate the next snapshot and
  mutation, then atomically write snapshot, binding metadata, and queue entry.
  Update Svelte memory only after transaction completion.
- Local/manual/paused action: atomically write only the next snapshot and any
  required binding mode metadata.
- Deferred/destructive action uses the same transaction and cannot expose a
  queue-only commit.
- Delivery success atomically removes the head mutation, advances binding and
  baseline, clears retry/blocked data, and stores the replayed optimistic
  snapshot before broadcasting.
- Delivery failure atomically updates disposition, blocked metadata, backoff, or
  quarantine without advancing the queue head.
- Discard and repair operate on a complete Workspace queue. A head-only removal
  is forbidden unless every remaining expected revision is safely rebased in the
  same transaction or replaced by an explicit reconcile.

### Migration

Initialization migrates these legacy keys:

- `subman:state:v1`
- `subman:workspace-state:v2`
- `subman:workspace-mutation-queue:v1`
- their existing quarantine metadata

Phases are `not-started`, `copied`, `validated`, and `confirmed`. Each phase is
committed transactionally and can be retried. The copied records are validated
for Workspace identity, mutation schema, unique IDs, and contiguous expected
revisions. Invalid records are quarantined without diagnostics access to raw
content.

Legacy keys are read-only rollback sources until `confirmed`. After confirmation
they are removed and a non-sensitive completion marker remains. If IndexedDB is
unsupported, opening/upgrading fails, or a transaction aborts, the app enters
`invalid-local-storage` read-only repair state. It never falls back to split-key
writes.

Rollback before confirmation reads the untouched legacy keys. Rollback after
confirmation requires the locally exported sanitized metadata plus the last
validated snapshot from IndexedDB; tokens are independently retained according
to their session/persistent choice.

## Failure Dispositions

The shared classifier is exhaustive over coordinator and gateway codes. Unknown
codes fail closed as `operator-repair`; they never default to state conflict or
automatic retry.

| Disposition | Codes or conditions | Queue and UI behavior |
| --- | --- | --- |
| `state-conflict` | `revision_conflict`, `entity_deleted`, trusted identity/revision conflict | Keep queue and safe latest document; offer tombstone-aware Pull/Merge/Use Local. |
| `domain-conflict` | `duplicate_node_raw`, `duplicate_subscription_url`, `output_file_conflict`, `publication_file_mismatch`, `entity_exists` | Block the Workspace head; show safe mutation metadata and edit/discard/realign actions. |
| `auth-required` | GitHub 401, invalid/revoked token, permission 403 | Keep queue; stop delivery; reconnect without 5xx retry. |
| `queue-corruption` | `mutation_id_reused`, invalid local mutation, invalid success response, revision gap | Freeze and quarantine the Workspace queue; require explicit repair. |
| `operator-repair` | `migration_backup_conflict`, `mutation_recovery_failed`, `commit_index_failed`, journal continuity failure, unknown internal code | Fail closed with read-only operational guidance. |
| `retryable-upstream` | network error, timeout, 408, 429, GitHub 5xx | Persist exponential backoff, jitter, retry headers, and next attempt. |
| `permanent-upstream` | GitHub 404, 409/422 not represented by a domain code | Stop delivery and explain Workspace/upstream repair. |
| `invalid-request` | malformed mutation, unsupported schema, request/content/domain limits | Reject without retry; retain safe local data and show an actionable validation error. |

Responses add `disposition` and optional safe retry metadata. Only
`state-conflict` may include a validated latest document/revision. Public
messages are stable and safe; GitHub response bodies and credentials are never
returned.

## Sync State Machine

The store accepts events and returns a complete state. Arbitrary partial updates
are removed.

States:

- `local-only`
- `automatic-idle`
- `queued`
- `syncing`
- `retrying`
- `manual-local-only`
- `paused-state-conflict`
- `blocked-domain-conflict`
- `auth-required`
- `queue-repair-required`
- `operator-repair-required`
- `invalid-local-storage`
- `disconnected`

Events:

- `LOCAL_COMMITTED`
- `MUTATION_ENQUEUED`
- `SYNC_STARTED`
- `SYNC_COMMITTED`
- `SYNC_RETRY_SCHEDULED`
- `AUTH_LOST`
- `AUTH_RESTORED`
- `STATE_CONFLICT`
- `DOMAIN_BLOCKED`
- `QUEUE_CORRUPTED`
- `OPERATOR_REPAIR_REQUIRED`
- `REPAIR_SUCCEEDED`
- `WORKSPACE_BOUND`
- `WORKSPACE_DISCONNECTED`
- `STORAGE_QUARANTINED`

Every state includes active queue count, total queue count, orphan Workspace
count, blocked/dead-letter count, last committed revision, next attempt time,
safe recent error `{ code, disposition, messageKey }`, optional blocked mutation
metadata, and recovery notice. Successful commit, repair, auth restore, and rebind
transitions explicitly clear fields that are no longer valid. Illegal events
throw in development/tests and become an operator-safe error in production.

## Tombstone-Aware Merge

`workspace-merge.ts` is a pure three-way merge over local business data, trusted
remote `WorkspaceDocumentV2`, optional trusted baseline document, and explicit
per-entity choices.

- Remote tombstone plus unchanged or modified local entity resolves to deleted
  and records a notice; there is no restore mutation.
- Local deletion plus unchanged remote resolves to deleted via reconcile.
- Local deletion plus remote modification is an explicit conflict.
- Both live sides changed is an explicit conflict, independent of timestamps.
- Both sides added the same ID is an explicit conflict unless byte-equivalent.
- Missing baseline never grants local overwrite authority and produces explicit
  choices.
- Local/remote choices are deterministic and recorded by collection plus ID.
- Resolved output removes invalid aggregate selections, publish targets, and
  client exports; validates output ownership; and passes the full WorkspaceData
  validator.
- Use Local and Force Push first remove every remote-tombstoned ID and report
  what could not be restored.

## Queue Lease And Backoff

Each active Workspace dispatcher uses an IndexedDB lease with random owner ID,
monotonically allocated fencing token, expiry, heartbeat, and shared
`nextAttemptAt`. Acquire, renew, release, and backoff update are transactions.
Web Locks may reduce contention but are never the correctness boundary.

The owner checks its fence immediately before each request and after each await.
An expired or superseded owner cannot start another request. A new tab can take
over after expiry. BroadcastChannel only wakes peers; correctness remains when it
is absent.

Backoff is exponential with bounded full jitter, a maximum delay, persisted
attempt count, and server `Retry-After` or rate-limit reset as the lower bound.
Authentication restore and explicit Retry reset only eligible retry state.

## Gateway, Request, And Domain Limits

`GitHubGatewayError` exposes only operation, status, category, request ID,
retry-after, and rate-limit reset. Fetch helpers use AbortSignal timeouts for Gist
metadata, raw truncated files, and PATCH. The coordinator maps categories without
flattening every failure to 502. Durable Object promise serialization releases
the current operation in `finally` behavior already provided by the promise
chain; timeout tests prove later operations proceed.

A shared bounded JSON reader verifies JSON content type and counts streamed bytes,
including chunked bodies. Stable failures are 415 for content type, 400 for JSON,
and 413 with `request_too_large` for byte limits.

Central byte/count limits cover mutation body, output content, node raw,
subscription URL, names/labels/external keys, tags, collection entities, rename
maps, and serialized Workspace documents. Existing oversized legacy values remain
readable. Only created or edited fields are subject to creation limits; an
unrelated update does not reject untouched legacy content. Tombstone count is an
observability threshold, not a V2 rejection rule.

## Diagnostics And Security Headers

Diagnostics export only counts, safe Workspace/revision/mode metadata, mutation
ID/kind/revision/time, payload byte length and hash, retry/disposition metadata,
and quarantine key/bytes/time. It never reads a quarantine raw value into the
export object. Errors contribute stable code/disposition only, not raw messages or
stacks.

SvelteKit response hooks add CSP, `frame-ancestors`, Referrer-Policy,
X-Content-Type-Options, and Permissions-Policy. The first-paint theme script uses
the SvelteKit-supported nonce/hash path verified by build and response tests.
Token UX remains session-only by default and explicitly describes persistent
storage and active-XSS risk.

## Implementation Phases And Test Matrix

### Phase 1 - Characterization and contracts

- Add failing transaction-boundary, disposition-table, tombstone-merge, reducer,
  gateway-timeout, bounded-reader, and diagnostic-canary tests.
- Preserve the baseline single-writer tests and remove `@ts-nocheck` where the
  compiler API types allow it.
- Gate: focused Bun tests show failures for the intended missing behavior only.

### Phase 2 - Disposition, merge, and reducer

- Implement exhaustive error classification and safe API metadata.
- Implement pure tombstone-aware merge and conflict choices.
- Replace sync partial patches with reducer events and update status UI.
- Tests: every coordinator code; all five entity collections across delete,
  modify, add, and choice matrices; all legal/illegal state transitions.

### Phase 3 - Transactional persistence and migration

- Implement interface, IndexedDB adapter, in-memory fake, bootstrap migration,
  quarantine, read-only failure state, and app action service.
- Remove direct business snapshot localStorage writes from `stores/app.ts`.
- Tests inject failure before snapshot, between snapshot and queue, after queue
  before commit, after commit before memory, at every migration boundary, large
  payload quota failure, deferred consistency, token exclusion, and restart
  exactly-once behavior.

### Phase 4 - Lease, queue inspector, and retry

- Add fenced lease/backoff persistence and grouped queue repair service/UI.
- Tests use two persistence clients to prove single sender, expiry takeover,
  stale fencing rejection, shared offline backoff, and behavior without Web Locks
  or BroadcastChannel.
- Test Workspace switching, active/total/orphan counts, transactional full discard,
  identity-checked rebind, and no silent expected-revision gaps.

### Phase 5 - Gateway, bounds, diagnostics, and headers

- Implement sanitized gateway categories/timeouts and bounded route readers.
- Add domain limits with legacy compatibility.
- Rewrite diagnostics and add canaries for proxy URIs, subscription query tokens,
  both output types, reconcile, auth/session/persistent tokens, quarantine, and
  error stack.
- Add CSP/security headers and Token risk copy.
- Tests cover 401/403/404/409/422/429/5xx, timeout release, chunked oversize,
  domain boundaries, canary absence, and generated Worker response headers.

### Phase 6 - CI, E2E, controller extraction, and docs

- Add Bun-version-pinned least-privilege CI with concurrency cancellation and no
  secrets.
- Add a minimal Playwright layer for transaction failure, offline reload,
  two-tab lease, tombstone edit, domain conflict, repair indicator, queue groups,
  auth persistence, diagnostic redaction, and keyboard dialogs.
- Extract connection, conflict, queue repair, persistence, diagnostics, and sync
  status responsibilities only after behavior coverage is stable.
- Update design, operations, README, error, storage, queue repair, diagnostics,
  and design-only ADR documents.

### Final local gate

```bash
bun test
bun run check
bun run lint
bun run build
bun run test:cf
bun run test:e2e
```

Cloudflare tests mock every GitHub request and use no real secrets.

## Fault Injection Catalogue

- IndexedDB open, upgrade, request, and commit aborts, plus quota errors.
- Migration crash before copy, after copy, after validate, and before cleanup.
- Queue corruption: invalid schema, duplicate ID, revision gap, invalid success.
- Cross-tab races at acquire, renew, pre-fetch fence check, post-fetch fence check,
  backoff write, and expiry takeover.
- Fetch timeout for GitHub metadata, truncated raw file, PATCH, and browser route.
- GitHub status categories and malformed/rate-limited responses.
- Lost PATCH response with read-back commit proof and journal restart recovery.
- Oversized Content-Length and chunked bodies; exact-limit and one-byte-over.
- Diagnostic canaries in every prohibited field and arbitrary string format.
- Remote tombstone races against every live collection and dependent reference.

## Rollback

Browser persistence rollout is feature-gated during development. Before migration
confirmation, disabling it restores legacy reads because old keys remain. After
confirmation, rollback uses a compatibility build that reads the IndexedDB
snapshot but does not reintroduce split-key writes.

Worker rollback remains a forward deployment that retains the applied Durable
Object migration, binding, class export, and SQLite namespace. Do not deploy a
pre-Durable-Object bundle. `subman.v1.backup.json` remains immutable and is never
automatically deleted or replaced.

No rollback procedure compacts tombstones, prunes processed mutations, skips a
journal gap, or writes a real Gist during tests.

## Design-Only Follow-Up

Separate ADRs will define, without production implementation:

- Publication freshness using source revision/signature, content hash, observed
  remote hash, and current/stale/modified/missing states.
- Tombstone compaction using a watermark/snapshot protocol, offline-client safety
  proof, schema migration, rollback, and multi-device tests.
- Processed mutation retention using an idempotency window, continuity proof,
  audit requirements, namespace migration, and safe pruning proof.
- Authenticated read-only operator health, attestation, and recovery without
  automatically skipping a missing journal.
