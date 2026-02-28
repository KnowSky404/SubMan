# Codex 上下文 — SubMan

## 项目目标
Gist-first 的代理订阅管理工具（VLESS/VMess 等）。纯前端实现。
核心数据存储在固定的 GitHub Workspace Gist。

## 当前架构
- Workspace 模式：保存 GitHub Token 后，查找/创建固定标识的 Gist（描述 `SubMan-Data`，配置文件 `subman.json`）
- Local 模式：无 Token 时仅使用 localStorage
- 自动同步：存在 Token + activeGistId 时，本地修改自动写入 Gist
- 聚合：选定节点/订阅后生成输出，发布到同一个 Workspace Gist

## 关键流程
- 保存 Token -> ensure workspace gist -> 绑定 workspace
- 冲突处理 UI：
  - 本地覆盖远程
  - 远程覆盖本地
  - 合并后保存
  - 仅绑定（不同步）
- Gists 页面：展示 workspace 文件列表 + raw 链接复制
- Nodes 页面：编辑节点/订阅
- Aggregate 页面：生成输出并发布到 workspace gist

## 关键文件
- 路由
  - `src/routes/auth/+page.svelte`（Workspace+Token+冲突处理）
  - `src/routes/gists/+page.svelte`（Workspace 文件列表）
  - `src/routes/nodes/+page.svelte`
  - `src/routes/aggregate/+page.svelte`
- 核心逻辑
  - `src/lib/workspace.ts`（Gist 查找/创建）
  - `src/lib/gist.ts`（GitHub Gist API）
  - `src/lib/sync.ts`（自动同步）
  - `src/lib/aggregate.ts`（聚合输出）
  - `src/lib/serialization.ts`（导入导出）

## 部署
- Cloudflare Workers
- Adapter: `@sveltejs/adapter-cloudflare`
- 配置文件：`wrangler.toml`
- 常用命令：
  - `pnpm build`
  - `pnpm deploy`

## 约定
- 代码保持 ASCII 字符
- **原子化提交**：每完成一个独立的功能点、UI 改进或 Bug 修复后，必须立即执行 git commit。
- 所有文件写入同一个 Workspace Gist
- 涉及依赖变更时仅使用默认 `pnpm` 命令：`pnpm add <pkg>`、`pnpm add -D <pkg>`、`pnpm remove <pkg>`；不要添加任何自定义包存储路径参数（如 `--store-dir`），保持 `pnpm` 默认存储路径

## 后续方向
- 更强的订阅解析与聚合能力
- 冲突处理体验优化
- 可选：手动切换 Workspace
