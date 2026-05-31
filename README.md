# SubMan

[English README](README.en.md)

Gist-first 的纯前端代理订阅管理工具，支持 VLESS / VMess 等节点与订阅聚合。
核心目标是在一个固定的 GitHub Workspace Gist 内完成数据管理与稳定订阅发布。

默认 Workspace 标识：
- 描述：`SubMan-Data`
- 配置文件：`subman.json`

## 主要能力
- Workspace Gist：保存 Token 后自动查找或创建固定标识的 Gist，并绑定为工作区
- 本地与远端双模式：无 Token 仅 localStorage；有 Token 自动与 Gist 同步
- 冲突处理与修复：本地覆盖远端、远端覆盖本地、合并保存、仅绑定；提供健康检查与配置修复
- 自动同步：浏览器本地状态变更后自动写入 workspace gist，并可查看最近同步状态
- 节点与订阅管理：新增、编辑、启用/停用、标签、搜索与过滤
- 批量导入：支持多行导入节点或订阅，自动去重与预览；支持解析 base64 订阅内容
- 聚合规则：按节点/订阅选择、排除标签、协议类型过滤、正则表达式重命名、自动区域旗标
- 结果排序：支持按名称、协议、区域（旗标）自动排序，并支持通过关键词优先级或手动拖拽实现完全自定义排序
- 自定义区域规则：自定义区域旗标映射，内置模板导入与快速查找
- 发布目标：规则可绑定多个发布目标，支持文件名、描述、可见性设置
- 稳定订阅链接：同一 Gist + 同一文件名保持稳定 raw URL，改名时提供自动清理策略提示
- Workspace 文件管理：查看文件列表、复制 raw 链接、删除输出文件、批量清理非配置文件
- 自动清理机制：节点或订阅删除后，自动清理聚合规则中的无效关联，保持配置一致性
- 活动日志：记录 workspace 初始化、同步与修复操作

## 使用流程
1. 在 `/auth` 保存 GitHub Token（需要 `gist` 权限）并绑定 Workspace
2. 在 `/nodes` 添加节点与订阅（支持批量导入）
3. 在 `/aggregate` 创建规则，配置排序与重命名并预览输出
4. 创建发布目标并发布到 Workspace Gist，复制稳定订阅链接

## 页面说明
- `/auth`：Workspace 设置、冲突处理、健康检查、导入导出、同步状态
- `/gists`：Workspace 文件列表、raw 链接复制、文件清理
- `/nodes`：节点与订阅管理（搜索、筛选、批量导入）
- `/aggregate`：规则编辑、可视化拖拽排序、发布目标管理、聚合输出发布

## 聚合与发布细节
- 规则支持：节点/订阅选择、排除标签、协议类型过滤、正则表达式重命名映射
- 排序引擎：混合排序模式，支持优先级关键词与预览结果手动拖拽同步到配置
- 订阅内容：发布时拉取订阅链接，自动识别并解码 base64 内容
- 区域旗标：可开启自动识别节点名称中的地区关键字并添加旗标
- 输出预览：提供行数统计、协议识别、警告与错误提示，支持实时拖拽调整顺序
- 发布策略：保持文件名可维持稳定链接；改名会生成新稳定链接并提示旧文件清理策略

## Workspace 机制
- 保存 Token 后自动查找或创建固定标识的 Gist，并写入 `subman.json`
- 数据统一写入同一 Workspace Gist，配置文件受保护不可在 UI 中删除
- 冲突处理支持本地覆盖、远端覆盖、合并保存或仅绑定
- 提供健康检查与配置修复入口

## FAQ

### 自动同步会不会直接用本地内容覆盖远端？
不会直接覆盖。启用 Workspace 后，浏览器里的本地改动会触发自动同步；写入 Gist 前，SubMan 会先读取远端 `subman.json` 并和本地保存的同步基线比较。

- 如果远端没有变化，直接写入当前本地状态。
- 如果远端也发生了变化，SubMan 会基于“上次同步基线、本地状态、远端状态”做三方合并，再写回 Workspace Gist。
- 如果远端删除了某个条目，而本地只是保留了旧副本，自动合并会保留远端删除，不会把它恢复回 Gist。
- 如果自动同步过程中你又继续编辑，本次同步不会用旧快照覆盖新的本地编辑；新的本地编辑会保留，并在后续同步中继续处理。

### 哪些操作仍然会覆盖远端？
手动点击 Push Local / 推送本地，以及冲突处理里选择“本地覆盖远端”，会在确认后把当前本地状态写入 Workspace Gist。它们是显式覆盖操作，适合你确定本地数据就是最新来源时使用。

### 登录或重新绑定 Workspace 时发现本地和远端不同怎么办？
`/auth` 页面会显示冲突处理选项：

- Pull Remote / 远端覆盖本地：用远端数据替换本地视图。
- Push Local / 本地覆盖远端：把当前本地数据写入 Gist。
- Merge & Save / 合并保存：按条目 `updatedAt` 合并本地和远端后保存。
- Bind only / 仅绑定：只绑定 Workspace，不立即同步数据。

## 开发与构建
```bash
bun install
bun run dev
bun run preview
```

## Cloudflare Workers 部署
```bash
bun run build
bun run deploy
```

本地预览 Workers：
```bash
bun run dev:cf
```

## Server API
SubMan 可以为 `sing-box-vps` 这类后端脚本提供自用 API。完整接口文档见
[docs/api/server-api.md](docs/api/server-api.md)。

使用步骤：

1. 准备一个带 GitHub `gist` 权限的 Token。
2. 准备一个足够长的自定义 `SUBMAN_API_TOKEN`，供你的脚本调用 SubMan API。
3. 在 Cloudflare Worker 中写入 Secrets：

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

4. 部署 SubMan：

```bash
bun run build
bun run deploy
```

5. 检查 API 配置状态：

```bash
curl -sS "https://subman.example.com/api/health"
```

返回 `ok: true` 表示 `GITHUB_TOKEN` 和 `SUBMAN_API_TOKEN` 都已配置。

6. 在后端脚本中使用 `SUBMAN_API_TOKEN` 同步节点：

```bash
curl -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

推荐脚本使用 `PUT /api/nodes/by-key/:externalKey`，因为它是幂等接口：同一个
`externalKey` 重复调用会更新已有节点，不会产生重复节点。
通过 UI 或 API 新增/更新节点时，同名会自动追加时间后缀以便聚合筛选区分；
相同原始 URI 会被视为重复内容并拒绝保存。

`GITHUB_TOKEN` 只保存在 Cloudflare Secrets 中，外部脚本不需要也不应该持有 GitHub Token。
第一版 API 面向可信后端脚本调用，不默认开放浏览器跨域访问。

## AI / Agent 适配
本仓库提供面向 Codex、Hermes agents 等自动化 agent 的项目上下文与 skill：

- Agent Guide：[docs/agents/subman-agent-guide.md](docs/agents/subman-agent-guide.md)
- Project Skill：[docs/agents/subman-skill/SKILL.md](docs/agents/subman-skill/SKILL.md)

这些文档覆盖 Workspace Gist、Cloudflare Workers 部署、Server API 自动化调用、关键源码路径和开发边界。

## 技术栈
- SvelteKit + TypeScript
- TailwindCSS v4
- Biome
- bun

## License
GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).

## 约定
- 代码保持 ASCII 字符
- 每完成一个独立功能点或修复后立即提交
- 所有数据统一写入同一个 Workspace Gist
