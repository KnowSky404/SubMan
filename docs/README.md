# Documentation sources

English | [简体中文](README.zh-CN.md)

The [bilingual Wiki index](wiki/Home.md) lists all maintained guides.
Read them here or in the [published GitHub Wiki](https://github.com/KnowSky404/SubMan/wiki).

- [Usage](wiki/User-Guide.md), [development](wiki/Development.md), and [changelog](wiki/Changelog.md)
- [Server API](api/server-api.md), [OpenAPI](api/openapi.yaml), and [integrations](integrations/sing-box-vps.md)
- [Operations](workspace-v2-operations.md), [migration](legacy-workspace-migration.md), and [exports](sing-box-export.md)
- [CI/CD](ci-cd.md), [roadmap](ROADMAP.md), and [agent guide](agents/subman-agent-guide.md)
- [Archived designs and plans](archive/README.md); [deferred protocol decisions](adr/0001-workspace-v2-deferred-protocols.md)

The repository is the document source. Edit English/Chinese pairs together and
run `bun run docs:check`; `bun run wiki:build` renders Wiki pages without publishing.
The [development guide](wiki/Development.md) explains the directory layout and publication.
`README.en.md` at the root remains a compatibility entry for existing links.
