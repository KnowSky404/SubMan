# SubMan 工作区数据参考

[English](workspace-data.md) | 简体中文

## 云端权威与身份

业务配置和生成输出保存在同一个私有 GitHub Gist：

- 描述：`SubMan-Data`
- Workspace ID：`gist:<gist-id>`
- 配置：`subman.json`

浏览器只保留一个绑定，没有工作区列表、切换、本地业务模式、手动同步、本地覆盖
合并、仅绑定或业务 JSON 备份导入。首次连接可显式指定原始 Gist ID；歧义或无效发现
不得自动选择或创建另一份。重连或替换 Token 仍使用原身份，即使它暂时不可访问。

启动后先读最新云端，再启用业务页面。新 Gist 最初只有 `subman.bootstrap.json`，
首次协调器 mutation 创建空 V2 云端文档，不上传旧浏览器数据。

## Schema V2 与单一写入者

`WorkspaceDocumentV2` 包含：

- `version: 2`、`schemaVersion: 2`
- 确定性的 `workspaceId`、单调递增的 `revision`
- `updatedAt`、`lastMutationId`
- nodes、subscriptions、aggregates、publish targets、client exports 业务集合
- 每个业务集合的 tombstone

所有 `subman.json` 变更都经过 `WorkspaceCoordinator` Durable Object。浏览器和
Server API 创建经过验证的带版本 mutation，都不直接写完整 Gist 状态。公开 REST
路由的鉴权和响应契约保持稳定；Worker 独立于浏览器发现 API 目标，需核对
`workspace.gistId`。`/api/workspaces/:workspaceId/mutations` 始终是内部浏览器协议。

## 浏览器发送

每次变更都要求鉴权、成功加载的云端会话及初始化的自动绑定。未解决的发送或修复
证据阻止继续编辑。单个本地事务写入缓存与原始 mutation，然后立即发送。
`completion` 等待云端结果；只有 `remote-committed` 能报告成功或结束草稿。
排队、其他标签页接管、重试和确认不确定均保留草稿与原 mutation 身份。

IndexedDB `subman-workspace` v1 保存缓存、有序日志、重试/阻塞、租约、迁移和历史
队列证据；它不是第二业务数据源。成功时先保存已提交云端文档，再移除队列项。
网络失败保留原 ID 与持久化重试时间。登出清除鉴权、停止发送，但保留绑定和待处理证据。

GitHub 鉴权独立于 IndexedDB：默认使用会话级 `sessionStorage`；只有明确选择
Remember token 才使用 `localStorage`。持久化不能保护 Token 免受活动 XSS 窃取。

## 冲突与恢复

版本冲突暂停发送并保留可信的最新云端文档。恢复界面可重试原请求，或在确认后丢弃
完整活动队列并加载最新云端，再基于新版本重施编辑。没有本地推送、合并或强制覆盖，
远端 tombstone 必须保留。

云端重载在同一事务中比较预期快照、绑定和完整队列；并发编辑应触发受控重试，不能
被静默丢弃。重新绑定和修复不得将活动绑定替换成另一工作区。历史孤立队列只作为
安全证据，不自动重新绑定或发送。显式丢弃始终处理完整队列。

## 保留文件

以下名称不区分大小写地受保护：

- `subman.json`
- `subman.v1.backup.json`
- `subman.bootstrap.json`

聚合和客户端输出必须使用其他名字。文件管理可以删除输出，不能删除配置或恢复文件。

## V1 迁移

发现流程可读 V1，但不会重写它。连接已识别 V1 时显示预览；只有未绑定设备可以通过
原始 Gist ID 检查旧版，且检查不创建 Gist。描述必须为 `SubMan-Data`、文件名必须为
`subman.json`，文档必须有效。已绑定会话不能借旧版检查选择另一 Gist。

显式迁移使用内部 `workspace.migrate`，带预览原始字节的 SHA-256。协调器在同一次
经过回读验证的 Gist PATCH 中创建字节完全相同的不可变 `subman.v1.backup.json`
并写入 V2；业务对象、输出字节、文件名、URL 和时间戳保持不变，不重新发布。
源内容变化后必须重新检查；现有备份不匹配时返回 `migration_backup_conflict`。
迁移前解决待发送队列和修复证据，只有 `remote-committed` 才能完成预览。

## 运维审计与恢复

`scripts/audit-workspace.ts` 离线读取下载的文件，报告 schema 和数量元数据；
`--gist-id` 可核对 V2 身份。保留的 `--export-v1` 以独占方式创建权限为 `0600`
的规范化运维恢复文件，不提供应用导入或恢复路径。历史
`subman-business-configuration` 文件缺少 revision/tombstone，不能替换远端
`subman.json`。诊断也不能恢复业务数据。

审计不访问 GitHub、不验证输出时效，也不从输出重建发布目标。另行授权的运维修复前
保留原云端文件与历史，不先清浏览器证据或批量删除外部文件：失去目标记录的旧输出
仍可能服务客户端。参阅 `docs/legacy-workspace-migration.zh-CN.md` 和
`docs/workspace-v2-operations.zh-CN.md`。

## 稳定性规则

- 不添加其他运行时 `subman.json` 写入者。
- 常规恢复不重置 revision 或清除 tombstone。
- 重试和替换 Token 时保留原 mutation ID。
- 需要稳定 raw URL 时保持输出文件名。
- GitHub Token 不进入 mutation、IndexedDB、Durable Object SQLite、响应、诊断或日志。
