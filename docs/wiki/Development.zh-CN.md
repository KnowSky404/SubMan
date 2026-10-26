# 开发与 Wiki 维护

[English](Development.md) | 简体中文 · [Wiki 首页](Home.zh-CN.md)

## Worktree 与 PR 工作流

每项任务（包括小修复和文档更新）都使用以下顺序：

**独立 worktree + 任务分支 → 本地实现与验证 → 原子提交 → 推送并提 PR
→ review 完成并处理反馈 → rebase 合并到 `main` → 核对并同步主分支
→ 清理已合并任务的分支和 worktree。**

推送、创建 PR、合并、直接推送 `main`、Wiki 发布和部署需要覆盖对应动作的授权。
流程本身不额外授予权限；同一范围内已有明确授权的动作无需重复确认。
SubMan 保留现有 CI 和本地验证，不引入 FlareMail 的 PRE 验收门禁；普通开发不自动发布或部署。

修改前检查原工作树，fetch 并核对 `origin/main`，再创建新任务分支和独立 checkout。
每项任务替换以下示例中的主题与路径：

```bash
pwd
git status --short --branch
git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
git worktree list
git fetch origin main
git rev-parse origin/main
git worktree add -b feat/topic ../SubMan-topic origin/main
cd ../SubMan-topic
```

修复和文档分别使用 `fix/<topic>`、`docs/<topic>`，其他任务使用相应 Conventional Commit 类型。
记录 worktree 绝对路径、分支和基线 SHA。继续已有任务时复用对应 worktree；
只有用户要求时才换用其他基线。保留原 checkout，不直接在 `main` 开发。
保留无关改动，不 reset、stash 或改写其他任务的历史。

在任务 worktree 内安装锁定依赖。分别隔离 `.svelte-kit`、`build`、`.wrangler`
（包括本地 DO SQLite）、浏览器状态和端口，不共用可写生成目录，不自动复制私有配置或凭据。
实现后完成下文适用的检查，再创建原子 Conventional Commit。获得授权后推送任务分支，
使用仓库 PR 模板向 `main` 提 PR，写明问题、最终行为、基线及验证 SHA、验证证据与限制。
GitHub CLI 多行正文先写入临时文件，再通过 `--body-file` 传入。

## 合并前 Review

所有 PR（包括文档和开发约束更新）都必须完成针对当前 head 的 Codex Code Review。
创建 PR 或追加提交后主动检查审查是否触发。核对仓库实际的 review 配置，不能因为
FlareMail 启用了集成就假定 SubMan 也已启用。Security Review 及其他必需审查启用时，
也必须逐项完成。尚未出现审查记录不能视为集成已关闭。

核对真实作者（`chatgpt-codex-connector[bot]`，部分输出省略 `[bot]`）、审查提交、
完成时间和结果链接。检查 `Codex Review Summary` 中每项审查的状态与提交，结合
已提交 review 和行内反馈判断。单个汇总 status/head SHA 不代表所有审查都已完成。
`CLEAN`、空 Actions checks、`COMMENTED`、表情或旧 head 的 review 均不能作为完成证据。
必需 CI 检查与机器人审查分别验收。

修复有效阻断问题并补做受影响检查；误报或不适用项记录依据。追加任何提交后，
都要等待新 head 的审查。审查待完成、失败或缺少可核实凭据时，保留 PR、分支和 worktree，
报告阻塞原因。等待超时不豁免审查，不提前开启可能绕过门禁的 auto-merge。

## Rebase 合并与清理

获得合并授权后，核对 PR 目标为 `main`、head SHA、提交/文件范围、可合并状态、
必需 CI 检查与当前 head 的审查。用户未指定其他策略时默认 rebase 合并，锁定已验证 head：

```bash
gh pr merge <PR> --rebase --match-head-commit <VERIFIED_HEAD_SHA>
```

不通过 `--admin` 绕过检查。加入合并队列或开启 auto-merge 不代表已合并，清理前必须确认
PR 为 `MERGED`。记录 PR URL、原 head SHA 和合并 SHA。fetch `origin/main`，
确认它包含合并 SHA 及任务全部改动。Rebase 会改写 SHA，使用补丁/内容对比核对原始与
rebase 后的提交范围，例如 `git range-diff`。不能只凭原 head 的祖先关系或推送成功判断整合结果，
也不要求整个任务树与含其他改动的最新 main 完全相等。冲突解决或整合导致内容变化时补做受影响验证。

从保留的原 checkout 同步主分支，仅在当前为 `main`、工作树干净且能快进时执行：

```bash
git merge --ff-only origin/main
```

主工作树有改动或分叉时保留现场并报告，不 reset、stash 或自动 rebase。
这不妨碍已独立核实可安全执行的任务清理。核实已授权的合并完成后，默认完成收尾，用户要求保留时除外：

1. 确认尚存的本地和远端任务分支仍指向已合并 PR head，没有新增提交。
   检查暂存、未提交、未跟踪文件及需保留的忽略文件，把验收证据和私有配置保存到任务工作树之外，
   停止临时服务。不删除其他任务 worktree 或主 checkout。
2. 从保留的 checkout 运行 `git worktree remove <PATH>`，不加 `--force`，
   再运行 `git branch -d <BRANCH>`。清理与合并分步执行，逐项核对结果。
3. 尚存远端分支只能使用锁定已核实合并 head 的 lease 删除：
   `git push --force-with-lease=refs/heads/<BRANCH>:<VERIFIED_HEAD_SHA> origin :refs/heads/<BRANCH>`。
   这是条件删除，不授权覆盖历史；不使用无条件 `--delete` 或 `--force`。
   分支已不存在时记录即可。Lease 被拒绝时保留分支并报告，不换成较新的未合并 head 重试删除。
4. `-d` 仅因 rebase 改写祖先关系而失败时，先证明 PR `MERGED`、合并 SHA 在 main、
   任务 head 未变、补丁/内容等价，才能对本任务分支使用 `-D`。
   单独的 `-d` 成功不证明改动进入 main。未合并提交、未保存文件、其他 worktree 占用，
   或用户要求保留时，停止对应清理。
5. 核对 PR 状态、本地/远端 main SHA、工作树状态、任务分支和 worktree 移除结果。
   交付 PR URL、最终 SHA、验证、同步与清理结果及阻塞项。未合并任务继续保留。
   合并和清理不代表生产部署。

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

纯文档/开发约束改动运行 `bun run docs:check`，审阅差异、命令和链接，无需运行时测试或远程部署。
实现、测试、工具或 CI 改动执行下方适用检查；前置条件缺失或检查失败时如实报告。
共享生成文件的检查（`check`、构建、Worker 测试、类型生成、浏览器测试）在同一 worktree 内串行运行。

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
