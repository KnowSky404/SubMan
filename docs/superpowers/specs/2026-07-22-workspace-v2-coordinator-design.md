# Workspace Schema V2 and Coordinator Design

## Context

SubMan stores its configuration and generated outputs in one GitHub Workspace
Gist. The V1 browser and Server API paths now share transaction helpers and
verify writes, but they remain independent writers. Two devices can still read
the same revision, compute different complete states, and overwrite one
another.

Schema V2 introduces an explicit remote document, separates browser-local
binding state, and routes every `subman.json` mutation through one Cloudflare
Durable Object per workspace. The Durable Object is the only runtime component
allowed to commit the configuration file.

## Goals

- Preserve all V1 workspace entities during migration.
- Keep browser-local Gist and synchronization state out of `subman.json`.
- Use a monotonically increasing revision as the conflict authority.
- Preserve deletions with tombstones so stale clients cannot resurrect data.
- Serialize browser, publication, and Server API mutations through one writer.
- Make retries idempotent across Durable Object restarts.
- Keep GitHub credentials request-scoped and out of persisted coordinator data.
- Preserve generated output and its related workspace update in one Gist PATCH.
- Provide a staged rollout and a byte-for-byte V1 rollback artifact.

## Non-Goals

- Do not compact tombstones in this phase.
- Do not support an implicit restore of deleted IDs.
- Do not move workspace data out of the fixed GitHub Gist.
- Do not expose the browser GitHub token to external automation.
- Do not make client timestamps the conflict authority.
- Do not retain a direct browser or route-level fallback writer.

## V1 Wire Format

V1 is the export envelope currently stored in `subman.json`. Its nested `data`
object contains workspace entities as well as browser-local binding metadata:

```ts
type WorkspaceDocumentV1 = {
  version: 1;
  exportedAt?: string;
  data: {
    nodes?: NodeItem[];
    subscriptions?: SubscriptionItem[];
    aggregates?: AggregateRule[];
    publishTargets?: AggregatePublishTarget[];
    clientExports?: ClientExportProfile[];
    gists?: GistItem[];
    activeGistId?: string | null;
    activeGistFile?: string | null;
    lastUpdated?: string;
  };
};
```

Historical V1 writers omitted some collections and local fields, so those
specific omissions retain their current empty/default compatibility behavior.
The parser recognizes V1 only when `version` is `1` (or absent for a documented
pre-version legacy export), `data` is an object, and `schemaVersion` is absent.
A document with a present unsupported `schemaVersion` is never interpreted as
V1.

## V2 Wire Format

```ts
type WorkspaceData = {
  nodes: NodeItem[];
  subscriptions: SubscriptionItem[];
  aggregates: AggregateRule[];
  publishTargets: AggregatePublishTarget[];
  clientExports: ClientExportProfile[];
};

type WorkspaceTombstone = {
  id: string;
  deletedAt: string;
  deletedRevision: number;
  mutationId: string;
};

type WorkspaceTombstones = {
  nodes: WorkspaceTombstone[];
  subscriptions: WorkspaceTombstone[];
  aggregates: WorkspaceTombstone[];
  publishTargets: WorkspaceTombstone[];
  clientExports: WorkspaceTombstone[];
};

type WorkspaceDocumentV2 = {
  version: 2;
  schemaVersion: 2;
  workspaceId: string;
  revision: number;
  updatedAt: string;
  lastMutationId: string | null;
  data: WorkspaceData;
  tombstones: WorkspaceTombstones;
};

type LocalWorkspaceBinding = {
  gistId: string | null;
  fileName: string;
  syncMode: "automatic" | "manual" | "paused-conflict";
  baseline: SyncBaselineEnvelope | null;
};
```

`version: 2` is a deliberate legacy compatibility fence. The currently deployed
V1 parser rejects unsupported `version` values before it can project V2's
`data`, so an already-open V1 client cannot read V2 and write it back as a V1
document. `schemaVersion` remains the authoritative schema discriminator for V2
and later readers.

The remote document never contains `activeGistId`, `activeGistFile`, `gists`,
UI state, a pending mutation queue, or local synchronization state. Existing
localStorage data is migrated separately into `WorkspaceData` plus a
`LocalWorkspaceBinding`.

## Workspace Identity

An existing Gist has one deterministic workspace identity:

```text
workspaceId = "gist:" + gistId
```

