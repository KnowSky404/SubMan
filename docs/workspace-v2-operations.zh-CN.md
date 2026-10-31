# Workspace V2 运维

[English](workspace-v2-operations.md) | 简体中文

本手册涵盖 Workspace Schema V2 协调器的部署、首次写入迁移、验证和回滚。

## 运行时契约

- `subman.json` 是唯一权威业务文档；`gist:<gist-id>` 对应一个 SQLite-backed
  `WorkspaceCoordinator` Durable Object。
- 所有能改变配置的浏览器和 Server API mutation 经过协调器；公共 API 契约不变，
  浏览器 mutation 是内部协议，页面/API 不直接 PATCH 配置。
- 浏览器只绑定一个云端 Gist，没有工作区列表/切换。重绑和队列修复事务也拒绝替换已有绑定，
  包括跨标签页与旧恢复路径。用户确认的设备重置可先明确移除绑定，再单独重新连接；
  重置本身不选择或新建替代 Gist。
- 启动先读取最新云端再开放业务编辑；登录/替换 token 保留原 ID。
  原 Gist 查询失败不能另选/新建；初次发现多份候选必须填写原 ID。
- `subman-workspace` IndexedDB v1 通过 `WorkspacePersistence` 在同一事务中保存缓存、
  journal、重试、租约和历史队列证据；它们是技术恢复状态，不是本地业务模式或第二数据源。
- 业务变更需要认证、最新自动绑定、无未解决发送；先写 journal 再立即发送并等云端确认。
  pending/manual/paused/disconnected 状态拒绝新增业务变更。
- 设置提供云端重载/恢复，没有本地推送、合并、覆盖、仅绑定、手动同步或业务 JSON 备份/导入。
  新 bootstrap 从空云端开始，不上传旧缓存。
- `subman.v1.backup.json`、`subman.bootstrap.json` 是保留恢复文件，输出不能替换或删除。
- 协调器支持 node/subscription/aggregate/publish-target/client-export upsert/delete、
  聚合和客户端发布、`output.delete`、`workspace.bootstrap.cleanup`、显式
  `workspace.migrate` 和内部 `workspace.reconcile`。

Wrangler 绑定 `WORKSPACE_COORDINATOR`，以 migration tag `v1` 创建 SQLite 类。
已应用 tag 是不可变部署历史，不能删除/改名。

## 浏览器操作结果

历史 manual 或冲突暂停队列不自动发送，用确认后的 **Reload from Cloud** 恢复；
升级不能发布旧浏览器快照。

`submitted` 只表示同步校验接受并安排异步任务，不证明 IndexedDB、队列或远端写入。
页面必须等待 `completion` 才清空草稿、关闭编辑器或报告成功。
延后结果可结束当前加载动画，但保留草稿及原 mutation。

| 完成状态 | 持久证据 | 页面含义 |
| --- | --- | --- |
| `local-durable` | 旧兼容本地快照已提交 | 不算云端保存；当前云端业务操作不产生此结果，保留草稿 |
| `local-durable-queued` | 快照与原 mutation 已进入 IndexedDB | 待云端确认，保留草稿/journal |
| `peer-owned` | 原请求在队列，其他有效租约负责发送 | 其他标签页同步中，非终态 |
| `retry-scheduled` | mutation、重试次数/时间/错误码持久化 | 延后或等待重试，非终态 |
| `remote-committed` | 协调器结果与本地 binding/baseline/snapshot/队列结算一致 | 唯一保存/发布成功结果 |
| `conflict-or-blocked` | 原 mutation 及 disposition/错误码保留 | 等待处理或修复 |
| `rejected-before-durable-commit` | 未建立可靠本地事务 | 未保存，保留草稿并显示一次最终错误 |
| `commit-acknowledgement-uncertain` | 核心事务可能已提交，无法重读证据 | 不得声称未保存；先重载再判断，避免重复提交 |

共享 presenter 解释全部结果；store 不发操作 toast，页面不从异常文案推断状态。
只有 `remote-committed` 完成草稿；其他持久状态保留身份并阻止更多业务编辑。
每次操作前重读 IndexedDB，校验就绪认证、无 pending/blocked，再对最新已验证云端缓存应用意图。
其他标签页推进 binding 时允许以同 mutation ID/时间做一次有界重放；这不是存储损坏，不能隔离。
BroadcastChannel/Web Locks 只是提示，持久记录、租约、fencing token、revision/序列保证正确性。

核心事务提交后，缓存刷新、释放租约或广播失败不能降为“拒绝保存”。
运行时重读 IndexedDB 证明提交；仍无法证明则返回 acknowledgement uncertainty，不能生成替代 mutation。

## 部署前门禁

使用 Bun 1.3.14 与冻结锁文件；sing-box 需要 Docker，E2E 需要 Chromium。
`check` 包含 Worker 类型校验。

