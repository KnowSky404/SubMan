# SubMan Wiki

[English](Home.md) | 简体中文

SubMan 使用一个私有 GitHub Gist 管理代理资源。从[使用指南](User-Guide.zh-CN.md)
开始，或返回[项目介绍](../../README.zh-CN.md)。

| 主题 | English | 简体中文 |
| --- | --- | --- |
| 连接、页面与日常恢复 | [User guide](User-Guide.md) | [使用指南](User-Guide.zh-CN.md) |
| 开发、验证与 Wiki 发布 | [Development](Development.md) | [开发指南](Development.zh-CN.md) |
| 工作区部署与修复 | [Operations](../workspace-v2-operations.md) | [运维与恢复](../workspace-v2-operations.zh-CN.md) |
| CI 与生产部署 | [CI/CD](../ci-cd.md) | [CI/CD](../ci-cd.zh-CN.md) |
| 历史数据恢复 | [Legacy migration](../legacy-workspace-migration.md) | [旧版迁移](../legacy-workspace-migration.zh-CN.md) |
| 导出协议与限制 | [sing-box export](../sing-box-export.md) | [sing-box 导出](../sing-box-export.zh-CN.md) |
| 可信后端自动化 | [Server API](../api/server-api.md) | [接口文档](../api/server-api.zh-CN.md) |
| 服务器自动配置 | [sing-box-vps integration](../integrations/sing-box-vps.md) | [集成指南](../integrations/sing-box-vps.zh-CN.md) |
| 产品规划 | [Roadmap](../ROADMAP.md) | [路线图](../ROADMAP.zh-CN.md) |
| API 扩展提案 | [API roadmap](../api/roadmap.md) | [API 路线图](../api/roadmap.zh-CN.md) |
| 贡献者入门 | [Agent guide](../agents/subman-agent-guide.md) | [Agent 指南](../agents/subman-agent-guide.zh-CN.md) |
| 可安装的 Agent Skill | [Skill](../agents/subman-skill/SKILL.md) | [Skill 说明](../agents/subman-skill/SKILL.zh-CN.md) |
| 版本与开发日志 | [Changelog](Changelog.md) | [变更记录](Changelog.zh-CN.md) |

[OpenAPI 契约](../api/openapi.yaml)是机器可读的 API 来源。
公共接口覆盖健康检查和节点操作；浏览器 mutation 为内部协议。

Wiki 从主仓库中的现行文档生成。修改文档源时同步中英文，并运行 `bun run docs:check`。
[历史设计与计划](../archive/README.md)保留原语言和当时的决策，当前行为以现行指南和源码为准。
