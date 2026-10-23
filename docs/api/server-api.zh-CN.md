# SubMan Server API

[English](server-api.md) | [简体中文](server-api.zh-CN.md)

SubMan Server API 是由所有者自行部署、面向可信后端脚本的 REST API。
首版用于 `sing-box-vps` 等安装或更新 SubMan Workspace 节点的自动化流程。

API 运行于现有的 Cloudflare Workers / SvelteKit 应用，写入与浏览器 UI 相同的
Workspace Gist。

Schema、operation ID、参数、响应头与示例的机器可读定义见
[`openapi.yaml`](openapi.yaml)。

## 公开范围与兼容性

支持的公开 API 包含 `GET /api/health` 和下文所列节点接口。
当前未版本化路径属于第一代兼容接口，兼容变更应保持新增式；未来破坏性变更必须使用
新的版本化路径或明确协商版本。

订阅、聚合规则、发布、输出文件和客户端导出尚无公开 REST 接口。
外部调用方不得直接 PATCH Gist，也不得调用
`/api/workspaces/:workspaceId/mutations`。该路径是凭证和 mutation envelope
均不同的浏览器内部传输协议，不提供公开兼容性保证。

扩展设计见[路线图](roadmap.zh-CN.md)，不改变当前支持的契约。

安装脚本对接、已核对的 `sing-box-vps` 调用方契约及其校验差异见
[sing-box-vps 对接指南](../integrations/sing-box-vps.zh-CN.md)。

## 基础地址

使用 SubMan 实际部署的源站：

```text
https://subman.example.com
```

下文示例使用 `https://subman.example.com`，请替换为实际部署域名。

## 鉴权

除了 `GET /api/health`，所有接口都要求：

```http
Authorization: Bearer <SUBMAN_API_TOKEN>
```

`SUBMAN_API_TOKEN` 是自定义的 SubMan API 凭证，与 GitHub Token 分开。
它是一个共享的全权限 Bearer，没有 scope、独立客户端身份、单客户端撤销或内置
调用方限流。只通过 TLS 交给可信后端，不要放入 URL 或日志，定期轮换。
CORS 不是鉴权边界。

## 服务器配置

使用 Cloudflare Workers API 前，需要配置两个 Secret。上传 Secret 和部署都会
修改远端 Worker；必须先取得该目标的明确操作授权，再执行：

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

`GITHUB_TOKEN` 需要 GitHub 的 `gist` 权限。Worker 使用它发现或创建
Workspace Gist，并在每次请求中单独传给协调器，不会放入 mutation payload。

`SUBMAN_API_TOKEN` 是自定义的长随机秘密值，调用方通过 `Authorization` 请求头发送。

在同样授权范围内部署：

```bash
bun run deploy
```

## Workspace 行为

API 与 UI 使用相同的 Workspace 标识：

- Gist 描述：`SubMan-Data`
- Workspace 文件：`subman.json`

Workspace Gist 不存在时，API 只创建 bootstrap 标记。每次写入构造带版本的节点
mutation，提交给该 Gist 对应的 `WorkspaceCoordinator` Durable Object。
协调器读取最新文档、应用一项变更，并在经过核验的 Gist PATCH 中提交 `subman.json`。
浏览器和 Server API 因而共用顺序、内部幂等、tombstone 和冲突规则。

公开节点 API 写入是同步的。写入 `2xx` 表示协调器已经提交并回读核验远端 Workspace。
浏览器的 `local-durable-queued`、`peer-owned`、`retry-scheduled` 等完成状态
不适用于公开 API 调用方。

读取返回观察到的远端快照，不提交业务数据或发布输出。发现逻辑与 UI 共用，但 API
不使用浏览器保存的绑定，而是查找 Worker 的 `GITHUB_TOKEN` 可访问的 Gist。
完全没有匹配 Workspace 时，即使节点 GET 也可能创建私有 bootstrap Gist；
V1 和 bootstrap 读取版本为 `0`。多个有效候选或无效匹配候选需要运营者选择/修复，
当前返回脱敏的 `502 gist_read_failed`；API 没有 Workspace 选择参数。
写入前应核对 `workspace.gistId` 是否为预期 Gist，版本 ETag 本身不标识 Gist。