```bash
bun install --frozen-lockfile
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

启动本地 Cloudflare 运行时，在另一终端检查健康和未认证 mutation：

```bash
bun run dev:cf -- --ip :: --port 8787
curl -fsS "http://127.0.0.1:8787/api/health" | jq .
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:8787/api/workspaces/smoke/mutations")" = "401"
```

VPS 浏览器地址为 `http://oc-de-fra-1.knowsky.uk:8787`，用 `ss -lntp` 核对 IPv4/IPv6。
本地默认模拟 binding/DO 存储；没有 secrets 时健康 HTTP 200 且 `ok: false` 属预期，
不是生产就绪证据。`test:cf` 通过真实 Worker/DO/SQLite 路径、模拟 GitHub I/O 验证认证变更。
不要给一次性本地迁移 fixture 配置生产 GitHub 凭据。
CI 使用只读仓库权限执行这些门禁，不接收部署凭据，不部署/访问真实 Gist。

## 生产部署

1. 核实 Worker secrets `GITHUB_TOKEN`、`SUBMAN_API_TOKEN`，不写入 `wrangler.toml`。
2. 私人保留受控迁移工作区的当前 `subman.json`。
3. 运行完整部署前门禁和 dry-run。
4. 通过 `bun run deploy` 一起部署 Worker 和 DO migration。
5. 检查健康是否仅报告两个 secret 已配置：

   ```bash
   curl -fsS "$SUBMAN_ORIGIN/api/health" | jq -e '.ok == true and
   .config.githubToken == true and .config.submanApiToken == true'
   ```

6. 用一个受控工作区执行首次浏览器或 Server API mutation。
7. 检查下述 Gist 迁移证据后再扩大使用。

部署和真实 Gist 修改需要明确授权。历史 `c89a60b` 是曾验证的 V1 行为兼容产物，
保留 `v1` migration/binding/class；复用前必须在当前环境重新验证。
健康 secret 存在不证明 GitHub 权限、上游状态或工作区可写。

## 首次写入迁移

发现 V1 时不改写。首个成功协调器 mutation 在同一经验证 PATCH 中：

1. 把原 `subman.json` 精确字节复制到 `subman.v1.backup.json`。
2. 转成 V2 业务集合。
3. 应用请求变更。
4. 一起写入新配置和任何请求发布输出。

浏览器绑定/替换缓存前显示 V1 升级预览，可取消、重新检查或 **Migrate and load Workspace**。
初次设置可指定原 ID；独立旧版检查仅在未绑定时接受明确 ID，只读且不创建 Gist。
已绑定设备不扫描/切换；描述、文件名、格式和身份校验仍适用。没有本地备份下载或 JSON 导入，
旧本地证据保留给维护者，不静默上传或替换云端。

内部 `workspace.migrate` 仅带预览 V1 原始字节的 `sourceSha256`，不改业务实体/发布元数据，
也不写输出文件，保留原 Gist、文件名、内容、时间和 URL，包括无目标引用的输出。
协调器在 journaling/写入前再次核 hash；源变化或 schema 变化返回 `revision_conflict`，需重新检查。
浏览器先持久化 envelope，重试复用原 ID，不发送无关 pending 或丢 dead-letter。
只有 `remote-committed` 关闭预览并报告完成。该 mutation 与
`/api/workspaces/:workspaceId/mutations` 都不是第三方集成接口。

只支持严格解析器接受的 V1，不支持任意历史文件。缺失旧可选集合、`allowedTypes`、
文件切换字段可规范化；未知字段、错误时间、重复 ID、悬空引用拒绝。
Gist 描述必须精确为 `SubMan-Data`。旧浏览器快照用当前完整校验，可能隔离某些 Gist V1 可读形状。
输出不能重建发布目标，详见[迁移指南](legacy-workspace-migration.zh-CN.md)。
已有备份不匹配时报 `migration_backup_conflict`，调查前不替换。
新工作区只有 `subman.bootstrap.json`，首次 mutation 同一 PATCH 创建 V2 并删标记。

## 浏览器持久化迁移

`subman-workspace` v1 只有一个事务根 `workspace-state`，包含：

- 已验证快照、绑定和 baseline。
- 各工作区有序 mutation、retry/blocked/dead-letter。
- dispatcher 租约和下一个 fencing token。
- 安全隔离元数据与不可由普通检查读取的原始修复数据。
- 迁移阶段和时间。

