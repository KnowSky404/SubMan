# SubMan

[English](README.md) | 简体中文

[文档目录](docs/README.zh-CN.md) · [Server API](docs/api/server-api.zh-CN.md) · [sing-box-vps 集成](docs/integrations/sing-box-vps.zh-CN.md)

代理订阅管理工具，支持 VLESS / VMess / TUIC / AnyTLS 等节点与订阅聚合、
sing-box 客户端导出和可信后端自动化 API。基于 SvelteKit 与 Cloudflare Workers，
业务数据保存在一个私有 GitHub Gist 中，由 SQLite-backed Durable Object 协调每次带版本的写入。

默认 Workspace 标识：

- 描述：`SubMan-Data`
- 配置文件：`subman.json`

## 主要能力

- 单一云端数据源：连接并固定到一个私有 GitHub Gist，`subman.json` 是业务数据的唯一权威来源
- 云端加载：每次启动先读取最新云端数据，完成连接和加载后才能编辑
- 即时同步：每次变更先进入持久化发送日志，再立即交给 Cloudflare Durable Object 按版本提交；云端确认后才报告保存成功
- 同步恢复：网络失败保留原请求重试；版本冲突需确认丢弃整组待同步变更并重新加载云端
- 单一绑定：取消工作区列表与切换；历史队列和修复证据保留在恢复面板中
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

先连接 GitHub 并加载云端数据，再管理节点、订阅和规则。应用不提供本地业务模式、
业务 JSON 备份或恢复、手动推送或合并覆盖。浏览器缓存和发送日志仅用于同步可靠性。

1. 在 `/auth` 保存 GitHub Token（需要 `gist` 权限；默认仅当前会话，勾选 Remember token 才持久化），核对唯一 Gist 并等待云端加载完成。首次连接可指定 Gist ID；发现多份数据时必须填写原 ID，不自动选择或另建一份
2. 在 `/nodes` 添加节点与订阅（支持批量导入）
3. 在 `/aggregate` 创建规则，配置排序与重命名并预览输出
4. 在 `/exports` 选择聚合规则，预览、复制或下载 sing-box 配置
5. 创建发布目标并发布到 Workspace Gist，复制稳定订阅链接

## 页面说明

- `/auth`：云端连接、同步状态、重新加载云端、旧版升级与安全诊断
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

- 首次连接按固定标识发现 Gist，也可明确填写原 Gist ID；没有候选才创建空的私有 bootstrap Gist，多份候选或无效目标不会自动创建或覆盖
- 设备绑定一个 Gist，重新登录仍使用原 ID；取消工作区列表、切换和重新绑定入口
- 每次启动先加载最新云端快照；旧版手动同步状态在安全加载后恢复为自动同步，缓存不能作为新的业务数据源
- 浏览器与 Server API 的变更统一交给 `WorkspaceCoordinator`；只有协调器能写 `subman.json`，配置和输出在同一个带版本的提交中更新
- 每次业务操作立即发送并等待云端确认；待发送、其他标签页接管和预约重试均不算保存成功，未完成请求仍保留原 mutation ID
- 同步失败或冲突期间阻止追加业务变更。恢复连接后重试原请求；需要放弃待发送内容时，确认丢弃完整队列并重新加载最新云端，不提供本地覆盖或合并
- `subman.json`、`subman.v1.backup.json`、`subman.bootstrap.json` 是保留文件，不可用作输出或从文件页删除
- 识别到旧版 V1 时先预览，再确认在原 Gist 升级；保留字节级 V1 备份和原输出的文件名、内容、发布时间与 URL
- 新连接的 bootstrap 从空云端数据开始，不上传旧浏览器缓存。历史其他 Gist 的队列只作为保留的恢复证据，不会切换到该 Gist 或自动发送

部署、迁移验证与回滚流程见 [Workspace V2 Operations](docs/workspace-v2-operations.zh-CN.md)。
升级后看不到历史规则或发布记录时，先按
[旧版数据排查与迁移指南](docs/legacy-workspace-migration.zh-CN.md)
核对 Gist 身份、配置格式和输出文件；其中包含仅供维护者使用的离线检查与 V1 恢复步骤。
当前阶段与延后项见 [Roadmap](docs/ROADMAP.zh-CN.md)。
sing-box 协议矩阵、订阅 CORS/大小限制与导出发布边界见
[sing-box Export](docs/sing-box-export.zh-CN.md)。

## FAQ

### Gist 中还有旧输出，为什么看不到原来的规则或发布目标？

规则和最后一次发布记录来自 `subman.json` 的 `aggregates`、`publishTargets`
（sing-box 导出使用 `clientExports`），不会从输出文件自动重建。
早期版本没有持久化发布目标；旧配置也可能因固定 Gist 标识、严格校验或浏览器缓存迁移
而未加载。先备份并查看[迁移指南](docs/legacy-workspace-migration.zh-CN.md)，
不要用空白本地数据覆盖旧 Gist。可识别 V1 需要确认升级，不保证任意历史文件均可读取。