更新节点不会重新生成已有聚合订阅或 sing-box 输出文件，需在浏览器检查并另行发布。

首次写入 V1 Workspace 时，先将原始字节精确保存在 `subman.v1.backup.json`，
再提交 V2。迁移和回滚见 [Workspace V2 运维指南](../workspace-v2-operations.zh-CN.md)。

## 通用请求头

JSON 请求：

```http
Authorization: Bearer <SUBMAN_API_TOKEN>
Content-Type: application/json
If-Match: "subman-revision-12"
```

写入可选 `If-Match`。使用上次成功节点响应的 strong ETag，防止基于过期快照修改。
`If-Match: *` 表示不要求指定版本。过期或 weak validator 返回
`412 precondition_failed` 及当前版本。

每次成功节点响应都包含：

```http
ETag: "subman-revision-13"
X-SubMan-Revision: 13
Cache-Control: no-store
```

## 数据类型

### 节点

```json
{
  "id": "string",
  "name": "vps-1 vless",
  "type": "vless",
  "raw": "vless://...",
  "tags": [
    {
      "id": "sing-box-vps",
      "label": "sing-box-vps"
    }
  ],
  "enabled": true,
  "updatedAt": "2026-05-06T00:00:00.000Z",
  "source": "single"
}
```

允许的 `type` 值：

- `vless`
- `vmess`
- `trojan`
- `ss`
- `ssr`
- `hysteria2`
- `tuic`
- `anytls`
- `other`

允许的 `source` 值：

- `single`
- `subscription`

### 创建节点请求体

`POST /api/nodes` 和 `PUT /api/nodes/by-key/:externalKey` 接受：

```json
{
  "name": "vps-1 vless",
  "type": "vless",
  "raw": "vless://...",
  "enabled": true,
  "tags": ["sing-box-vps", "auto"],
  "source": "single"
}
```

规则：

- `name` 必填。
- 与其他节点重名时，API 添加时间戳后缀，例如 `HK 2026-05-26 06:32`。
- `type` 必填，且必须为支持的代理类型之一。
- `raw` 必填。
- 与其他节点相同的 trimmed raw URI 返回 `409 duplicate_node_raw`。
- `enabled` 默认 `true`。
- `source` 默认 `single`。
- `tags` 默认空数组。
- tags 可以是字符串或 `{ "id": "...", "label": "..." }` 对象。
- 字符串去除首尾空白，标签按规范化后的 label 去重。未知请求字段被忽略。
  应始终发送文档规定的类型：创建/upsert 当前对非布尔 enabled、非数组 tags、
  缺失/空/非字符串 source 使用默认值；PATCH 会检查明确提供的可选字段。

### 部分更新请求体

`PATCH /api/nodes/:id` 接受创建请求字段的任意子集：

```json
{
  "name": "vps-1 renamed",
  "enabled": false
}
```

省略字段保留既有值。

提供 `tags` 会替换整个标签列表，包括既有的 external-key 标记。
受管节点调整标签且保留 key 时，应使用包含完整目标节点内容的 by-key PUT。
不要把返回的 `external:` 标记复制进请求 tags，调用方自行提供该标记会被拒绝。

PATCH 与创建应用相同的去重规则：重名会调整为唯一名称，raw 与其他节点重复会被拒绝。

## 响应格式

列表响应：

```json
{
  "data": [],
  "workspace": {
    "gistId": "gist-id",
    "file": "subman.json",
    "revision": 12
  }
}
```

单节点写入响应：

```json
{
  "data": {
    "id": "node-id",
    "name": "vps-1 vless",
    "type": "vless",
    "raw": "vless://...",
    "tags": [],
    "enabled": true,
    "updatedAt": "2026-05-06T00:00:00.000Z",
    "source": "single"
  },
  "workspace": {
    "gistId": "gist-id",
    "file": "subman.json",
    "revision": 13
  }
}
```

