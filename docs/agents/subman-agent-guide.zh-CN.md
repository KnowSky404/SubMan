# SubMan Agent 指南

[English](subman-agent-guide.md) | 简体中文

本指南供 AI Agent、自动化执行器和检索系统理解或维护仓库。文档默认英文，中文版本
通过文首链接切换；应用界面的语言设置独立于仓库文档。

## 项目形态

SubMan 是以 Gist 为数据源的代理订阅管理器。浏览器管理节点、订阅、聚合规则、
发布目标和同步状态，同一个 SvelteKit Worker 为可信后端自动化提供小型 Server API。

工作区 Gist 的固定身份：

- 描述：`SubMan-Data`
- 配置：`subman.json`

云端 `subman.json` 是唯一业务权威，每台设备只保留一个固定绑定。启动先加载最新
云端再允许编辑，每次变更需要鉴权并等待云端确认。浏览器 GitHub Token 默认使用
`sessionStorage`，只有明确勾选 Remember token 才使用 `localStorage`；鉴权独立于
业务 IndexedDB。产品不提供本地业务模式、切换、手动同步、本地覆盖合并或业务 JSON
备份导入。IndexedDB `subman-workspace` 仅保存缓存、发送日志和恢复证据。

## 文档入口

- 项目规则：`AGENTS.md`
- README：[English](../../README.md) / [简体中文](../../README.zh-CN.md)
- Server API：[English](../api/server-api.md) / [简体中文](../api/server-api.zh-CN.md)
- sing-box-vps 对接：[English](../integrations/sing-box-vps.md) / [简体中文](../integrations/sing-box-vps.zh-CN.md)
- 机器契约：`docs/api/openapi.yaml`
- Agent 技能：[英文入口](subman-skill/SKILL.md) / [中文阅读版](subman-skill/SKILL.zh-CN.md)
- [架构参考](subman-skill/references/architecture.zh-CN.md)
- [部署参考](subman-skill/references/deployment.zh-CN.md)
- Workspace 运维：`docs/workspace-v2-operations.zh-CN.md`
- 旧版发现、迁移和离线恢复：`docs/legacy-workspace-migration.zh-CN.md`
- CI 与手动生产部署：`docs/ci-cd.zh-CN.md`
- [工作区数据参考](subman-skill/references/workspace-data.zh-CN.md)
- [自动化 API 参考](subman-skill/references/server-api.zh-CN.md)
- sing-box 导出契约：`docs/sing-box-export.zh-CN.md`

支持技能的 Agent 在处理 SubMan 部署、自动化、API 对接、同步或 Gist 数据变化时，
加载 `docs/agents/subman-skill/SKILL.md`；中文文件不改变技能发现入口。

## 常用命令

使用与 `package.json`、CI 一致的 Bun 1.3.14，按 `bun.lock` 安装。

```bash
bun install --frozen-lockfile
bun test
bun run test:sing-box
bun run check
bun run lint
bun run test:cf
bun run test:e2e
bun run deploy:check
```

`test:cf` 和 `deploy:check` 先构建。`check` 包含可复现 Worker 类型检查，binding
变化后运行 `bun run generate:worker-types`。sing-box 检查依赖 Docker；缺少 Chromium
时使用 `bunx playwright install --with-deps chromium`。测试使用合成或模拟数据，
不证明真实 Gist 或生产行为。

UI 开发使用 `bun run dev -- --host :: --port 5173`；Worker 本地运行：

```bash
bun run dev:cf -- --ip :: --port 8787
```

在本 VPS 打开 `http://oc-de-fra-1.knowsky.uk:5173` 或 `:8787`，通过 `ss -lntp`
核对 IPv4/IPv6。未配置本地 secrets 时 health 为 HTTP 200、`ok: false`；即使
`ok: true`，也只证明 secret 存在，不检查 GitHub 权限或协调器 binding。
本地写入测试不配置真实 GitHub 凭证。

生产命令需要明确授权。被授权设置 Server API 后，交互式写入：

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

secret 写入会修改远端 Worker。部署使用 `bun run deploy` 或手动生产 workflow，
参阅 `docs/ci-cd.zh-CN.md`；这些都不属于本地验证。

## 工作流程

