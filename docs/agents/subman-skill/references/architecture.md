# SubMan Architecture Reference

## Runtime

SubMan is a SvelteKit + TypeScript app deployed to Cloudflare Workers with
`@sveltejs/adapter-cloudflare`. The UI is the primary product surface. Server API
routes live in the same app for trusted backend automation.

## Core Data Model

Types live in `src/lib/models.ts`.

- `NodeItem`: individual proxy node.
- `SubscriptionItem`: remote subscription source.
- `AggregateRule`: selection, filtering, rename, flag, and sort rule.
- `AggregatePublishTarget`: output file settings and last publish metadata.
- `AppState`: full workspace state, including nodes, subscriptions,
  aggregates, publish targets, gist metadata, active gist id, and active gist
  file.

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

- `src/lib/workspace.ts`: find/create/bind the fixed workspace gist.
- `src/lib/gist.ts`: GitHub Gist API client.
- `src/lib/sync.ts`: local-to-gist automatic sync.
- `src/lib/aggregate.ts`: aggregate output generation.
- `src/lib/serialization.ts`: import/export and workspace serialization.
- `src/lib/merge.ts`: conflict merge behavior.
- `src/lib/server/api/*`: server API auth, env, node mutation, workspace access,
  and error envelopes.

## Development Notes

- Follow existing route and store patterns before introducing abstractions.
- Keep shared business rules in `src/lib` rather than duplicating them in route
  components.
- Server API writes mutate the same serialized `AppState` stored in
  `subman.json`.