错误响应：

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Unauthorized",
    "disposition": "auth-required"
  }
}
```

错误始终使用稳定的 `code` 和 `disposition`。GitHub 失败可以附加受限 `gateway`
对象，只含 operation、status、category、request ID、retry-after 和 rate-limit
reset。不返回原始 GitHub 响应体、凭证、异常 message、stack 或 Workspace 文档。
冲突可附加 `{ "workspace": { "revision": 13 } }`。应按 code/disposition 分支，
不要解析人类可读的 message。

安全 GitHub 元数据包含 `retryAfter` 时，响应也带标准 `Retry-After` 响应头。
`gateway` 可省略：提交协调器前的发现/读取失败可能只返回脱敏 502，不含上游元数据。

## 请求与业务限制

JSON 写入要求 `application/json` 或 `+json` 媒体类型。Worker 按流统计实际字节，
不只信任 `Content-Length`，请求上限 9 MiB。无效媒体类型、无效 JSON 和超限 body
分别返回稳定的 415、400、413 错误。

新建或修改值按 UTF-8 字节/数量限制：节点 raw 16 KiB、订阅 URL 8 KiB、名称
256 字节、标签 label 128 字节、通用 externalKey 256 字节、每实体 64 个标签、
每个 collection 5,000 个实体、重命名映射最多 1,000 项且 64 KiB、输出内容 1 MiB、
规范化 Workspace 文档 8 MiB。未修改的超限旧字段保持可读且允许缩减，
不会因为无关修改而被拒绝。

by-key 写入自动生成的 `external:` 前缀占用 128 字节标签限制中的 9 字节。
因此新建/修改 key 最多 **119 UTF-8 字节**，调用方需为标记保留一个标签位置，
最多 **63 个不同的普通 label**。通用 mutation 的 256 字节 externalKey 限制
不会绕过生成标签的更严格限制。业务限制返回 `400 invalid_mutation`，不是 HTTP 413。
继续增大已超限 Workspace 返回 `500 workspace_size_limit`，disposition 为
`operator-repair`。读取旧数据不受相同写入大小上限限制。

## 接口

### 健康检查

```http
GET /api/health
```

鉴权：不需要。

返回必需的服务器 Secret 是否配置，不返回值。

HTTP 状态始终为 `200`，包括 `ok: false`。`ok: true` 不验证 GitHub 权限、
Workspace 发现或协调器绑定。

示例：

```bash
curl -sS "https://subman.example.com/api/health"
```

响应：

```json
{
  "ok": true,
  "config": {
    "githubToken": true,
    "submanApiToken": true
  }
}
```

### 列出节点

```http
GET /api/nodes
```

示例：

```bash
curl -sS "https://subman.example.com/api/nodes" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN"
```

响应：

```json
{
  "data": [
    {
      "id": "node-id",
      "name": "vps-1 vless",
      "type": "vless",
      "raw": "vless://...",
      "tags": [],
      "enabled": true,
      "updatedAt": "2026-05-06T00:00:00.000Z",
      "source": "single"
    }
  ],
  "workspace": {
    "gistId": "gist-id",
    "file": "subman.json",
    "revision": 12
  }
}
```

### 创建节点

```http
POST /api/nodes
```

每次创建新节点，除非提交的 raw URI 已存在。重名会添加时间戳后缀。
安装脚本应优先使用 `PUT /api/nodes/by-key/:externalKey`，避免为相同受管节点
创建多个记录。

示例：

```bash
curl --fail-with-body -sS -X POST "https://subman.example.com/api/nodes" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["manual"]}'
```

成功状态：`201 Created`。

### 获取节点

```http
GET /api/nodes/:id
```

示例：

```bash
curl -sS "https://subman.example.com/api/nodes/node-id" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN"
```

### 更新节点

```http
PATCH /api/nodes/:id
```

示例：

```bash
curl --fail-with-body -sS -X PATCH "https://subman.example.com/api/nodes/node-id" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "subman-revision-12"' \
  -d '{"enabled":false,"name":"vps-1 disabled"}'