Token 不进入该数据库。默认 sessionStorage；明确选择 Remember token 才用 localStorage，
仍可被同源 JavaScript 读取，不防活跃 XSS。
初始化迁移 `subman:state:v1`、`subman:workspace-state:v2`、
`subman:workspace-mutation-queue:v1` 和旧隔离记录。
`not-started`、`copied`、`validated`、`confirmed` 均为事务边界，
确认前校验身份、schema、唯一 ID 和连续 expectedRevision；非法记录隔离，不静默丢弃。
确认前旧键是回滚来源，确认后删除旧键，IndexedDB 保留缓存/证据；云端仍是权威。
不支持 IndexedDB、升级/配额/事务失败或损坏时进入 `invalid-local-storage` 只读修复，
不清存储、不退到 localStorage 分散写入、不在调查前恢复发送。

## 队列检查和修复

按原工作区报告 active/total/orphan/blocked/dead-letter 技术证据；
旧 orphan 队列不因移除切换而删除、重绑或自动发送，保留到明确整队丢弃或独立维护者恢复。
各运行时统一使用以下指标：

- `activeQueueCount`：当前工作区 pending 数。
- `totalQueueCount`：全部工作区 pending 数。
- `orphanedWorkspaceCount`：非当前且保留 pending/blocked/dead-letter 的工作区数。
- `blockedMutationCount`：带 blocked 元数据的工作区队列数。
- `deadLetterCount`：全部 retained dead-letter 数。

- **Sync from Cloud**：先以原 ID 恢复符合条件的发送，再读云端；保留 retry 时间和 blocked，未解决队列阻止成功刷新。
- **Reload from Cloud**：丢弃当前全部未确认变更前必须确认；校验原 Gist，原子替换整队和缓存。
- **Retained previous queues**：只显示安全元数据，丢弃整组选中队列，不切换绑定/业务模式。
- **Repair**：完整有效序列和 snapshot/binding/queue compare-and-swap；刷新与编辑竞争时拒绝并重读，不静默丢新请求。
- **Quarantine**：冻结损坏数据，普通检查/诊断只保留元数据。

状态冲突保留可信云端和 pending，可确认整队丢弃、重载后重新编辑。
domain conflict/修复证据继续阻塞；时间戳不赋予覆盖权，墓碑仍有效。
退出登录只清认证并停止发送，不删绑定、缓存、mutation 身份或证据。

## 原 Gist 不可用时重置设备

普通重新连接继续锁定原 Gist。404 不能证明它已删除，也可能是缺少访问权限；
若希望恢复原数据，应先检查 Token 和原 Gist。用户主动删除原 Gist，或决定放弃当前本地连接时，
可在设置中选择**重置此设备**，无需先登录或成功加载云端。

用户必须确认丢弃当前本机业务缓存和完整当前队列，建议先关闭其他 SubMan 标签页。
重置通过一个 `WorkspacePersistence` 事务比较已检查的 binding、snapshot 和当前 queue，
拒绝尚未到期的当前 dispatcher 租约，然后清除当前绑定与完整队列，并写入空的未绑定快照。
历史 orphan 队列、隔离元数据与不可直接访问的原始证据、单调分配的 fencing 计数继续保留。
迁移状态标记为完成，避免旧 localStorage 重新恢复已放弃的绑定或缓存。

发起重置的标签页仅在事务提交后清除认证；同源其他标签页重读持久状态。
延迟返回的云端读取、已捕获的队列头和发送回执不得恢复旧绑定，即使跨标签页通知不可用，
持久 compare-and-swap 与 fencing 校验也必须保证这一点。
发送中或并发变化导致拒绝时，应等待或刷新后重新确认；存储不可用或失败时保持关闭编辑，
不报告成功。

重置不发送 GitHub 或协调器 mutation 请求，不删除云端文件，也不自动重新连接。
用户随后重新输入 Token 并点击**连接**，未绑定发现流程才会加载已有云端数据，
或创建空的私有 bootstrap Gist 并由协调器完成初始化；已丢弃的浏览器缓存不会成为上传来源。
历史队列的安全证据仍可在“同步恢复”中查看，不会自动重绑或发送。

## 租约、重试和上游故障

dispatcher 持久租约含随机 owner、单调 fencing token、到期和 heartbeat；
请求前及每次 await 后检查 fence，过期/替代 owner 不能发送下一项。
Web Locks 降低争用、BroadcastChannel 唤醒同伴，均非正确性前提。
网络、超时、408/429、GitHub 5xx 保留同 ID，以持久有界指数退避+jitter 重试；
安全 Retry-After/rate-limit reset 为下限。GitHub 元数据、截断 raw 读取、PATCH、
浏览器 mutation 都有超时。认证失败等重连，永久上游/domain/队列/维护者错误不做通用 5xx 重试。

## 失败分类