1. 先检查 git 状态、diff、脚本和相关实现，保留无关变更。
2. 根据架构参考定位源文件。UI 阅读 `design.md`，持久化和协议阅读运维手册。
3. 既有协议变化前先加行为测试。业务操作必须经过持久化并等待 `completion`；
   `submitted` 不表示保存，只有 `remote-committed` 才能结束草稿和报告成功。
4. 同步英文 README、中文版本及相关双语 Agent 参考；公开 API 变化还要更新 OpenAPI、
   完整 API 指南和契约测试。
5. 运行对应检查。运行时/binding 变化跑 Worker/DO 测试，浏览器流程跑 E2E，
   导出器变化跑 sing-box 检查。
6. 独立变更创建 Conventional Commit。报告提交、检查和证据范围。推送、部署和真实
   Gist 操作需要授权。

## 旧工作区恢复

仅未绑定设备可在 `/auth` 的 Manual Workspace migration 输入原始 Gist ID。
检查只读指定 Gist，不创建新 Gist；首次发现有歧义必须提供 ID；已绑定启动和登录
保留原 Gist，不扫描切换。

确认迁移前核对 V1 对象数量、输出文件名和旧 URL。保留历史缓存、待处理和修复证据；
没有本地业务备份导入。内部 `workspace.migrate` 核对 V1 原始内容哈希，创建字节
完全相同的不可变备份，保留输出字节与发布元数据。只有 `remote-committed` 表示完成。
源变化后重新检查；遇到 `migration_backup_conflict` 调查既有备份，不能覆盖。

下载的私有配置可离线审计：

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json --gist-id YOUR_GIST_ID
```

`--export-v1 /private/path/recovery.json` 独占创建权限为 `0600` 的规范化运维文件。
应用无法导入它，它不是带 revision 的 Workspace，不能替换 `subman.json`。
诊断只有元数据，不是业务恢复数据；另行运维修复见旧版迁移指南。

## 自动化 API

VPS 安装器和重复节点更新优先使用：

```http
PUT /api/nodes/by-key/:externalKey
Authorization: Bearer <SUBMAN_API_TOKEN>
Content-Type: application/json
```

同一 external key 通过以下标签定位同一节点：

```text
external:<externalKey>
```

除非确实需要
创建新对象，自动化不要使用 POST。该约束是资源身份幂等，不是请求重放幂等；
每次成功更新仍可推进版本。不支持 `Idempotency-Key`，未知结果不能盲目重放。
写入 `2xx` 表示协调器已远端提交并回读验证。下次写入可发送返回的 ETag 作为
`If-Match`，`412 precondition_failed` 后先重读。

UI/API 采用同一重复规则：重名追加时间戳，相同 raw URI 返回
`409 duplicate_node_raw`。

```bash
curl --fail-with-body -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer ${SUBMAN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

真实调用需将 URI 占位符替换为有效节点链接。119 字节 key、63 个调用方标签、
PUT 默认值和不确定结果恢复见[完整 API 指南](../api/server-api.zh-CN.md)。
API 用 Worker 凭证独立发现 Gist，写前核对 `workspace.gistId`。节点更新不会重新
发布输出，GET/health 不证明写入完成。

## 开发边界

- 配置和输出保存在固定 Gist；技术状态全部经过 IndexedDB `WorkspacePersistence`。
- `subman.json`、`subman.v1.backup.json`、`subman.bootstrap.json` 不可被输出覆盖或
  文件清理删除，迁移恢复证据也必须保留。
- 所有配置 mutation 经协调器，不新增直接全量 Gist 写入者。
- 只有 health 与 node 路由是公开 API，浏览器内部 mutation 路由不用于集成。
- 按稳定 `code`、`disposition` 分支，不解析错误消息。
- 排队、peer 接管、预约重试均保留原 mutation ID；修复和丢弃处理完整队列。
- 保留 tombstone 和 revision；云端重载须确认丢弃整队列，不提供本地覆盖合并。
  未知存储故障保持只读。
- `duplicate_node_raw` 表示 URI 已存在于其他节点，先核对资产清单。
- 脚本不持有 GitHub Token，只用共享全权限 API Token；通过 TLS，避免日志/URL，
  支持定期轮换。API Token 没有 scope 和单客户端撤销。
- 代码标识和注释保持 ASCII；独立变更原子提交。
- 推送、部署、release、真实 Gist 和生产 secrets 操作需要用户明确授权。