The server derives this value from the addressed Gist and does not trust a
client to map an arbitrary `workspaceId` to a different Gist. New workspaces use
the same rule after GitHub creates the Gist. A Durable Object stub is selected
with `WORKSPACE_COORDINATOR.getByName(workspaceId)`.

The coordinator rejects a V2 document whose `workspaceId` differs from the
derived value. The mutation envelope, route workspace, and loaded document must
all agree.

## Parsing and Validation

`parseWorkspaceDocument()` parses JSON once and returns a validated V1 or V2
result. It rejects malformed JSON, non-object roots, unsupported schema
versions, invalid timestamps, unsafe integers, missing arrays, duplicate or
empty IDs, and malformed entity fields.

V2 validation also enforces:

- `schemaVersion` is exactly `2`.
- The legacy compatibility sentinel `version` is exactly `2`.
- `workspaceId` is non-empty and matches the addressed Gist.
- `revision` is a non-negative safe integer.
- `lastMutationId` is null or a valid mutation ID.
- Every live entity ID is unique within its collection.
- Every tombstone ID is unique within its collection.
- An ID cannot be both live and tombstoned in the same collection.
- `deletedRevision` is a positive safe integer no greater than `revision`.
- References use existing entities: aggregate selections reference nodes or
  subscriptions, publish targets reference aggregates, and client export
  references resolve according to their current model contract.

An unknown higher schema returns `unsupported_schema` before a mutation is
applied or a Gist PATCH is attempted. Invalid known data returns
`invalid_workspace_document`; neither error permits overwrite recovery.

## V1 Migration and Backup

`migrateWorkspaceDocumentV1ToV2()` copies every V1 entity collection without
changing IDs or business fields. An absent optional `clientExports` collection
becomes an empty array. Local-only fields are returned separately for local
binding migration and are not written into V2. Tombstone collections start
empty, `revision` starts at `0`, and `lastMutationId` starts as null.

The workspace ID is derived from the Gist ID. The migration timestamp is the
only newly generated display timestamp. Migration is performed by the
coordinator as part of the first accepted mutation, not by independent browser
code.

Before replacing a V1 configuration, that same Gist PATCH creates
`subman.v1.backup.json` containing the exact original `subman.json` bytes. The
backup is immutable: if a file with that name already exists and differs from
the current V1 bytes, automatic migration stops with `migration_backup_conflict`.
The PATCH then writes the migrated-and-mutated V2 `subman.json` and any
publication output together. A failed PATCH changes neither file.

## Canonical Serialization and Signatures

`canonicalizeWorkspaceData()` recursively sorts object keys but preserves the
order of the five live entity collections because current UI and store behavior
make that order observable. Set-like nested fields are sorted only where their
model contract declares order irrelevant. Tombstone arrays are sorted by ID.
The function does not mutate the input.

`serializeWorkspaceDocumentV2()` emits the envelope in a fixed field order and
uses canonical object keys while retaining semantic entity-array order.
Documents with the same ordering and values therefore produce identical bytes
regardless of object insertion order; migration never reorders user-visible
collections.

`getWorkspaceContentSignature()` hashes canonical `data` and `tombstones`. It
excludes envelope-only coordination and display fields: `revision`,
`updatedAt`, and `lastMutationId`. Entity fields remain part of the signature;
the function does not silently discard model data.

## Mutation Protocol

All mutations use this serializable envelope:

```ts
type WorkspaceMutation = {
  mutationId: string;
  workspaceId: string;
  expectedRevision: number;
  source: "browser" | "server-api";
  createdAt: string;
  kind:
    | "node.upsert"
    | "node.delete"
    | "subscription.upsert"
    | "subscription.delete"
    | "aggregate.upsert"
    | "aggregate.delete"
    | "publish-target.upsert"
    | "publish-target.delete"
    | "client-export.upsert"
    | "client-export.delete"
    | "aggregate.publish"
    | "client-export.publish"
    | "workspace.reconcile";
  payload: unknown;
};
```