| Disposition | 常见原因 | 操作 |
| --- | --- | --- |
| `state-conflict` | revision/身份冲突且有可信最新文档 | 检查 pending，确认整队丢弃并重载 |
| `domain-conflict` | 重复资源、输出所有权、实体冲突 | 编辑、丢弃或调整阻塞请求 |
| `auth-required` | GitHub 401/403、token 缺失/撤销 | 重连，不按 5xx 重试 |
| `queue-corruption` | mutation ID 复用、响应非法、revision 断层 | 冻结并明确修复/隔离 |
| `operator-repair` | 备份、恢复、commit-index、journal、未知内部失败 | 保持只读，按手册处理 |
| `retryable-upstream` | 网络、超时、408、429、GitHub 5xx | 保留队列，按持久退避 |
| `permanent-upstream` | GitHub 404、非 domain 的 409/422 | 停止发送，修复上游/工作区 |
| `invalid-request` | JSON/schema/mutation/大小错误 | 改输入，不原样重试 |

只有 `state-conflict` 可包含已验证最新文档/revision；错误响应仅稳定码、分类和有界网关元数据，
不含 GitHub 响应体、凭据、异常文案或栈。

## 限制、诊断和响应头

JSON 必须 `application/json` 或 `+json`，含 chunked 最多 9 MiB；稳定错误为
415 `unsupported_media_type`、400 `invalid_json`、413 `payload_too_large`。
UTF-8/数量限制：输出 1 MiB、node raw 16 KiB、订阅 URL 8 KiB、名称 256 bytes、
label 128 bytes、mutation external key 256 bytes、每实体 64 tags、每集合 5,000 entities、
rename map 1,000 项/64 KiB、规范序列化文档 8 MiB。
新/改字段受限，未改超大历史字段可保留或缩减；每集合墓碑超过 10,000 只警告，不拒绝/压缩。
实际 by-key 节点还要留 `external:<key>` label 长度和 tag 槽：新/改 key 最多 119 UTF-8 bytes、
调用方最多 63 tags，不能只看 256-byte mutation 限制。

诊断只导出计数、安全身份/revision/mode、mutation ID/kind/revision/time、payload bytes/SHA-256、
retry/disposition 和 quarantine key/bytes/time；不读取隔离原文，不导出节点/订阅、输出、完整文档、
token、任意错误/文案/栈。
生产响应须有含 `frame-ancestors` 的 CSP、Referrer-Policy、X-Content-Type-Options、
Permissions-Policy。首屏主题脚本走构建验证的 nonce/hash 路径。缺头、主题脚本被阻、
持久 token 说明遗漏活跃 XSS 风险都应阻止交付。

## 验证证据

本地门禁证明重试幂等、SQLite 不含凭据、Worker/DO 路径和保留文件保护。
受控生产工作区另行核实：

- `subman.json` 有 `version: 2`、`schemaVersion: 2`、正确 `workspaceId` 和正 revision。
- V1 备份与迁移前导出逐字节一致。
- 浏览器发布与 Server API 节点更新都保留。
- API 无无关工作区数据/凭据；诊断无 canary payload、隔离原文、token、错误文案/栈。
- 双标签页验证单 sender、到期接管、旧 fence 拒绝和持久重试，不依赖可选锁/广播。
- 边界值/多一字节测试及真实 Worker 安全头。
- 重复受控 by-key API 只保留同身份节点；每次 HTTP 仍可能因新 mutation ID/更新时间推进 revision。

<a id="rollback"></a>

## 回滚

这是另行授权、明确设计的灾难恢复，不是普通浏览器修复或绕过 revision/墓碑的方法，
也不是 Wrangler migration reversal。以下历史兼容产物复用前必须重新验证。
浏览器 `confirmed` 前中断可从未改旧键重启技术迁移；确认/清理后不重建分散写入，
保留安全迁移元数据并恢复 IndexedDB 已验证快照。Token 独立，不参与持久化回滚。

1. 停止 V2 写入者，避免兼容 Worker 与协调器竞争。
2. 导出当前 V2 配置以便未来恢复。
3. 按单独恢复计划，把精确 V1 备份恢复为 `subman.json`。
4. 在独立 worktree 验证 `c89a60b` 并作正常向前部署，保留已应用 `v1` migration、binding/class：

   ```bash
   git worktree add --detach /tmp/subman-v1-compat c89a60b
   cd /tmp/subman-v1-compat
   bun install --frozen-lockfile
   bun test
   bun run check
   bun run lint
   bun run test:cf
   bun wrangler deploy --dry-run
   bun run deploy
   ```

5. 核对恢复 Gist 的 V1 UI 后才开放写入。

不要部署/回滚到缺少 DO 的旧 Worker；DO migration 是原子生命周期变更，旧包缺 binding/class。
保留 namespace 和 SQLite 记录。V2 专属编辑无法自动翻回 V1，保留 V2 导出供后续协调。
若恢复 V1 写入，当前配置会逐渐偏离原不可变备份。再升 V2 前先停止写入，导出两文件，
在保留文件名外归档原备份，再按独立计划明确移除失效旧备份；下次受控 mutation 才建新精确备份。
绝不把替换/删除保留备份作为自动恢复。
