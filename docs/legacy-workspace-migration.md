# Legacy Data Investigation and Migration

English | [简体中文](legacy-workspace-migration.zh-CN.md)

The cloud Gist's `subman.json` is the sole business data source. Startup loads
cloud data, and a device keeps one Gist binding. Workspace switching, local
business mode, JSON business backup/import, manual push, and local merge or
force overwrite are removed. Keep browser delivery journals and historical
recovery evidence during an upgrade.

A recognized V1 document displays an upgrade preview during normal connection.
Initial setup can use the original Gist ID. While unbound, the legacy migration
check also accepts that explicit ID, reads without creating a Gist, and requires
separate upgrade confirmation. It does not scan without an ID or switch an
existing binding. Login and refresh always retain the original bound ID; an
inaccessible Gist produces an error instead of another binding or empty Gist.

If an older release bound the device to an empty Gist, preserve its browser
evidence and identify the original cloud document. An isolated browser profile
can connect using the explicit original ID without disturbing pending journals
in the original profile. This remains cloud connection, not local import or
Workspace switching. Repairing an existing device binding is an operator
recovery task; do not bypass it by deleting queues, rewriting identity, or
resetting revisions.

## Distinguish three data sets

- **Rules:** `data.aggregates` in `subman.json`.
- **Publish targets and last-publication metadata:** `data.publishTargets`,
  including `ruleId`, `fileName`, `lastPublishedAt`, and `lastPublishedUrl`.
  sing-box profiles use `data.clientExports` and appear in `/exports`.
- **Published output:** `.txt`, sing-box `.json`, and other Gist files.
  An existing output does not prove a saved target exists or reflects current
  rules.

SubMan retains last-publication metadata, not a complete publication history.
Outputs without target references are external files and cannot reconstruct
rules. Aggregate publish targets appear in `/aggregate`; client profiles appear
in `/exports`.

## Format boundaries

The package version `0.0.1` is not a data-format version. Verified historical
boundaries are:

| Historical change | Current read behavior | Recovery |
| --- | --- | --- |
| 2026-02-26 `bb23bed`: V1 rules lacked `allowedTypes` | Defaults to `[]`, without protocol filtering | Upgrade the original Gist |
| 2026-02-27 `3ca9da5`: direct output without persisted targets | Cannot infer full targets or accurate publication times | Preserve outputs/URLs; reconstruct targets manually |
| 2026-02-28 `74ed11f`: `publishTargets` added | Preserves valid filenames, timestamps, and URLs | Confirm records exist in the document |
| 2026-03-08 `eadf826`: file transition metadata added | Missing `lastPublishTransition*` fields become `null` | Do not invent history |
| 2026-05-12 `95cf2ff`: `clientExports` added | Missing collection becomes `[]` | Aggregate targets remain in `/aggregate` |
| 2026-07-22 `77aed70`: Workspace V2 | Validates V1 first; backup and V2 write occur on the first accepted mutation | Original Gist, coordinator commit |
| Legacy browser `subman:state:v1` | Validated against the current full snapshot; invalid data may be quarantined | Retain technical evidence for operator inspection; no browser JSON restore |

V1 has no `schemaVersion` and uses `{ "version": 1, "data": ... }`;
compatibility reads also allow an omitted `version`. Manually adding
`schemaVersion: 1` is unsupported. V2 requires `schemaVersion: 2`, Workspace
identity, revision, and tombstones. Historical
`kind: subman-business-configuration` files are business exchange artifacts,
without the revision chain and tombstones; they cannot replace `subman.json`.

Dangling sources/rules, duplicate IDs/tags/selections, unknown fields, invalid
enums, noncanonical UTC timestamps, invalid/reserved output filenames, or
Workspace identity mismatches invalidate the document. Discovery and explicit
inspection require the exact description `SubMan-Data` and `subman.json` or a
valid bootstrap marker. Ambiguous initial discovery requires the original ID.

## 1. Preserve sources and identify the Gist

1. Privately retain the original Gist ID, exact `subman.json` bytes, all outputs,
   subscription URLs, Gist history, and any `subman.v1.backup.json`. These sources
   can contain credentials.
2. Preserve browser storage and pending-delivery evidence; close older tabs that
   could keep editing. Settings no longer exports or restores business JSON.
   Safe diagnostics contain metadata and cannot restore nodes or rules. Do not
   clear storage first.
3. Compare the `/auth` binding ID with the original Gist. Domains, browsers, and
   browser profiles do not share the original technical journal; verify cloud
   identity explicitly.
