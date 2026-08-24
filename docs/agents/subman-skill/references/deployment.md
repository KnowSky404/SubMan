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

## Worker types and compatibility date

`src/worker-configuration.d.ts` is generated from `wrangler.toml`:

```bash
bun run generate:worker-types
bun run check:worker-types
```

Do not hand-edit the generated declaration. The script uses the repository's
Wrangler version with isolated log and registry paths, then applies only the
small normalization needed for the SvelteKit Worker entrypoint and the typed
Durable Object class. `check:worker-types` compares the reproducible result so
configuration and declaration drift fails locally and in CI.

The current compatibility date is intentionally the newest date supported by
the local Workers test runtime. Advance it only after the complete build,
Cloudflare, browser, and type-generation gates pass, then rerun all gates. If a
local `workerd` or Wrangler binary reports that a newer date is unsupported,
upgrade that toolchain first or keep the last supported date; do not silently
skip the Cloudflare test suite.

## Safe Worker observability

`wrangler.toml` enables Workers Logs without enabling full tracing. The default
`head_sampling_rate = 0.1` limits routine volume; temporarily raise it only for
a controlled investigation and restore it after verification. Application
events are emitted as structured JSON through one allowlisted helper. The
allowed fields are request ID, operation, hashed Workspace ID, mutation ID and
kind, expected/committed revision, latency, status, disposition, stable error
code, and safe GitHub operation/status/category/request ID metadata.

Never add tokens, Authorization or Cookie values, subscription URLs, raw proxy
URIs, mutation payloads, Workspace documents, generated outputs, quarantine
contents, exception messages, or stacks to Worker logs. Tombstone counts may be
warnings, but they never authorize compaction. There is no time-based cleanup
of tombstones or processed mutations.

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
  the exact V1 backup, and forward-deploying tested compatibility artifact
  `c89a60b`, which retains the applied migration, binding, and coordinator class
  export while using the verified V1 transaction paths.
- Keep the Durable Object namespace and SQLite records during rollback.

The browser UI can still run in local mode without a GitHub token. Business
state remains in the `subman-workspace` IndexedDB database; only explicit token
persistence uses localStorage.
The trusted Server API always depends on Worker secrets and the
`WORKSPACE_COORDINATOR` binding.

For the current URI support matrix, subscription CORS requirements, and export
publication boundary, see [`docs/sing-box-export.md`](../../../sing-box-export.md).
