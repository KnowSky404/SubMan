# Cloud Workspace Reset

Date: 2026-11-01
Status: Implemented and locally verified
Base: `243db4cc4272e7e4772355fcc7f8e06a84976259`
Task branch: `feat/cloud-reset`

## Outcome

Settings offers **Reset cloud data** next to the existing device recovery action.
After a confirmed cloud commit, the current device remains authenticated and bound
to the same private Gist, with the empty business state seen after first setup.
The action affects every device connected to that Gist.

Device reset remains a separate local operation. Cloud reset does not create or
delete a Gist, clear credentials, change Workspace identity, or erase GitHub
revision history. It does not offer browser backup/import, switching, local push,
merge, or force overwrite.

## Scope and ownership

Reset clears all live `nodes`, `subscriptions`, `aggregates`, `publishTargets`,
and `clientExports`. It removes existing output files only when current publication
metadata proves SubMan published them. An unowned file, an unpublished same-name
file, or a retained historical output without sufficient ownership evidence is
preserved and appears in the confirmation preview.

`subman.json` remains the authoritative Schema V2 document. The immutable
`subman.v1.backup.json`, external files, historical tombstones, processed mutation
journal, orphan browser queues, quarantine evidence, and fencing counters remain.
Existing bootstrap cleanup rules remain owned by the coordinator.
When a stale bootstrap marker is visible in the inventory, the reset preview
lists it for cleanup rather than promising to preserve it.

## Entry and confirmation

1. Show a separate destructive Settings section beside **Reset this device**.
2. Require authentication, an initialized automatic V2 binding, successful cloud
   loading, and no active pending, blocked, or dead-letter queue. Refuse active
   dispatcher leases. Existing reload/repair resolves pending evidence first.
3. Read only the originally bound Gist. Validate the cloud document, then safely
   align the local baseline using the existing compare-and-swap refresh boundary.
4. Prepare a preview containing Gist ID, revision, reset revision, counts for all
   five resource collections, files to remove, files to preserve, and the complete
   local snapshot/binding/active-queue expectation.
   Derive deletion names from the authoritative document, without filtering them
   through a separately read Gist inventory that may predate a concurrent publish.
5. Use the shared accessible Dialog. Explain the cross-device impact and retained
   files; require literal `RESET`. Cancellation sends no mutation.
6. Pin the preview's local expectation and cloud revision. A changed snapshot,
   binding, queue, active lease, or cloud revision rejects this attempt and requires
   a fresh preview and confirmation. Reset never automatically reprepares itself
   against newer data.

## Coordinator mutation

Add browser-only `workspace.reset` with an empty payload to the internal mutation
protocol. The public Server API does not expose reset or change its request or
response contract.

The existing coordinator serializes the operation for `gist:<gist-id>`. It checks
identity, request hash, pending recovery, authorization, expected revision, and
reset boundary using the existing order and guarantees. It then:

- Appends tombstones for every live entity, retaining all earlier tombstones.
- Clears the five business collections.
- Advances revision by one and sets `lastMutationId` and commit timestamp normally.
- Sets `resetRevision` to this committed revision.
- Produces deletions only for provably published SubMan output files.
- Journals the candidate before sending one Gist PATCH containing the new
  `subman.json` and all output deletions.
- Reads back and verifies the candidate and file effects before confirming it.

A repeated mutation ID with the same request hash returns its stored receipt
without executing reset again. Existing processed retries remain recoverable even
after later writes or resets. Unresolved pending recovery, invalid documents,
backup mismatch, and ambiguous upstream writes continue to fail closed.

## Reset boundary and compatibility

Schema V2 gains optional `resetRevision`; mutation envelopes gain optional
`expectedResetRevision`. Absence means zero for comparison. A new mutation is
accepted only if its observed reset revision equals the document's reset revision.
Ordinary mutations preserve the document boundary. Another reset advances it.

This supplements revision checks and tombstones: an old queued creation can have
an ID that never reached the cloud and therefore has no tombstone. Local CAS retry,
delayed actions, or compatibility reconcile must not silently repackage that old
intent with a new reset boundary.

- Capture the initial Workspace identity and reset boundary when accepting an
  action, before asynchronous preparation. Recheck after every persistence read
  and bounded ordinary CAS retry. A boundary change rejects the old intent.
- A batch import pins one boundary for the whole batch. Stop on reset or any
  non-remote outcome; retain its draft instead of submitting later rows as fresh
  actions in the new generation.
- Persist envelopes with their originally observed boundary; never rewrite it at
  dispatch time. Remote conflicts block the complete queue for explicit repair.
