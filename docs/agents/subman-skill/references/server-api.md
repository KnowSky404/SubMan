# SubMan Server API Reference

For full endpoint documentation, see `docs/api/server-api.md`. This file is the
short agent-facing version for automation work.

## Purpose

The Server API is for owner-operated, trusted backend scripts. It runs inside the
same SvelteKit app on Cloudflare Workers and writes to the same Workspace Gist as
the browser UI through the same `WorkspaceCoordinator` Durable Object.

## Authentication

All endpoints except `GET /api/health` require:

```http
Authorization: Bearer <SUBMAN_API_TOKEN>
```

`SUBMAN_API_TOKEN` is separate from the GitHub token. Backend scripts should not
hold `GITHUB_TOKEN`.

## Preferred Automation Endpoint

Use this for VPS installers and repeatable node sync:

```http
PUT /api/nodes/by-key/:externalKey
```

It is idempotent. The API stores the external key as a tag label:

```text
external:<externalKey>
```

Choose stable keys such as `vps-1-vless`, `hostname-vless-reality`, or
`server-id-protocol-port`.

Example:

```bash
curl -fsS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
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
- `PUT /api/nodes/by-key/:externalKey`: idempotent create/update by stable key.

## Operational Constraints

- Every write is a revisioned mutation. The coordinator serializes commits, and
  a stale request returns `409 revision_conflict` instead of overwriting newer
  state.
- Retry revision conflicts with bounded backoff. GitHub Gist is still intended
  for low-frequency automation even though the coordinator prevents lost
  updates.
- A first write may migrate V1 and create the immutable
  `subman.v1.backup.json`; investigate `migration_backup_conflict` rather than
  replacing the backup.
- CORS is not broadly opened for arbitrary browser origins.
- Treat `409 duplicate_node_raw` as an idempotency or inventory mismatch signal;
  inspect the existing node before retrying with a different raw URI.
- Rotate `SUBMAN_API_TOKEN` if a trusted script host is compromised.
