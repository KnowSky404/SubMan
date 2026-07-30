# SubMan Server API Reference

For full endpoint documentation, see `docs/api/server-api.md`. For schemas and
code generation, use `docs/api/openapi.yaml`. This file is the short
agent-facing version for automation work.

## Purpose

The Server API is for owner-operated, trusted backend scripts. It runs inside the
same SvelteKit app on Cloudflare Workers and writes to the same Workspace Gist as
the browser UI through the same `WorkspaceCoordinator` Durable Object.

## Authentication

All endpoints except `GET /api/health` require:

```http
Authorization: Bearer <SUBMAN_API_TOKEN>
```

`SUBMAN_API_TOKEN` is separate from the GitHub token. It is one shared,
full-access bearer without scopes or per-client revocation. Backend scripts
should not hold `GITHUB_TOKEN`; they should receive the API token only over TLS,
keep it out of URLs and logs, and support rotation.

## Preferred Automation Endpoint

Use this for VPS installers and repeatable node sync:

```http
PUT /api/nodes/by-key/:externalKey
```

One stable external key addresses one node. The API stores the key as a tag
label:

```text
external:<externalKey>
```

Choose stable keys such as `vps-1-vless`, `hostname-vless-reality`, or
`server-id-protocol-port`. URL-encode the path segment, keep it within 256 UTF-8
bytes, and do not use the reserved `external:` tag namespace for unrelated tags.

The endpoint is resource-identity idempotent, not request-replay idempotent.
Every successful call may update `updatedAt` and advance the Workspace revision.
`Idempotency-Key` is not supported.

Example:

```bash
curl --fail-with-body -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer ${SUBMAN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

## Node Payload

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

- `name`, `type`, and `raw` are required.
- Duplicate names are automatically saved with a timestamp suffix, for example
  `HK 2026-05-26 06:32`.
- Duplicate trimmed `raw` URIs are rejected with `409 duplicate_node_raw`.
- `enabled` defaults to `true`.
- `source` defaults to `single`.
- `tags` defaults to an empty array.
- `tags` may be strings or `{ "id": "...", "label": "..." }` objects.

Allowed `type` values:

```text
vless, vmess, trojan, ss, ssr, hysteria2, tuic, anytls, other
```

## Available Endpoints

- `GET /api/health`: check Worker secret configuration.
- `GET /api/nodes`: list nodes.
- `POST /api/nodes`: create a new node, unless the raw URI already exists.
- `GET /api/nodes/:id`: get one node.
- `PATCH /api/nodes/:id`: update one node; duplicate names are made unique and
  raw URI collisions are rejected.
- `DELETE /api/nodes/:id`: delete one node and remove it from aggregate
  `nodeIds`.
- `PUT /api/nodes/by-key/:externalKey`: create/update the node identified by a
  stable key.

Only these health and node routes are public integration contracts. The browser
route `/api/workspaces/:workspaceId/mutations` is internal, uses a different
credential and envelope, and has no compatibility guarantee. Subscriptions,
aggregates, publication, and exports do not yet have public REST endpoints.

## Completion And Revision Contract

- A Node API `2xx` response means the coordinator committed and read-back
  verified the remote Workspace. Browser-only completion states such as
  `peer-owned` and `retry-scheduled` do not apply to this API.
- Successful node responses include the committed revision in the JSON body,
  `X-SubMan-Revision`, and a strong ETag such as
  `"subman-revision-12"`.
- A write may send the last ETag as `If-Match`. A stale value returns
  `412 precondition_failed` with disposition `state-conflict` and the current
  revision. Re-read before deciding whether to reapply the intent.
- Concurrent writes without `If-Match` may still receive
  `409 revision_conflict` from the coordinator.

Errors use `{ "error": { "code", "message", "disposition" } }`. Branch on
`code` and `disposition`, never on `message`. Retryable GitHub failures may add a
bounded `gateway` object and `Retry-After` header; no raw upstream body is
returned.

## Retry Rules

- `GET`: retry transport and `retryable-upstream` failures with bounded backoff.
- `PUT .../by-key`: after a definite non-commit response, retry with bounded
  backoff. After a lost/unknown response, GET first; a blind replay can advance
  revision again.
- `PATCH`: re-read the node and revision before retrying an unknown outcome.
- `POST`: never blindly retry an unknown outcome because it may create another
  node.
- `DELETE`: re-read after an unknown outcome; a repeated delete may return
  `entity_deleted` or `entity_not_found`.

## Operational Constraints

- Every write is a revisioned mutation. GitHub Gist remains a low-frequency
  storage backend even though the coordinator prevents lost updates.
- A first write may migrate V1 and create the immutable
  `subman.v1.backup.json`; investigate `migration_backup_conflict` rather than
  replacing the backup.
- CORS is not broadly opened for arbitrary browser origins and is not an
  authentication boundary.
- Treat `409 duplicate_node_raw` as an idempotency or inventory mismatch signal;
  inspect the existing node before retrying with a different raw URI.
- Rotate `SUBMAN_API_TOKEN` if a trusted script host is compromised.
