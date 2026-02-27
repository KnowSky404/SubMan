# SubMan

纯前端的 Gist-first 订阅管理工具，支持 VLESS / VMess 等协议的节点与订阅聚合。
数据默认存储在固定的 GitHub Workspace Gist（`SubMan-Data` / `subman.json`）。

## 主要能力
- **Workspace Gist**：保存 Token 后自动查找/创建固定标识的 Gist
- **本地/远端双模式**：
  - 无 Token -> 本地模式，仅 localStorage
  - 有 Token -> Workspace 模式，自动同步到 Gist
- **冲突处理**：本地 / 远端 / 合并 / 仅绑定
- **节点与订阅管理**：新增、编辑、标签、协议筛选
- **聚合输出**：生成订阅结果，发布到同一 Workspace Gist
- **Gists 页面**：展示 Workspace 内文件及 raw 链接

## 页面说明
- `/auth`：Workspace（Token、冲突处理、本地导入导出）
- `/gists`：Workspace 文件列表与链接复制
- `/nodes`：节点与订阅管理
- `/aggregate`：规则编辑、聚合输出、发布

## Workspace 机制
- **固定标识**：
  - 描述：`SubMan-Data`
  - 文件：`subman.json`
- 保存 Token 后：
  - 如果 Gist 不存在 -> 创建并写入本地数据
  - 如果存在 -> 仅绑定，不自动覆盖
  - 提供“本地/远端/合并/仅绑定”的选择

## 开发与构建
```bash
pnpm install
pnpm dev
```

## Cloudflare Workers 部署
已适配 Workers：`@sveltejs/adapter-cloudflare` + `wrangler.toml`

```bash
pnpm build
pnpm deploy
```

如需本地预览 Workers：
```bash
pnpm dev:cf
```

## 技术栈
- SvelteKit + TypeScript
- TailwindCSS v4
- Biome
- pnpm

## 约定
- ASCII 字符
- 每次改动后直接 commit
- 所有数据统一写入 Workspace Gist
