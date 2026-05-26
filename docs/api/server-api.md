# SubMan Server API

SubMan Server API is an owner-operated REST API for trusted backend scripts.
The first version is designed for automation such as `sing-box-vps` installing
or updating nodes in the SubMan workspace.

The API runs inside the existing SvelteKit app on Cloudflare Workers. It writes
to the same Workspace Gist used by the browser UI.

## Base URL

Use the origin where SubMan is deployed:

```text
https://subman.example.com
```

Examples below use `https://subman.example.com`. Replace it with your deployed
SubMan domain.

## Authentication

All endpoints except `GET /api/health` require:

```http
Authorization: Bearer <SUBMAN_API_TOKEN>
```

`SUBMAN_API_TOKEN` is your own SubMan API token. It is separate from the GitHub
token and is safe to give to trusted automation scripts.

## Server Configuration

Before using the API in Cloudflare Workers, configure two secrets:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

`GITHUB_TOKEN` must have GitHub `gist` permission. The Worker uses it to find or
create the Workspace Gist and update `subman.json`.

`SUBMAN_API_TOKEN` is an arbitrary long secret value that callers must send in
the `Authorization` header.

Then deploy:

```bash
bun run build
bun run deploy
```

## Workspace Behavior

The API uses the same workspace identity as the UI:

- Gist description: `SubMan-Data`
- Workspace file: `subman.json`

If the Workspace Gist does not exist, the API creates it. Write operations read
the current `subman.json`, mutate the requested node data, then write the full
sync state back to the same file.

## Common Headers

For JSON requests:

```http
Authorization: Bearer <SUBMAN_API_TOKEN>
Content-Type: application/json
```

The API is intended for backend scripts. It does not enable broad browser CORS
by default.

## Data Types

### Node

```json
{
  "id": "string",
  "name": "vps-1 vless",
  "type": "vless",
  "raw": "vless://...",
  "tags": [
    {
      "id": "sing-box-vps",
      "label": "sing-box-vps"
    }
  ],
  "enabled": true,
  "updatedAt": "2026-05-06T00:00:00.000Z",
  "source": "single"
}
```

Allowed `type` values:

- `vless`
- `vmess`
- `trojan`
- `ss`
- `ssr`
- `hysteria2`
- `tuic`
- `anytls`
- `other`

Allowed `source` values:

- `single`
- `subscription`

### Node Create Body

`POST /api/nodes` and `PUT /api/nodes/by-key/:externalKey` accept:

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

Rules:

- `name` is required.
- If another node already has the same name, the API saves the node with a
  timestamp suffix such as `HK 2026-05-26 06:32`.
- `type` is required and must be one of the allowed proxy types.
- `raw` is required.
- If another node already has the same trimmed `raw` URI, the API rejects the
  write with `409 duplicate_node_raw`.
- `enabled` defaults to `true`.
- `source` defaults to `single`.
- `tags` defaults to an empty array.
- `tags` may be strings or `{ "id": "...", "label": "..." }` objects.

### Node Patch Body

`PATCH /api/nodes/:id` accepts any subset of the node create body:

```json
{
  "name": "vps-1 renamed",
  "enabled": false
}
```

Missing fields keep their existing values.

Patch requests use the same duplicate handling as create requests: duplicate
names are made unique, and duplicate raw URIs on another node are rejected.

## Response Envelope

List responses:

```json
{
  "data": [],
  "workspace": {
    "gistId": "gist-id",
    "file": "subman.json"
  }
}
```

Single-node write responses:

```json
{
  "data": {
    "id": "node-id",
    "name": "vps-1 vless",
    "type": "vless",
    "raw": "vless://...",
    "tags": [],
    "enabled": true,
    "updatedAt": "2026-05-06T00:00:00.000Z",
    "source": "single"
  },
  "workspace": {
    "gistId": "gist-id",
    "file": "subman.json"
  }
}
```

