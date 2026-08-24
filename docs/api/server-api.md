# SubMan Server API

SubMan Server API is an owner-operated REST API for trusted backend scripts.
The first version is designed for automation such as `sing-box-vps` installing
or updating nodes in the SubMan workspace.

The API runs inside the existing SvelteKit app on Cloudflare Workers. It writes
to the same Workspace Gist used by the browser UI.

The machine-readable source for schemas, operation IDs, parameters, response
headers, and examples is [`openapi.yaml`](openapi.yaml).

## Supported Surface And Compatibility

The supported public API consists of `GET /api/health` and the node endpoints
documented below. The current unversioned paths are the first compatibility
generation: compatible changes should remain additive. A future breaking
contract must use a new versioned path or an explicitly negotiated version.

Subscriptions, aggregate rules, publication, output files, and client exports do
not yet have public REST endpoints. External callers must not PATCH the Gist or
call `/api/workspaces/:workspaceId/mutations`. That route is an internal browser
transport with a different credential and mutation envelope and has no public
compatibility guarantee.

The staged design for expanding this surface is documented in
[`roadmap.md`](roadmap.md). It does not change the current supported contract.

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
token, but it is one shared full-access bearer: there are no scopes, per-client
identities, per-client revocation, or built-in caller rate limits. Give it only
to trusted backend scripts over TLS, keep it out of URLs and logs, and rotate it
periodically. CORS is not an authentication boundary.

## Server Configuration

Before using the API in Cloudflare Workers, configure two secrets:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

`GITHUB_TOKEN` must have GitHub `gist` permission. The Worker uses it to find or
create the Workspace Gist and passes it separately to the Workspace coordinator
for each request. It is never included in a mutation payload.

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

If the Workspace Gist does not exist, the API creates only a bootstrap marker.
Each write builds a revisioned node mutation and submits it to the
`WorkspaceCoordinator` Durable Object for that Gist. The coordinator reads the
latest document, applies one mutation, and commits `subman.json` in a verified
Gist PATCH. Browser and Server API writes therefore share the same ordering,
idempotency, tombstone, and conflict rules.

The public Node API is synchronous. A `2xx` response means the coordinator
committed and read-back verified the remote Workspace. Browser completion states
such as `local-durable-queued`, `peer-owned`, and `retry-scheduled` do not apply
to public API callers.

The first write to a V1 Workspace preserves the exact original bytes as
`subman.v1.backup.json` before committing V2. See
`docs/workspace-v2-operations.md` for migration and rollback procedures.

## Common Headers

For JSON requests:

```http
Authorization: Bearer <SUBMAN_API_TOKEN>
Content-Type: application/json
If-Match: "subman-revision-12"
```

`If-Match` is optional on writes. Use the strong ETag from a previous successful
node response to prevent a stale read-modify-write. `If-Match: *` means the
caller does not require a specific revision. A stale or weak validator returns
`412 precondition_failed` and the current revision.

Every successful node response includes:

```http
ETag: "subman-revision-13"
X-SubMan-Revision: 13
Cache-Control: no-store
```

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
    "file": "subman.json",
    "revision": 12
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
    "file": "subman.json",
    "revision": 13
  }
}
```

Error responses:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Unauthorized",
    "disposition": "auth-required"
  }
}
```

Errors always use a stable `code` and `disposition`. A GitHub failure may add a
bounded `gateway` object containing only operation, status, category, request ID,
retry-after, and rate-limit reset. Raw GitHub response bodies, credentials,
exception messages, stacks, and Workspace documents are never returned. A
conflict may add only `{ "workspace": { "revision": 13 } }`. Branch on `code`
and `disposition`, not the human-readable `message`.

When safe GitHub metadata includes `retryAfter`, the response also carries the
standard `Retry-After` header. The `gateway` object is optional: discovery/read
failures that occur before coordinator submission may return a sanitized 502
without upstream metadata.

## Request And Domain Limits

JSON writes require `application/json` or a `+json` media type. The Worker counts
streamed bytes rather than trusting only `Content-Length`; the request limit is 9
MiB. Invalid media type, malformed JSON, and oversize bodies return stable 415,
400, and 413 errors respectively.

Created or edited values use UTF-8/count limits: node raw 16 KiB, subscription URL
8 KiB, names 256 bytes, labels 128 bytes, external keys 256 bytes, 64 tags per
entity, 5,000 entities per collection, rename maps of at most 1,000 entries and
64 KiB, output content 1 MiB, and canonical Workspace documents 8 MiB. Unchanged
oversized legacy fields remain readable and may be reduced; unrelated changes do
not reject them.

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
    "file": "subman.json",
    "revision": 12
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
curl --fail-with-body -sS -X POST "https://subman.example.com/api/nodes" \
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
curl --fail-with-body -sS -X PATCH "https://subman.example.com/api/nodes/node-id" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "subman-revision-12"' \
  -d '{"enabled":false,"name":"vps-1 disabled"}'
```

### Delete Node

```http
DELETE /api/nodes/:id
```

Deletes the node and removes its id from aggregate rule `nodeIds`.

Example:

```bash
curl --fail-with-body -sS -X DELETE "https://subman.example.com/api/nodes/node-id" \
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
    "file": "subman.json",
    "revision": 13
  }
}
```

### Upsert Node By External Key

```http
PUT /api/nodes/by-key/:externalKey
```

This is the recommended endpoint for automation scripts. One stable
`externalKey` addresses one node, so repeated calls update that resource instead
of creating duplicates. This is resource-identity idempotency, not request
replay idempotency: each successful update may change `updatedAt` and advance the
Workspace revision. The API does not support `Idempotency-Key`.

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

URL-encode the path segment and keep the decoded value within 256 UTF-8 bytes.
The `external:` tag label namespace is reserved for this identity mapping; do not
use it for unrelated caller tags.

Example:

```bash
curl --fail-with-body -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
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

