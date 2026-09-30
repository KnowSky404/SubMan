# SubMan

[English README](README.en.md)

Gist-first、浏览器优先的代理订阅管理工具，支持 VLESS / VMess / TUIC / AnyTLS
等节点与订阅聚合。
SvelteKit 运行在 Cloudflare Workers 上，并由每个 Workspace 一个的 Durable Object
串行协调写入。核心目标是在一个固定的 GitHub Workspace Gist 内完成数据管理与稳定订阅发布。

默认 Workspace 标识：
- 描述：`SubMan-Data`
- 配置文件：`subman.json`

## 主要能力

- Workspace Gist：连接时发现固定标识的 Gist；多个候选需选择，旧版需确认迁移，找不到时创建私有 bootstrap Gist
- 本地与远端双模式：业务数据保存在浏览器 IndexedDB；有 Token 时可自动与 Gist 同步
- 冲突处理与修复：本地覆盖远端、远端覆盖本地、合并保存、仅绑定；提供健康检查与配置修复
- 自动同步：浏览器改动先进入持久化队列，再由 Cloudflare Durable Object 按版本顺序写入 Workspace
- 队列恢复：可区分活动与孤立 Workspace 队列，并按完整队列执行重试、丢弃、重新绑定或修复
- 节点与订阅管理：新增、编辑、启用/停用、标签、搜索与过滤
- 批量导入：支持多行导入节点或订阅，自动去重与预览；支持解析 base64 订阅内容
- 聚合规则：按节点/订阅选择、排除标签、协议类型过滤、正则表达式重命名、自动区域旗标
- sing-box 客户端导出：按明确的 sing-box 1.14 目标支持 VLESS、VMess、Trojan、Shadowsocks、Hysteria2、TUIC 与 AnyTLS；SSR 保留聚合但导出时给出跳过警告
- 结果排序：支持按名称、协议、区域（旗标）自动排序，并支持通过关键词优先级或手动拖拽实现完全自定义排序
- 自定义区域规则：自定义区域旗标映射，内置模板导入与快速查找
- 发布目标：规则可绑定多个发布目标，保存文件名、描述与可见性元数据；输出仍写入当前 Workspace Gist，其 GitHub 可见性由 Gist 本身决定
- 稳定订阅链接：同一 Gist + 同一文件名保持稳定 raw URL，改名时提供自动清理策略提示
- Workspace 文件管理：查看文件列表、复制 raw 链接、删除输出文件、批量清理非配置文件
- 自动清理机制：节点或订阅删除后，自动清理聚合规则中的无效关联，保持配置一致性
- 活动日志：记录 workspace 初始化、同步与修复操作

## 使用流程

无需 Token 即可在本地模式管理节点、订阅、规则并预览或下载输出；业务数据保存在
当前浏览器、当前站点的 IndexedDB 中，不会自动跨设备共享。若要同步与发布：

1. 在 `/auth` 保存 GitHub Token（需要 `gist` 权限；默认仅当前会话，勾选 Remember token 才持久化）并核对、绑定 Workspace
2. 在 `/nodes` 添加节点与订阅（支持批量导入）
3. 在 `/aggregate` 创建规则，配置排序与重命名并预览输出
4. 在 `/exports` 选择聚合规则，预览、复制或下载 sing-box 配置
5. 创建发布目标并发布到 Workspace Gist，复制稳定订阅链接

## 页面说明

- `/auth`：Workspace 设置、冲突处理、健康检查、导入导出、同步状态
- `/gists`：Workspace 文件列表、raw 链接复制、文件清理
- `/nodes`：节点与订阅管理（搜索、筛选、批量导入）
- `/aggregate`：规则编辑、可视化拖拽排序、发布目标管理、聚合输出发布
- `/exports`：sing-box 客户端配置预览、复制、下载与 Workspace 发布

## 聚合与发布细节

- 规则支持：节点/订阅选择、排除标签、协议类型过滤、正则表达式重命名映射
- 排序引擎：混合排序模式，支持优先级关键词与预览结果手动拖拽同步到配置
- 订阅内容：发布时拉取订阅链接，自动识别并解码 base64 内容
- 订阅拉取：浏览器端请求使用 15 秒超时和 4 MiB 响应上限，并区分 CORS/网络、HTTP、大小、编码和空内容问题
- 区域旗标：可开启自动识别节点名称中的地区关键字并添加旗标
- 输出预览：提供行数统计、协议识别、警告与错误提示，支持实时拖拽调整顺序
- sing-box 导出：TUIC 与 AnyTLS 使用当前 sing-box 字段映射；SSR 和未知/非法行不会阻断其他可转换节点
- 发布策略：保持文件名可维持稳定链接；改名会生成新稳定链接并提示旧文件清理策略

