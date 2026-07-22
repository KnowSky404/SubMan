# SubMan Deployment Reference

## Commands

Install and validate:

```bash
bun install
bun test
bun run check
bun run lint
bun run build
bun run test:cf
bun wrangler deploy --dry-run
```

Local runtimes:

```bash
bun run dev
bun run dev:cf -- --ip :: --port 8787
```

Deploy only with explicit operator approval:

```bash
bun run deploy
```

## Durable Object Configuration

`wrangler.toml` binds one SQLite-backed coordinator class:

```toml
[[durable_objects.bindings]]
name = "WORKSPACE_COORDINATOR"
class_name = "WorkspaceCoordinator"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["WorkspaceCoordinator"]
```

Do not rename an applied migration tag. New class changes require a new unique
tag and the appropriate Wrangler migration directive. Local Wrangler runs use
local simulated Durable Object storage unless remote bindings are explicitly
configured.

## Cloudflare Secrets

The Server API needs two Worker secrets:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

- `GITHUB_TOKEN`: GitHub token with `gist` permission, used only inside the
  Worker request and coordinator RPC.
- `SUBMAN_API_TOKEN`: bearer token for trusted backend scripts.

Neither secret belongs in source, Wrangler variables, mutation payloads, or
local test fixtures.

## Post-Deployment Verification

Check secret configuration:

```bash
curl -fsS "https://subman.example.com/api/health" | \
  jq -e '.ok == true and .config.githubToken == true and .config.submanApiToken == true'
```

Expected successful shape:

```json
{
  "ok": true,
  "config": {
    "githubToken": true,
    "submanApiToken": true
  }
}
```

Then run one controlled browser or Server API mutation and verify that the
Workspace revision advances exactly once. For a V1 Workspace, also verify the
byte-exact `subman.v1.backup.json` before widening use.

## Migration And Rollback

Follow `docs/workspace-v2-operations.md`. In particular:

- V1 migration happens on the first coordinator mutation, not at discovery.
- New Gists use a bootstrap marker until the first coordinator commit.
- Rollback requires stopping V2 writers, preserving the V2 document, restoring
  the exact V1 backup, and deploying a forward compatibility release that
  retains the applied migration, binding, and coordinator class export.
- Keep the Durable Object namespace and SQLite records during rollback.

The browser UI can still run in localStorage-only mode without a GitHub token.
The trusted Server API always depends on Worker secrets and the
`WORKSPACE_COORDINATOR` binding.
