# Integrating sing-box-vps with SubMan

[English](sing-box-vps.md) | [简体中文](sing-box-vps.zh-CN.md)

This guide covers trusted installers and backend agents that manage nodes through
SubMan. The supported interface is the [Server API](../api/server-api.md), with
schemas in [OpenAPI](../api/openapi.yaml). The browser's single cloud binding does
not change those public routes.

## Configure the two sides

The SubMan Worker holds `GITHUB_TOKEN` with `gist` permission and one
`SUBMAN_API_TOKEN`. The installer receives only the SubMan origin and
`SUBMAN_API_TOKEN`; it never needs the Worker's GitHub credential. The current
bearer grants full access to the node API and has no per-client scopes or
revocation. Keep it in protected server configuration and out of URLs and logs.
Secret uploads and deployments require authorization for the target Worker.

In sing-box-vps, configure `SUBMAN_API_URL`, `SUBMAN_API_TOKEN`, and a stable
`SUBMAN_NODE_PREFIX` through its existing configuration flow. Set the URL to the
SubMan origin, for example `https://subman.example.com`. Changing the prefix
changes managed resource identities; plan removal of obsolete nodes explicitly.
The existing `sbv agent subman-sync --json` command performs remote writes and
should run only when those writes are authorized.

`GET /api/health` needs no bearer. It always returns HTTP 200 and reports secret
presence only: inspect `ok`, then use an authenticated `GET /api/nodes` to check
the reachable Workspace. Discovery uses the Worker's credentials independently
of the browser binding. Verify `workspace.gistId` against the intended Gist;
even a node GET can create a bootstrap Gist if no matching candidate exists.
Discovery prefers exactly one valid V1/V2 document; otherwise, with no valid
document, it selects exactly one valid bootstrap. Invalid or bootstrap candidates
do not prevent selecting a unique valid document, and invalid candidates do not
prevent selecting a unique valid bootstrap. Multiple candidates at the selected
tier or only invalid candidates return `502 gist_read_failed`; there is no public
Workspace selector.

## Supported operations

| Installer task | Public operation | Result |
| --- | --- | --- |
| Inspect inventory or reconcile an uncertain write | `GET /api/nodes` | Nodes plus observed Workspace identity and revision |
| Create or replace one managed node | `PUT /api/nodes/by-key/:externalKey` | HTTP 200 plus the committed node and revision |
| Inspect one known node | `GET /api/nodes/:id` | Node plus observed revision |
| Remove one managed node | Find its exact key marker in the list, then `DELETE /api/nodes/:id` with `If-Match` | HTTP 200 plus `data.deleted: true` and committed revision |

There is no GET-by-key or DELETE-by-key route, no bulk transaction, and no public
aggregate, subscription, publication, or client-export endpoint. Do not call
`/api/workspaces/:workspaceId/mutations` or PATCH `subman.json` from an installer.
That internal browser protocol is not a supported integration surface.

## Resource identity and payloads

Use one stable key for each machine/protocol/instance/user/address combination.
For example, `sing-box-vps:edge-1:vless-reality:ipv4` is a caller-owned identity.
The current caller has protocol-specific key formats; preserve those existing
formats when updating it, rather than rebuilding keys from display names.

Encode the entire key exactly once as a URL path segment (`jq @uri` or
`encodeURIComponent`). Matching is case-sensitive after trimming. Check the
**unencoded UTF-8 byte length**, not the percent-encoded length:

| Field | Effective limit for new or edited values |
| --- | --- |
| External key | 119 UTF-8 bytes, leaving 9 bytes for `external:` in a 128-byte tag label |
| Ordinary caller tags on by-key PUT | 63 distinct labels, leaving the 64th slot for the key marker |
| Tag label | 128 UTF-8 bytes |
| Node name | 256 UTF-8 bytes |
| Raw node URI | 16 KiB |
| JSON request | 9 MiB of streamed bytes |

Do not supply `external:` tags yourself. The coordinator adds the marker. PUT
replaces writable fields: send the full desired `name`, `type`, `raw`, `enabled`,
`source`, and ordinary `tags`. Omitted `enabled`, `source`, and `tags` become
`true`, `single`, and an empty list. PATCH tags replace the complete list and can
remove the key marker; use by-key PUT for machine-managed tags.

Identical raw URIs on another node return `409 duplicate_node_raw`. Duplicate
names receive a timestamp suffix. Treat the returned ID as authoritative.
Deleting a node tombstones its ID and removes aggregate references. A subsequent
PUT using the old key may create a different node ID; it does not restore the
deleted ID or its old aggregate memberships.

## Validate success and handle concurrency

For every successful node response, check that these agree:

- `workspace.file` is `subman.json`, and `workspace.gistId` is the intended Gist;
- `workspace.revision` is a nonnegative integer;
- `X-SubMan-Revision` is that same decimal revision;
- `ETag` is `"subman-revision-<revision>"` and the response is `no-store`;
- an upsert returns a node ID and the exact `external:<key>` tag marker;
- a deletion returns `data.deleted: true`.

A write 2xx means the coordinator committed and read-back verified the remote
Workspace. A browser queue state or HTTP health result cannot substitute for
this evidence. Upstream failures and transport loss can leave the write outcome
uncertain, including failures after GitHub accepted a PATCH.

