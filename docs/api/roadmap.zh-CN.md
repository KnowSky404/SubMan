# 公开 API 扩展路线图

[English](roadmap.md) | [简体中文](roadmap.zh-CN.md)

当前 SubMan 公开接口范围是健康检查、节点 CRUD 和 `externalKey` 更新。
`/api/workspaces/:workspaceId/mutations` 是浏览器内部传输，不是第三方 API。

本文描述下一步契约设计，不代表已经实现或授权执行这些接口。

## 契约原则

- `subman.json` 始终是唯一权威的 Workspace Schema V2 文档。
- 写入经协调器，保留 `expectedRevision`、mutation ID、tombstone、内部幂等与同一 Gist PATCH 约束，不允许公开路由直接 PATCH Gist。
- 写入成功返回已提交版本、strong ETag 和 `Cache-Control: no-store`；调用方通过 `If-Match` 保护乐观并发。
- 错误保持稳定 code/disposition，gateway 仅允许受限元数据，不返回或记录上游原文、凭证、payload、文档或 stack。
- 当前未版本化节点路径保持新增式兼容；破坏性变更使用 `/api/v2` 或明确版本协商。

## 候选资源组

| 资源 | 候选操作 | 需明确的问题 |
| --- | --- | --- |
| 订阅 | 列表、创建、更新、删除 | URL 归属、抓取策略、CORS 分类及是否持久化远端内容 |
| 聚合规则 | 列表、创建、更新、删除、预览 | 稳定规则身份、来源快照与预览大小 |
| 发布 | 预览、发布、查看状态、删除输出 | 输出新鲜度、文件名变更及文档/输出原子提交 |
| 客户端导出 | 列表、创建、更新、删除、生成、发布 | sing-box 版本/schema 协商和输出限制 |
| 诊断 | 健康、Workspace 摘要、队列摘要 | 安全字段、运营者鉴权，禁止导出隔离原文或 payload |

优先考虑订阅和聚合规则读取；明确新鲜度后再加入预览与发布操作。
协调器确认对应 mutation 前，生成输出不能呈现为已提交。

## 鉴权演进

现有 `SUBMAN_API_TOKEN` 是单一全权限 Bearer。开放更多资源前，需要版本化鉴权契约：

- 具名客户端身份与 `nodes:write`、`subscriptions:read`、`publication:write` 等 scope；
- 独立轮换和撤销，避免全局中断；
- 有界调用方限流和请求重放/幂等策略；
- 仅含身份和结果元数据的审计事件，不含原始 Token；
- 明确区分运营者与自动化调用权限。

CORS 不是鉴权边界。未来 scoped token 仍只放请求头，不进入 Workspace 文档或浏览器
业务持久化。

## 交付阶段

1. 发布新增式 schema 和示例，覆盖限制、ETag、错误 disposition 与鉴权 scope。
2. 使用一致版本快照实现只读订阅和聚合接口。
3. 实现经协调器的版本化写入，每个路由对照 OpenAPI 做契约测试。
4. 测试覆盖输出新鲜度、同 PATCH 和提交后确认后再增加发布/导出操作。
5. 引入版本化鉴权并迁移可信调用方，再开放更广的第三方使用。

完成前，外部调用方只能使用 [Server API](server-api.zh-CN.md) 已列出的路径，
不得调用浏览器内部 Workspace mutation 路由。
