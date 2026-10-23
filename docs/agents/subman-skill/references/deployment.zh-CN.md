# SubMan 部署参考

[English](deployment.md) | 简体中文

## 命令

使用与 `package.json`、CI 一致的 Bun 1.3.14，安装并验证：

```bash
bun install --frozen-lockfile
bun test
bun run test:sing-box
bun run check
bun run lint
bun run build
bun run test:cf
bun run deploy:check
bun run test:e2e
```

`test:sing-box` 依赖 Docker，使用固定 digest 的容器和合成数据；E2E 依赖 Chromium
（`bunx playwright install --with-deps chromium`）。`check` 包含 Worker 类型验证。
这些本地/模拟检查不证明生产健康或真实 GitHub 交付。`deploy:check` 只构建并执行
Wrangler dry-run，不上传。构建类检查应顺序运行：`build`、`test:cf`、`test:e2e`
和 `deploy:check` 共用 `.svelte-kit` 生成文件。

本地运行：

```bash
bun run dev -- --host :: --port 5173
bun run dev:cf -- --ip :: --port 8787
```

`dev:cf` 先构建，再执行 `wrangler dev --local`，是验证 Durable Object 导出、迁移
和 binding 的本地运行时；Vite 用于快速 UI 开发。先构建再运行
`bun run preview -- --host :: --port 4173`。

本 VPS 使用 `http://oc-de-fra-1.knowsky.uk:5173`、`:4173` 或 `:8787`，并通过
`ss -lntp` 验证监听。若 `::` 只接受 IPv6，另用 Vite `--host 0.0.0.0` 或 Wrangler
`--ip 0.0.0.0` 验证/启动 IPv4。通过 Bun 使用项目 Wrangler，不为匹配示例而升级。
CLI 参数参阅 [Wrangler 命令文档](https://developers.cloudflare.com/workers/wrangler/commands/)，
并使用当前安装的 `bun wrangler <command> --help` 核对。

GitHub Actions、生产 environment secrets 和历史 Worker 类型 CI 故障见
[CI/CD 指南](../../../ci-cd.zh-CN.md)。

## Worker 类型与 compatibility date

`src/worker-configuration.d.ts` 根据 `wrangler.toml` 生成：

```bash
bun run generate:worker-types
bun run check:worker-types
```

不手改生成声明。脚本使用仓库 Wrangler 和隔离的日志/registry 路径，仅为 SvelteKit
入口和类型化 DO class 做少量标准化。`check:worker-types` 比较可复现结果，在本地和
CI 阻止配置与声明漂移。

当前 compatibility date 有意保持在本地 Workers 测试运行时支持的最新日期。
只有完整构建、Cloudflare、浏览器、部署 dry-run、类型生成全部通过后才推进日期，
推进后重跑完整检查。如果本地 workerd/Wrangler 不支持新日期，先升级工具链或保留
上一可用日期，不静默跳过 Cloudflare 测试。

## 安全可观测性

`wrangler.toml` 启用 Workers Logs，未启用完整 tracing。
默认 `head_sampling_rate = 0.1` 控制常规日志量；仅在受控排查时临时提高，并在验证后
还原。应用只通过一个允许列表 helper 输出结构化 JSON，字段包括请求 ID、操作、
哈希后的 Workspace ID、mutation ID/kind、预期/提交版本、延迟、状态、disposition、
稳定错误码，以及安全的 GitHub 操作、状态、类别和 request ID。

日志不能包含 Token、Authorization/Cookie、订阅 URL、raw 代理 URI、mutation
payload、Workspace 文档、生成输出、隔离内容、异常消息或堆栈。tombstone 数量
只用于警告，不授权压缩；不按时间清理 tombstone 或 processed mutation。

只有明确授权后部署：

```bash
bun run deploy
```

脚本会构建并使用 Wrangler strict 模式。GitHub Actions 使用手动触发的
`Deploy production` workflow，不添加 push 自动生产部署。

## Durable Object 配置

`wrangler.toml` 绑定 SQLite 协调器：

```toml
[[durable_objects.bindings]]
name = "WORKSPACE_COORDINATOR"
class_name = "WorkspaceCoordinator"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["WorkspaceCoordinator"]
```

不改名已应用的迁移 tag。新 class 变化使用新唯一 tag 及正确的 Wrangler 迁移指令。
本地 Wrangler 默认使用模拟 DO 存储，除非明确配置 remote binding。

## Worker secrets

Server API 需要两个 Worker secrets：

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

这些命令修改远端 Worker，需要明确授权，不属于本地配置/验证。先核对账户及 Worker，
交互式输入，不在命令文本中写 secret 值。

- `GITHUB_TOKEN`：具有 `gist` 权限，只在 Worker 请求和协调器 RPC 中使用。
- `SUBMAN_API_TOKEN`：可信后端脚本的 Bearer 凭证。

两者都不进入源码、Wrangler vars、mutation payload、GitHub Actions 部署凭证或
本地测试 fixture。

## 部署后验证

检查 secret 配置：

```bash
curl -fsS "https://subman.example.com/api/health" | \
  jq -e '.ok == true and .config.githubToken == true and .config.submanApiToken == true'
```

配置完整时响应：

```json
{
  "ok": true,
  "config": {
    "githubToken": true,
    "submanApiToken": true
  }
}
```

随后执行一次受控浏览器或 Server API mutation，核实工作区 revision 恰好推进一次。
V1 工作区还须验证 `subman.v1.backup.json` 与原始内容字节完全一致，再扩大使用范围。

Health 始终 HTTP 200，包括 `ok: false`。上述成功响应只证明 secret 存在，不检查
GitHub 权限、Workspace 发现或 coordinator binding。真实 Gist 读写需要单独授权和
证据。Node API 写入不重新生成订阅/sing-box 输出，相关发布需另行核对。

## 迁移与回滚

遵循[Workspace 运维手册](../../../workspace-v2-operations.zh-CN.md)：

- V1 在首次协调器 mutation 时迁移，不在发现时迁移。
- 浏览器先显示预览并要求确认；未绑定 `/auth` 旧版检查必须提供原始 ID，且不创建
  Gist。已绑定设备保留原身份。迁移保留输出和链接，不重新发布。
- 新 Gist 在首次协调器提交前只含 bootstrap 标记。
- 回滚需停止 V2 写入者、保留 V2 文档、恢复精确 V1 备份，并向前部署经过验证的兼容
  artifact `c89a60b`。该版本保留已经应用的迁移、binding 和协调器 class 导出，
  同时使用验证过的 V1 事务路径。
- 回滚时保留 Durable Object namespace 和 SQLite 记录。

浏览器编辑前必须 GitHub 鉴权并加载最新云端，每次变更等待云端确认。唯一 Gist
绑定取代本地业务模式、切换、手动同步及业务 JSON 备份导入。IndexedDB 只保存缓存、
日志和恢复证据；Token 默认在 `sessionStorage`，明确选择持久化后才用
`localStorage`。可信 Server API 契约保持稳定，依赖 Worker secrets 和
`WORKSPACE_COORDINATOR` binding。

URI 支持矩阵、订阅 CORS 和导出发布边界见
[sing-box 导出指南](../../../sing-box-export.zh-CN.md)。