```

### 删除节点

```http
DELETE /api/nodes/:id
```

删除节点，并从聚合规则 `nodeIds` 中移除该 ID。

示例：

```bash
curl --fail-with-body -sS -X DELETE "https://subman.example.com/api/nodes/node-id" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN"
```

响应：

```json
{
  "data": {
    "deleted": true
  },
  "workspace": {
    "gistId": "gist-id",
    "file": "subman.json",
    "revision": 13
  }
}
```

### 按 External Key 创建或替换节点

```http
PUT /api/nodes/by-key/:externalKey
```

该接口推荐用于自动化脚本。一个稳定 `externalKey` 对应一个节点，重复调用更新该
资源而非创建重复节点。这是资源身份幂等，不是请求重放幂等：每次成功更新可能改变
`updatedAt` 并推进 Workspace 版本。API 不支持 `Idempotency-Key`。

PUT 替换全部可写字段，省略 `enabled`、`source`、`tags` 使用创建默认值，而非保留
原值。key 标记由协调器添加，省略其他普通标签会移除它们。删除节点会移除 key 标记；
以后相同 key 的 by-key PUT 可以创建新 ID，原删除 ID 仍保留 tombstone。

仍应用正常节点校验：重名调整为唯一名称，raw 属于其他节点时返回
`409 duplicate_node_raw`。

API 将 external key 存为一个身份标记标签：

```text
external:<externalKey>
```

选择稳定的 `externalKey`，例如：

- `vps-1-vless`
- `hostname-vless-reality`
- `server-id-protocol-port`

将 key 作为 URL 路径段，仅编码一次。框架解码一次，字面 `%` 或 `%2F` 也可以是
key 的一部分。去除首尾空白后区分大小写，新建/修改 key 最多 119 UTF-8 字节。
`external:` 标签命名空间保留用于身份映射，不得用于无关调用方标签。

示例：

```bash
curl --fail-with-body -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer $SUBMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

## Shell 集成示例

```bash
#!/usr/bin/env bash
set -euo pipefail

SUBMAN_BASE_URL="https://subman.example.com"
SUBMAN_API_TOKEN="${SUBMAN_API_TOKEN:?SUBMAN_API_TOKEN is required}"

NODE_HOSTNAME="$(hostname)"
NODE_KEY="${NODE_HOSTNAME}-vless-reality"
NODE_NAME="${NODE_HOSTNAME} vless reality"
NODE_RAW="vless://..."

NODE_KEY_BYTES="$(printf '%s' "${NODE_KEY}" | wc -c | tr -d '[:space:]')"
(( NODE_KEY_BYTES > 0 && NODE_KEY_BYTES <= 119 )) || exit 1
ENCODED_NODE_KEY="$(jq -rn --arg key "${NODE_KEY}" '$key | @uri')"

PAYLOAD="$(jq -cn \
  --arg name "${NODE_NAME}" \
  --arg raw "${NODE_RAW}" \
  '{name: $name, type: "vless", raw: $raw, enabled: true, tags: ["sing-box-vps", "auto"]}')"

curl --fail-with-body -sS -X PUT "${SUBMAN_BASE_URL}/api/nodes/by-key/${ENCODED_NODE_KEY}" \
  -H "Authorization: Bearer ${SUBMAN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "${PAYLOAD}"
```

示例测量编码前的 UTF-8 字节数，并仅 URL 编码一次。发送写入前，应通过
`GET /api/nodes` 核对 `workspace.gistId`，仅凭健康检查无法确认目标。
动态值必须使用 `jq` 等 JSON 序列化器，不要通过字符串拼接生成 JSON。
响应校验和结果不确定时的处理见[对接指南](../integrations/sing-box-vps.zh-CN.md)。

## TypeScript 集成示例

