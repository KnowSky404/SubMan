# Workspace V2 Operations

English | [简体中文](workspace-v2-operations.zh-CN.md)

This runbook covers deployment, first-write migration, verification, and
rollback for the Workspace Schema V2 coordinator.

## Runtime Contract

- `subman.json` is the authoritative Workspace V2 document.
- One `WorkspaceCoordinator` Durable Object is addressed by `gist:<gist-id>`.
- Every browser and Server API mutation that can change `subman.json` goes
  through that coordinator. The public API contract is unchanged; browser
  mutations remain an internal protocol.
- The browser has one cloud binding, with no Workspace list or switching. Both
  rebind and queue-repair transactions reject replacing an active binding with
  another Gist, including competing browser tabs and legacy recovery paths.
  A confirmed device reset may explicitly remove the binding before a separate
  fresh connection; it never selects or creates a replacement Gist itself.
- Startup loads the latest cloud document before enabling business pages. Login
  and token replacement retain the existing Gist identity; a failed lookup must
  never fall through to another Gist or create a new one. An ambiguous initial
  discovery requires the original Gist ID.
- Browser cache, delivery journal, retry metadata, leases, and historical queue
  evidence share the `subman-workspace` IndexedDB v1 transaction boundary through
  `WorkspacePersistence`. This is technical recovery state, not a local business
  mode or a second source of truth. The database schema is unchanged.
- Every valid business action requires authentication, a freshly loaded automatic
  binding, and no unresolved active delivery. It journals one mutation, sends it
  immediately, and awaits cloud confirmation. Pending, manual, paused, and
  disconnected states reject new business changes.
- Settings offers cloud reload and recovery, not local push, merge, force
  overwrite, bind-only, manual synchronization, or business JSON backup/import.
  A new bootstrap starts from empty cloud data, never an old browser cache.
- `subman.v1.backup.json` and `subman.bootstrap.json` are reserved recovery
  files. Generated outputs cannot replace or delete them.
- The coordinator accepts node, subscription, aggregate, publish-target, and
  client-export upserts/deletes; aggregate/client publication; `output.delete`;
  `workspace.bootstrap.cleanup`; explicit `workspace.migrate`; and
  `workspace.reconcile`. No browser
  page or Server API route may PATCH `subman.json` directly.

The checked-in Wrangler configuration binds `WORKSPACE_COORDINATOR` and creates
the SQLite-backed class with migration tag `v1`. Migration tags are immutable
deployment history; do not rename or remove an applied tag.

## Browser Operation Results

Historical manual or conflict-paused pending queues are retained without
automatic delivery. Use the confirmed **Reload from Cloud** recovery flow;
upgrading must not publish a previous browser snapshot.

Workspace actions expose a submitted handle and an authoritative completion
result. `submitted` means only that synchronous validation accepted the request
and scheduled its task. It does not prove an IndexedDB transaction, queue entry,
or remote write. UI callers must await `completion` before clearing drafts,
closing editors or reporting success. Only cloud confirmation finalizes a draft;
a deferred result may end the current loading indicator while retaining the
draft and the original pending mutation.

| Completion status | Durable evidence | UI meaning |
| --- | --- | --- |
| `local-durable` | Historical compatibility result for a locally committed snapshot | Not a cloud save; cloud-only business actions do not produce this result. Retain the draft. |
| `local-durable-queued` | Snapshot and original mutation committed in IndexedDB | Pending cloud confirmation; retain the draft and journal. |
| `peer-owned` | Mutation remains in the persistent queue while another valid lease owns delivery | Saved locally; another tab is synchronizing. This is nonterminal. |
| `retry-scheduled` | Mutation and retry attempt, time, and stable error code are persisted | Saved locally; delivery is deferred or will retry. This is nonterminal. |
| `remote-committed` | Coordinator result and local binding, baseline, snapshot, and queue settlement agree | Saved to Workspace or published. This is the only publication-success result. |
| `conflict-or-blocked` | Local mutation remains durable with its exact disposition and stable code | Saved locally, but synchronization needs review or repair. |
| `rejected-before-durable-commit` | No reliable local transaction was established | Not saved. Retain drafts and show one final error. |
| `commit-acknowledgement-uncertain` | The core transaction may have committed, but durable evidence could not be reread | Never claim not saved. Retain the draft and reload before retrying to avoid duplication. |

