# SubMan Documentation

English | [简体中文](README.zh-CN.md)

Start with the [project README](../README.md). The maintained guides below
describe the current single-cloud Workspace and supported public API. Each
guide has a language link at the top; protocol names, endpoint paths, JSON
fields, and CLI commands stay the same in both languages.

| Guide | English | 简体中文 |
| --- | --- | --- |
| Project overview and quick start | [README](../README.md) | [README](../README.zh-CN.md) |
| Trusted backend Server API | [Reference](api/server-api.md) | [接口文档](api/server-api.zh-CN.md) |
| sing-box-vps and provisioning scripts | [Integration guide](integrations/sing-box-vps.md) | [集成指南](integrations/sing-box-vps.zh-CN.md) |
| sing-box client export | [Export guide](sing-box-export.md) | [导出指南](sing-box-export.zh-CN.md) |
| Workspace operations and recovery | [Operations](workspace-v2-operations.md) | [运维与恢复](workspace-v2-operations.zh-CN.md) |
| Legacy Workspace migration | [Migration](legacy-workspace-migration.md) | [迁移指南](legacy-workspace-migration.zh-CN.md) |
| Local checks and deployment workflows | [CI/CD](ci-cd.md) | [CI/CD](ci-cd.zh-CN.md) |
| Product roadmap | [Roadmap](ROADMAP.md) | [路线图](ROADMAP.zh-CN.md) |
| Public API expansion proposals | [API roadmap](api/roadmap.md) | [API 路线图](api/roadmap.zh-CN.md) |
| Developer and agent orientation | [Agent guide](agents/subman-agent-guide.md) | [Agent 指南](agents/subman-agent-guide.zh-CN.md) |
| Installable project skill | [Skill](agents/subman-skill/SKILL.md) | [Skill 中文说明](agents/subman-skill/SKILL.zh-CN.md) |

The [OpenAPI 3.1 contract](api/openapi.yaml) is the shared machine-readable API
definition. It covers health and node CRUD/by-key operations. Subscriptions,
aggregates, publication, and client exports do not have public REST endpoints;
the API roadmap describes proposals. The browser mutation route is internal.

The skill also provides bilingual references for
[architecture](agents/subman-skill/references/architecture.md),
[deployment](agents/subman-skill/references/deployment.md),
[Workspace data](agents/subman-skill/references/workspace-data.md), and
[API automation](agents/subman-skill/references/server-api.md).

Historical records under `superpowers/` and `adr/` retain their original
language and date-specific decisions. They are design evidence; use the current
guides and source code to determine shipped behavior.