```ts
type SubManResult = {
  error?: { code: string; disposition: string };
};

const response = await fetch(
  `${submanOrigin}/api/nodes/by-key/${encodeURIComponent(externalKey)}`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${submanApiToken}`,
      "Content-Type": "application/json",
      ...(previousEtag ? { "If-Match": previousEtag } : {}),
    },
    body: JSON.stringify(node),
  },
);
const result = (await response.json()) as SubManResult;
if (!response.ok) {
  if (!result.error) throw new Error(`Unexpected HTTP ${response.status}`);
  throw new Error(`${result.error.code}: ${result.error.disposition}`);
}
const committedEtag = response.headers.get("etag");
```

生产集成应根据稳定的 code/disposition 映射为明确结果，而不是像精简示例一样
仅抛出通用异常。

## 重试矩阵

| 方法 | 已知未提交失败 | 结果未知或响应丢失 |
| --- | --- | --- |
| `GET` | retryable-upstream 使用有界退避。 | 可安全重试。 |
| `PUT .../by-key` | 仅重试已确认写入前的可重试失败，遵守 Retry-After。 | 先 GET 列表并精确查找 `external:<key>`，盲重放可能再次推进版本。 |
| `PATCH` | 状态冲突时重新读取，明确重放意图后再重试。 | 先 GET 并比较节点与版本。 |
| `POST` | 修正校验/业务错误后再发请求。 | 不可盲重试，节点可能已创建。 |
| `DELETE` | 按当前状态处理 tombstone / not-found。 | 先 GET，重复删除不具请求幂等。 |

API 不接受 `Idempotency-Key`。`If-Match` 仅保护乐观并发，不能让结果未知的请求
安全重放。

写入失败，包括 PATCH 后 GitHub 超时或 5xx，可能发生在 GitHub 接受变更之后。
`retryable-upstream` 描述处理方式，不证明没有写入。结果不确定时，先重新读取节点
和版本，再决定是否重新提交；核验/索引失败需要运营者检查。核查时仍遵守安全的
重试时序。没有 GET-by-key 接口。

## 状态码

| 状态 | code | 含义 |
| --- | --- | --- |
| `200` | - | 读取、更新、删除或 upsert 成功。 |
| `201` | - | `POST /api/nodes` 创建成功。 |
| `400` | `bad_request` | JSON 请求体或字段值无效。 |
| `400` | `invalid_json` | body 缺失、JSON 格式错误或 UTF-8 无效。 |
| `400` | `invalid_mutation` | 节点 mutation 或修改值违反 schema / 业务限制。 |
| `400` | `invalid_workspace_document` / `invalid_bootstrap_marker` | 存储内容需运营者修复。 |
| `401` | `unauthorized` | SUBMAN_API_TOKEN 缺失或错误。 |
| `401` / `403` | `gist_read_failed` / `gist_write_failed` | GitHub 鉴权或权限失败，重新连接或修复 Worker Secret。 |
| `404` | `not_found` | 指定节点 ID 不存在。 |
| `404` | `entity_not_found` | 写入目标节点不存在。 |
| `404` | `workspace_not_found` | Workspace Gist 已不存在。 |
| `412` | `precondition_failed` | If-Match 不匹配当前版本。 |
| `409` | `duplicate_node_raw` | raw 属于其他节点。 |
| `409` | `revision_conflict` | 读取之后其他 mutation 已提交，需从最新版本重试。 |
| `409` | `entity_deleted` | 旧写入试图恢复 tombstone ID。 |
| `409` | `migration_backup_conflict` | 已有 V1 备份与当前 V1 原文不匹配。 |
| `422` | `unsupported_schema` | Workspace schema 版本过新。 |
| `413` | `payload_too_large` | 流 JSON body 超过 9 MiB。 |
| `415` | `unsupported_media_type` | 请求不是 JSON。 |
| `429` | `gist_read_failed` / `gist_write_failed` | GitHub 限流，遵守安全重试元数据。 |
| `500` | `server_error` | 必需 Secret / 协调器绑定缺失，或未知失败。 |
| `500` | `workspace_size_limit` / `commit_index_failed` / `invalid_journal_record` | 大小或协调器状态需运营者修复，远端可能已提交。 |
| `502` | `gist_read_failed` / `gist_write_failed` / `write_verification_failed` | 发现、网络或上游核验失败，写入可能已提交。 |
| `504` | `gist_read_failed` / `gist_write_failed` | 有界 GitHub 请求超时。 |

## 运维注意

- `GITHUB_TOKEN` 仅保存在 Cloudflare Secrets。
- 后端脚本只持有 `SUBMAN_API_TOKEN`。
- 定期轮换 API Token，脚本主机失陷后立即轮换。
- Durable Object 串行化并发 mutation 并拒绝过期版本，但 Gist 仍适合低频操作。
- 使用有界退避和安全的 Retry-After / rate-limit 元数据。
  `revision_conflict` / `precondition_failed` 为 `state-conflict`，需重新读取后明确应用意图。
- 重试写入前先确认是否已提交，上游错误 disposition 本身不证明未提交。
- GET 可安全重试。写入结果未知时先重新读取：by-key PUT 可能再次推进版本，
  PATCH 可能再次应用变更，POST 可能创建其他节点，重复 DELETE 可能返回 tombstone / not-found 冲突。
- CORS 有意不对任意浏览器源开放，也不能作为访问控制。