The shared presenter exhaustively maps these results. Stores do not emit
operation toasts, and pages must not infer business state from thrown message
text. Only `remote-committed` reports success and finalizes the draft. A durable
queued, peer-owned, or retry-scheduled publication remains pending; preserve its
identity and block additional business edits until settlement or explicit repair.

Before every browser business action, require a ready authenticated cloud
session, read the current IndexedDB record, reject pending/blocked delivery, and
apply the intent to the latest validated cache of the cloud snapshot. A transactional binding advance from a
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
bun run docs:check
bun test
bun run test:sing-box
bun run check
bun run lint
bun run build
bun run test:cf
bun run test:e2e
bun run deploy:check
```

Use Bun 1.3.14 and `bun install --frozen-lockfile`. The sing-box gate requires
Docker; E2E needs installed Chromium. `check` includes generated Worker types.

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

Browser connection detects a recognized V1 document and presents an explicit
migration preview before binding or changing the cached snapshot. The user can
cancel, recheck, or choose **Migrate and load Workspace**. Initial setup may check
an explicit original Gist ID. The separate legacy check requires that ID and is
available only while unbound; it reads without creating a Gist. Connected devices
always retain the same Gist and do not scan or switch to other candidates.
Description, filename, document validity, and identity checks still apply. There
is no local backup download or business JSON import in this flow. Preserve any
historical local-only evidence for separate operator recovery instead of
silently sending it or replacing the selected cloud data.
The internal browser `workspace.migrate` mutation carries only `sourceSha256`,
the SHA-256 hash of the exact previewed V1 bytes. It changes no business entities
or publication metadata and sends no output-file changes. The Gist ID, output
filenames, output contents, publication timestamps, and recorded URLs remain
unchanged. Output files without saved publish targets are retained too.

The coordinator checks the source hash again before journaling or writing.
A changed preview or a different current schema returns `revision_conflict`;
the user must recheck rather than overwrite the remote document. The browser
persists the migration envelope before delivery, reuses its mutation ID on retry,
and refuses to flush unrelated pending mutations or discard dead-letter evidence.
Only `remote-committed` closes the migration preview and reports completion.
This operation and `/api/workspaces/:workspaceId/mutations` remain internal browser
protocols, not supported third-party integration surfaces.

This applies to V1 documents accepted by the current strict parser, not every
historical file. Missing legacy optional collections, `allowedTypes`, and
publication transition fields are normalized; unknown fields, invalid timestamps,
duplicate IDs, and dangling references reject the document. Gist discovery also
requires the exact description `SubMan-Data` and the recognized config filename.
The legacy browser snapshot path uses current snapshot validation and can
quarantine shapes that the V1 Gist parser accepts. Output files alone do not
reconstruct publish targets. See the
[user migration guide](legacy-workspace-migration.md) for backup,
offline audit, V1 conversion, and manual recovery steps.

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
confirmation, the legacy keys are removed and IndexedDB retains the validated
cache and technical migration evidence. Cloud `subman.json` remains the
authoritative business document. If IndexedDB is unsupported, upgrade fails, quota is
exhausted, a transaction aborts, or stored data is corrupt, keep the application
in `invalid-local-storage` read-only repair mode. Do not clear storage, create a
new localStorage fallback, or resume delivery until the cause and retained
metadata have been inspected.

## Queue Inspection And Repair

Queue inspection groups technical evidence by original Workspace identity and
reports active, total, orphan, blocked, and dead-letter counts. Retained orphan
queues may come from earlier versions. Removing Workspace switching must not
delete, rebind, or automatically deliver that evidence. It remains inspectable
until an explicit whole-queue discard or a separate operator recovery.

All runtime surfaces derive the same metrics from the persistence record:

- `activeQueueCount` is the pending mutation count for the active Workspace.
- `totalQueueCount` is the pending mutation count across every Workspace.
- `orphanedWorkspaceCount` counts each non-active Workspace that retains pending,
  blocked, or dead-letter evidence.
- `blockedMutationCount` counts Workspace queues with blocked mutation metadata.
- `deadLetterCount` is the total retained dead-letter count.

- **Sync from Cloud** first resumes eligible pending delivery with the original
  IDs, then loads the latest cloud document. Retry timing and blocked dispositions
  remain authoritative; an unresolved queue prevents a successful refresh.
- **Reload from Cloud** requires confirmation before abandoning all active
  pending changes. It validates the original Gist and atomically replaces the
  complete queue and cached snapshot with the latest cloud state.
- **Retained previous queues** show only safe recovery metadata. Their explicit
  discard removes the complete selected queue; they cannot switch the current
  binding or become an alternative business mode.
- **Repair** uses complete validated sequences and compare-and-swap checks for
  the current snapshot, binding, and queue. A cloud refresh racing a new edit
  must reject and re-read instead of silently dropping the new mutation.
- **Quarantine** freezes corrupt queue data and retains only safe metadata in
  normal inspection and diagnostics.

State conflicts retain the trusted latest document and pending work. The user
may explicitly discard the complete queue and reload cloud data, then reapply an
edit against the new revision. There are no local overwrite or merge controls.
Domain conflicts and repair evidence remain blocked until resolved or explicitly
discarded; timestamps never authorize overwrite and remote tombstones stay
protected. Logout clears authentication and stops delivery without deleting the
binding, cache, pending mutation identities, or recovery evidence.

## Device Reset After An Unavailable Gist

Ordinary reconnect remains pinned to the original Gist. A 404 does not prove
deletion: it may also reflect missing access. First check the token and original
Gist if recovery is intended. If the user deliberately removed it or chooses to
abandon the current local connection, Settings offers **Reset this device** even
without authentication or a successful cloud load.

The user must confirm loss of the current cached business snapshot and complete
active queue. Close other SubMan tabs before confirming. In one
`WorkspacePersistence` transaction, reset compares the inspected binding,
snapshot, and active queue, rejects an unexpired active dispatcher lease, clears
that binding and complete queue, and writes an empty unbound snapshot. It retains
historical orphan queues, quarantine metadata and inaccessible raw evidence, and
the monotonically allocated fencing counter. It records completed migration so
legacy localStorage cannot restore the abandoned binding or cache.

The initiating tab clears authentication only after the transaction commits.
Other same-origin tabs refresh their persistent state; delayed cloud reads,
captured queue heads, and delivery acknowledgements cannot restore the old
binding. Persisted compare-and-swap and fencing checks enforce this even when
cross-tab notifications are unavailable. An active-delivery or concurrent-change
rejection requires waiting or refreshing and a new confirmation; unavailable or
failed storage remains fail-closed without a success report.

Reset sends no GitHub or coordinator mutation requests, deletes no cloud files,
and does not reconnect automatically. The user subsequently enters a token and
chooses **Connect**. Unbound discovery then loads existing cloud data or creates
an empty private bootstrap Gist and initializes it through the coordinator. The
discarded browser cache is never uploaded as business authority. Safe historical
queue evidence remains in Sync recovery and is never automatically rebound or
delivered.

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
| `state-conflict` | Revision/identity conflict with a trusted latest document | Review pending evidence; confirm complete-queue discard and reload cloud data. |
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

For external-key node writes, the resulting `external:<key>` tag also consumes
label bytes and a tag slot: new/changed keys fit 119 UTF-8 bytes and leave room
for at most 63 caller tags. The 256-byte mutation key limit alone does not make
a new key admissible.

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

Rollback is an operator-controlled disaster-recovery procedure requiring
separate approval and an explicit restoration plan. It is not routine browser
repair, a way to bypass revisions/tombstones, or a Wrangler migration reversal.
The historical compatibility artifact below must be revalidated before use:

For browser persistence, an interruption before `confirmed` may restart technical
migration from the untouched legacy keys. After confirmation and cleanup, do not recreate split-key
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