- Reject old-boundary reconcile/repair and delayed resolved snapshots. Cloud reload
  may replace a complete old queue only through existing explicit confirmation.
- An already-committed old mutation may acknowledge its historical receipt and
  hydrate the latest cloud state; remaining old queue entries stay blocked and
  are not replayed into the new generation.
- Server API adapters capture the boundary from their own cloud read and place it
  in their internal envelope. Public clients need no new field.

Keep optional fields absent in historical parsing, serialization, request hashes,
and document signatures. Do not inject zero into existing envelopes: that would
change the request hash for an original mutation ID. Include a nonzero reset
boundary in document signatures and preserve old pending-journal verification.
New documents first emit the boundary on actual reset. Older strict clients stop
on the unfamiliar field and must reload the updated application.

## Browser durability and presentation

Use the existing `WorkspacePersistence` root and transaction boundary. Reset's
original envelope, optimistic snapshot, and unchanged binding are committed
atomically before dispatch. Persistence also verifies the full preview expectation
and idle active queue/lease inside that transaction; a read-only preflight alone
is insufficient.

Await the operation completion. Only `remote-committed` allows **Cloud data reset**
success wording and finalization. Pending, peer-owned, retry-scheduled, blocked,
and acknowledgement-uncertain outcomes use the shared operation presenter and
retain the operation identity. Eligible upstream retries use existing bounded
backoff and the same mutation ID. Editing remains blocked while delivery is
pending. A post-commit local read or presentation failure cannot turn cloud success
into a fresh destructive attempt.

After confirmation, atomically settle the queue with the authoritative empty
snapshot and baseline. Keep Gist binding, authentication preference, and token.
Broadcast existing commit/state events as hints; correctness must survive missing
BroadcastChannel or Web Locks.

## Validation and acceptance

Add behavior tests before implementation in each affected layer:

| Layer | Required evidence |
| --- | --- |
| Document/mutation | Optional-field compatibility; unchanged old hashes/signatures; five collections cleared; tombstones retained/appended; monotonic revision; browser-only reset; output ownership |
| Coordinator | Single PATCH; immutable backup; duplicate request; timeout after actual commit; read-back recovery; competing write/reset rejects stale preview |
| Persistence | Preview CAS including snapshot/queue; active lease; rollback before commit; durable post-commit recovery; unchanged Gist identity and token exclusion |
| Browser actions | Old intents and unseen UUID creations cannot cross reset during asynchronous preparation or CAS retry; explicit reset never retries with a newer revision |
| Delivery/repair | Old queue conflict; historical receipt recovery; remaining old queue retained and blocked; safe explicit whole-queue cloud reload |
| Server API | Empty reads after reset; fresh writes succeed; pre-reset internal envelopes conflict; public OpenAPI contract unchanged |
| UI/E2E | Cancel sends zero writes; typed confirmation; resource/file preview; cloud confirmation precedes success; token/binding retained; pending outcome; desktop and Chinese mobile flow |

Run repository docs, unit, type, lint, build, Workers runtime, and relevant browser
checks with Bun 1.3.14. Use isolated worktree dependencies, Worker state, output,
browser state, and ports. Test GitHub through mocks, never a real user Gist.

## Delivery boundary

Implement and verify in the dedicated task worktree and create an atomic local
Conventional Commit. Push, PR creation, merge, Wiki publication, and production
deployment require authorization beyond this local implementation request.

## Local verification evidence

Verified with Bun 1.3.14 in the dedicated task worktree:

- 758 unit tests across 74 files passed.
- 10 Workers/SQLite integration tests passed, including reset receipt recovery
  and stale-preview HTTP rejection.
- All 81 browser cases passed in isolated groups (41 + 20 + 20). The seven reset
  cases passed again after the final confirmation layout adjustment.
- Desktop 1280 x 720 and Chinese mobile 390 x 844 confirmation flows were inspected.
  The warning initially stays visible; the confirmation input remains fully in
  view while editing, with no framework overlay or unexpected console errors in
  the normal preview flow.
- Documentation, Svelte/type/generated Worker type checks, lint, build, sing-box
  1.14 output validation, and deployment dry-run passed.
- Independent local review findings about first-read races, batch boundaries,
  and incomplete deletion previews were reproduced and resolved with regression
  tests. Removing the browser action guard in an isolated copy made all three
  new guard regressions fail, confirming their effectiveness.

GitHub calls used test fixtures and mocks. No real Gist was accessed or changed,
and these checks do not claim production deployment or live GitHub acceptance.
