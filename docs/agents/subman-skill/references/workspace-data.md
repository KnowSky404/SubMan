# SubMan Workspace Data Reference

English | [简体中文](workspace-data.zh-CN.md)

## Cloud Authority And Identity

SubMan stores authoritative configuration and generated outputs in one private
GitHub Gist:

- Description: `SubMan-Data`
- Workspace ID: `gist:<gist-id>`
- Config file: `subman.json`

The browser retains one binding. There is no Workspace list or switcher, local
business mode, manual sync, local overwrite/merge, bind-only, or business JSON
backup/import workflow. Initial setup may take an explicit Gist ID; ambiguous
or invalid discovery must not choose or create another Gist. Reconnection and
token replacement keep the original identity, even if it is unavailable.

Startup loads the latest cloud state before enabling business pages. New Gists
initially contain only `subman.bootstrap.json`; the first coordinator mutation
creates an empty V2 cloud document instead of uploading old browser data.

## Schema V2 And Single Writer

The remote `WorkspaceDocumentV2` contains:

- `version: 2` and `schemaVersion: 2`
- deterministic `workspaceId` and monotonic `revision`
- `updatedAt` and `lastMutationId`
- business collections: nodes, subscriptions, aggregates, publish targets,
  and client exports
- tombstones for every business collection

Every `subman.json` mutation goes through the `WorkspaceCoordinator` Durable
Object. Browser store actions and Server API routes create validated revisioned
mutations; neither writes a complete Gist state directly. Public REST routes
and their authentication/response contracts are unchanged. The Worker selects
its API target independently of browser binding; check `workspace.gistId`.
`/api/workspaces/:workspaceId/mutations` remains an internal browser protocol.

## Browser Delivery

Every business change requires authentication, a cloud session that has loaded
successfully, and an initialized automatic binding. Unresolved active delivery
or repair evidence blocks additional edits. A single local transaction commits
the cache and original mutation, then delivery begins immediately. The action's
`completion` waits for the cloud result; only `remote-committed` reports success
and finalizes the draft. Queueing, peer ownership, retry, and acknowledgement
uncertainty retain the draft and original mutation identity.

IndexedDB `subman-workspace` v1 contains caches, ordered delivery journals,
retry/blocked metadata, leases, migration evidence, and retained historical
queues. It is technical recovery storage, not a second business data source.
Success persists the committed cloud document before removing the queue item.
Network failures keep the original ID and persisted retry timing. Logout clears
authentication and stops delivery while preserving binding and pending evidence.

GitHub authentication stays outside IndexedDB: session-only `sessionStorage`
is the default; `localStorage` is used only after explicit Remember token opt-in.
Persistent browser storage does not protect tokens from active XSS.

## Conflict And Recovery

A revision conflict pauses delivery and retains the trusted latest cloud
document. The settings recovery flow may retry the original request, or, after
confirmation, discard the complete active queue and reload the latest cloud
state. Reapply an intended edit against that new revision. No local push, merge,
or force overwrite is offered. Remote tombstones remain protected.

Cloud reload compares the expected snapshot, binding, and complete queue in the
same transaction. A concurrent edit must cause a controlled retry instead of
being silently discarded. Rebind and repair transactions cannot replace an
active binding with another Workspace. Historical orphan queues remain visible
as safe evidence; they are not automatically rebound or sent. Explicit discard
always removes a complete queue.

## Reserved Files

These names are protected case-insensitively:

- `subman.json`
- `subman.v1.backup.json`
- `subman.bootstrap.json`

Aggregate and client export files must use other names. The Gists page may
delete outputs but cannot delete recovery or configuration files.

## V1 Migration

V1 remains readable for in-place migration. Discovery does not rewrite it.
Connecting recognized V1 opens a preview; unbound legacy checking requires the
original Gist ID and never creates a Gist. The description must be `SubMan-Data`,
the filename `subman.json`, and the document valid. Bound sessions cannot use
legacy checks to select a different Gist.

Explicit migration uses internal `workspace.migrate` with the SHA-256 of the
previewed bytes. The coordinator copies exact V1 bytes to the immutable
`subman.v1.backup.json` and writes V2 in one verified Gist PATCH, preserving
business entities, output bytes/names, URLs, and timestamps without republishing.
Changed source requires rechecking; a mismatching existing backup stops with
`migration_backup_conflict`. Resolve pending queues/repair evidence first.
Only `remote-committed` completes the preview.

## Operator Audit And Recovery

`scripts/audit-workspace.ts` reads a downloaded file offline, reports schema/count
metadata, and optionally verifies V2 Gist identity with `--gist-id`. Its retained
`--export-v1` option creates an exclusive `0600` normalized business artifact
for operator inspection. This does not provide an application import or restore
path. Historical `subman-business-configuration` files omit revision/tombstones
and cannot replace remote `subman.json`. Diagnostics cannot restore business data.

The audit does not contact GitHub, verify output freshness, or recreate targets
from output files. Preserve original cloud files and history before a separately
authorized operator repair. Do not clear browser evidence or bulk-clean external
files first: historical outputs without targets may still serve clients.
See `docs/legacy-workspace-migration.md` and `docs/workspace-v2-operations.md`.

## Stability Rules

- Never add another runtime writer of `subman.json`.
- Never reset revision or clear tombstones during normal recovery.
- Preserve original mutation IDs across retries and token replacement.
- Keep output filenames stable when stable raw URLs matter.
- Keep GitHub tokens out of mutations, IndexedDB, Durable Object SQLite,
  responses, diagnostics, and logs.