NODE_HOSTNAME="$(hostname)"
NODE_KEY="${NODE_HOSTNAME}-vless-reality"
NODE_NAME="${NODE_HOSTNAME} vless reality"
NODE_RAW="vless://..."

PAYLOAD="$(jq -cn \
  --arg name "${NODE_NAME}" \
  --arg raw "${NODE_RAW}" \
  '{name: $name, type: "vless", raw: $raw, enabled: true, tags: ["sing-box-vps", "auto"]}')"

curl --fail-with-body -sS -X PUT "${SUBMAN_BASE_URL}/api/nodes/by-key/${NODE_KEY}" \
  -H "Authorization: Bearer ${SUBMAN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "${PAYLOAD}"
```

Use a URL encoder when `NODE_KEY` is not already limited to unreserved URL
characters. A JSON serializer such as `jq` is required when values are dynamic;
do not build JSON by string interpolation.

## TypeScript Integration Example

```ts
type SubManResult = {
  error?: { code: string; disposition: string };
};

const response = await fetch(
  `${submanOrigin}/api/nodes/by-key/${encodeURIComponent(externalKey)}`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${submanApiToken}`,
      "Content-Type": "application/json",
      ...(previousEtag ? { "If-Match": previousEtag } : {}),
    },
    body: JSON.stringify(node),
  },
);
const result = (await response.json()) as SubManResult;
if (!response.ok) {
  if (!result.error) throw new Error(`Unexpected HTTP ${response.status}`);
  throw new Error(`${result.error.code}: ${result.error.disposition}`);
}
const committedEtag = response.headers.get("etag");
```

Production integrations should map stable codes/dispositions to typed outcomes
instead of throwing a generic error as this compact example does.

## Retry Matrix

| Method | Known non-commit failure | Unknown outcome or lost response |
| --- | --- | --- |
| `GET` | Retry `retryable-upstream` with bounded backoff. | Retry safely. |
| `PUT .../by-key` | Retry `retryable-upstream`; honor `Retry-After`. | GET first. Blind replay can advance revision again. |
| `PATCH` | Re-read on state conflict; retry only after reapplying intent. | GET first and compare the node plus revision. |
| `POST` | Correct validation/domain errors before a new request. | Do not blindly retry; a node may already exist. |
| `DELETE` | Resolve tombstone/not-found responses as current state. | GET first; repeated delete is not request-idempotent. |

The API does not accept `Idempotency-Key`. `If-Match` protects optimistic
concurrency but does not make an unknown-outcome request safe to replay.

## Status Codes

| Status | Code | Meaning |
| --- | --- | --- |
| `200` | - | Read, update, delete, or upsert succeeded. |
| `201` | - | Node created by `POST /api/nodes`. |
| `400` | `bad_request` | Invalid JSON body or unsupported field value. |
| `400` | `invalid_json` | The request body is missing, malformed, or invalid UTF-8 JSON. |
| `401` | `unauthorized` | Missing or invalid `SUBMAN_API_TOKEN`. |
| `401` / `403` | `gist_read_failed` / `gist_write_failed` | GitHub authentication or permission failed; reconnect or repair the Worker secret. |
| `404` | `not_found` | Requested node id does not exist. |
| `404` | `entity_not_found` | A write targeted a node that does not exist. |
| `404` | `workspace_not_found` | The configured Workspace Gist no longer exists. |
| `412` | `precondition_failed` | `If-Match` does not match the current Workspace revision. |
| `409` | `duplicate_node_raw` | Submitted raw URI already belongs to another node. |
| `409` | `revision_conflict` | Another mutation committed after this request loaded the Workspace; retry from the latest revision. |
| `409` | `entity_deleted` | A stale write attempted to restore a tombstoned entity. |
| `409` | `migration_backup_conflict` | The existing V1 backup does not match the current V1 config. |
| `422` | `unsupported_schema` | The Workspace uses a newer unsupported schema. |
| `413` | `payload_too_large` | The streamed JSON body exceeds 9 MiB. |
| `415` | `unsupported_media_type` | The request is not JSON. |
| `429` | `gist_read_failed` / `gist_write_failed` | GitHub rate limited the operation; honor safe retry metadata. |
| `500` | `server_error` | A required Worker secret or coordinator binding is missing, or an unexpected failure occurred. |
| `502` | `gist_read_failed` / `gist_write_failed` / `write_verification_failed` | Network, invalid response, or upstream GitHub I/O failed without a verified commit. |
| `504` | `gist_read_failed` / `gist_write_failed` | A bounded GitHub request timed out. |

## Operational Notes

- Keep `GITHUB_TOKEN` only in Cloudflare Secrets.
- Give backend scripts only `SUBMAN_API_TOKEN`.
- Rotate `SUBMAN_API_TOKEN` periodically and immediately if a script host is
  compromised.
- The Durable Object serializes concurrent mutations and rejects stale
  revisions, but GitHub Gist remains a low-frequency storage backend.
- Retry only `retryable-upstream` responses with bounded backoff and safe
  `Retry-After`/rate-limit metadata. A `revision_conflict` or
  `precondition_failed` is `state-conflict`: reload current state and
  deliberately reapply the intent.
- `GET` is safe to retry. After an unknown write outcome, re-read before acting:
  `PUT .../by-key` can advance revision again, `PATCH` can reapply a change,
  `POST` can create another node, and repeated `DELETE` can return a tombstone or
  not-found conflict.
- CORS is intentionally not opened for arbitrary browser origins and must not be
  treated as access control.