Payload parsing is discriminated by `kind`; unknown envelope or payload keys
are rejected rather than copied into state. Browser upserts carry one complete
validated entity. A Server API `node.upsert` instead carries a discriminated
command payload for create, patch-by-ID, or upsert-by-external-key so duplicate
raw URI checks, external-key lookup, ID stability, and name deduplication run
against the latest document inside the coordinator. Deletes carry an ID.
Publication mutations carry the relevant target/profile ID and validated output
file data.
`workspace.reconcile` carries the user's resolved complete `WorkspaceData` plus
the conflict baseline revision and is reserved for explicit conflict-resolution
actions. Its `expectedRevision` must match the latest document. At that point
the resolved live set is authoritative: omission of a currently live ID creates
a tombstone at the new revision, existing tombstones remain, and inclusion of a
tombstoned ID returns `entity_deleted`. The UI must include remote changes in a
merge choice; a confirmed local-overwrite choice may intentionally omit them.
This transition never clears a tombstone and validates references after the
resolved set is applied.

`mutationId` is a UUID generated once when the local operation is created. A
retry reuses the same envelope. `createdAt` is audit context only. It cannot
override `expectedRevision` or a tombstone.

## Mutation Semantics

For a new mutation, the coordinator reads and validates the latest Gist before
checking `expectedRevision`. A matching revision applies exactly one
deterministic transition. Success increments the revision by one, sets
`lastMutationId`, and sets the server commit time. A Gist write failure returns
an error without advancing the stored or returned revision.

Delete removes the live entity and records a tombstone with the new revision,
server time, and mutation ID. Deleting an already tombstoned ID is a deterministic
no-op transition only when represented by the same mutation ID; otherwise it
returns `entity_deleted`. Upserting a tombstoned ID also returns
`entity_deleted`. A future explicit restore mutation may define removal of a
tombstone; ordinary upsert cannot do so.

Stale `expectedRevision` always returns `revision_conflict`, including a stale
update racing a delete. This provides delete-wins behavior without comparing
client timestamps. Tombstones are never time-pruned in V2.

Publication mutations generate or validate the output against the latest
document, update the target/profile metadata, and write the output file plus
the next `subman.json` in one Gist PATCH. A publication cannot commit only one
half of that pair.

Before every PATCH, the coordinator writes a SQLite pending journal entry that
contains only the canonical request hash, candidate revision and document hash,
safe receipt, and expected file hashes. After the PATCH, it reads the Gist again
and verifies the committed revision, `lastMutationId`, canonical document hash,
and expected file hashes. It then promotes the journal entry into the committed
idempotency index. If the read-back has the mutation ID and expected hashes, the
commit succeeded even if the PATCH response was lost. Any other mismatch returns
a conflict or write-verification error and is not blindly retried as a fresh
transition.

## Durable Object Architecture

`WorkspaceCoordinator` is exported by the SvelteKit Worker and bound as
`WORKSPACE_COORDINATOR`. Public SvelteKit endpoints authenticate and validate a
request, derive the workspace identity, select the object by name, and invoke
its typed RPC method. The object owns the Gist read/validate/apply/PATCH loop.

Cloudflare storage input gates do not serialize execution across GitHub
`fetch()` calls. The object therefore uses:

- `blockConcurrencyWhile()` only to initialize its SQLite schema.
- An instance-local promise queue to serialize complete mutation operations,
  including GitHub network I/O.
- `expectedRevision` checks against the document freshly read inside that
  queue.
- SQLite records for durable mutation results and recovery metadata.

No route, browser library, or Server API helper may call the `subman.json` Gist
write transaction directly after cutover. Gist reads and generated-file deletes
can retain purpose-specific paths only when they cannot change `subman.json`.

New workspace creation is a two-step bootstrap because a Gist ID is required to
derive the workspace ID. The Workspace route creates the Gist with only a
reserved `subman.bootstrap.json` marker. Discovery recognizes that marker. It
then invokes the new coordinator, whose first PATCH writes V2 `subman.json` and
deletes the marker. Creating the marker is not a configuration write; every
creation or replacement of `subman.json` still originates in the coordinator.
If the second step fails, discovery finds the bootstrap Gist and retries it
instead of creating a duplicate workspace.

## Durable State and Crash Recovery

The initial SQLite schema is:

```sql
CREATE TABLE IF NOT EXISTS pending_mutations (
  mutation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  base_document_hash TEXT NOT NULL,
  candidate_revision INTEGER NOT NULL,
  candidate_document_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  expected_files_json TEXT NOT NULL,
  committed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_mutations (
  mutation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  committed_revision INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  committed_at TEXT NOT NULL
);
```