Error responses:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Unauthorized"
  }
}
```

## Endpoints

### Health Check

```http
GET /api/health
```

Authentication: not required.

Returns whether the required server-side secrets are configured. Secret values
are never returned.

Example:

```bash
curl -sS "https://subman.example.com/api/health"
```

Response:

```json
{
  "ok": true,
  "config": {
    "githubToken": true,
    "submanApiToken": true
  }
}
```

### List Nodes

```http
GET /api/nodes
```

Example:

```bash
curl -sS "https://subman.example.com/api/nodes" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN"
```

Response:

```json
{
  "data": [
    {
      "id": "node-id",
      "name": "vps-1 vless",
      "type": "vless",
      "raw": "vless://...",
      "tags": [],
      "enabled": true,
      "updatedAt": "2026-05-06T00:00:00.000Z",
      "source": "single"
    }
  ],
  "workspace": {
    "gistId": "gist-id",
    "file": "subman.json"
  }
}
```

### Create Node

```http
POST /api/nodes
```

Creates a new node every time unless the submitted raw URI already exists. If
the submitted name already exists, the saved name receives a timestamp suffix.
For installer scripts, prefer `PUT /api/nodes/by-key/:externalKey` to avoid
creating separate records for the same machine-managed node.

Example:

```bash
curl -sS -X POST "https://subman.example.com/api/nodes" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["manual"]}'
```

Success status: `201 Created`.

### Get Node

```http
GET /api/nodes/:id
```

Example:

```bash
curl -sS "https://subman.example.com/api/nodes/node-id" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN"
```

### Update Node

```http
PATCH /api/nodes/:id
```

Example:

```bash
curl -sS -X PATCH "https://subman.example.com/api/nodes/node-id" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false,"name":"vps-1 disabled"}'
```

### Delete Node

```http
DELETE /api/nodes/:id
```

Deletes the node and removes its id from aggregate rule `nodeIds`.

Example:

```bash
curl -sS -X DELETE "https://subman.example.com/api/nodes/node-id" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN"
```

Response:

```json
{
  "data": {
    "deleted": true
  },
  "workspace": {
    "gistId": "gist-id",
    "file": "subman.json"
  }
}
```

### Upsert Node By External Key

```http
PUT /api/nodes/by-key/:externalKey
```

This is the recommended endpoint for automation scripts. It is idempotent:
running the same command again updates the existing node instead of creating a
duplicate.

It still follows normal node validation: duplicate names are made unique, and a
raw URI that already belongs to a different node is rejected with
`409 duplicate_node_raw`.

The API stores the external key as a hidden-style tag label:

```text
external:<externalKey>
```

Choose a stable `externalKey`, for example:

- `vps-1-vless`
- `hostname-vless-reality`
- `server-id-protocol-port`

Example:

```bash
curl -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

## Shell Integration Example

```bash
#!/usr/bin/env bash
set -euo pipefail

SUBMAN_BASE_URL="https://subman.example.com"
SUBMAN_API_TOKEN="${SUBMAN_API_TOKEN:?SUBMAN_API_TOKEN is required}"

HOSTNAME="$(hostname)"
NODE_KEY="${HOSTNAME}-vless-reality"
NODE_NAME="${HOSTNAME} vless reality"
NODE_RAW="vless://..."

curl -fsS -X PUT "${SUBMAN_BASE_URL}/api/nodes/by-key/${NODE_KEY}" \
  -H "Authorization: Bearer ${SUBMAN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${NODE_NAME}\",\"type\":\"vless\",\"raw\":\"${NODE_RAW}\",\"enabled\":true,\"tags\":[\"sing-box-vps\",\"auto\"]}"
```

## Status Codes

| Status | Code | Meaning |
| --- | --- | --- |
| `200` | - | Read, update, delete, or upsert succeeded. |
| `201` | - | Node created by `POST /api/nodes`. |
| `400` | `bad_request` | Invalid JSON body or unsupported field value. |
| `401` | `unauthorized` | Missing or invalid `SUBMAN_API_TOKEN`. |
| `409` | `duplicate_node_raw` | Submitted raw URI already belongs to another node. |
| `404` | `not_found` | Requested node id does not exist. |
| `500` | `server_error` | Missing `GITHUB_TOKEN` or unexpected server/Gist failure. |

## Operational Notes

- Keep `GITHUB_TOKEN` only in Cloudflare Secrets.
- Give backend scripts only `SUBMAN_API_TOKEN`.
- Rotate `SUBMAN_API_TOKEN` if a script host is compromised.
- The Gist backend is suitable for low-frequency automation. It is not intended
  for high-concurrency writes from many machines at the same time.
- CORS is intentionally not opened for arbitrary browser origins in this API
  version.
