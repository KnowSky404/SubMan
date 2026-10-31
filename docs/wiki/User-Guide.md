# User guide

English | [简体中文](User-Guide.zh-CN.md) · [Wiki home](Home.md)

## Connect your cloud data

Open `/auth` and provide a GitHub token with `gist` permission. Tokens stay in
session storage by default. Choose persistent storage only on a trusted device;
same-origin JavaScript can read it, including during active XSS.

SubMan finds a private Gist described as `SubMan-Data` with the authoritative
`subman.json` document. If several candidates exist, enter the original Gist ID.
Initial setup may create an empty private bootstrap Gist only when no candidate
exists. A bound device always returns to its original Gist after reconnecting or
changing tokens. Wait for the latest cloud data to load before editing.

Recognized V1 data shows a migration preview and requires confirmation. Migration
preserves the original Gist, exact V1 backup, output bytes, filenames, metadata,
and subscription links. Use the [migration guide](../legacy-workspace-migration.md)
if data is missing or a document is rejected.

## Manage resources

The brand links to the overview. The header shows connection and pending cloud
states; icon labels appear on hover or keyboard focus. On narrow screens, use the
navigation arrow to reach additional pages. The overview shows onboarding for an
empty Workspace, then recent resources and confirmed publication metadata.

| Page | Purpose |
| --- | --- |
| `/auth` | Connection, token, delivery status, cloud reload, device reset, migration, and diagnostics |
| `/nodes` | Nodes and subscriptions, tags, search, filters, and batch import |
| `/aggregate` | Rule editing, preview ordering, publish targets, and publication |
| `/exports` | sing-box configuration preview, copy, download, and publication |
| `/gists` | Read-only cloud file list, raw links, and link copying |

Import one URI per line or paste base64 subscription content. Preview and
resolve duplicates before adding. Aggregates select nodes and subscriptions,
exclude tags, filter protocols, apply regex renaming, add region flags, and sort
by names, protocols, regions, priority keywords, or manual ordering.

Open **Advanced rule options** for protocol filtering, sorting, renaming, and
region flags. Existing non-default options open automatically when loading a rule.
Saving a rule or target stores configuration; publishing generates the output file.
For client exports, save profile changes and generate a current preview before publishing.

Subscription URLs must permit browser access. Fetches have a 15-second timeout
and 4 MiB response limit; network/CORS, HTTP, size, encoding, and empty responses
have separate errors. See the [export guide](../sing-box-export.md) for supported
protocols, warnings, and sing-box 1.14 compatibility.

## Publish stable links

Select an aggregate rule, preview its output, and configure a publish target.
Outputs use the bound Workspace Gist and inherit its actual GitHub visibility.
Keeping the same Gist and filename preserves the raw subscription URL. Renaming
a file creates a new URL; review the cleanup result before removing the old file.
Node edits do not automatically republish existing aggregate or sing-box files.

Configuration and outputs are committed together through the coordinator.
The Gists page is read-only for all files, including managed outputs, external
files, and bootstrap markers. Use Aggregation or Client Exports to manage
publications; file preview, link copying, and refresh remain available in Gists.
`subman.json`, `subman.v1.backup.json`, and `subman.bootstrap.json` are reserved
and cannot be outputs.

## Delivery and recovery

Cloud `subman.json` is the business authority. Each valid edit is recorded in a
transactional browser delivery journal, sent immediately, and reported as saved
only after cloud confirmation. A local cache or queued request is delivery state,
not an independent business copy. Pending or blocked changes pause further edits.

- **Network failure or peer delivery:** retain the original mutation and retry
  after reconnecting. Queued and retrying states do not mean a successful save.
- **Concurrent changes:** review the conflict. If abandoning pending work, confirm
  complete-queue discard and reload the latest cloud document, then reapply your intent.
- **Storage repair:** keep the browser data intact and inspect safe diagnostics.
  Do not clear individual queue entries or replace the Gist with a diagnostic file.
- **Missing old rules:** outputs cannot reconstruct aggregates or publication
  records. Follow the migration guide and inspect original Gist history.

Diagnostics export counts, safe metadata, hashes, and retry classifications;
they do not export business data or credentials. There is no browser business
JSON backup/restore, local overwrite/merge, manual push, or Workspace switching.
For operator procedures, see [operations and repair](../workspace-v2-operations.md).

## Start again after removing your Gist

Disconnect removes your token but keeps this device's Workspace binding and
pending changes. Reconnecting still reads the original Gist, even when it is
unavailable. A GitHub 404 can also mean the token cannot access it.

If you deliberately deleted the original Gist or want to abandon this device's
current connection, open Settings and choose **Reset this device**. The control
is available while signed out or when cloud loading fails. Close other SubMan
tabs, then review the confirmation: reset removes the current binding, cached
business data, and the complete current pending queue. Unconfirmed changes in
that queue will be lost. Historical queues and quarantined recovery evidence
remain available in Sync recovery; existing cloud files are unchanged.

After a successful reset, enter your token and choose **Connect** again. SubMan
finds existing cloud data or, if none exists, initializes an empty private
Workspace. Reset itself never creates or deletes a Gist or uploads an old cache.
The local reset affects other SubMan tabs on the same site. If delivery is active,
wait for it to finish and retry; if state changes during confirmation, review the
new state before trying again. A failed storage transaction does not report a
successful reset or clear authentication.

## Backend automation

The public API supports health and node CRUD/by-key updates. Start with the
[Server API](../api/server-api.md) and [sing-box-vps integration](../integrations/sing-box-vps.md).
The backend bearer is separate from your browser GitHub token. Subscription,
aggregation, publication, and export REST endpoints remain proposals; third-party
scripts must not PATCH the Gist or use the internal browser mutation route.