The token, mutation payload, file contents, and complete workspace document are
not stored. `result_json` contains only the safe receipt needed for an
idempotent retry. The document hashes and each content entry in
`expected_files_json` are fixed-size SHA-256 digests, not serialized content.

There is an unavoidable crash window after GitHub accepts a PATCH but before
SQLite promotes the pending row. Every request closes that window as follows:

1. Read and validate the latest Gist document.
2. If its non-null `lastMutationId` is absent from `processed_mutations`, load
   the corresponding pending row, verify its candidate revision and document
   and file hashes against the Gist, then promote it. A missing or mismatched
   pending row is a recovery error rather than permission to reapply a mutation.
3. Look up the incoming `mutationId` and return its prior result if its
   canonical request hash matches. Return `mutation_id_reused` if it differs.
4. If the incoming ID has a pending row, require the same request hash. When the
   Gist still has the expected pre-mutation revision and document hash, resume
   the same mutation; when it has the candidate commit, verify and promote it.
5. Otherwise validate the latest revision, apply the transition, insert the
   pending row, PATCH GitHub, verify the read-back, and promote the row.

The Gist document is therefore the commit record, the pending table is the
minimal crash journal, and `processed_mutations` is the idempotency index. A
Durable Object restart cannot cause the last successful mutation to be applied
twice, and request-hash collision detection remains possible after a crash.

## Endpoint Contract

Browser mutations use:

```text
POST /api/workspaces/:workspaceId/mutations
Authorization: Bearer <GitHub token>
Content-Type: application/json
```

The route derives the Gist ID from the encoded workspace ID, treats the GitHub
token as request-scoped capability material, and forwards it separately from
the mutation to the Durable Object RPC call.

The existing Server API endpoint remains:

```text
PUT /api/nodes/by-key/:externalKey
Authorization: Bearer <SUBMAN_API_TOKEN>
```

It retains external-key idempotency, duplicate raw URI rejection, and node-name
deduplication. After authentication it creates `node.upsert` and invokes the
same coordinator. The coordinator receives `GITHUB_TOKEN` from the Worker
environment as a separate RPC argument. The route no longer loads and saves a
complete workspace state.

Successful browser mutation responses contain the committed V2 document,
revision, mutation ID, and publication metadata when applicable. Server API
routes project the coordinator result back to their existing least-privilege
shape: the affected node plus workspace Gist/file/revision metadata. They never
return unrelated node URIs, subscriptions, or the complete document. Errors use
stable codes:

- `400 invalid_mutation` or `invalid_workspace_document`
- `401 unauthorized`
- `404 workspace_not_found` or `entity_not_found`
- `409 revision_conflict`, `entity_deleted`, or
  `migration_backup_conflict`
- `409 mutation_id_reused`
- `422 unsupported_schema`
- `502 gist_read_failed` or `gist_write_failed`

A conflict response includes the latest safe document and revision so the
browser can enter conflict handling. Responses never echo credentials.

## Browser Synchronization

The browser remains optimistic locally but no longer writes `subman.json`
directly:

1. A business action creates a mutation and updates UI state.
2. The mutation is inserted into a persistent localStorage queue before send.
3. The browser sends the queue head to the Worker mutation endpoint.
4. Success replaces local workspace data with the committed document, updates
   the revision and baseline, then removes that mutation from the queue.
5. Network and retryable server failures retain the same mutation ID and retry
   in order after recovery.
6. A `409` keeps the mutation, sets `syncMode` to `paused-conflict`, and opens
   the existing conflict flow.

BroadcastChannel communicates committed state and queue changes between tabs.
Only one tab attempts queue delivery at a time using the existing browser
coordination lease, but server correctness never depends on that lease.

Manual mode may enqueue only after an explicit sync action. Bind-only and
`paused-conflict` modes enqueue and send no automatic mutation. Local mode has
no remote queue. A logout or token removal preserves unsent mutations but
cannot send them until authentication is restored.

## Token and Logging Boundary

- A browser GitHub token is accepted only by the same-origin Worker endpoint
  and exists only for that request and RPC invocation.
- Server automation knows only `SUBMAN_API_TOKEN`; the Worker supplies its
  `GITHUB_TOKEN` secret to the coordinator call.
- Credentials are not fields in `WorkspaceMutation`.
- Credentials are never written to SQLite, Gist files, local mutation queue
  payloads, response bodies, exception messages, or application logs.
