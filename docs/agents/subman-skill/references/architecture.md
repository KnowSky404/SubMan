# SubMan Architecture Reference

## Runtime

SubMan is a SvelteKit + TypeScript app deployed to Cloudflare Workers. The UI
and trusted Server API submit revisioned Workspace mutations to one
SQLite-backed `WorkspaceCoordinator` Durable Object per Gist.

## Core Data Model

Types live in `src/lib/models.ts`.

- `NodeItem`: individual proxy node.
- `SubscriptionItem`: remote subscription source.
- `AggregateRule`: selection, filtering, rename, flag, and sort rule.
- `AggregatePublishTarget`: output file settings and last publish metadata.
- `WorkspaceDocumentV2`: remote business data, revision metadata, and
  tombstones.
- `AppState`: browser view state. Gist identity and UI metadata remain local
  and are not serialized into the V2 document.

Allowed proxy types:

```text
vless, vmess, trojan, ss, ssr, hysteria2, tuic, anytls, other
```

## Important Routes

- `src/routes/auth/+page.svelte`: token setup, workspace binding, conflict
  handling, health checks, import/export, sync status.
- `src/routes/gists/+page.svelte`: workspace file list, raw URL copy, output
  deletion and cleanup.
- `src/routes/nodes/+page.svelte`: nodes and subscriptions.
- `src/routes/aggregate/+page.svelte`: aggregate rules, sorting, preview,
  publish targets.
- `src/routes/api/health/+server.ts`: server API secret health.
- `src/routes/api/nodes/+server.ts`: trusted node automation endpoints.

## Important Library Modules

- `src/lib/workspace.ts`: discover the fixed Gist or create its bootstrap
  marker.
- `src/lib/gist.ts`: GitHub Gist API client.
- `src/lib/workspace-browser-mutation.ts`: translate browser store actions to
  mutations.
- `src/lib/workspace-mutation-queue.ts`: persistent ordered browser queue.
- `src/lib/workspace-mutation-sync.ts`: committed-state persistence, optimistic
  replay, and conflict pausing.
- `src/lib/server/workspace-coordinator.ts`: Durable Object RPC boundary.
- `src/lib/server/workspace-coordinator-core.ts`: the only `subman.json` writer.
- `src/lib/aggregate.ts`: aggregate output generation.
- `src/lib/serialization.ts`: import/export and workspace serialization.
- `src/lib/merge.ts`: conflict merge behavior.
- `src/lib/server/api/*`: server API auth, env, node mutation, workspace access,
  and error envelopes.

## Development Notes

- Follow existing route and store patterns before introducing abstractions.
- Keep shared business rules in `src/lib` rather than duplicating them in route
  components.
- Server API and browser writes use the same coordinator and revision contract.
- See `docs/workspace-v2-operations.md` before migration, deployment, or
  rollback work.
