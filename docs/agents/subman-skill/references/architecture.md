# SubMan Architecture Reference

English | [简体中文](architecture.zh-CN.md)

## Runtime

SubMan is a SvelteKit + TypeScript app deployed to Cloudflare Workers. The UI
and trusted Server API submit revisioned Workspace mutations to one
SQLite-backed `WorkspaceCoordinator` Durable Object per Gist. The browser keeps
one fixed binding, loads fresh cloud data before edits, and requires cloud
confirmation for each change. IndexedDB is a technical cache and delivery
journal, with historical recovery evidence, rather than a local business mode.

## Core Data Model

Types live in `src/lib/models.ts`.

- `NodeItem`: individual proxy node.
- `SubscriptionItem`: remote subscription source.
- `AggregateRule`: selection, filtering, rename, flag, and sort rule.
- `AggregatePublishTarget`: output file settings and last publish metadata.
- `ClientExportProfile`: sing-box options, aggregate reference, output settings,
  and publication metadata; profile helpers are in `src/lib/client-export/profile.ts`.
- `WorkspaceDocumentV2` (`src/lib/workspace-document.ts`): remote business data, revision metadata, and
  tombstones.
- `AppState`: browser view state. Gist identity and UI metadata remain local
  and are not serialized into the V2 document.

Allowed proxy types:

```text
vless, vmess, trojan, ss, ssr, hysteria2, tuic, anytls, other
```

## Important Routes

- `src/routes/auth/+page.svelte`: token setup, one cloud binding, cloud reload,
  whole-queue recovery, legacy upgrade preview, and safe diagnostics.
- `src/routes/gists/+page.svelte`: workspace file list, raw URL copy, output
  deletion and cleanup.
- `src/routes/nodes/+page.svelte`: nodes and subscriptions.
- `src/routes/aggregate/+page.svelte`: aggregate rules, sorting, preview,
  publish targets.
- `src/routes/exports/+page.svelte`: sing-box client preview, copy, download,
  and Workspace publication.
- `src/routes/api/health/+server.ts`: server API secret health.
- `src/routes/api/nodes/+server.ts`: trusted node automation endpoints.
- `src/routes/api/nodes/[id]/+server.ts`: public node get/patch/delete.
- `src/routes/api/nodes/by-key/[externalKey]/+server.ts`: public external-key PUT.
- `src/routes/api/workspaces/[workspaceId]/mutations/+server.ts`: internal browser
  transport; no public automation compatibility guarantee.

## Important Library Modules

- `src/lib/workspace.ts`: discover the fixed Gist or create its bootstrap
  marker only when no candidate exists; classify V1/V2/bootstrap/invalid results
  and require an explicit original Gist ID for ambiguous initial discovery.
- `src/lib/workspace-cloud-session.ts`: load the latest original-Gist document
  before enabling edits and recover original pending requests.
- `src/lib/workspace-cloud-status.ts`: shared readiness gate for cloud business
  pages and store actions.
- `src/lib/workspace-settings-controller.ts`: persistent settings view, safe
  remote reload, complete-queue recovery, and migration preparation.
- `src/lib/workspace-browser-session-v2.ts`: revisioned binding, explicit V1
  migration, and browser delivery orchestration.
- `src/lib/gist.ts`: GitHub Gist API client.
- `src/lib/stores/app.ts`: validate business actions and submit revisioned
  mutations through the transactional persistence boundary.
- `src/lib/workspace-persistence.ts`: transactional browser snapshot, binding,
  queue, retry, repair, and lease boundary.
- `src/lib/workspace-operation-result.ts`: authoritative browser operation
  completion states.
- `src/lib/workspace-operation-presenter.ts`: the shared UI interpretation
  boundary for completion results.
- `src/lib/workspace-mutation-queue.ts`: persistent ordered browser queue.
- `src/lib/workspace-mutation-sync.ts`: committed-state persistence, optimistic
  replay, and conflict pausing.
- `src/lib/server/workspace-coordinator.ts`: Durable Object RPC boundary.
- `src/lib/server/workspace-coordinator-core.ts`: the only `subman.json` writer.
- `src/lib/aggregate.ts`: aggregate output generation.
- `src/lib/proxy-protocol.ts`: canonical protocol list, scheme detection, and
  warning-first URI metadata validation.
- `src/lib/subscription.ts`: bounded browser subscription fetching and stable
  failure classification.
- `src/lib/client-export/`: pure sing-box outbound parsers and client config
  generation; this layer has no UI or GitHub dependency.
- `src/lib/serialization.ts`: retained schema/serialization compatibility for
  technical migration and operator tooling; no settings business JSON restore.
- `src/lib/workspace-merge.ts`: retained tombstone-aware internal reconciliation
  compatibility; local merge is not a current browser workflow.
- `src/lib/workspace-file-inventory.ts`: distinguish reserved, managed, and
  external output files without reconstructing missing publish targets.
- `src/lib/workspace-diagnostics.ts`: allowlisted diagnostics without raw data.
- `scripts/audit-workspace.ts`: offline schema/identity audit and V1 operator
  recovery artifact conversion; no application import path, network, or runtime
  Gist writer.
- `src/lib/server/api/*`: server API auth, env, node mutation, workspace access,
  and error envelopes.
- `docs/api/openapi.yaml`: machine-readable public Server API contract.
- `docs/sing-box-export.md`: current export protocol matrix and browser fetch
  contract.

API integration details, including the effective 119-byte external-key limit,
63 caller-tag limit, full-field PUT defaults, and uncertain-write recovery, are in
[the Server API guide](../../../api/server-api.md). API discovery uses Worker credentials independently of
browser binding; check the returned Gist identity before writing. Node updates do
not republish output files, and GET/health success does not prove a remote commit.

## Development Notes

- Follow existing route and store patterns before introducing abstractions.
- Keep shared business rules in `src/lib` rather than duplicating them in route
  components.
- Server API and browser writes use the same coordinator and revision contract.
- Public Node API success is synchronous: write `2xx` proves a verified remote commit.
  Browser queue completion states do not apply to public API callers.
- `/api/workspaces/:workspaceId/mutations` is an internal browser transport, not
  a public integration endpoint.
- See `docs/workspace-v2-operations.md` before migration, deployment, or
  rollback work.
