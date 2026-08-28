# SubMan CI/CD

## Continuous integration

The `CI` workflow runs for pushes to `main`, pull requests, and manual
dispatches. It uses the repository-pinned Bun and Wrangler toolchain and keeps
`GITHUB_TOKEN` read-only.

The verification order is intentionally fail-fast:

1. install the frozen lockfile;
2. run unit tests;
3. run Svelte and TypeScript checks, including generated Worker type drift;
4. run Biome;
5. build the SvelteKit Worker;
6. run the Cloudflare Durable Object integration suite;
7. run `wrangler deploy --dry-run` and retain its bundle under
   `.wrangler/deploy-check`;
8. install Chromium and run Playwright through `wrangler dev --local`.

Using Wrangler for the browser server validates the generated Worker entrypoint,
the `WORKSPACE_COORDINATOR` class export, the Durable Object migration, and
Workers Assets configuration. Plain `vite preview` is not accepted as evidence
for those Cloudflare runtime boundaries.

When Playwright fails, traces, screenshots, videos, and reports are uploaded as
a seven-day GitHub Actions artifact. If an earlier gate fails, the workflow does
not spend time installing Chromium.

## Historical CI failure

The formal `CI` run on 2026-08-24 (`run #5`, commit
`e82147c5d370734c27a03fa681fccf07028721d8`) passed all unit tests, then failed
the type and Svelte check stage because `check:worker-types` detected a stale
generated declaration. Wrangler had stopped generating the obsolete
`Cloudflare.GlobalProps.durableNamespaces` declaration, while the checked-in
`src/worker-configuration.d.ts` still contained it.

The correction is committed in the current line:

```bash
bun run generate:worker-types
bun run check:worker-types
```

Do not hand-edit the generated declaration. Any future `wrangler.toml`, Wrangler,
binding, migration, or compatibility-date change must regenerate the file and
pass the complete CI workflow.

## Production deployment

Production deployment is intentionally not automatic. Use the
`Deploy production` workflow from the `main` branch and enter `deploy` in the
confirmation input.

The deployment job references the GitHub `production` environment. Configure
that environment with required reviewers and these environment secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Scope the API token to the target Cloudflare account and the minimum Workers
deployment permissions. The workflow validates both secrets, reruns the complete
quality and browser gates, creates a deployment dry-run bundle, and then runs:

```bash
wrangler deploy --strict
```

Strict mode fails closed when a non-interactive deployment could overwrite
conflicting remote settings.

The deployment credentials above are separate from the Worker runtime secrets:

- `GITHUB_TOKEN`
- `SUBMAN_API_TOKEN`

Runtime secrets remain managed with `wrangler secret put`; they must not be
copied into repository files, workflow inputs, build variables, or test
fixtures.

## Repository settings

Require the `CI / verify` check before merging or updating `main`. Keep direct
production deployment behind the `production` environment rather than a
push-triggered workflow. Do not enable automatic deployment until branch
protection, required checks, environment approval, rollback, and post-deployment
health verification are all configured.
