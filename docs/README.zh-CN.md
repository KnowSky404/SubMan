# 文档源

[English](README.md) | 简体中文

[双语 Wiki 目录](wiki/Home.zh-CN.md)列出了现行指南，可在仓库中阅读，也可查看
[已发布的 GitHub Wiki](https://github.com/KnowSky404/SubMan/wiki/Home.zh-CN)。

- [使用](wiki/User-Guide.zh-CN.md)、[开发](wiki/Development.zh-CN.md)与[变更记录](wiki/Changelog.zh-CN.md)
- [Server API](api/server-api.zh-CN.md)、[OpenAPI](api/openapi.yaml)与[集成](integrations/sing-box-vps.zh-CN.md)
- [运维](workspace-v2-operations.zh-CN.md)、[迁移](legacy-workspace-migration.zh-CN.md)与[导出](sing-box-export.zh-CN.md)
- [CI/CD](ci-cd.zh-CN.md)、[路线图](ROADMAP.zh-CN.md)与 [Agent 指南](agents/subman-agent-guide.zh-CN.md)
- [历史设计与计划](archive/README.md)；[暂缓协议决策](adr/0001-workspace-v2-deferred-protocols.md)

仓库为文档源。同步修改中英文后运行 `bun run docs:check`；
`bun run wiki:build` 只生成 Wiki 页面，不发布。
[开发指南](wiki/Development.zh-CN.md)说明目录约定和发布流程。
根目录 `README.en.md` 为已有链接保留兼容入口。
