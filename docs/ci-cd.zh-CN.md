# SubMan CI/CD

[English](ci-cd.md) | 简体中文

## 持续集成

`CI` 在所有 PR、推送 main 和手动触发时运行。PR 验证 GitHub 生成的 head 与 base
集成提交，范围判断任务记录三个 SHA。它从 base 读取路径策略，核对集成提交的父提交
并比较两棵树。证据不完整或事件不是 PR 时运行完整套件。标签和 PR 正文不影响选择。

| CI 套件 | 适用的 PR | 必需证据 |
| --- | --- | --- |
| 文档 | 仅修改 `docs/wiki/` 下开发指南以外的 Markdown | 双语文档及链接检查，无需安装应用依赖 |
| UI | 仅修改 `src/app.css` 和上述文档 | 文档、单测、类型和 lint，Worker 构建、dry-run 及浏览器测试 |
| 完整 | 其他路径（含工作流和策略），以及 main 和手动运行 | 全部 UI 检查，加 sing-box 导出和 Workers/DO 集成 |

CI 按路径保守选择套件，按 AGENTS.md 独立评估风险。快速和运行时任务在独立托管
runner 上并行。运行时任务构建一次，Workers/DO 集成、dry-run 和 Playwright 复用
同一 checkout 的产物。dry-run 包位于 `.wrangler/deploy-check`。Playwright 使用
`wrangler dev --local` 和合成数据，覆盖 Worker 入口、DO 导出和迁移、Workers Assets。
失败时将本地 fixture 的 trace 和报告上传 GitHub，保留七天。Playwright 重试用于
收集诊断信息，结果不稳定时 CI 仍失败。

`CI / verify` 是固定门禁。范围判断和快速任务须成功，仅文档套件可跳过运行时任务。
适用的检查缺失、取消或失败时，门禁无法通过。同一 ref 的过时 CI 自动取消。
Actions 固定到提交，Bun 版本来自 `package.json`，依赖使用冻结锁文件。
Bun setup 缓存固定版本的可执行文件。PR CI 使用只读权限，检出后不保留凭据，
也不接收生产 environment 的 secrets。

`bun run test:sing-box` 使用固定的 sing-box `1.14.0` 镜像验证内存导出，本地需要
Docker。测试数据为合成 fixture。`bun run test:cf` 和 `bun run deploy:check` 可独立运行并
先构建。只有同一 checkout 刚构建过相同候选版本时，才使用 `:built` 命令和
`SUBMAN_E2E_USE_BUILD=1`。

## 历史 CI 故障

### Worker 类型漂移

2026-08-24 的 `run #5`（`e82147c5d370734c27a03fa681fccf07028721d8`）
单测通过后因生成声明过期失败。2026-09-30 的
`81f6a590ac45cdd2725211acd3dcede9982d47b4` 也遇到同类问题。

Wrangler 仅在框架入口存在时生成 `Cloudflare.GlobalProps`。本地构建保留
`.svelte-kit/cloudflare/_worker.js`，CI 则先检查再构建，导致仅重新生成仍不稳定。
当前生成器剔除完整的依赖构建产物的 `GlobalProps`，保留从稳定源码导入的
`Env.WORKSPACE_COORDINATOR` 类型。回归测试在入口存在/不存在时运行真实生成器并比较结果。

```bash
bun run generate:worker-types
bun run check:worker-types
```

不要手改生成声明；修改 `wrangler.toml`、Wrangler、binding、migration 或兼容日期时，
重新生成并通过完整 CI。

### 本地 Workers 运行时落后于兼容日期

最初改用 `wrangler dev --local` 的 CI 在浏览器服务启动前已通过单测、类型、lint、
构建、Cloudflare 和 dry-run，但旧 Wrangler `4.81.0` 的 workerd 只支持到 `2026-04-12`，
项目要求 `2026-07-28`，启动失败。

没有回退生产兼容日期；Wrangler 升级并固定到 `4.127.0`，锁文件解析
`workerd` `1.20260826.1`。后续兼容日期变更须先更新固定运行时，并通过 Worker 启动、
dry-run、集成与浏览器门禁。

## 生产发布

DEV 使用隔离 worktree、模拟服务与本地 Worker/DO 状态。稳定候选须具备适用的完整
CI、审查及隔离 Worker 和浏览器验收证据。记录候选 SHA 或 tree、锁文件和工具链、
Wrangler 配置与 fixture/运行时标识，以及覆盖的行为、负向和失败路径。如果集成改变了
相关源码、基线、配置、依赖或构建输入，重跑受影响的验收。复用前先证明输入等价。
SubMan 没有共享 PRE 部署环节。本地运行时无法证明重要行为时，由 Owner 批准额外的隔离验收。

授权合并后，核对集成 SHA 与成功的完整 `main` push CI。对比已部署版本的运行时、
构建输入和配置。等价时无需发布。记录发布范围、准确 SHA、目标、原 Worker 版本和
回滚步骤。R3 还需记录受影响状态的兼容性与恢复证据。Worker 回滚只恢复代码与配置。
状态变更需要另行授权的恢复点或兼容的前向修复方案。

获得发布授权后，从 `main` 手动触发 `Deploy production`，输入确认值 `deploy` 和已
验证的完整提交 SHA。工作流核对该 SHA 最新的 push CI，部署前再校验 main tip。
发布 runner 使用相同的锁定依赖并构建一次。验证套件和 dry-run 包由 main CI 提供证据。
沿用严格模式，远端配置冲突时停止。生产任务使用 `production` environment，部署串行且
不取消正在执行的任务。

记录工作流、提交与部署日志中的 Cloudflare 版本。在获准的生产域名确认 `/api/health`
返回 HTTP 200 和 `ok: true`，再验证受影响的只读功能并检查 Worker 错误。健康检查
只证明就绪。记录样例、时间和结果，排除凭据和客户数据。冒烟检查失败时，生产验收仍待
完成。重试前核对实际在线版本，按授权执行已记录的恢复方案并重新检查。

## 仓库设置

新 `verify` 任务在 PR 上运行后，打开 **Settings → Branches → Add branch protection rule**，
选择 `main`，要求经 PR 合并并通过状态检查，选择 GitHub Actions 的 `verify`（PR 界面
显示 `CI / verify`）。要求分支保持最新、解决对话，关闭绕过、强推和删除。保留 rebase
合并，避免设置单人 Owner 无法满足的人工审批人数。在实际 PR 验证设置。即使状态检查为绿，
CI 工作流或分类策略变更仍需 R3 审查。

在 **Settings → Environments** 创建或检查 `production`，将部署分支限制为 `main`，
在可用时配置 required reviewers 和独立审批，并继续要求 Owner 的明确发布授权。
将 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` 仅配置为 environment secrets，
限定到目标账户和最小 Workers 部署权限。运行时 `GITHUB_TOKEN`、`SUBMAN_API_TOKEN`
留在 Worker secrets，避免进入 CI、构建或 fixture。发布保持手动触发。

核对 Codex 自动代码与安全审查设置。平台门禁未强制执行前，由获授权的合并者核对
当前 head 的审查证据与发现处置。GitHub 必需 CI 检查无法证明 Codex 已完成审查。

## 流程度量

从 Actions 和 PR 记录对照交付周期、PR 周期、各套件 CI 耗时、审查轮次与上下文恢复次数。
发布时记录候选部署次数、冒烟失败和恢复时间。比较同类 PR 和 runner 条件后再判断耗时变化。
首次观察样本记录到流程 PR。还无法在真实集成验证的路径使用本地模拟。
