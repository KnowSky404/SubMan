# SubMan Server API Design

## Goal

Add a server-side REST API for trusted automation scripts, starting with the
`sing-box-vps` integration use case. The API lets a script create or update
SubMan nodes without opening the browser UI.

The first version is for owner-operated backend scripts only. It is not a
public browser API and does not need broad CORS support.

## Current Context

SubMan is deployed with SvelteKit on Cloudflare Workers. The browser UI stores a
user-provided GitHub token locally and uses it to read and write the workspace
Gist. Server-side API routes cannot access that browser-local token, so API
access needs separate server-side credentials.

The existing workspace model remains unchanged:

- Workspace Gist description: `SubMan-Data`
- Workspace config file: `subman.json`
- Data format: existing `exportSyncState` / `importState` payload
- Primary state sections: `nodes`, `subscriptions`, `aggregates`,
  `publishTargets`

## Architecture

Add SvelteKit `+server.ts` routes under `src/routes/api`. These routes run on
Cloudflare Workers through the existing adapter.

Cloudflare secrets provide server-side credentials:

- `GITHUB_TOKEN`: GitHub token with `gist` permission. Used only by Worker API
  routes to find, create, read, and update the workspace Gist.
- `SUBMAN_API_TOKEN`: SubMan API bearer token. Used by trusted scripts to call
  the API.

The browser UI can keep its current token and sync behavior. The new API is a
parallel server-side entry point that writes to the same workspace Gist.

## Authentication

Every API request except health checks must include:

```http
Authorization: Bearer <SUBMAN_API_TOKEN>
```

Invalid or missing tokens return `401`.

The API must not accept GitHub tokens from the caller in v1. This keeps
`sing-box-vps` scripts from needing direct GitHub credentials.

## CORS

Because v1 is called by backend scripts such as `curl` or install scripts, CORS
is not required for normal operation. Responses should not include permissive
`Access-Control-Allow-Origin: *` by default.

If browser-based API clients are needed later, add an allowlist-based CORS
layer with explicit `OPTIONS` handling.

## Endpoints

### Health

`GET /api/health`

Returns basic API availability and whether required server-side configuration is
present. It must not expose secret values.

### Nodes

`GET /api/nodes`

Returns all nodes from the workspace state.

`GET /api/nodes/:id`

Returns one node by internal SubMan node id.

`POST /api/nodes`

Creates a node. The server assigns `id` and `updatedAt` unless explicitly
provided for migration tooling.

`PATCH /api/nodes/:id`

Updates a node by internal id. Missing fields keep their previous values.

`DELETE /api/nodes/:id`

Deletes a node and removes the id from aggregate rule `nodeIds`, matching the
existing UI cleanup behavior.

`PUT /api/nodes/by-key/:externalKey`

Idempotently creates or updates a node owned by an external automation source.
This is the main endpoint for `sing-box-vps`.

The API stores the external key as a tag label in the form
`external:<externalKey>` so repeated script runs update the same node without
requiring a schema migration in v1.

Example:

```bash
curl -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

### Aggregates

Aggregate rule CRUD can follow after node API support:

- `GET /api/aggregates`
- `GET /api/aggregates/:id`
- `POST /api/aggregates`
- `PATCH /api/aggregates/:id`
- `DELETE /api/aggregates/:id`

These are lower priority than node upsert for the first `sing-box-vps`
integration.

## Request Shape

Node create/upsert accepts:

```json
{
  "name": "vps-1 vless",
  "type": "vless",
  "raw": "vless://...",
  "enabled": true,
  "tags": ["sing-box-vps", "auto"],
  "source": "single"
}
```

Validation rules:

- `name` must be a non-empty string.
- `type` must be one of the existing `ProxyType` values.
- `raw` must be a non-empty string.
- `enabled` defaults to `true`.
- `source` defaults to `single`.
- `tags` accepts strings and is converted to SubMan `NodeTag` objects.

## Data Flow

For write requests:

1. Authenticate `Authorization` against `SUBMAN_API_TOKEN`.
2. Ensure the workspace Gist exists using `GITHUB_TOKEN`.
3. Read `subman.json` from the workspace Gist.
4. Parse with existing import logic and default state fallback.
5. Apply the requested mutation.
6. Update `lastUpdated` and the changed item's `updatedAt`.
7. Write the full sync state back to `subman.json`.
8. Return the changed item and workspace metadata.

For read requests:

1. Authenticate.
2. Ensure/read the workspace Gist.
3. Return the requested state subset.

## Error Handling

Return JSON errors:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Unauthorized"
  }
}
```

Expected status codes:

- `400`: invalid request body or unsupported value
- `401`: missing or invalid API token
- `404`: requested item not found
- `405`: unsupported method
- `500`: missing server configuration or upstream Gist failure

## Testing

Add focused tests for pure API helpers:

- bearer token parsing
- node payload validation
- idempotent upsert by external key
- delete cleanup from aggregate `nodeIds`

Run existing project checks after implementation:

- `bun run check`
- `bun run lint`
- targeted unit tests where available

## Deployment Notes

Configure secrets before using API routes:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

Then deploy normally:

```bash
bun run build
bun run deploy
```

## Deferred Work

- Browser CORS allowlist.
- Multi-user API token mapping.
- D1, KV, or Durable Object storage for high-concurrency writes.
- Full aggregate and publish-target automation if `sing-box-vps` needs it.