## Workspace 机制

- 保存 Token 后自动查找固定标识的 Gist；新 Gist 先创建 bootstrap 标记，首次协调器提交再写入 `subman.json`
- 数据统一写入同一 Workspace Gist；`subman.json`、`subman.v1.backup.json`、`subman.bootstrap.json` 都是保留文件，不可作为发布输出或在文件页删除
- 浏览器与 Server API 的配置变更统一交给每个 Workspace 一个的 Durable Object 串行提交
- `subman.json` 只能由协调器写入；配置、发布输出与删除输出均通过带版本的 mutation 提交
- 设置页提供“手动迁移工作区”：可重新查找所有 Workspace 或指定旧 Gist ID，只读检查后确认迁移
- 连接可识别的旧版 Workspace 时显示迁移预览；点击“迁移并加载工作区”后在原 Gist 内升级并保留字节级 `subman.v1.backup.json`
- 迁移保留原输出文件名、内容、发布时间和发布 URL，不需要替换客户端中的稳定订阅链接
- 冲突处理支持本地覆盖、远端覆盖、合并保存或仅绑定
- 提供健康检查与配置修复入口

部署、迁移验证与回滚流程见 [Workspace V2 Operations](docs/workspace-v2-operations.md)。
升级后看不到历史规则或发布记录时，先按
[旧版数据排查与迁移指南](docs/legacy-workspace-migration.md)
核对 Gist 身份、配置格式和输出文件；其中包含离线检查与 V1 配置转换步骤。
当前阶段与延后项见 [Roadmap](docs/ROADMAP.md)。
sing-box 协议矩阵、订阅 CORS/大小限制与导出发布边界见
[sing-box Export](docs/sing-box-export.md)。

## FAQ

### Gist 中还有旧输出，为什么看不到原来的规则或发布目标？

规则和最后一次发布记录来自 `subman.json` 的 `aggregates`、`publishTargets`
（sing-box 导出使用 `clientExports`），不会从输出文件自动重建。
早期版本没有持久化发布目标；旧配置也可能因固定 Gist 标识、严格校验或浏览器缓存迁移
而未加载。先备份并查看[迁移指南](docs/legacy-workspace-migration.md)，
不要用空白本地数据覆盖旧 Gist。正常 V1 有自动迁移，但不保证任意历史文件均可读取。

### 自动同步会不会直接用本地内容覆盖远端？

不会直接覆盖。启用 Workspace 后，浏览器先把每个本地业务操作写入持久化队列，再按 `expectedRevision` 发送给 Workspace 协调器。

- 协调器只接受当前版本上的下一次变更，并在同一个 Gist PATCH 中提交配置和发布文件。
- 网络失败会保留同一个 mutation ID 并重试，不会把一次操作重复提交两次。
- 如果远端版本已变化，队列会保留，自动同步暂停，并显示冲突处理界面。
- 如果同步过程中继续编辑，后续队列项会在最新已提交基线上重放，较新的本地编辑不会被旧响应覆盖。

### 哪些操作仍然会覆盖远端？

手动点击 Push Local / 推送本地时，SubMan 会先读取远端 `subman.json` 并和本地同步基线比较：

- 如果远端没有变化，会在确认后推送当前本地状态。
- 如果远端已经变化，不会直接覆盖，而是提示你选择 Pull Remote、Merge & Save 或 Force Push。
- 只有选择 Force Push / 强制推送，或登录冲突处理中明确选择“本地覆盖远端”，才会覆盖远端数据。

这些覆盖操作仍受 revision 与墓碑约束，不能复活远端已删除 ID；可能移除远端现存实体。仅在确认本地数据是预期来源并保存恢复来源后使用。

### 登录或重新绑定 Workspace 时发现本地和远端不同怎么办？

`/auth` 页面会显示冲突处理选项：

- Pull Remote / 远端覆盖本地：用远端数据替换本地视图。
- Push Local / 本地覆盖远端：把当前本地数据写入 Gist。
- Merge & Save / 合并保存：基于可信同步基线进行三方合并；删除墓碑优先，`updatedAt` 不授予覆盖权限。
- Bind only / 仅绑定：只绑定 Workspace，不立即同步数据。

