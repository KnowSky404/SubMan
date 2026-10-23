---
name: subman-project
description: 在 SubMan 仓库中处理 Gist 工作区、Cloudflare Workers 部署、可信自动化 API、节点同步脚本或聚合发布时使用。
---

# SubMan 项目

[English](SKILL.md) | 简体中文

本文件是英文 `SKILL.md` 的中文阅读版本。技能加载入口保持为 `SKILL.md`。
SubMan 是 SvelteKit 应用，业务数据存放在固定的 GitHub Gist 中，同一个
Cloudflare Worker 可提供面向可信后端自动化的 API。

## 开始前

以下 `references/` 以外的路径相对于仓库根目录。

1. 检查当前工作区，阅读 `AGENTS.md`。
2. 阅读 `docs/agents/subman-agent-guide.zh-CN.md`。文档默认英文，中文版本使用
   `*.zh-CN.md` 文件名，通过文首链接切换。
3. 按任务选择参考文档：
   - 架构和文件位置：[architecture.zh-CN.md](references/architecture.zh-CN.md)
   - 部署和验证：[deployment.zh-CN.md](references/deployment.zh-CN.md)
   - Gist 和数据结构：[workspace-data.zh-CN.md](references/workspace-data.zh-CN.md)
   - 后端 API 对接：[server-api.zh-CN.md](references/server-api.zh-CN.md)

## 工作规则

- 使用 Bun 1.3.14、`bun install --frozen-lockfile` 和当前项目脚本。
- 一个绑定 Gist 中的云端 `subman.json` 是业务数据唯一权威。编辑前必须读取最新云端；
  IndexedDB 只保存技术缓存、发送日志和恢复证据，不提供本地业务模式或工作区切换。
- 工作区身份固定为描述 `SubMan-Data`、文件 `subman.json`。
- 外部脚本只接收 `SUBMAN_API_TOKEN`；`GITHUB_TOKEN` 保存在 Worker Secrets 中。
- 浏览器 GitHub Token 默认仅使用 `sessionStorage`；只有明确勾选 Remember token
  才使用 `localStorage`，并且始终独立于业务 IndexedDB。
- 自动化节点使用 `PUT /api/nodes/by-key/:externalKey`。其幂等性只保证资源身份，
  不保证请求重放；重复成功调用仍可推进版本，不支持 `Idempotency-Key`。
- 公开 Node API 写入的 `2xx` 表示远端提交已经回读验证。可将返回的 `ETag`
  通过 `If-Match` 用于下一次乐观并发检查。
- `/api/workspaces/:workspaceId/mutations` 是内部浏览器协议，不是第三方集成接口。
- UI/API 对重名节点自动添加时间戳后缀；重复的 raw URI 会被拒绝。
- 冲突恢复只能在确认丢弃完整待发送队列后重新加载原始云端文档；不恢复本地推送、
  合并覆盖、仅绑定、手动同步或业务 JSON 导入备份。
- 等待 `WorkspaceActionHandle.completion`；`submitted` 只表示任务已被接收。
  通过共享 presenter 解释结果。排队、其他标签页接管和预约重试均为未完成状态；
  只有 `remote-committed` 才能提示成功或结束草稿。
- 保留 revision、tombstone、原始 mutation ID、fencing token 和完整工作区队列。
  诊断不得读取隔离区原始内容。
- TypeScript/Svelte 变更后运行 `bun run check`；部署相关结论前运行构建。
- 每项独立变更验证后创建原子提交。
- 默认使用本地或模拟验证。推送、部署、访问或修改真实 Gist、发布 release 或使用生产
  secrets 需要用户明确授权。

有效 external key 上限 119 UTF-8 字节、调用方标签上限 63 个、PUT 全字段默认值和
不确定写入恢复见[完整 API 文档](../../api/server-api.zh-CN.md)。API 使用 Worker
凭证独立发现 Gist，不依赖浏览器绑定；写入前核对返回的 `workspace.gistId`。
节点更新不会重新发布输出文件，GET 或 health 成功不证明写入完成。

## 常见任务

### 新增或更新自动化脚本

阅读 `references/server-api.zh-CN.md` 和 `docs/api/openapi.yaml`。
sing-box-vps 对接使用[专用指南](../../integrations/sing-box-vps.zh-CN.md)。
使用稳定 external key 和 `curl --fail-with-body -sS` 或等价的状态码及响应体处理。
Gist 是低频写入目标；按稳定错误 `code`/`disposition` 分支，保留安全重试时间，
显式处理 `409 duplicate_node_raw`。

公开 API 变化时，同步 OpenAPI、完整 API 指南、英文 README 及中文版本、本参考和
相关翻译。运行 `bun test src/lib/server/api`，路由变化还需运行对应运行时检查。

### 修改工作区行为

阅读工作区参考并检查 `src/lib/workspace.ts`、
`src/lib/workspace-browser-session-v2.ts`、`src/lib/workspace-persistence.ts`、
`src/lib/workspace-mutation-sync.ts`、`src/lib/workspace-operation-result.ts` 和
`src/lib/server/workspace-coordinator-core.ts`。保留受保护配置、版本队列和同 Gist 发布。
启动加载见 `src/lib/workspace-cloud-session.ts`，重载恢复见
`src/lib/workspace-settings-controller.ts`。保留单一绑定和云端权威；内部 reconcile
兼容路径也必须遵守 tombstone。先加协议行为测试，再运行单元、类型、lint、Worker
及相关浏览器检查。

### 发现或迁移旧工作区

阅读 `docs/legacy-workspace-migration.zh-CN.md` 和工作区参考。只有未绑定设备可以在
`/auth` 使用 Manual Workspace migration，通过原始 Gist ID 只读检查。
已绑定启动和重连只读原始 Gist；首次未发现候选可创建空 bootstrap，歧义必须指定 ID。
核对原始 Gist 和迁移预览后再确认。保留历史缓存与修复证据，不上传缓存、清队列、
重生成输出或改变旧链接。`scripts/audit-workspace.ts` 离线运行，不使用网络或凭证；
其转换结果没有当前浏览器导入路径。

### 修改 UI 流程

按 `design.md` 和对应路由实现：`/auth` 负责云端连接、Token 和恢复，`/gists`
管理文件，`/nodes` 管理节点及订阅，`/aggregate` 管理规则和发布，`/exports`
管理 sing-box 配置。编辑前加载最新云端，草稿保留至 `remote-committed`，验证变化的
浏览器流程。pending、peer 和 retry 只表示技术发送状态。

### 部署或排查 Cloudflare 运行时

阅读部署参考及 `docs/workspace-v2-operations.zh-CN.md`，通过 Bun 使用项目 Wrangler。
部署后分别验证 Durable Object 迁移、secrets 和真实提交。
