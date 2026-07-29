# Workspace V2 Operations

This runbook covers deployment, first-write migration, verification, and
rollback for the Workspace Schema V2 coordinator.

## Runtime Contract

- `subman.json` is the authoritative Workspace V2 document.
- One `WorkspaceCoordinator` Durable Object is addressed by `gist:<gist-id>`.
- Every Workspace-mode browser and Server API mutation that can change
  `subman.json` goes through that coordinator.
- Browser state is committed through `WorkspacePersistence` into the
  `subman-workspace` IndexedDB v1 database. Snapshot, binding, per-Workspace
  queues, delivery metadata, and leases share one transaction boundary.
- Automatic Workspace-mode mutations are sent in revision order. Local-only,
  bind-only, manual-local-only, and paused modes do not send automatically.
- `subman.v1.backup.json` and `subman.bootstrap.json` are reserved recovery
  files. Generated outputs cannot replace or delete them.
- The coordinator accepts node, subscription, aggregate, publish-target, and
  client-export upserts/deletes; aggregate/client publication; `output.delete`;
  `workspace.bootstrap.cleanup`; and explicit `workspace.reconcile`. No browser
  page or Server API route may PATCH `subman.json` directly.

The checked-in Wrangler configuration binds `WORKSPACE_COORDINATOR` and creates
the SQLite-backed class with migration tag `v1`. Migration tags are immutable
deployment history; do not rename or remove an applied tag.

## Browser Operation Results

Workspace actions expose a submitted handle and an authoritative completion
result. `submitted` means only that synchronous validation accepted the request
and scheduled its task. It does not prove an IndexedDB transaction, queue entry,
or remote write. UI callers must await `completion` before clearing drafts,
closing editors, finalizing loading state, or reporting success.

| Completion status | Durable evidence | UI meaning |
| --- | --- | --- |
| `local-durable` | Snapshot and binding committed locally | Saved locally. Manual mode still requires Push; paused mode still requires conflict repair. |
| `local-durable-queued` | Snapshot and original mutation committed in IndexedDB | Saved locally and queued; remote commit is not proven. |
| `peer-owned` | Mutation remains in the persistent queue while another valid lease owns delivery | Saved locally; another tab is synchronizing. This is nonterminal. |
| `retry-scheduled` | Mutation and retry attempt, time, and stable error code are persisted | Saved locally; delivery is deferred or will retry. This is nonterminal. |
| `remote-committed` | Coordinator result and local binding, baseline, snapshot, and queue settlement agree | Saved to Workspace or published. This is the only publication-success result. |
| `conflict-or-blocked` | Local mutation remains durable with its exact disposition and stable code | Saved locally, but synchronization needs review or repair. |
| `rejected-before-durable-commit` | No reliable local transaction was established | Not saved. Retain drafts and show one final error. |
| `commit-acknowledgement-uncertain` | The core transaction may have committed, but durable evidence could not be reread | Never claim not saved. Retain the draft and reload before retrying to avoid duplication. |

The shared presenter exhaustively maps these results. Stores do not emit
operation toasts, and pages must not infer business state from thrown message
text. A durable queued, peer-owned, or retry-scheduled publication is not a
`Publish failed` outcome.

Before every browser business action, read the current IndexedDB record and
apply the intent to its latest snapshot. A transactional binding advance from a
peer raises a controlled concurrent-update result and permits one bounded replay
with the same mutation ID and timestamp. It is not storage corruption and does
not trigger quarantine. BroadcastChannel and Web Locks remain optional hints;
the persisted record, lease, fencing token, revision, and mutation sequence are
the correctness boundaries.

After the authoritative transaction commits, cache refresh, lease release, and
broadcast are secondary acknowledgement or cleanup work. Failures there cannot
downgrade the operation to rejected. The runtime rereads IndexedDB to prove the
commit; if proof remains unavailable, it returns acknowledgement uncertainty and
must not generate or submit a replacement mutation.

## Pre-Deployment Gate

Run the complete local gate:

```bash
bun test
bun run check
bun run lint
bun run build
bun run test:cf
bun run test:e2e
bun wrangler deploy --dry-run
```

