# SubMan

纯前端的 Gist-first 订阅管理工具，支持 VLESS / VMess 等协议的节点与订阅聚合。
核心目标是：在一个固定的 GitHub Workspace Gist 内完成数据管理与稳定订阅发布。

默认 Workspace 标识：
- 描述：`SubMan-Data`
- 配置文件：`subman.json`

## 主要能力
- **Workspace Gist**：保存 Token 后自动查找/创建固定标识的 Gist
- **本地/远端双模式**：
  - 无 Token -> 本地模式，仅 localStorage
  - 有 Token -> Workspace 模式，自动同步到 Gist
- **冲突处理**：本地 / 远端 / 合并 / 仅绑定
- **节点与订阅管理**：新增、编辑、标签、协议筛选
- **聚合规则与发布目标**：
  - 规则（Rule）负责聚合逻辑
  - 发布目标（Publish Target）负责输出文件、描述、发布可见性
  - 支持一个规则复用到多个发布目标
- **稳定订阅链接发布**：同一 Gist + 同一文件名覆盖发布，客户端链接可长期不变
- **Workspace 文件管理**：
  - 查看 Workspace 文件与 raw 链接
  - 删除非关键文件（`subman.json` 受保护）
  - 支持批量清理非关键文件

## 页面说明
- `/auth`：Workspace（Token、冲突处理、本地导入导出）
- `/gists`：Workspace 文件列表、链接复制、文件清理
- `/nodes`：节点与订阅管理（订阅列表支持搜索/筛选/紧凑展示）
- `/aggregate`：规则编辑、发布目标管理、聚合输出发布

## Workspace 机制
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
- 所有项目数据统一写入同一个 Workspace Gist
