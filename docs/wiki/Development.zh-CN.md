# 开发与 Wiki 维护

[English](Development.md) | 简体中文 · [Wiki 首页](Home.zh-CN.md)

## 工具链与本地服务

使用与 `package.json`、CI 一致的 Bun **1.3.14**：

```bash
bun install --frozen-lockfile
bun run dev -- --host :: --port 5173
```

Vite 适合快速调整界面。Worker 路由和 SQLite 协调器行为使用本地 Cloudflare 运行时验证：

```bash
bun run dev:cf -- --ip :: --port 8787
```

预览构建后的界面：

```bash
bun run build
bun run preview -- --host :: --port 4173
```

项目 VPS 域名为 `oc-de-fra-1.knowsky.uk`，搭配所选端口访问。
用 `ss -lntp` 检查实际监听地址，包括 IPv6；无法双栈监听时，单独验证可访问的地址族。
本地运行时测试使用合成数据和 mock，不为测试写入配置真实 GitHub Token。

## 验证

```bash
bun run docs:check
bun test
bun run test:sing-box
bun run check
bun run lint
bun run build
bun run test:cf
bun run test:e2e
bun run deploy:check
```

`test:sing-box` 需要 Docker；E2E 需要 Chromium 和系统依赖，必要时运行
`bunx playwright install --with-deps chromium` 安装。
`check` 包含生成 Worker 类型验证；修改 binding/config 后运行
`bun run generate:worker-types`，提交可复现的声明。

这些检查只证明本地行为和打包，不部署、不访问真实 Gist，也不证明生产资源或真实订阅发送正常。
生产部署需单独授权，步骤见 [CI/CD](../ci-cd.zh-CN.md) 和[工作区运维](../workspace-v2-operations.zh-CN.md)。
API secrets 设置与示例见[接口文档](../api/server-api.zh-CN.md)。

## 目录约定

| 路径 | 用途 |
| --- | --- |
| `src/` | 应用、路由、协议代码及同目录单测 |
| `test/`、`e2e/` | Cloudflare 集成测试、浏览器场景 |
| `scripts/` | 验证、离线审计、类型生成和 Wiki 工具 |
| `static/` | 随应用发布的资源 |
| `docs/wiki/` | Wiki 入口、使用/开发指南及双语变更记录 |
| `docs/api/`、`docs/integrations/`、`docs/agents/` | 权威契约与专题指南，同时发布到 Wiki |
| `docs/archive/`、`docs/adr/` | 带日期的历史设计证据和协议决策 |
| `docs/assets/` | 设计源稿和文档配套资源 |

[AGENTS.md](../../AGENTS.md) 规定项目不变量，[DESIGN.md](../../DESIGN.md) 规定界面约定。
代码标识符与注释保持 ASCII。清理旧路径前检查实际调用；迁移和修复工具仍为受支持的操作工具。
每项独立变更单独原子提交。

## 维护双语 Wiki

主仓库保存文档源。每篇现行 `.md` 指南与 `.zh-CN.md` 中文版本同步修改，
`_Sidebar.md` 为双语共用导航。历史归档和素材说明保留原语言。
后续版本/开发日志统一记录在 [Changelog](Changelog.md) 和[变更记录](Changelog.zh-CN.md)，
生产部署证据单独说明。

验证文档源并生成平面 GitHub Wiki 页面：

```bash
bun run docs:check
bun run wiki:build --out-dir /tmp/subman-wiki-pages
```

生成器转换文档链接，检查本地目标、中英文配对和页面重名。默认输出为忽略的 `.wrangler/wiki`，
生成产物不提交到主仓库。发布前审阅生成差异。获得明确 Wiki 发布授权后：

1. 将 `https://github.com/KnowSky404/SubMan.wiki.git` 克隆到独立目录。
   首次克隆前，GitHub 要求先通过网页创建一个初始页面。
2. 把生成的 Markdown 页面复制到 Wiki 工作区，保留已有的无关页面；确认旧生成页已过时后再删除。
3. 审阅、提交，使用现有系统 GitHub 凭据推送到 Wiki 默认分支。Wiki 推送不会部署应用。
4. 比较本地/远端 Wiki 提交 ID，并查看中英文首页。

Wiki 与主仓库推送是两个动作。引入新的仓库文件链接时，先发布获授权的对应源码提交，再发布链接。
不要强制推送覆盖 Wiki 历史。
