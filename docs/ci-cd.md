# SubMan CI/CD

English | [简体中文](ci-cd.zh-CN.md)

## Continuous integration

`CI` runs for all PRs, main pushes and manual dispatches. It tests GitHub's
synthetic merge of PR head with base. The scope job records all three SHAs.
For PRs it loads the path policy from the base, verifies the merge parents
and compares the two trees. Uncertain inputs and all non-PR events use the
full suite. Labels and PR text have no effect on selection.

| CI suite | PR applicability | Required evidence |
| --- | --- | --- |
| Docs | Only Markdown under `docs/wiki/` outside the development guides | Bilingual docs/link validation without installing app dependencies |
| UI | Only `src/app.css` and eligible docs | Docs, unit, type and lint checks, Worker build/dry run and browser tests |
| Full | All other paths, including workflow/policy changes, plus main and manual runs | All UI checks, sing-box executable export and Workers/DO integration |

CI path selection is conservative. Assign risk separately using AGENTS.md.
The fast and runtime jobs run on isolated hosted runners. The runtime job
builds once before Workers/DO integration, dry run and Playwright, using that
same checkout's output. The dry-run bundle stays at `.wrangler/deploy-check`.
Playwright exercises `wrangler dev --local` with synthetic fixtures, covering
the Worker entrypoint, DO export and migrations, and Workers Assets. The
seven-day failure artifact contains local fixture traces and reports.

`CI / verify` is the stable gate. It requires scope and fast to succeed and
allows the runtime job to be skipped only for the docs suite. Missing,
cancelled or failed applicable jobs cannot pass. Superseded CI runs for
the same ref are cancelled. All actions are pinned, Bun comes from
`package.json`, and dependencies come from the frozen lockfile. The Bun
setup action caches its pinned executable. PR jobs receive read-only access
with checkout credentials removed and no production environment secrets.

`bun run test:sing-box` checks an in-memory export with the pinned sing-box
`1.14.0` image and requires Docker locally. All fixtures use synthetic data.
Use `bun run test:cf` and `bun run deploy:check` standalone to build from source.
Use the `:built` scripts and `SUBMAN_E2E_USE_BUILD=1` only when the current
checkout has just built the same candidate.

## Historical CI failures

### Generated Worker type drift

The formal `CI` run on 2026-08-24 (`run #5`, commit
`e82147c5d370734c27a03fa681fccf07028721d8`) passed all unit tests, then failed
the type and Svelte check stage because `check:worker-types` detected a stale
generated declaration. The same gate failed on 2026-09-30 for commit
`81f6a590ac45cdd2725211acd3dcede9982d47b4`.

Wrangler includes `Cloudflare.GlobalProps` only when the configured framework
entrypoint exists. Local builds left `.svelte-kit/cloudflare/_worker.js` present,
while CI checked types before building. Merely regenerating the declaration
therefore produced different results in a clean checkout and a built checkout.

The generator now omits the entire build-dependent `GlobalProps` block. The
`Env.WORKSPACE_COORDINATOR` binding still imports the coordinator class from its
stable source path and retains its typed Durable Object namespace. A regression
test runs the actual generator with and without a framework entrypoint and
checks that both results match the committed declaration.

The correction is committed in the current line:

```bash
bun run generate:worker-types
bun run check:worker-types
```

Do not hand-edit the generated declaration. Any future `wrangler.toml`, Wrangler,
binding, migration, or compatibility-date change must regenerate the file and
pass the complete CI workflow.

### Local Workers runtime behind the compatibility date

The first CI run that replaced `vite preview` with `wrangler dev --local`
successfully passed unit, type, lint, build, Cloudflare integration, and
deployment dry-run gates, but the browser server could not start. The locked
Wrangler `4.81.0` bundled a `workerd` runtime supporting compatibility dates only
through `2026-04-12`, while SubMan requires `2026-07-28`.

The production compatibility date was not rolled back. Wrangler was upgraded
and pinned to `4.127.0`, whose lockfile resolves `workerd` `1.20260826.1`. This
keeps local browser evidence aligned with the checked-in production
configuration. Future compatibility-date changes must first update the pinned
runtime and pass local Worker startup, deployment dry-run, Cloudflare
integration, and browser gates.

## Production release

DEV uses isolated worktrees, mock providers and local Worker/DO state. The
stable candidate uses the full applicable CI and review evidence plus isolated
Worker and browser acceptance. Record the candidate SHA/tree, lockfile and
toolchain, Wrangler config and fixture/runtime identity, covered behaviors and
failure paths. If a relevant source, base, configuration, dependency or build
input changes during integration, repeat the affected acceptance. Prove input
equivalence before carrying acceptance forward. SubMan has no shared PRE
deployment step. Get Owner approval for additional isolated acceptance if the
local runtime cannot establish a material behavior.

After an authorized merge, verify the integrated SHA and successful full
`main` push CI. Compare runtime and build inputs to the already deployed
version. Equivalent inputs and configuration need no release. Record the
release scope, exact SHA, target, previous Worker version and rollback steps.
R3 changes also need compatibility and recovery evidence for affected state.
Worker rollback only restores code/configuration. A state change needs its own
authorized recovery point or compatible forward fix.

With release authorization, dispatch `Deploy production` from `main` with
confirmation `deploy` and the full verified commit SHA. The workflow checks
the latest push CI for that exact SHA and rechecks the tip before deployment.
It uses a separate runner with the same locked dependencies and performs one
build. Verification suites and dry-run packaging are evidenced by main CI.
The existing strict Wrangler mode fails on conflicting remote settings.
Production jobs use the `production` environment and deployments serialize
without cancelling an in-flight job.

Record the workflow, commit and Cloudflare version from the deploy log. On the
approved production hostname, verify `/api/health` returns HTTP 200 and
`ok: true`, then confirm the affected read-only path and inspect Worker errors.
Readiness alone cannot establish feature behavior. Record sample/time and result
without credentials or customer data. A failed smoke keeps production
verification pending. Check the actual live version before any retry, follow
the recorded recovery plan with authorization, and recheck smoke after recovery.

## Repository settings

After the replacement `verify` job has run on a PR, open **Settings →
Branches → Add branch protection rule**, select `main`, require a pull request and
status checks, and choose the `verify` job from GitHub Actions (`CI / verify` in
the PR UI). Require branches to be up to date, enable conversation resolution
and disable bypass, force pushes and deletion. Keep rebase merge enabled and
avoid requiring a human approval quorum a solo Owner cannot satisfy.
Verify these settings on an actual PR. CI workflow or classifier changes
require R3 review even when GitHub reports the required check as green.

In **Settings → Environments**, create or inspect `production`, limit deployments
to the `main` branch, and configure required reviewers where supported. Require
independent approval when available and preserve explicit Owner release
authorization. Add environment-only `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` scoped to the target account and minimum Workers
deployment permissions. Keep runtime `GITHUB_TOKEN` and `SUBMAN_API_TOKEN`
in Worker secrets without copying them to CI, builds or fixtures. Release
dispatch stays manual.

Verify Codex automatic code and security review settings in the provider.
Until there is an enforced provider gate, the authorized merge actor must
verify current-head review evidence and dispositions. GitHub's required CI
check does not attest to Codex review.

## Workflow measurements

Use Actions and PR history to record comparable lead time, PR cycle time, CI
elapsed time by suite, review rounds and context recoveries. For releases
record candidate deployment count, smoke failures and recovery time. Compare
like-for-like PRs and runner conditions before claiming a speedup. Record the
first observed samples in the workflow PR. Use local simulations for branches
of the workflow that cannot yet run against real integrations.