Start the local Cloudflare runtime, inspect the health payload, and verify the
unauthenticated mutation boundary:

```bash
bun run dev:cf -- --ip :: --port 8787
curl -fsS "http://127.0.0.1:8787/api/health" | jq .
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:8787/api/workspaces/smoke/mutations")" = "401"
```

Wrangler local development uses local simulated bindings and Durable Object
storage by default. Without local secrets, health returns HTTP 200 with
`ok: false`; that is expected locally but is not production readiness. The
`bun run test:cf` gate exercises an authenticated Worker mutation through the
real Durable Object and SQLite journal with mocked GitHub I/O. Do not use
production GitHub credentials for disposable local migration fixtures.

The checked-in GitHub Actions workflow runs the same test, check, lint, build,
Cloudflare integration, and browser-test gates with read-only repository
permission. It receives no deployment credentials and never deploys or touches a
real Gist.

## Production Deployment

1. Confirm `GITHUB_TOKEN` and `SUBMAN_API_TOKEN` are configured as Worker
   secrets. Never place either value in `wrangler.toml`.
2. Export the current `subman.json` from each controlled migration Workspace.
3. Run the pre-deployment gate, including the Wrangler dry-run.
4. Deploy the Worker and Durable Object migration together with
   `bun run deploy`.
5. Require the deployed health payload to report both secrets:
   `curl -fsS "$SUBMAN_ORIGIN/api/health" | jq -e '.ok == true and
   .config.githubToken == true and .config.submanApiToken == true'`.
6. Use one controlled Workspace for the first browser or Server API mutation.
7. Inspect the Gist and confirm the migration evidence below before widening
   use.

Deployment or production Gist mutation requires explicit operator approval.
Commit `c89a60b` is the tested V1-behavior compatibility artifact: it retains
the `v1` Durable Object migration, binding, and class export while browser and
Server API writes still use the verified V1 transaction path.

## First-Write Migration

Existing V1 Gists are not rewritten during discovery. On the first successful
coordinator mutation, the Durable Object performs one verified Gist PATCH that:

1. Copies the exact original `subman.json` bytes to
   `subman.v1.backup.json`.
2. Converts all business collections to the V2 document.
3. Applies the requested mutation.
4. Writes the new `subman.json` and any publication output together.

If a backup already exists but does not exactly match the current V1 file, the
write stops with `migration_backup_conflict`. Do not replace that backup until
the mismatch has been investigated.

A new Workspace starts with only `subman.bootstrap.json`. Its first coordinator
mutation creates V2 `subman.json` and deletes the bootstrap marker in the same
verified PATCH.

## Browser Persistence Migration

The browser database is `subman-workspace`, version 1, with one transactional
`workspace-state` root. It contains:

- The validated business snapshot and Workspace binding/baselines.
- Per-Workspace ordered mutations plus retry, blocked, and dead-letter metadata.
- Dispatcher leases and the next fencing token.
- Safe quarantine metadata and separately inaccessible repair payloads.
- Migration phase and timestamps.

GitHub tokens are never fields in this database. Session storage is the default;
localStorage is used for a token only after Remember token is explicitly enabled.
That persistent choice remains readable to same-origin JavaScript and therefore
does not protect against active XSS.

Initialization imports `subman:state:v1`, `subman:workspace-state:v2`,
`subman:workspace-mutation-queue:v1`, and legacy quarantine records. Each of
`not-started`, `copied`, `validated`, and `confirmed` is a transaction boundary.
Identity, mutation schema, unique IDs, and contiguous expected revisions are
validated before confirmation. Invalid legacy records are quarantined rather
than silently discarded.

Before confirmation, untouched legacy keys are rollback sources. After
confirmation, the legacy keys are removed and IndexedDB plus its migration
evidence are authoritative. If IndexedDB is unsupported, upgrade fails, quota is
exhausted, a transaction aborts, or stored data is corrupt, keep the application
in `invalid-local-storage` read-only repair mode. Do not clear storage, create a
new localStorage fallback, or resume delivery until the cause and retained
metadata have been inspected.

## Queue Inspection And Repair