## 开发与构建

使用 `package.json` 与 CI 声明的 Bun **1.3.14**，保留 `bun.lock`：

```bash
bun install --frozen-lockfile
bun run dev -- --host :: --port 5173
```

Vite 适合 UI 开发；协调器、SQLite 和 Worker 路由验证使用 `dev:cf`。
构建后的预览需先构建，在另一终端或停止开发服务后运行：

```bash
bun run build
bun run preview -- --host :: --port 4173
```

本 VPS 访问地址分别为 `http://oc-de-fra-1.knowsky.uk:5173` 和
`http://oc-de-fra-1.knowsky.uk:4173`。检查 `ss -lntp` 中实际监听地址；
若只有 IPv6，需另用 `--host 0.0.0.0` 验证 IPv4。

完整本地检查：

```bash
bun test
bun run test:sing-box
bun run check
bun run lint
bun run build
bun run test:cf
bun run test:e2e
bun run deploy:check
```

`check` 已包含生成的 Worker 类型一致性检查；变更绑定后先运行
`bun run generate:worker-types`。`test:sing-box` 需要 Docker；E2E 首次运行前用
`bunx playwright install --with-deps chromium` 准备 Chromium 与系统依赖。

GitHub Actions 在 `main` push 和 pull request 上执行同一检查链，其中导出门禁使用
固定摘要的 sing-box 1.14.0 容器与纯合成数据；流程不读取仓库 Secret，也不执行部署、
真实订阅请求或真实 Gist 操作。

## Cloudflare Workers 部署

部署前完成上述门禁，核对账号、Worker、路由和绑定。部署脚本已包含构建并使用
Wrangler `--strict`；仅在明确授权生产变更后执行：

```bash
bun run deploy
```

本地预览 Workers：
```bash
bun run dev:cf -- --ip :: --port 8787
```

本 VPS 访问 `http://oc-de-fra-1.knowsky.uk:8787`。这是本地模拟运行时；不要配置真实
GitHub Token 来测试写入。本地单元、Cloudflare 与浏览器测试使用合成数据或 mock。
`deploy:check` 只验证打包，不上传 Worker，也不证明生产资源正常。
GitHub Actions 的生产部署仅由手动触发流程执行，详情见 [CI/CD](docs/ci-cd.md)。

Worker 已启用结构化 Observability 日志。应用日志只包含 allowlist 中的
操作、revision、错误分类和 GitHub 安全元数据；Workspace 标识使用哈希，
不会记录 Token、原始 mutation、完整文档、输出或异常消息。类型生成使用
`bun run generate:worker-types`，兼容日期只有在完整运行时门禁通过后才调整。

## Server API

SubMan 可以为 `sing-box-vps` 这类后端脚本提供自用 API。完整接口文档见
[docs/api/server-api.md](docs/api/server-api.md)，机器可读契约见
[docs/api/openapi.yaml](docs/api/openapi.yaml)，公共 API 的后续资源扩展设计见
[API Roadmap](docs/api/roadmap.md)。

使用步骤：

1. 准备一个带 GitHub `gist` 权限的 Token。
2. 准备一个足够长的自定义 `SUBMAN_API_TOKEN`，供你的脚本调用 SubMan API。
3. 在 Cloudflare Worker 中写入 Secrets：

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

4. 确认生产变更授权后部署 SubMan（Secrets 写入也会改变远端 Worker）：

```bash
bun run deploy
```

5. 检查 API 配置状态：

```bash
curl -sS "https://subman.example.com/api/health"
```

返回 `ok: true` 表示 `GITHUB_TOKEN` 和 `SUBMAN_API_TOKEN` 都已配置。

6. 在后端脚本中使用 `SUBMAN_API_TOKEN` 同步节点：

