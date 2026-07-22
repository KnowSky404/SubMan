# Workspace V2 Operations

This runbook covers deployment, first-write migration, verification, and
rollback for the Workspace Schema V2 coordinator.

## Runtime Contract

- `subman.json` is the authoritative Workspace V2 document.
- One `WorkspaceCoordinator` Durable Object is addressed by `gist:<gist-id>`.
- Every Workspace-mode browser and Server API mutation that can change
  `subman.json` goes through that coordinator.
- Automatic Workspace-mode browser mutations are persisted in a local queue
  and sent in revision order. Local-only, bind-only, and paused modes do not
  send automatic mutations.
- `subman.v1.backup.json` and `subman.bootstrap.json` are reserved recovery
  files. Generated outputs cannot replace or delete them.

The checked-in Wrangler configuration binds `WORKSPACE_COORDINATOR` and creates
the SQLite-backed class with migration tag `v1`. Migration tags are immutable
deployment history; do not rename or remove an applied tag.

## Pre-Deployment Gate

Run the complete local gate:

```bash
bun test
bun run check
bun run lint
bun run build
bun run test:cf
bun wrangler deploy --dry-run
```

Start the local Cloudflare runtime, inspect the health payload, and verify the
unauthenticated mutation boundary:

```bash
bun run dev:cf -- --ip :: --port 8787
curl -fsS "http://127.0.0.1:8787/api/health" | jq .
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:8787/api/workspaces/smoke/mutations")" = "401"
```

Wrangler local development uses local simulated bindings and Durable Object
storage by default. Without local secrets, health returns HTTP 200 with
`ok: false`; that is expected locally but is not production readiness. The
`bun run test:cf` gate exercises an authenticated Worker mutation through the
real Durable Object and SQLite journal with mocked GitHub I/O. Do not use
production GitHub credentials for disposable local migration fixtures.

## Production Deployment

1. Confirm `GITHUB_TOKEN` and `SUBMAN_API_TOKEN` are configured as Worker
   secrets. Never place either value in `wrangler.toml`.
2. Export the current `subman.json` from each controlled migration Workspace.
3. Run the pre-deployment gate, including the Wrangler dry-run.
4. Deploy the Worker and Durable Object migration together with
   `bun run deploy`.
5. Require the deployed health payload to report both secrets:
   `curl -fsS "$SUBMAN_ORIGIN/api/health" | jq -e '.ok == true and
   .config.githubToken == true and .config.submanApiToken == true'`.
6. Use one controlled Workspace for the first browser or Server API mutation.
7. Inspect the Gist and confirm the migration evidence below before widening
   use.

Deployment or production Gist mutation requires explicit operator approval.

## First-Write Migration

Existing V1 Gists are not rewritten during discovery. On the first successful
coordinator mutation, the Durable Object performs one verified Gist PATCH that:

1. Copies the exact original `subman.json` bytes to
   `subman.v1.backup.json`.
2. Converts all business collections to the V2 document.
3. Applies the requested mutation.
4. Writes the new `subman.json` and any publication output together.

If a backup already exists but does not exactly match the current V1 file, the
write stops with `migration_backup_conflict`. Do not replace that backup until
the mismatch has been investigated.

A new Workspace starts with only `subman.bootstrap.json`. Its first coordinator
mutation creates V2 `subman.json` and deletes the bootstrap marker in the same
verified PATCH.

## Verification Evidence

The pre-deployment gate proves retry idempotency, SQLite credential exclusion,
the Worker-to-Durable-Object path, and reserved-file enforcement. For the
controlled production Workspace, verify:

- `subman.json` has `version: 2`, `schemaVersion: 2`, the expected
  `workspaceId`, and a positive `revision`.
- `subman.v1.backup.json` is byte-for-byte equal to the pre-migration V1
  export.
- A browser publication and a Server API node update both remain present.
- API responses contain no unrelated Workspace data or credentials.
- Repeating the same controlled idempotent Server API operation does not create
  a second node and advances the Workspace only when its content changes.

## Rollback

Rollback is an operator-controlled data restoration, not a Wrangler migration
reversal:

1. Stop or disable V2 writers so a compatibility Worker cannot race the
   coordinator.
2. Export the current V2 `subman.json` for forward recovery.
3. Restore the exact `subman.v1.backup.json` content as `subman.json`.
4. Build and deploy a tested forward compatibility release that restores V1
   application behavior while retaining the applied `v1` migration,
   `WORKSPACE_COORDINATOR` binding, and exported `WorkspaceCoordinator` class.
5. Verify the V1 UI against the restored Gist before reopening writes.

Do not deploy or use Wrangler rollback to a pre-Durable-Object Worker version:
Cloudflare Durable Object migrations are atomic lifecycle changes, and that
older bundle lacks the required binding and class export. Keep the Durable
Object namespace and SQLite records in place. V2-only edits cannot be translated
back to V1 automatically; retain the V2 export for later reconciliation.

If V1 writes resume, the restored `subman.json` will eventually diverge from
the immutable original `subman.v1.backup.json`. Before a later V2 re-upgrade,
stop V1 writers, export both files, archive the original backup outside the
reserved filename, and deliberately remove the stale backup from the Gist. The
next controlled coordinator mutation will create a new byte-exact backup of the
current V1 document. Never replace or delete the reserved backup as an automatic
recovery action.
