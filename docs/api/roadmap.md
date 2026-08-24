# Public API Expansion Roadmap

SubMan's current public API is intentionally small: health plus node CRUD and
`externalKey` updates. The browser mutation route
`/api/workspaces/:workspaceId/mutations` is an internal transport and is not a
third-party API.

This document describes the next API contract; it does not authorize or
implement these routes.

## Contract principles

- `subman.json` remains the authoritative Workspace Schema V2 document.
- Every write goes through the Workspace coordinator with the existing
  `expectedRevision`, mutation ID, tombstone, idempotency, and same-Gist-PATCH
  rules. No public route may patch a Gist directly.
- Successful writes return the committed Workspace revision, a strong ETag,
  and `Cache-Control: no-store`. Clients use `If-Match` for optimistic
  concurrency.
- Error responses keep stable codes and dispositions. Gateway details remain
  bounded metadata; raw upstream bodies, tokens, payloads, documents, and
  stacks are never returned or logged.
- The current unversioned node paths remain an additive compatibility surface.
  Breaking changes use `/api/v2` or explicit version negotiation.

## Candidate resource groups

| Area | Candidate operations | Key contract questions |
| --- | --- | --- |
| Subscriptions | list, create, update, delete | URL ownership, fetch policy, CORS classification, and whether remote content is ever persisted |
| Aggregates | list, create, update, delete, preview | stable rule identity, source snapshot semantics, and bounded preview size |
| Publication | preview, publish, inspect status, delete output | output freshness, file-name transitions, and atomic document/output publication |
| Client exports | list, create, update, delete, generate, publish | sing-box version/schema negotiation and generated-output limits |
| Diagnostics | health, Workspace summary, queue summary | safe fields only, operator authorization, and no quarantine/payload export |

The first expansion should likely prioritize subscriptions and aggregate reads,
then add explicit preview and publication operations once freshness semantics
are specified. A generated output must never be presented as committed until the
coordinator confirms the corresponding Workspace mutation.

## Authentication evolution

The existing `SUBMAN_API_TOKEN` is one shared, full-access bearer. Before
opening more resource groups, the API needs a versioned authentication contract
with:

- named client identities and scopes such as `nodes:write`,
  `subscriptions:read`, and `publication:write`;
- token rotation and revocation without requiring a global outage;
- bounded caller rate limits and replay/idempotency policy;
- audit events that contain identity and outcome metadata, never raw tokens;
- explicit separation between operator access and automation access.

CORS is not an authentication boundary. A future scoped token must remain
request-header-only and must not be stored in Workspace documents or browser
business persistence.

## Delivery phases

1. Publish the schemas and examples as an additive contract, including limits,
   ETags, error dispositions, and authentication scopes.
2. Implement read-only subscription and aggregate endpoints using a consistent
   revision snapshot.
3. Implement revisioned writes through the coordinator and contract-test every
   route against the OpenAPI document.
4. Add publication and export operations only after output freshness,
   same-PATCH behavior, and post-commit acknowledgement are covered by tests.
5. Introduce a versioned authentication scheme and migrate trusted callers
   before enabling broader third-party use.

Until these phases are complete, external callers should use only the routes
listed in [`server-api.md`](server-api.md) and must not call the internal
Workspace mutation route.
