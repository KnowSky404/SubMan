# SubMan Wiki

English | [简体中文](Home.zh-CN.md)

SubMan manages proxy resources in one private GitHub Gist. Start with the
[user guide](User-Guide.md), or return to the [project overview](../../README.md).

| Topic | English | 简体中文 |
| --- | --- | --- |
| Setup, pages, and recovery | [User guide](User-Guide.md) | [使用指南](User-Guide.zh-CN.md) |
| Development, checks, and Wiki publishing | [Development](Development.md) | [开发指南](Development.zh-CN.md) |
| Workspace deployment and repair | [Operations](../workspace-v2-operations.md) | [运维与恢复](../workspace-v2-operations.zh-CN.md) |
| CI and production deployment | [CI/CD](../ci-cd.md) | [CI/CD](../ci-cd.zh-CN.md) |
| Historical data recovery | [Legacy migration](../legacy-workspace-migration.md) | [旧版迁移](../legacy-workspace-migration.zh-CN.md) |
| Export protocols and limits | [sing-box export](../sing-box-export.md) | [sing-box 导出](../sing-box-export.zh-CN.md) |
| Trusted backend automation | [Server API](../api/server-api.md) | [接口文档](../api/server-api.zh-CN.md) |
| Server provisioning | [sing-box-vps integration](../integrations/sing-box-vps.md) | [集成指南](../integrations/sing-box-vps.zh-CN.md) |
| Product direction | [Roadmap](../ROADMAP.md) | [路线图](../ROADMAP.zh-CN.md) |
| Proposed API expansion | [API roadmap](../api/roadmap.md) | [API 路线图](../api/roadmap.zh-CN.md) |
| Contributor orientation | [Agent guide](../agents/subman-agent-guide.md) | [Agent 指南](../agents/subman-agent-guide.zh-CN.md) |
| Installable agent skill | [Skill](../agents/subman-skill/SKILL.md) | [Skill 说明](../agents/subman-skill/SKILL.zh-CN.md) |
| Release and development notes | [Changelog](Changelog.md) | [变更记录](Changelog.zh-CN.md) |

The [OpenAPI contract](../api/openapi.yaml) is the machine-readable API source.
Health and node operations are public; browser mutations are internal.

Wiki pages are generated from the maintained documents in the main repository.
Edit those sources, keep language pairs together, and run `bun run docs:check`.
Historical [designs and plans](../archive/README.md) retain their original language
and date-specific decisions. Current guides and source code describe present behavior.