4. Inspect `data.aggregates`, `data.publishTargets`, and `data.clientExports`.
   If empty, check Gist history and the V1 backup. Output presence alone does
   not prove that rules remain.

## 2. Offline audit

Run from the repository root. The tool reads local files, needs no token, makes
no network requests, and never writes a Gist:

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json
bun run scripts/audit-workspace.ts /private/path/subman.json --gist-id YOUR_GIST_ID
```

A successful report contains schema, collection counts, and counts of targets
with publication timestamps. It does not prove output freshness or URL health.
Failures expose safe codes, without source text, field values, or stacks.

| Code | Action |
| --- | --- |
| `invalid_workspace_document` | Inspect fields, timestamps, duplicates, and references |
| `unsupported_schema` | Identify an unknown format or exchange artifact; do not bypass by changing version numbers |
| `workspace_mismatch` | Find the original Gist; do not rewrite V2 identity |
| `v1_export_required` | `--export-v1` handles V1 only; V2 recovery must preserve revision and tombstones |
| `local_file_operation_failed` | Check permissions and whether the destination already exists |

Exit codes: `0` success, `1` validation/file failure, `2` invalid arguments.

## 3. Valid V1: upgrade in the original Gist

1. While unbound, connect or inspect `/auth` using the original Gist ID. Verify
   its fixed description, filename, and format. If its description differs,
   preserve sources before the owner decides whether to use `SubMan-Data`.
2. Compare the preview's Gist ID, rule counts, target filenames, and original
   links. Preview does not change the remote document or upload browser cache.
3. Choose **Migrate and load Workspace**. Resolve pending queues and repair
   evidence first; migration does not silently flush other requests. Queued or
   retrying is incomplete; only `remote-committed` completes the upgrade.
4. The coordinator checks the preview source SHA-256, creates a byte-exact
   `subman.v1.backup.json`, and writes V2. Output files are excluded from this
   PATCH and publication metadata retains its values. A changed source requires
   another inspection and confirmation.
5. Verify schema, entity counts, backup bytes, and rule/target/export references.
   The original Gist and unchanged filenames preserve existing URLs. Upgrading
   requires no republication and does not establish output freshness.

`migration_backup_conflict` means an existing backup differs from the V1 source.
Preserve both sources for operator investigation. Do not overwrite/delete the
immutable backup or force-push.

## 4. Invalid formats: operator offline recovery

The retained V1 conversion command produces a normalized business artifact for
operator inspection:

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json \
  --export-v1 /private/path/subman-recovery.json
```

It exclusively creates a new file with permissions `0600`, never overwrites a
source/destination, and never writes a Gist. It retains recognized collections,
IDs, filenames, and publication metadata, and normalizes old excluded tags.
It contains no Workspace revision chain, tombstones, queues, or authentication.
**The application has no JSON import/restore flow.** This artifact is not a
complete cloud backup and cannot replace `subman.json`.

Ordinary mutations cannot repair an invalid original Gist: the coordinator also
validates before writing. In a private working copy, restore missing sources or
rules from history, verify duplicates/timestamps/filename meanings, record exact
differences, and repeat the offline audit. Unknown publication times stay
`null`, never the recovery time. A separate original-Gist recovery operation
requires explicit authorization, stopped writers, and investigation of current
data, history, backups, and coordinator state. This guide offers no direct PATCH
shortcut. Follow the [operations rollback procedure](workspace-v2-operations.md#rollback)
for a separately designed restoration; do not downgrade to V1, erase tombstones,
or reset revisions to bypass normal recovery checks.

If history never persisted targets, reconstruct them from verified rules and
original filenames after restoring valid cloud data. Existing outputs can keep
serving their original URLs. Recreating targets does not recover trustworthy
publication timestamps. Preview and compare old outputs before publishing.
Avoid bulk external-file cleanup until recovery completes; clients may still
use those outputs.

## Completion criteria

- Source-consistent rule, target, and export counts with valid references.
  Verify record retention, output presence, and a new publication separately.
- Original Gist and filenames retain URLs. New Gists or filenames require
  client updates; old URL metadata does not copy files.
- Readable sources and byte-exact V1 backup; no bypass of revision, identity,
  tombstone, or idempotency checks.
- Cloud reload precedes editing; save success comes from remote confirmation.

Future format changes must document support, normalization, confirmed migration,
operator recovery, and rollback sources. Test the earliest supported shapes
against both Gist reads and technical-cache migration. Implementation sources:
`workspace.ts`, `workspace-document.ts`, `workspace-persistence.ts`,
`workspace-file-inventory.ts`, `scripts/audit-workspace.ts`, and their tests.
