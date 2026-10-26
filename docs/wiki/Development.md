# Development and Wiki maintenance

English | [简体中文](Development.zh-CN.md) · [Wiki home](Home.md)

## Worktree and PR workflow

Every task, including small fixes and documentation, uses this sequence:

**Dedicated worktree + task branch -> local implementation and verification
-> atomic commit -> push and PR -> completed review and resolved findings
-> rebase merge into `main` -> verify and sync main -> remove merged task
branches and worktree.**

Push, PR creation, merge, direct pushes to `main`, Wiki publication, and deployment
require authorization covering those actions. The sequence does not grant it;
existing authorization within the same scope does not need confirmation again.
SubMan retains its current CI and local checks. FlareMail's PRE acceptance gate
is not required here, and ordinary development does not publish or deploy.

Before editing, inspect the original checkout, fetch and verify `origin/main`,
then create a new task branch and separate checkout. Replace the example topic
and path for each task:

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

Use `fix/<topic>`, `docs/<topic>`, or another Conventional Commit type as
appropriate. Record the absolute worktree path, branch, and base SHA. Resume an
existing task in its existing worktree; use another base only when requested.
Keep the original checkout intact and do not develop directly on `main`.
Preserve unrelated changes without reset, stash, or rewriting another task's history.

Install locked dependencies in the task worktree. Keep `.svelte-kit`, `build`,
`.wrangler` (including local DO SQLite), browser state, and ports isolated.
Do not share writable generated directories or copy private configs/credentials
automatically. Implement, run applicable checks below, and create an atomic
Conventional Commit. With authorization, push the task branch and open a PR to
`main` using the repository PR template. Describe the problem, final behavior,
base and tested SHAs, validation evidence, and limitations. For multiline GitHub
CLI bodies, write a temporary file and pass `--body-file`.

## Review before merge

Every PR, including documentation/instruction changes, requires completed Codex
Code Review of the current head. After PR creation or any new commit, actively
check whether review has started. Verify actual repository review configuration;
FlareMail's enabled integrations do not establish SubMan's settings. Require
Security Review and any other configured required reviews when enabled. Missing
review activity does not prove an integration is disabled.

Verify the actual author (`chatgpt-codex-connector[bot]`, sometimes shown without
`[bot]`), reviewed commit, completion time, and result links. Inspect each review
item's status and commit in `Codex Review Summary`, submitted reviews, and inline
findings. A single summary status/head SHA does not establish every review's
completion. `CLEAN`, empty Actions checks, `COMMENTED`, reactions, and old-head
reviews are insufficient. Required CI checks and bot review are separate gates.

Fix valid blocking findings and rerun affected checks; document evidence for false
positives or inapplicable findings. Any new commit requires review of the new head.
Pending, failed, or unverifiable review means retaining the PR, branch, and worktree
and reporting the blocker. Elapsed time does not waive review. Do not enable
auto-merge before all gates have passed.

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
and all task changes. Rebase changes SHA identities: compare original and rebased
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

For documentation/instruction-only changes, run `bun run docs:check` and review
the diff, commands, and links. Runtime tests and remote deployment are not needed.
Implementation, test, tooling, or CI changes require applicable checks below;
report missing prerequisites or failures rather than claiming a pass. Run checks
that share generated files (`check`, build, Worker tests, type generation, and
browser tests) sequentially in each worktree.

```bash
bun run docs:check
bun test
bun run test:sing-box
bun run check
bun run lint
bun run build
bun run test:cf
bun run test:e2e
bun run deploy:check
```

`test:sing-box` requires Docker. E2E requires Chromium and system dependencies;
prepare them with `bunx playwright install --with-deps chromium` if needed.
`check` verifies generated Worker types; after binding/configuration changes run
`bun run generate:worker-types` and commit reproducible declarations.

These checks prove local behavior and packaging. They do not deploy, access a
real Gist, validate production resources, or prove real subscription delivery.
Production deployment requires separate authorization; follow [CI/CD](../ci-cd.md)
and [Workspace operations](../workspace-v2-operations.md). API secret setup and
examples live in the [API reference](../api/server-api.md).

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
