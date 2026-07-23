# ADR 0001: Deferred Workspace Protocol Extensions

- Status: Proposed, design only
- Date: 2026-07-23
- Applies to: Workspace V2 coordinator, Gist document, and SQLite journal

## Decision

Workspace V2 keeps its current wire format and retention behavior during the
reliability hardening release. Publication freshness, tombstone compaction,
processed-mutation pruning, and operator recovery require explicit protocol
versions and compatibility proofs. None of the fields or cleanup algorithms in
this ADR may enter the production path without a follow-up ADR, migration plan,
and the tests listed below.

## Publication Freshness

A future publication record should distinguish the Workspace revision used to
render content from what is currently stored in the output file:

```ts
type PublicationEvidenceV3 = {
  publishedFromRevision: number;
  sourceSignature: string;
  contentHash: string;
  remoteObservedHash: string | null;
  freshness: "current" | "stale" | "externally-modified" | "missing";
};
```

The coordinator computes all hashes from canonical bytes. The browser may show
evidence but cannot assert it. `current` requires the current owner source
signature and a matching remote-observed hash. A changed owner source makes the
record `stale`; a mismatched remote file makes it `externally-modified`; an
absent file makes it `missing`. Publication and evidence still commit in one
Gist PATCH.

Migration starts with evidence absent and reports freshness as unknown until a
coordinator read or publish establishes it. Rollback ignores additive evidence.
Tests must cover canonical hashing, same-PATCH evidence, owner rename/delete,
external file edits, missing files, retry idempotency, and V2 readers receiving
the proposed higher schema rather than partially interpreting it.

## Tombstone Compaction

Wall-clock age is insufficient because a long-offline client can retain an old
baseline. Compaction requires a server-issued snapshot generation and a
per-device acknowledgement watermark:

```text
snapshot generation G contains all live entities and tombstones through R
device D acknowledges G only after replacing its baseline and pending queue
coordinator may compact through R only when every registered, non-retired D
acknowledges G and the rollback window has elapsed
```

Safety argument: a client allowed to submit mutations must present a generation
at least as new as the compaction generation. An older client is forced to pull
the snapshot and rebase; it cannot recreate an omitted ID through an ordinary
upsert or reconcile. Device retirement is an authenticated, explicit operator
action and is itself journaled.

The schema migration must add the generation, compaction watermark, device
acknowledgements, and retired-device evidence before deleting any tombstone.
Rollback retains a pre-compaction snapshot plus the removed tombstone segment
until all supported clients have crossed the rollback horizon.

Compatibility tests must model two or more devices, long offline periods,
queued mutations predating the watermark, device retirement, restore from the
pre-compaction snapshot, mixed client versions, interrupted compaction, and an
attempted resurrection for every entity collection. No time-only deletion test
is acceptable as a safety proof.

## Processed Mutation Retention

The current journal remains unbounded. A future bounded design must define an
idempotency window in revisions and time, but pruning is legal only after its
request hashes and outcomes are covered by a signed continuity checkpoint.

Each checkpoint should bind the Workspace namespace, first and last retained
revision, the preceding checkpoint hash, the processed mutation Merkle root or
equivalent deterministic digest, and the remote document signature. Namespace
migration creates a new chain whose first checkpoint references the previous
namespace terminal checkpoint. Audit exports retain checkpoints longer than
the online replay window.

Pruning proof: a retry inside the advertised window still resolves to its exact
stored result; a retry outside the window receives a stable expired-idempotency
response and never executes under the old mutation ID; journal continuity from
the latest retained row to the remote revision is independently verifiable.

Tests must cover boundary revisions and timestamps, hash collisions, retries on
both sides of the window, restart during checkpoint creation, partial pruning,
namespace migration, rollback to the last unpruned checkpoint, and audit-chain
verification. Production keeps all `processed_mutations` rows until this proof
and its operational retention policy are approved.

## Operator Recovery

Recovery begins with an authenticated, read-only health endpoint. It returns
only safe attestation metadata:

- Workspace ID hash and current remote revision.
- Latest committed and pending journal revisions.
- Continuity status and checkpoint identifiers.
- Remote document signature and immutable backup status.
- Stable error code, disposition, and recommended runbook action.

It never returns credentials, mutation payloads, output content, complete
documents, raw GitHub errors, or quarantine contents. A health read cannot
write SQLite or the Gist.

Recovery is a separate, authenticated command with a dry-run attestation. The
operator supplies the expected Workspace identity, revision, document
signature, journal boundary, and one-time request ID. The coordinator applies a
reviewed recovery mode only when every expectation still matches. Missing
journal rows are never skipped automatically. Acceptable recovery outcomes are
restore from verified journal evidence, restore from an operator-provided and
separately archived snapshot, or remain fail-closed for forensic review.

Every recovery attempt and outcome is appended to an audit chain. Rollback
restores the pre-recovery SQLite export and Gist snapshot while writers remain
disabled. Tests must cover unauthorized reads, metadata redaction, stale
attestations, changed remote state between dry run and apply, missing journal
segments, duplicate recovery IDs, restart at each boundary, failed Gist PATCH,
read-back mismatch, and exact rollback restoration.

## Consequences

The current release favors unbounded safety evidence over unproven cleanup.
Storage growth and unknown publication freshness remain visible operational
limitations. The follow-up protocols can be reviewed independently without
weakening Workspace V2 revision, tombstone, backup, journal, request-hash, or
idempotency guarantees.
