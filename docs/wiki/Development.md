# Development and Wiki maintenance

English | [简体中文](Development.zh-CN.md) · [Wiki home](Home.md)

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