- Logging records request IDs, mutation IDs, workspace IDs, kinds, revisions,
  status codes, and sanitized GitHub status information only.
- Authorization headers and RPC token arguments are explicitly redacted from
  diagnostic helpers.
- `subman.json`, `subman.v1.backup.json`, and `subman.bootstrap.json` are
  reserved filenames. Aggregate and client export validation rejects them,
  case-insensitively, so publication cannot replace configuration or recovery
  data.

## SvelteKit Worker Export

`@sveltejs/adapter-cloudflare` generates
`.svelte-kit/cloudflare/_worker.js` and currently emits only a default Worker
export. Wrangler needs that module to also export `WorkspaceCoordinator`.

`svelte.config.js` will wrap the adapter's `adapt` step: run the official
adapter first, then append a static re-export from a source module that the
generated bundle can resolve. The wrapper is narrow and fails the build if the
expected generated entrypoint does not exist. A source-contract test verifies
the wrapper, while `bun run build` and local Wrangler startup prove the actual
named export. The `main` path remains the adapter output and is not redirected
to a competing source entrypoint.

## Wrangler Configuration

`wrangler.toml` adds:

```toml
[[durable_objects.bindings]]
name = "WORKSPACE_COORDINATOR"
class_name = "WorkspaceCoordinator"

[[migrations]]
tag = "v1-workspace-coordinator"
new_sqlite_classes = ["WorkspaceCoordinator"]
```

Generated Cloudflare environment types include the binding and secrets. Local
development uses Wrangler's local Durable Object storage and explicitly
configured development secrets. Test credentials must never be committed.

## Staged Rollout

1. Land the V1 parser compatibility fence so current code rejects any document
   with `schemaVersion`, plus parsing, migration, canonical serialization,
   mutation parsing, and pure transition tests without changing writers.
2. Land the coordinator, bootstrap behavior, binding, generated export, and
   local integration tests while routes still use a feature-gated call path.
3. Migrate Server API and browser writers, including the offline queue and
   conflict UI, then enforce structural tests that no other module writes
   `subman.json`.
4. Build and start local Wrangler, migrate a disposable V1 Gist fixture, run
   concurrent mutation and restart/idempotency checks, and inspect stored state
   for credentials.
5. Deploy the Worker and Durable Object migration before enabling V2 writers.
   The emitted V2 `version: 2` sentinel fences already-open V1 clients from
   reading and overwriting migrated data.
6. Enable coordinator writes for a controlled workspace, verify backup,
   revision, publication, and Server API behavior, then widen rollout.

No remote deployment, Gist mutation, or feature activation is part of local
implementation without explicit authorization.

## Rollback

Before rollback, disable or stop V2 writers so an old Worker cannot race the
coordinator. Export the current V2 `subman.json` for forward recovery. Restore
the byte-for-byte `subman.v1.backup.json` content to `subman.json`, then deploy
the previous V1 Worker version. Generated output files do not need restoration
because migration and publications preserve the same Gist and filenames.

The Durable Object namespace and SQLite records can remain allocated during
rollback; they contain no credentials and deleting them would make a rapid
forward recovery harder. A later explicit cleanup migration may remove the
class only after all workspaces have either rolled back or stabilized on V2.

Rollback cannot translate V2-only edits into V1 automatically. Operators must
retain the exported V2 document and choose whether to reapply those changes
after forward recovery.

## Verification

Unit and integration coverage must prove:

1. Lossless V1-to-V2 migration and V1/V2 round trips.
2. Stable canonical V2 serialization and signatures.
3. Corrupt and unknown higher schemas never trigger a write.
4. Tombstones prevent stale resurrection and resolve delete/update races.
5. Two mutations at one expected revision yield one success and one conflict.
6. Duplicate mutation IDs return one committed result.
7. Aggregate publication plus Node API mutation preserve both changes.
8. Client export publication plus browser deletion preserve both changes.
9. Gist failures do not advance revision.
10. Idempotency recovery survives a coordinator restart.
11. Tokens are absent from state, responses, and captured logs.
12. Offline mutations retry after connectivity returns.
13. Bind-only and paused-conflict modes send nothing.
14. Server API routes do not perform full-state saves.
15. Every `subman.json` write originates in `WorkspaceCoordinator`.

The final gate is `bun test`, `bun run check`, `bun run lint`, `bun run build`,
and `bun run dev:cf` with local Durable Object integration checks.