```bash
curl --fail-with-body -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

推荐脚本使用 `PUT /api/nodes/by-key/:externalKey`，因为同一个 `externalKey`
始终定位同一个节点，不会产生重复节点。它是资源身份幂等，不是请求重放幂等：
每次成功更新仍会推进 Workspace revision；当前 API 不支持 `Idempotency-Key`。
通过 UI 或 API 新增/更新节点时，同名会自动追加时间后缀以便聚合筛选区分；
相同原始 URI 会被视为重复内容并拒绝保存。

节点 API 写请求的 `2xx` 表示协调器已经提交并回读验证远端 Workspace。成功响应包含
`ETag: "subman-revision-<revision>"` 和 `X-SubMan-Revision`；写请求可携带上一轮
响应的 `ETag` 作为 `If-Match`，过期时返回 `412 precondition_failed`，避免基于旧版本更新。
写请求超时、5xx 或响应丢失都可能发生在提交之后；先读取节点和 revision，再按完整文档中的
方法级重试规则处理。

按键 PUT 会替换节点的可写字段；省略的标签、启用状态和来源使用创建默认值。
外部键只做一次 URL 编码，新建或改动的键最多 119 个 UTF-8 字节，普通标签最多 63 个，
其余空间留给自动生成的 `external:` 标签。PATCH 的 `tags` 会替换全部标签并移除键标记，
维护机器节点标签应使用按键 PUT。节点更新不会重新发布聚合或 sing-box 输出。

API 根据 Worker 的 GitHub Token 独立发现 Workspace，不读取浏览器绑定；调用前核对
响应的 `workspace.gistId`。节点 GET 在找不到 Workspace 时也可能创建 bootstrap Gist；
多个或无效候选会返回 `502 gist_read_failed`。健康检查只核对 Secrets 是否存在，
HTTP 200 或 `ok: true` 都不证明 GitHub 权限或远端可写。

`GITHUB_TOKEN` 只保存在 Cloudflare Secrets 中，外部脚本不需要也不应该持有 GitHub Token。
`SUBMAN_API_TOKEN` 是单一全权限共享 Bearer，不提供 scope、单客户端撤销或内置调用方限流；
只应通过 TLS 交给可信后端脚本，并定期轮换。CORS 不是鉴权边界。

当前受支持的公共集成面仅包括健康检查和节点 CRUD/按 external key 更新。订阅、聚合、
发布与导出尚无公共 REST API；外部程序不得直接 PATCH Gist，也不得调用浏览器内部的
`/api/workspaces/:workspaceId/mutations` 协议。

## 浏览器存储与安全

- Workspace 快照、绑定、每个 Workspace 的队列、重试/阻塞状态、租约和迁移证据原子保存在
  `subman-workspace` IndexedDB v1 中。
- 旧 localStorage 数据按 `copied -> validated -> confirmed` 阶段迁移；存储不可用、升级失败、
  配额不足或数据损坏时进入只读修复状态，不会回退到非原子写入。
- GitHub Token 不进入 IndexedDB、mutation、诊断、日志或 Durable Object SQLite。
  默认仅保存在当前 session；只有显式选择 Remember token 才持久化。
- 持久化 Token 可被同源 JavaScript 读取，活动型 XSS 能窃取它；浏览器端加密不能消除该风险。
- 页面业务操作以 `completion` 判定结果；`submitted` 不证明保存。排队、其他标签页接管或
  预约重试均不等于发布成功；只有 `remote-committed` 证明已保存到 Workspace。
- 设置页业务配置导出用于备份与导入，不包含 Workspace revision、墓碑、队列或认证信息，
  不能直接替换远端 `subman.json`。诊断导出只有安全元数据，不能恢复业务数据。
- 诊断导出仅包含计数、安全元数据、payload 长度与 SHA-256、重试/错误分类及隔离区元数据，
  不读取或导出隔离原文、代理 URI、订阅 Token、输出内容、错误堆栈或凭据。
- Worker 响应使用 CSP、`frame-ancestors`、Referrer-Policy、X-Content-Type-Options 和
  Permissions-Policy。请求与 Workspace 字段均有 UTF-8 字节/数量限制；旧版超限字段可保留，
  但新建或编辑字段必须满足当前限制。

浏览器迁移、队列修复、诊断、安全检查和回滚细节见
[Workspace V2 Operations](docs/workspace-v2-operations.md)。

## AI / Agent 适配

本仓库提供面向 Codex、Hermes agents 等自动化 agent 的项目上下文与 skill：

- Agent Guide：[docs/agents/subman-agent-guide.md](docs/agents/subman-agent-guide.md)
- Project Skill：[docs/agents/subman-skill/SKILL.md](docs/agents/subman-skill/SKILL.md)
- sing-box Export：[docs/sing-box-export.md](docs/sing-box-export.md)

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
- Workspace 模式的业务配置与输出统一写入同一个 Gist；本地模式保存在浏览器 IndexedDB
