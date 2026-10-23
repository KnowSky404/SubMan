# SubMan 架构参考

[English](architecture.md) | 简体中文

## 运行时

SubMan 使用 SvelteKit 和 TypeScript，部署到 Cloudflare Workers。浏览器 UI 与
可信 Server API 都提交带版本的 Workspace mutation，每个 Gist 由一个 SQLite
`WorkspaceCoordinator` Durable Object 串行写入。浏览器只保留一个固定绑定，
编辑前加载最新云端，每次变更等待云端确认。IndexedDB 保存技术缓存、发送日志和
历史恢复证据，不提供本地业务模式。

## 核心模型

模型主要定义于 `src/lib/models.ts`：

- `NodeItem`：单个代理节点。
- `SubscriptionItem`：远程订阅源。
- `AggregateRule`：选择、过滤、改名、区域旗标与排序规则。
- `AggregatePublishTarget`：输出文件配置与上次发布元数据。
- `ClientExportProfile`：sing-box 配置、聚合引用、输出与发布元数据；辅助函数位于
  `src/lib/client-export/profile.ts`。
- `WorkspaceDocumentV2`：云端业务数据、revision 元数据和 tombstone，定义于
  `src/lib/workspace-document.ts`。
- `AppState`：浏览器视图状态；Gist 身份和 UI 元数据不序列化进 V2 文档。

允许的代理类型：

```text
vless, vmess, trojan, ss, ssr, hysteria2, tuic, anytls, other
```

## 主要路由

| 路径 | 职责 |
| --- | --- |
| `src/routes/auth/+page.svelte` | Token、唯一云端绑定、重载、完整队列恢复、旧版升级预览、安全诊断 |
| `src/routes/gists/+page.svelte` | 文件列表、raw URL、输出删除和清理 |
| `src/routes/nodes/+page.svelte` | 节点与订阅管理 |
| `src/routes/aggregate/+page.svelte` | 聚合规则、排序、预览、发布目标 |
| `src/routes/exports/+page.svelte` | sing-box 预览、复制、下载、Workspace 发布 |
| `src/routes/api/health/+server.ts` | API secret 配置检查 |
| `src/routes/api/nodes/+server.ts` | 可信节点自动化列表和创建 |
| `src/routes/api/nodes/[id]/+server.ts` | 公开节点读取、PATCH、删除 |
| `src/routes/api/nodes/by-key/[externalKey]/+server.ts` | 公开 external key PUT |
| `src/routes/api/workspaces/[workspaceId]/mutations/+server.ts` | 内部浏览器传输，不承诺第三方兼容 |

## 主要模块

- `src/lib/workspace.ts`：按固定标识发现 Gist，只有无候选时创建 bootstrap；区分
  V1、V2、bootstrap 和无效数据；首次发现有歧义时要求原始 Gist ID。
- `src/lib/workspace-cloud-session.ts`：编辑前读取原始 Gist 最新数据，恢复原待处理请求。
- `src/lib/workspace-cloud-status.ts`：业务页面和 store action 共用的就绪门槛。
- `src/lib/workspace-settings-controller.ts`：持久化设置、云端重载、完整队列恢复与迁移准备。
- `src/lib/workspace-browser-session-v2.ts`：版本绑定、显式 V1 迁移、浏览器发送编排。
- `src/lib/gist.ts`：GitHub Gist 客户端。
- `src/lib/workspace-browser-mutation.ts`：将 store action 转换为 mutation。
- `src/lib/workspace-persistence.ts`：快照、绑定、队列、重试、修复和租约的事务边界。
- `src/lib/workspace-operation-result.ts`：浏览器操作的权威完成状态。
- `src/lib/workspace-operation-presenter.ts`：UI 对完成状态的共享解释边界。
- `src/lib/workspace-mutation-queue.ts`：持久化有序发送队列。
- `src/lib/workspace-mutation-sync.ts`：提交后持久化、乐观重放和冲突暂停。
- `src/lib/server/workspace-coordinator.ts`：Durable Object RPC 边界。
- `src/lib/server/workspace-coordinator-core.ts`：唯一 `subman.json` 写入者。
- `src/lib/aggregate.ts`：聚合输出生成。
- `src/lib/proxy-protocol.ts`：统一协议清单、scheme 检测、先警告的 URI 元数据检查。
- `src/lib/subscription.ts`：有界浏览器订阅拉取和稳定错误分类。
- `src/lib/client-export/`：纯 sing-box 解析与生成，无 UI/GitHub 依赖。
- `src/lib/serialization.ts`：为技术迁移和运维工具保留的序列化兼容；不提供业务 JSON 恢复。
- `src/lib/workspace-merge.ts`：保留 tombstone 的内部 reconcile 兼容；本地合并不是 UI 流程。
- `src/lib/workspace-file-inventory.ts`：区分保留、受管理、外部文件，不从输出重建发布目标。
- `src/lib/workspace-diagnostics.ts`：仅允许安全字段的诊断，不包含原始内容。
- `scripts/audit-workspace.ts`：离线 schema/身份检查与 V1 运维恢复转换；不使用网络，
  不写运行时 Gist，也没有应用导入路径。
- `src/lib/server/api/*`：鉴权、环境、节点 mutation、工作区访问、错误 envelope。
- `docs/api/openapi.yaml`：公开 Server API 机器契约。
- `docs/sing-box-export.zh-CN.md`：当前导出协议矩阵和浏览器拉取契约。

API 的 119 字节 external key、63 个调用方标签、PUT 默认值和不确定结果恢复见
[API 指南](../../../api/server-api.zh-CN.md)。Worker 凭证独立发现 API 目标，写入前
核对 `workspace.gistId`。节点更新不重新发布输出，GET/health 不证明远端提交。

## 开发约束

遵循既有路由及 store 模式，共享业务规则放入 `src/lib`。浏览器与 Server API 共用
协调器和版本契约；公开 Node API 写入同步完成，`2xx` 才证明回读验证后的提交，
浏览器队列完成状态不适用于公开 API。内部 mutation 路由不能作为第三方接口。
迁移、部署或回滚前阅读 `docs/workspace-v2-operations.zh-CN.md`。
