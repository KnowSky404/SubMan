# Workspace V2 Operations

This runbook covers deployment, first-write migration, verification, and
rollback for the Workspace Schema V2 coordinator.

## Runtime Contract

- `subman.json` is the authoritative Workspace V2 document.
- One `WorkspaceCoordinator` Durable Object is addressed by `gist:<gist-id>`.
- Every browser and Server API config mutation goes through that coordinator.
- Browser mutations are persisted in a local queue and sent in revision order.
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

Start the local Cloudflare runtime and exercise the health and mutation routes:

```bash
bun run dev:cf -- --ip :: --port 8787
curl -fsS "http://127.0.0.1:8787/api/health"
```

Wrangler local development uses local simulated bindings and Durable Object
storage by default. Do not use production GitHub credentials for disposable
local migration fixtures.

## Production Deployment

1. Confirm `GITHUB_TOKEN` and `SUBMAN_API_TOKEN` are configured as Worker
   secrets. Never place either value in `wrangler.toml`.
2. Export the current `subman.json` from each controlled migration Workspace.
3. Run the pre-deployment gate, including the Wrangler dry-run.
4. Deploy the Worker and Durable Object migration together with
   `bun run deploy`.
5. Check `GET /api/health` on the deployed origin.
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

For a migrated Workspace, verify:

- `subman.json` has `version: 2`, `schemaVersion: 2`, the expected
  `workspaceId`, and a positive `revision`.
- `subman.v1.backup.json` is byte-for-byte equal to the pre-migration V1
  export.
- A repeated mutation ID does not advance the revision twice.
- A browser publication and a Server API node update both remain present.
- Durable Object SQLite state and API responses contain no GitHub token.
- Reserved files cannot be selected as aggregate or client export outputs.

## Rollback

Rollback is an operator-controlled data restoration, not a Wrangler migration
reversal:

1. Stop or disable V2 writers so the old Worker cannot race the coordinator.
2. Export the current V2 `subman.json` for forward recovery.
3. Restore the exact `subman.v1.backup.json` content as `subman.json`.
4. Deploy the last known V1 Worker revision.
5. Verify the V1 UI against the restored Gist before reopening writes.

Keep the Durable Object binding, migration entry, namespace, and SQLite records
in place during rollback. Removing them is a separate destructive migration and
is not required to run the V1 Worker. V2-only edits cannot be translated back to
V1 automatically; retain the V2 export for later reconciliation.
