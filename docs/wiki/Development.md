# Development and Wiki maintenance

English | [简体中文](Development.zh-CN.md) · [Wiki home](Home.md)

## Worktree and PR workflow

The project policy and risk matrix live in [AGENTS.md](../../AGENTS.md).
The adopted Manifest commit is
[`6f387de5065b6ffc475908880362939185ff89d7`](https://github.com/KnowSky404/Manifest/blob/6f387de5065b6ffc475908880362939185ff89d7/docs/AI_NATIVE_DEVELOPMENT_WORKFLOW.md).
Update this baseline deliberately. SubMan retains its Codex review requirement
for R0 and uses isolated local Worker/DO and browser acceptance in place of a
standing PRE environment. The Owner approves an equivalent when a required
boundary needs other evidence.

Start from a verified main ref and keep the user's checkout intact:

```bash
pwd
git status --short --branch
git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
git worktree list
git fetch origin main
git rev-parse origin/main
git worktree add -b feat/topic ../SubMan-topic origin/main
cd ../SubMan-topic
```

Use an isolated clone at the same verified base if Git metadata is read-only.
Record the objective, scope, acceptance criteria, risk, authorization, base,
branch and path in the PR or ignored `.task/task.md`. Keep milestone evidence
compact. Include the head, stage, checks and inputs, review cycles/findings,
candidate evidence, blockers and next action. Resume with the original scope
by comparing the record with Git, Actions and current review items. Use a
sanitized PR or issue for cross-host recovery.

Install locked dependencies in the task checkout. Keep `.svelte-kit`,
`.wrangler` (including local DO SQLite), browser state and ports isolated.
Use a separate `SUBMAN_E2E_PORT` when running Playwright concurrently on one host.
Verify locally, commit atomically and publish the authorized task branch and PR.
Use a draft if useful for early CI. For a multiline GitHub CLI body, pass
`--body-file` with a temporary file.

## Review before merge

Start CI and required reviews in parallel. Check the bot summary on a ready PR
or new head. Verify each required item's author, reviewed SHA and completion
timestamp, then read the inline findings. If a required review is absent and
idle, use the provider trigger once (`@codex review` or
`@codex security review`). R3 also requires an independent local review or an
Owner-approved equivalent. Verify current configuration and treat the bot and
CI as separate evidence.

Batch blocking fixes and recheck the impacted paths. Record dispositions with
evidence for fixes, false positives and deferrals. R0 retains its required
initial review, with no discretionary cycles. Allow two cycles for R1 and
three for R2/R3. Count parallel reviews once. At the limit, refer remaining
blockers to the Owner. Leave open tasks and evidence available for continuation.
Current acceptance, applicable CI/reviews, finding dispositions and rollback
evidence establish readiness for an authorized merge.

## Rebase merge and cleanup

For an authorized merge, verify the PR targets `main`, inspect its head SHA,
commits/files, mergeability, required CI checks, and current-head reviews. Default
to rebase unless another strategy was requested; lock the merge to the verified
head:

```bash
gh pr merge <PR> --rebase --match-head-commit <VERIFIED_HEAD_SHA>
```

Do not bypass checks with `--admin`. A merge queue or auto-merge request is not
completion; confirm PR state `MERGED` before cleanup. Record the PR URL, original
head SHA, and merge SHA. Fetch `origin/main` and verify it contains the merge SHA
and all task changes, then verify full main CI on the integrated commit.
Rebase changes SHA identities: compare original and rebased
commit ranges with patch/content checks such as `git range-diff`. Neither original
head ancestry nor a successful push proves integration. Do not compare the entire
task tree to a main branch that also contains unrelated changes. Content changes
from conflict resolution or integration require affected verification again.

From the preserved original checkout, sync only when it is on `main`, clean,
and can fast-forward:

```bash
git merge --ff-only origin/main
```

Keep dirty/diverged main checkouts intact and report the limitation; do not reset,
stash, or automatically rebase. Independently safe task cleanup may still proceed.
After a verified authorized merge, cleanup is part of completion unless the user
requests retention:

1. Verify remaining local and remote task branches still point to the merged PR
   head with no later commits. Inspect staged, unstaged, untracked, and valuable
   ignored files. Preserve validation evidence and private configuration outside
   the disposable worktree; stop its temporary services. Never remove another
   task's worktree or the main checkout.
2. From a retained checkout, run `git worktree remove <PATH>` without `--force`,
   then `git branch -d <BRANCH>`. Do not combine cleanup with the merge command;
   verify each result separately.
3. Delete a remaining remote branch only with a lease pinned to the verified
   merged PR head:
   `git push --force-with-lease=refs/heads/<BRANCH>:<VERIFIED_HEAD_SHA> origin :refs/heads/<BRANCH>`.
   This is conditional deletion, not permission to overwrite history. Do not use
   unconditional `--delete` or `--force`. If already absent, record that result.
   A rejected lease means preserving the branch and reporting it; do not retry
   deletion using a newer unmerged head.
4. If `-d` refuses solely because rebase changed ancestry, `-D` is allowed only
   after proving PR `MERGED`, merge SHA in main, unchanged task head, and equivalent
   patches/content. A successful `-d` alone is not integration proof. Unmerged
   commits, unsaved files, another worktree using the branch, or a retention
   request stop the affected cleanup.
5. Verify PR state, local/remote main SHAs, working tree status, and removal of
   task branches/worktree. Report PR URL, final SHA, validation, sync and cleanup
   results, and blockers. Retain unmerged tasks. Merge and cleanup do not deploy
   production.

## Toolchain and local servers

Use Bun **1.3.14**, matching `package.json` and CI:

```bash
bun install --frozen-lockfile
bun run dev -- --host :: --port 5173
```

Vite is for fast UI iteration. To exercise Worker routes and the SQLite-backed
coordinator, use the local Cloudflare runtime:

```bash
bun run dev:cf -- --ip :: --port 8787
```

For a built UI preview:

```bash
bun run build
bun run preview -- --host :: --port 4173
```

The project VPS is `oc-de-fra-1.knowsky.uk`; open that hostname with the selected
port. Use `ss -lntp` to verify the actual listener, including IPv6; if dual-stack
binding is unavailable, verify the reachable family explicitly. Local runtime
tests use synthetic data and mocks; do not add a real GitHub token for test writes.

## Verification

Use scoped checks while iterating. For ordinary docs run `bun run docs:check`
and inspect diff, commands and links. For runtime changes use relevant commands
from AGENTS.md. The Worker integration command and deployment dry run each build
on their own. The runtime CI job builds once and uses the `:built` scripts with
that checkout's output. Run build-dependent commands sequentially within the
same worktree. CI covers the applicable complete suites.

`test:sing-box` requires Docker. E2E requires Chromium and OS libraries. Install
with `bunx playwright install --with-deps chromium` where needed. After a
binding change regenerate with `bun run generate:worker-types` and verify it
with `bun run check`. See [CI/CD](../ci-cd.md) for release evidence and
[Workspace operations](../workspace-v2-operations.md) for recovery.

## Directory conventions

| Path | Purpose |
| --- | --- |
| `src/` | Application, routes, protocol code, and colocated unit tests |
| `test/`, `e2e/` | Cloudflare integration tests and browser scenarios |
| `scripts/` | Verification, offline audit, type generation, and Wiki tooling |
| `static/` | Assets used by the shipped app |
| `docs/wiki/` | Wiki entry pages, user/developer guides, and bilingual changelog |
| `docs/api/`, `docs/integrations/`, `docs/agents/` | Canonical contracts and specialist guides, also published to Wiki |
| `docs/archive/`, `docs/adr/` | Dated design evidence and protocol decisions |
| `docs/assets/` | Design source artwork and supporting documentation assets |

Read [AGENTS.md](../../AGENTS.md) for invariants and [DESIGN.md](../../DESIGN.md)
for UI conventions. Keep code identifiers and comments ASCII. Remove retired
paths only after checking actual callers; migration and repair tools remain
supported operator tools. Commit each independent change atomically.

## Maintain the bilingual Wiki

The main repository is the document source. Keep each maintained `.md` guide and
its `.zh-CN.md` counterpart in the same change. `_Sidebar.md` is shared bilingual
navigation. Dated archives and source asset notes retain their original language.
Record future release/development notes in [Changelog](Changelog.md) and
[变更记录](Changelog.zh-CN.md), with deployment evidence stated separately.

Validate sources and generate flat GitHub Wiki pages:

```bash
bun run docs:check
bun run wiki:build --out-dir /tmp/subman-wiki-pages
```

The generator converts source links to Wiki pages or repository files and checks
local targets, bilingual pairs, and page-name collisions. Its default output is
ignored `.wrangler/wiki`; generated output is not committed to the main repository.
Review generated changes before publication. With explicit Wiki publishing authorization:

1. Clone `https://github.com/KnowSky404/SubMan.wiki.git` to a separate directory.
   GitHub requires creating an initial page in its web UI before the first clone.
2. Copy the generated Markdown pages into that checkout. Keep unrelated existing
   pages; remove an old generated page only after reviewing that it is obsolete.
3. Review the diff, commit, and push to the Wiki default branch with existing
   system GitHub credentials. A Wiki push does not deploy the application.
4. Compare remote and local Wiki commit IDs and inspect both language home pages.

Wiki and main-repository publication are separate actions. If new repository-file
links are introduced, publish the corresponding authorized source commit before
publishing those links. Never use a force push to replace Wiki history.