Use the strong ETag from a read as `If-Match` when protecting read-modify-write
or deletion. It is scoped to the Workspace, so verify the Gist ID as well.
`412 precondition_failed` or `409 revision_conflict` requires re-reading and
deliberately reapplying the intent. `If-Match: *` provides no revision guard.

The API does not support `Idempotency-Key`. A repeated by-key PUT preserves
resource identity but can advance revision again. After transport loss or an
uncertain write error, re-read and find the exact marker, compare desired state,
and then decide whether another write is needed. Do not automatically replay
POST or DELETE. With a known retryable pre-write failure, use bounded backoff
and honor safe `Retry-After` metadata. Branch on error `code` and `disposition`,
not translated message text. Preserve per-node partial-success information when
synchronizing several nodes; separate requests are not atomic together.

## Current sing-box-vps compatibility review

Reviewed on **2026-10-26**, against SubMan revision `ed6fa5a` and
[sing-box-vps revision `9bac47e`](https://github.com/KnowSky404/sing-box-vps/commit/9bac47e).
That is still the caller's latest default-branch commit at review time. The
findings below describe that source snapshot; later releases need another review.

The locally checked caller already URL-encodes keys once, validates committed
revision/ETag and key-marker responses, reads stable errors, reports unknown
transport outcomes, and uses list plus conditional deletion for old keys. Those
operations remain compatible with the current SubMan API.

Four caller changes are needed in sing-box-vps:

1. `validate_subman_node_request` and some key builders still permit 256-byte
   keys. The server's generated tag makes the usable limit **119 bytes**.
   Validate the complete generated key, including prefix, instance/user digest,
   and address suffix, before requesting a write. Shorten the configured prefix
   or choose a deliberately migrated deterministic identity scheme when needed;
   do not silently truncate existing keys.
2. Its generic payload validator permits 64 caller tags. By-key requests must
   leave the marker slot and use at most **63 distinct ordinary labels**.
3. `validate_subman_workspace_response` checks the file, revision, ETag, and key
   marker, but does **not** compare `workspace.gistId` with an expected Gist.
   Add explicit expected-Gist configuration, check it with GET before writing,
   and verify it in every node response. The current sync command sends PUT
   directly; it has no health or expected-Gist preflight. These remain operator
   steps until adapted. The API has no request parameter that atomically pins
   discovery to that Gist; an ETag alone cannot provide that guarantee.
4. `subman_api_request` parses headers with awk `IGNORECASE=1`, which mawk does
   not support. A valid lowercase `etag` or `x-subman-revision` can be missed,
   causing `revision_contract_mismatch` after a successful remote write. Use
   portable case-insensitive matching such as `tolower($0) ~ /^etag:/` for
   ETag, revision, and retry timing. This failure was reproduced with mawk 1.3.4;
   see the [current header parser](https://github.com/KnowSky404/sing-box-vps/blob/9bac47efe45e85133b68fb89026ad8d88a3bea90/install.sh#L25408).

SubMan already enforces these limits. This guide does not change the API or
modify the sing-box-vps repository. An integration failing these checks must be
fixed in that caller; widening a generic protocol limit does not widen tag
limits.

The caller currently ignores `Cache-Control: no-store`. Its multi-node result
contains synced/skipped/failed counts and the last error, without a per-node
key/ID outcome record. Add response-cache validation and per-node outcome
records when implementing the acceptance checks below.

## Caller adaptation acceptance checks

Use synthetic responses and a disposable mock API for these checks:

| Case | Required behavior |
| --- | --- |
| Complete key at 119/120 UTF-8 bytes, including multibyte text | Accept 119; reject 120 before sending a write; preserve existing keys |
| 63/64 distinct ordinary tags | Accept 63; reject 64 before by-key PUT; let the server add the marker |
| Unexpected Gist or mismatched revision/ETag/key marker | Stop preflight on the wrong Gist; do not report a mismatched write response as success |
| Lowercase and mixed-case response headers under mawk | Read ETag, revision, Retry-After, and no-store consistently |
| Lost response after a committed PUT | GET and compare the exact key and desired state before deciding to resend |
| Several nodes with mixed outcomes | Retain each key/ID and outcome; preserve successful writes when another node fails |
| Unsupported protocol or settings | Report an explicit skip without a lossy `other` conversion |

These are adaptation requirements, not claims about tests already present in
sing-box-vps. Keep fixtures free of real tokens and node credentials.

The caller's protocol support is also narrower than SubMan's node-type enum.
Its dedicated VLESS, Hysteria2, Trojan, VMess, and encrypted dual-network
Shadowsocks paths apply their own representability checks and per-user skips.
Its current unsupported protocols must stay explicit skips rather than being
sent as `other`. A type accepted by SubMan does not prove that an installer can
serialize every setting losslessly. See sing-box-vps capabilities and warnings
for the installed revision, and [SubMan's export matrix](../sing-box-export.md)
for the separate client conversion boundary.

Node updates do not regenerate published subscriptions or sing-box files.
Review and publish affected outputs in the browser. Future automation endpoints
remain a [roadmap](../api/roadmap.md), not an available feature.

This review uses local source and synthetic contract tests. It does not establish
production deployment, real Gist writes, or end-to-end synchronization with a
live sing-box-vps host.