Queue inspection groups work by Workspace and reports active, total, orphan,
blocked, and dead-letter counts. A Workspace can become orphaned after a switch
or disconnect; its mutations remain preserved until an explicit action is taken.

All runtime surfaces derive the same metrics from the persistence record:

- `activeQueueCount` is the pending mutation count for the active Workspace.
- `totalQueueCount` is the pending mutation count across every Workspace.
- `orphanedWorkspaceCount` counts each non-active Workspace that retains pending,
  blocked, or dead-letter evidence.
- `blockedMutationCount` counts Workspace queues with blocked mutation metadata.
- `deadLetterCount` is the total retained dead-letter count.

- **Retry** clears only eligible persisted retry state and wakes delivery.
- **Discard** removes the complete selected Workspace queue transactionally.
- **Rebind** requires an identity-checked snapshot and binding before making the
  selected Workspace active. Dead-letter evidence remains repair-required and is
  not described as repaired merely because the binding changed.
- **Repair** replaces the complete queue with a validated, contiguous sequence or
  an explicit reconcile. Never delete only the head and leave a revision gap.
- **Quarantine** freezes corrupt queue data and retains only safe metadata in
  normal inspection and diagnostics.

Domain conflicts keep the head blocked for edit, discard, or realign. State
conflicts keep the trusted latest document for tombstone-aware Pull, Merge, or
Use Local. Merge is a three-way comparison against the trusted baseline;
`updatedAt` is not overwrite authority, and a remote tombstone cannot be removed
by an ordinary upsert or reconcile.

## Leases, Retry, And Upstream Failures

Each Workspace dispatcher acquires a persisted lease with a random owner ID,
monotonic fencing token, expiry, and heartbeat. It checks the fence before a
request and after every await. An expired or superseded owner cannot send the
next mutation. Web Locks may reduce contention and BroadcastChannel may wake
peers, but neither is required for correctness.

Retryable network, timeout, HTTP 408/429, and GitHub 5xx failures retain the same
mutation ID and use persisted bounded exponential backoff with jitter. Safe
`Retry-After` and rate-limit reset metadata provide the lower bound. GitHub
metadata, truncated raw-file reads, PATCH requests, and browser mutation requests
have explicit timeouts so one stalled operation cannot hold the queue forever.
Authentication failures stop delivery until reconnect; permanent upstream,
domain, queue-corruption, and operator-repair failures are never treated as
generic 5xx retries.

## Failure Dispositions

| Disposition | Typical cause | Operator action |
| --- | --- | --- |
| `state-conflict` | Revision/identity conflict with a trusted latest document | Pull, tombstone-aware Merge, or Use Local. |
| `domain-conflict` | Duplicate resource, output ownership, or existing entity | Edit, discard, or realign the blocked mutation. |
| `auth-required` | GitHub 401/403 or missing/revoked browser token | Reconnect; do not 5xx-retry. |
| `queue-corruption` | Reused mutation ID, invalid response, or revision gap | Freeze and explicitly repair/quarantine the queue. |
| `operator-repair` | Backup, recovery, commit-index, journal, or unknown internal failure | Remain read-only and follow the runbook. |
| `retryable-upstream` | Network, timeout, 408, 429, or GitHub 5xx | Keep the queue and use persisted backoff. |
| `permanent-upstream` | GitHub 404 or non-domain 409/422 | Stop delivery and repair Workspace/upstream state. |
| `invalid-request` | Invalid JSON/schema/mutation or a request/domain limit | Correct the input; do not retry unchanged data. |

Only `state-conflict` may include a validated latest document and revision. Error
responses expose stable codes/dispositions and bounded gateway metadata, never
GitHub bodies, credentials, arbitrary exception messages, or stacks.

## Limits, Diagnostics, And Headers

Incoming JSON must use `application/json` or a `+json` media type and is limited
to 9 MiB, including streamed/chunked bodies. Stable failures are 415
`unsupported_media_type`, 400 `invalid_json`, and 413 `payload_too_large`.