### 云端和浏览器缓存不一致时，以哪份为准？

以云端 `subman.json` 为准。启动或点击“重新加载云端数据”时读取最新数据，普通连接不会上传旧缓存。每次变更带上 `expectedRevision`，协调器只接受当前版本上的下一次变更，远端已删除的 ID 也不会因旧缓存被恢复。

### 网络断开后，刚才的操作会丢失或被重复发送吗？

通过本地事务的请求保留在技术发送日志中，恢复连接后继续使用同一个 mutation ID。界面不会把排队、重试或其他标签页接管显示成保存成功；只有 `remote-committed` 证明云端提交。待同步请求处理完之前不能继续新增业务变更，不需要导出或恢复 JSON。

### 其他设备修改了相同的云端数据怎么办？

版本冲突会暂停发送并保留待同步内容。先核对恢复面板，再确认是否丢弃完整待同步队列并重新加载云端，之后基于最新数据重做所需修改。应用不再提供本地覆盖、合并保存、仅绑定或手动同步模式。

### 账号里有多个 SubMan Gist 怎么办？

首次连接填写要保留的原 Gist ID，不会显示多个工作区供日常切换。已有绑定始终固定到原 ID，换 Token 或原 Gist 暂时不可访问都不会悄悄改绑或新建 Gist。历史其他 Gist 的未发送队列仍保留在恢复面板，不会自动发送。

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
GitHub Actions 的生产部署仅由手动触发流程执行，详情见 [CI/CD](docs/ci-cd.zh-CN.md)。

Worker 已启用结构化 Observability 日志。应用日志只包含 allowlist 中的
操作、revision、错误分类和 GitHub 安全元数据；Workspace 标识使用哈希，
不会记录 Token、原始 mutation、完整文档、输出或异常消息。类型生成使用
`bun run generate:worker-types`，兼容日期只有在完整运行时门禁通过后才调整。

## Server API

服务器自动化脚本可从 [sing-box-vps 集成指南](docs/integrations/sing-box-vps.zh-CN.md) 开始，
其中包含调用方限制、版本校验、条件删除和写入结果不确定时的恢复步骤。

SubMan 可以为 `sing-box-vps` 这类后端脚本提供自用 API。完整接口文档见
[docs/api/server-api.zh-CN.md](docs/api/server-api.zh-CN.md)，机器可读契约见
[docs/api/openapi.yaml](docs/api/openapi.yaml)，公共 API 的后续资源扩展设计见
[API Roadmap](docs/api/roadmap.zh-CN.md)。

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
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://11111111-1111-4111-8111-111111111111@vps.example.com:443?security=tls&sni=vps.example.com#vps-1","enabled":true,"tags":["sing-box-vps"]}'
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
- 设置页不提供业务 JSON 备份与导入。历史 `subman-business-configuration` 文件不是远端 Workspace 文档，
  不能替换 `subman.json`；诊断导出也不能恢复业务数据。
- 诊断导出仅包含计数、安全元数据、payload 长度与 SHA-256、重试/错误分类及隔离区元数据，
  不读取或导出隔离原文、代理 URI、订阅 Token、输出内容、错误堆栈或凭据。
- Worker 响应使用 CSP、`frame-ancestors`、Referrer-Policy、X-Content-Type-Options 和
  Permissions-Policy。请求与 Workspace 字段均有 UTF-8 字节/数量限制；旧版超限字段可保留，
  但新建或编辑字段必须满足当前限制。

浏览器迁移、队列修复、诊断、安全检查和回滚细节见
[Workspace V2 Operations](docs/workspace-v2-operations.zh-CN.md)。

对已下载的配置执行离线检查：

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json --gist-id YOUR_GIST_ID
```

此命令不发起网络请求，只检查格式和身份，不验证输出内容、URL 可用性或发布新鲜度。
[旧版迁移指南](docs/legacy-workspace-migration.zh-CN.md) 说明了维护者恢复、V1 升级和旧订阅链接保留流程。

## 文档与语言

文档默认使用英文。点击现行指南顶部的 **简体中文** 可切换到中文版本；
[文档目录](docs/README.zh-CN.md) 列出了 README、API、集成、运维、迁移、导出、路线图
和 Agent 指南的两种语言。`README.en.md` 保留为英文 README 的兼容入口。
历史设计和实施计划保留原语言，描述其记录日期的方案；当前行为以现行指南为准。

## AI / Agent 适配

本仓库提供面向 Codex、Hermes agents 等自动化 agent 的项目上下文与 skill：

- Agent Guide：[docs/agents/subman-agent-guide.zh-CN.md](docs/agents/subman-agent-guide.zh-CN.md)
- Project Skill：[docs/agents/subman-skill/SKILL.zh-CN.md](docs/agents/subman-skill/SKILL.zh-CN.md)
- sing-box Export：[docs/sing-box-export.zh-CN.md](docs/sing-box-export.zh-CN.md)

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
- 业务配置与输出统一写入绑定的同一个云端 Gist；IndexedDB 只保留缓存、发送日志与恢复证据
