# SubMan 文档

[English](README.md) | 简体中文

从[项目 README](../README.zh-CN.md) 开始。下列现行指南描述单一云端工作区和当前支持的
公共 API。每篇指南顶部都有语言链接；协议名称、接口路径、JSON 字段和 CLI 命令在两种语言中保持一致。

| 指南 | English | 简体中文 |
| --- | --- | --- |
| 项目介绍与快速开始 | [README](../README.md) | [README](../README.zh-CN.md) |
| 可信后端 Server API | [Reference](api/server-api.md) | [接口文档](api/server-api.zh-CN.md) |
| sing-box-vps 与服务器自动化脚本 | [Integration guide](integrations/sing-box-vps.md) | [集成指南](integrations/sing-box-vps.zh-CN.md) |
| sing-box 客户端导出 | [Export guide](sing-box-export.md) | [导出指南](sing-box-export.zh-CN.md) |
| 工作区运维与恢复 | [Operations](workspace-v2-operations.md) | [运维与恢复](workspace-v2-operations.zh-CN.md) |
| 旧版工作区迁移 | [Migration](legacy-workspace-migration.md) | [迁移指南](legacy-workspace-migration.zh-CN.md) |
| 本地检查与部署流程 | [CI/CD](ci-cd.md) | [CI/CD](ci-cd.zh-CN.md) |
| 产品路线图 | [Roadmap](ROADMAP.md) | [路线图](ROADMAP.zh-CN.md) |
| 公共 API 扩展提案 | [API roadmap](api/roadmap.md) | [API 路线图](api/roadmap.zh-CN.md) |
| 开发者与 Agent 入门 | [Agent guide](agents/subman-agent-guide.md) | [Agent 指南](agents/subman-agent-guide.zh-CN.md) |
| 可安装的项目 Skill | [Skill](agents/subman-skill/SKILL.md) | [Skill 中文说明](agents/subman-skill/SKILL.zh-CN.md) |

[OpenAPI 3.1 契约](api/openapi.yaml) 是两种语言共用的机器可读 API 定义，覆盖健康检查和
节点 CRUD/按键更新。订阅、聚合、发布和客户端导出目前没有公共 REST 接口；API 路线图中的
内容仍是提案。浏览器 mutation 路由属于内部协议。

Skill 还提供[架构](agents/subman-skill/references/architecture.zh-CN.md)、
[部署](agents/subman-skill/references/deployment.zh-CN.md)、
[工作区数据](agents/subman-skill/references/workspace-data.zh-CN.md)和
[API 自动化](agents/subman-skill/references/server-api.zh-CN.md)的双语参考文档。

`superpowers/` 和 `adr/` 中的历史记录保留原语言及当时的决策，作为设计证据。
判断当前已实现的行为时，应以现行指南和源码为准。