Current UTF-8/count limits are: output 1 MiB, node raw 16 KiB, subscription URL
8 KiB, name 256 bytes, label 128 bytes, external key 256 bytes, 64 tags per
entity, 5,000 entities per collection, 1,000 rename entries/64 KiB per rename
map, and 8 MiB for canonical serialized `subman.json`. New and edited values must
fit. Unchanged oversized legacy fields remain readable and can be reduced;
tombstones above 10,000 per collection produce an observability warning but are
not rejected or compacted.

Diagnostics export only counts; safe Workspace, revision, and mode metadata;
mutation ID/kind/revision/time plus payload byte length and SHA-256; retry and
disposition metadata; and quarantine key/bytes/time. They never read quarantine
raw values or export proxy/subscription data, output content, complete documents,
tokens, arbitrary errors, messages, or stacks.

Production responses must carry CSP with `frame-ancestors`, Referrer-Policy,
X-Content-Type-Options, and Permissions-Policy. The first-paint theme script must
use the build-tested nonce/hash path. Treat missing headers, a blocked theme
script, or persistent-token copy that omits active-XSS risk as a release failure.

## Verification Evidence

The pre-deployment gate proves retry idempotency, SQLite credential exclusion,
the Worker-to-Durable-Object path, and reserved-file enforcement. For the
controlled production Workspace, verify:

- `subman.json` has `version: 2`, `schemaVersion: 2`, the expected
  `workspaceId`, and a positive `revision`.
- `subman.v1.backup.json` is byte-for-byte equal to the pre-migration V1
  export.
- A browser publication and a Server API node update both remain present.
- API responses contain no unrelated Workspace data or credentials.
- Browser diagnostics contain no canary payloads, quarantine raw values, tokens,
  arbitrary error messages, or stacks.
- A two-tab lease test proves one sender, expiry takeover, stale-fence rejection,
  and persisted retry timing without relying on Web Locks/BroadcastChannel.
- Exact-limit and one-byte-over tests cover request and domain limits; generated
  Worker responses contain the required security headers.
- Repeating the same controlled external-key Server API operation keeps one
  node with the same identity. Each accepted HTTP request may still advance the
  Workspace revision because it has a new mutation ID and update timestamp.

## Rollback

Rollback is an operator-controlled data restoration, not a Wrangler migration
reversal:

For browser persistence, an interruption before `confirmed` may restart from the
untouched legacy keys. After confirmation and cleanup, do not recreate split-key
writes: retain/export safe migration metadata and recover the last validated
snapshot from IndexedDB. Tokens follow their independent session/persistent
choice and are not part of persistence rollback.

1. Stop or disable V2 writers so a compatibility Worker cannot race the
   coordinator.
2. Export the current V2 `subman.json` for forward recovery.
3. Restore the exact `subman.v1.backup.json` content as `subman.json`.
4. In an isolated worktree at `c89a60b`, run its complete gate and deploy it as
   a normal forward deployment. This artifact restores V1 application behavior
   while retaining the applied `v1` migration, `WORKSPACE_COORDINATOR` binding,
   and exported `WorkspaceCoordinator` class:

   ```bash
   git worktree add --detach /tmp/subman-v1-compat c89a60b
   cd /tmp/subman-v1-compat
   bun install --frozen-lockfile
   bun test
   bun run check
   bun run lint
   bun run test:cf
   bun wrangler deploy --dry-run
   bun run deploy
   ```

5. Verify the V1 UI against the restored Gist before reopening writes.

Do not deploy or use Wrangler rollback to a pre-Durable-Object Worker version:
Cloudflare Durable Object migrations are atomic lifecycle changes, and that
older bundle lacks the required binding and class export. Keep the Durable
Object namespace and SQLite records in place. V2-only edits cannot be translated
back to V1 automatically; retain the V2 export for later reconciliation.

If V1 writes resume, the restored `subman.json` will eventually diverge from
the immutable original `subman.v1.backup.json`. Before a later V2 re-upgrade,
stop V1 writers, export both files, archive the original backup outside the
reserved filename, and deliberately remove the stale backup from the Gist. The
next controlled coordinator mutation will create a new byte-exact backup of the
current V1 document. Never replace or delete the reserved backup as an automatic
recovery action.
