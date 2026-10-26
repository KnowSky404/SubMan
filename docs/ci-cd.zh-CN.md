# SubMan CI/CD

[English](ci-cd.md) | 简体中文

## 持续集成

`CI` 在推送 `main`、Pull Request 和手动触发时运行，使用仓库固定的 Bun/Wrangler，
仓库 `GITHUB_TOKEN` 只有读取权限。Wrangler 精确固定 `4.127.0`，冻结锁文件包含能运行
`compatibility_date = "2026-07-28"` 的本地 `workerd`。

验证顺序为：

1. 按冻结锁文件安装依赖。
2. 单元测试，以及双语文档链接和语言配对检查。
3. 用固定的 sing-box `1.14.0` 容器验证本地合成 URI/订阅导出。
4. Svelte、TypeScript 和生成 Worker 类型漂移检查。
5. Biome。
6. 构建 SvelteKit Worker。
7. Cloudflare Durable Object 集成测试。
8. `wrangler deploy --dry-run`，包保存在 `.wrangler/deploy-check`。
9. 安装 Chromium，通过 `wrangler dev --local` 运行 Playwright。

本地 `bun run test:sing-box` 调用真实聚合/导出代码，注入内存 fixture，
用 tag 与多架构 digest 固定的镜像执行 `sing-box check`。它不读取真实订阅、用户数据、
凭据或 Gist，也不连接代理服务器；本地额外依赖 Docker。

Wrangler 浏览器服务覆盖生成 Worker 入口、`WORKSPACE_COORDINATOR` 类导出、
DO 迁移与 Workers Assets；普通 `vite preview` 不能证明这些运行时边界。
Playwright 失败时上传 trace、截图、视频和报告，保留七天；早期门禁失败不会安装 Chromium。

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

## 生产部署

生产不自动部署。在 `main` 手动运行 `Deploy production`，确认输入为 `deploy`。
部署使用 GitHub `production` environment；配置 required reviewers 与下列环境 secrets：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Token 应限制到目标账户和最小 Workers 部署权限。工作流检查凭据后重跑单测、类型、lint、
构建、Cloudflare 集成和浏览器检查，生成 dry-run 包，然后执行：

```bash
wrangler deploy --strict
```

部署工作流目前不重复 `docs:check` 或 `test:sing-box`；这两项门禁由独立的 `CI / verify` 提供。
部署前要求同一提交的该检查成功。Strict 模式在非交互部署可能覆盖冲突远端配置时失败。

部署凭据与 Worker 运行时的 `GITHUB_TOKEN`、`SUBMAN_API_TOKEN` 分开管理。
运行时 secrets 用 `wrangler secret put`，不写入仓库、工作流输入、构建变量或 fixture。

## 仓库设置

合并或更新 `main` 前要求 `CI / verify`。生产部署保留在 `production` environment
审批门禁内；在分支保护、必需检查、环境审批、回滚和部署后健康验证齐备前，不启用自动部署。
