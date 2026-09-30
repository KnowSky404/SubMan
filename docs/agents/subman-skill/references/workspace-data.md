# SubMan Workspace Data Reference

## Workspace Identity

SubMan stores configuration and generated outputs in one GitHub Gist:

- Description: `SubMan-Data`
- Workspace ID: `gist:<gist-id>`
- Config file: `subman.json`

New Gists initially contain only `subman.bootstrap.json`. The first coordinator
mutation replaces that marker with a V2 config document.

## Schema V2

The remote `WorkspaceDocumentV2` contains:

- `version: 2` and `schemaVersion: 2`
- deterministic `workspaceId`
- monotonic `revision`
- `updatedAt` and `lastMutationId`
- business collections: nodes, subscriptions, aggregates, publish targets,
  and client exports
- tombstones for every business collection

Browser-only Gist lists, active-file state, sync mode, conflict baselines, and
the pending mutation queue are not written to the Gist.

## Single-Writer Rule

Every `subman.json` mutation goes through the `WorkspaceCoordinator` Durable
Object. Browser store actions and Server API routes create validated,
revisioned mutations; neither path writes a complete Gist state directly.

The browser queue is persisted before delivery. Successful delivery persists
the committed V2 document before removing the queue item. Network failures keep
the same mutation ID for retry. Revision conflicts retain the mutation and
pause automatic delivery.

## Modes

- Local: no GitHub token or V2 binding; business data remains in the
  `subman-workspace` IndexedDB transactional root.
- Automatic: browser business actions enqueue and deliver mutations.
- Manual: only explicit pull, push, reconcile, or publication actions send.
- Paused conflict: local optimistic state and queued mutations are retained,
  but automatic delivery stops.
- Server API: the Worker supplies `GITHUB_TOKEN` separately to the same
  coordinator used by the browser.

Logout clears the active browser identity and token but preserves the V2
binding and unsent queue. No mutation can be delivered until authentication is
restored.

## Conflict Handling

The `/auth` flow supports:

- Local overwrites remote.
- Remote overwrites local.
- Merge then save.
- Bind only in manual mode.

The latest safe remote document and the last common baseline are stored
separately while a conflict is paused. Merge choices must include remote changes
and preserve remote deletions. Local overwrite may intentionally omit remote
live entities, producing tombstones through `workspace.reconcile`.

## Reserved Files

These names are protected case-insensitively:

- `subman.json`
- `subman.v1.backup.json`
- `subman.bootstrap.json`

Aggregate and client export files must use other names. The Gists page may
delete generated outputs but cannot delete recovery or configuration files.

## V1 Migration

V1 remains readable only for migration and import compatibility. Discovery does
not rewrite it. The first successful coordinator mutation copies the exact V1
bytes to `subman.v1.backup.json`, migrates all business collections, applies the
mutation, and writes V2 in one verified Gist PATCH.

Browser connection to recognized V1 data presents a preview before binding or
replacing local data. Manual Workspace migration in `/auth` can check all
candidates (ignoring the saved binding) or one Gist ID without creating a Gist.
The description must still be `SubMan-Data`, the filename `subman.json`, and the
document valid. Multiple candidates require choosing the original Workspace.

Explicit migration uses internal browser `workspace.migrate` with the SHA-256
of the previewed source bytes. It preserves output files, names, URLs, timestamps,
and business entities without republishing. Changed source requires rechecking;
an existing mismatching backup stops with `migration_backup_conflict`. Resolve
pending queues/repair evidence first. Queued or retrying is not completion;
wait for `remote-committed`.

## Import, Audit, And Recovery

`subman.json` is a revisioned Workspace document. Settings exports use
`{ version: 2, kind: "subman-business-configuration", data: ... }` and omit
binding, revision, tombstones, queues, and authentication. They are import files,
not replacements for remote `subman.json`.

`scripts/audit-workspace.ts` reads a downloaded file offline, reports schema/count
metadata, and optionally verifies V2 Gist identity with `--gist-id`. Its
`--export-v1` option converts valid V1 into an exclusively created `0600` import
file. It does not contact GitHub, verify output freshness, or recreate targets
from output files. Diagnostics likewise cannot restore business data.

For a move to a new Gist, imported old URLs do not copy output files or establish
trusted publication metadata. New targets lose claimed publication metadata until
actually published. Prefer migration in the original Gist when old links matter.
Do not bulk-clean external files before recovery: old outputs without target
records are classified as external and may still be used by clients.

See `docs/legacy-workspace-migration.md` for the full procedure.

See `docs/workspace-v2-operations.md` for deployment evidence and rollback.

## Stability Rules

- Never add another runtime path that can write `subman.json`.
- Never clear tombstones during normal reconciliation.
- Preserve mutation IDs across retries.
- Keep publish target filenames stable when stable raw URLs matter.
- Keep GitHub tokens out of mutations, local coordination storage, Durable
  Object SQLite state, responses, and logs.
