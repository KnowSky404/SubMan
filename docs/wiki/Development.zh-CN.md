# 开发与 Wiki 维护

[English](Development.md) | 简体中文 · [Wiki 首页](Home.zh-CN.md)

## Worktree 与 PR 工作流

项目规则与风险矩阵见 [AGENTS.md](../../AGENTS.md)。采用的 Manifest 固定版本为
[`6f387de5065b6ffc475908880362939185ff89d7`](https://github.com/KnowSky404/Manifest/blob/6f387de5065b6ffc475908880362939185ff89d7/docs/AI_NATIVE_DEVELOPMENT_WORKFLOW.md)。
更新基线前先审查变化。SubMan 对 R0 保留 Codex 代码审查，候选版本使用隔离的本地
Worker、DO 和浏览器验收。测试无法覆盖关键边界时，由 Owner 批准等效验收。

从已核对的主分支版本创建任务分支，并保留原 checkout：

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

Git 元数据只读时使用基于同一已核对版本的独立 clone。将目标、范围、验收、
风险、授权、基线、分支和路径记录到 PR 或忽略的 `.task/task.md`。在节点更新当前
head、阶段、检查及输入、审查轮次和结论、候选证据、阻塞与下一步。恢复任务前，
对照记录、Git、Actions 和当前审查状态。跨环境交接使用脱敏的 PR 或 issue。

在任务 checkout 安装锁定依赖，隔离 `.svelte-kit`、`.wrangler`（含本地 DO SQLite）、
浏览器状态和端口。同一主机并行运行 Playwright 时使用独立的 `SUBMAN_E2E_PORT`。
本地验证后原子提交，按授权推送任务分支和创建 PR。可用 Draft 提前运行 CI。
GitHub CLI 的多行正文使用临时文件和 `--body-file`。

## 合并前审查

并行启动 CI 与必需审查。PR 转为 ready 或 head 更新后检查机器人摘要，逐项核对
审查作者、对应 SHA、完成时间和行内发现。确认必需审查未启动且无在途任务后，
使用 `@codex review` 或 `@codex security review` 触发一次。R3 还需独立本地审查
或 Owner 批准的等效审查。核对实际配置，并分别验证机器人审查和 CI。

批量修复阻塞发现，针对受影响路径复验，记录修复、误报与延后的依据。R0 保留
首轮必需审查，取消额外自主轮次。R1 最多两轮，R2/R3 最多三轮。并行审查计一轮，
用完预算仍有阻塞时交由 Owner 裁决。保留未完成任务及证据供续作。
验收、适用的 CI/审查、发现处置和回滚证据齐备后，任务才达到可授权合并状态。

## Rebase 合并与清理

获得合并授权后，核对 PR 目标为 `main`、head SHA、提交/文件范围、可合并状态、
必需 CI 检查与当前 head 的审查。用户未指定其他策略时默认 rebase 合并，锁定已验证 head：

```bash
gh pr merge <PR> --rebase --match-head-commit <VERIFIED_HEAD_SHA>
```

不通过 `--admin` 绕过检查。加入合并队列或开启 auto-merge 不代表已合并，清理前必须确认
PR 为 `MERGED`。记录 PR URL、原 head SHA 和合并 SHA。fetch `origin/main`，
确认它包含合并 SHA 及任务全部改动，并核对集成提交的完整 main CI。Rebase 会改写
SHA，使用补丁或内容对比核对原始与
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

迭代时运行受影响的检查。普通文档运行 `bun run docs:check` 并核对 diff、命令和链接。
运行时改动使用 AGENTS.md 中适用的命令。Worker 集成命令和部署 dry-run 可单独运行，
各自先构建。CI 的运行时任务构建一次，随后使用同一 checkout 的产物运行 `:built` 命令。
同一 worktree 中，依赖构建产物的命令串行执行。CI 覆盖适用的完整套件。

`test:sing-box` 需要 Docker。E2E 需要 Chromium 和系统库，可通过
`bunx playwright install --with-deps chromium` 安装。绑定变更后执行
`bun run generate:worker-types` 再运行 `bun run check`。
发布证据见 [CI/CD](../ci-cd.zh-CN.md)，恢复见[运维指南](../workspace-v2-operations.zh-CN.md)。

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
