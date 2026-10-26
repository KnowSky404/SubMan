# SubMan Server API 参考

[English](server-api.md) | 简体中文

完整端点说明见 [Server API](../../../api/server-api.zh-CN.md)，机器契约见
[OpenAPI](../../../api/openapi.yaml)，尚未实现的资源接口见
[API 路线图](../../../api/roadmap.zh-CN.md)。sing-box-vps 的调用流程见
[集成指南](../../../integrations/sing-box-vps.zh-CN.md)。

## 用途和鉴权

这是面向站点所有者及可信后端脚本的 API，与浏览器 UI 运行在同一个 Cloudflare
Worker，通过同一个 `WorkspaceCoordinator` Durable Object 写入工作区 Gist。

除 `GET /api/health` 外，所有公开端点都要求：

```http
Authorization: Bearer <SUBMAN_API_TOKEN>
```

`SUBMAN_API_TOKEN` 和 GitHub Token 相互独立。它是共享的全权限凭证，没有 scope
或单客户端撤销能力。脚本只持有该 API Token，通过 TLS 发送，不放入 URL 或日志，
并支持轮换；`GITHUB_TOKEN` 保留在 Worker 内。

## 首选自动化接口

```http
PUT /api/nodes/by-key/:externalKey
```

稳定 key 对应一个节点，保存为以下节点标签：

```text
external:<externalKey>
```

可选
`vps-1-vless`、`hostname-vless-reality` 或 `server-id-protocol-port` 等稳定值。

- 标签上限 128 字节，扣除 9 字节 `external:` 前缀，新增或修改的 key 最多为
  **119 UTF-8 字节**。
- 为自动标签预留一个槽位，最多传 63 个去重后的普通标签。
- key 仅 URL 编码一次。字面百分号序列是 key 内容，服务端不会二次解码。
  去除首尾空白后按大小写精确匹配。
- 调用方不得提交保留的 `external:` 标签。
- 幂等性只保证资源身份；重复成功调用可更新 `updatedAt`、推进工作区 revision。
  不支持 `Idempotency-Key`。
- PUT 替换所有可写字段。省略 `tags`、`enabled`、`source` 使用创建默认值，
  不保留旧值。PATCH 的 `tags` 替换完整列表，可能移除 key 标签；托管节点使用 by-key PUT。
- 删除节点后，再次 by-key PUT 可以创建一个新 ID；旧 ID 的 tombstone 不会被复活。

```bash
curl --fail-with-body -sS -X PUT "https://subman.example.com/api/nodes/by-key/vps-1-vless" \
  -H "Authorization: Bearer ${SUBMAN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"vps-1 vless","type":"vless","raw":"vless://...","enabled":true,"tags":["sing-box-vps"]}'
```

`vless://...` 只是占位符，真实调用需替换为有效节点链接。

## 节点字段

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

`name`、`type`、`raw` 必填。重名自动添加时间戳后缀，例如
`HK 2026-05-26 06:32`；首尾去空白后相同的 raw URI 返回
`409 duplicate_node_raw`。`enabled` 默认 `true`，`source` 默认 `single`，
`tags` 默认空数组。标签可以是字符串或 `{ "id": "...", "label": "..." }`。
建议使用字符串标签，或提供显式非空对象 ID；仅有 label 的对象在 ASCII 规范化结果
为空 ID 时返回 `400 invalid_mutation`。

允许的 `type`：

```text
vless, vmess, trojan, ss, ssr, hysteria2, tuic, anytls, other
```

PATCH 至少要求一个已知的可写字段；空对象或仅含未知字段的请求体返回
`400 invalid_mutation`。

## 当前公开端点

| 方法和路径 | 用途 |
| --- | --- |
| `GET /api/health` | 检查 Worker secret 是否配置 |
| `GET /api/nodes` | 列出节点 |
| `POST /api/nodes` | 创建节点，拒绝重复 raw URI |
| `GET /api/nodes/:id` | 获取单个节点 |
| `PATCH /api/nodes/:id` | 部分更新，处理重名并拒绝 raw 冲突 |
| `DELETE /api/nodes/:id` | 删除节点并清理聚合规则 `nodeIds` |
| `PUT /api/nodes/by-key/:externalKey` | 按稳定外部 key 创建或更新 |

只有这些 health 和 node 路由属于公开集成契约。
`/api/workspaces/:workspaceId/mutations` 使用另一套凭证及 envelope，是内部浏览器
传输协议，不提供第三方兼容保证。订阅、聚合、发布和导出尚无公开 REST 端点。

## 完成与版本

- Node API 写入返回 `2xx`，表示协调器已提交并回读验证远端 Workspace。
  浏览器的 `peer-owned`、`retry-scheduled` 等完成状态不适用于该 API。
- 成功节点响应的 JSON `workspace.revision`、`X-SubMan-Revision` 和强 ETag
  `"subman-revision-12"` 反映版本。
- 写入可发送上次 ETag 作为 `If-Match`。过期值返回 `412 precondition_failed`、
  `state-conflict` 和当前 revision；重新读取后决定是否重施意图。
- 不带 `If-Match` 的并发写入仍可能返回 `409 revision_conflict`。
- GET 只是观察快照。无工作区时可创建 bootstrap Gist；V1/bootstrap revision 为 0。
  API 由 Worker 凭证独立发现目标，没有工作区选择器。优先选择唯一有效的 V1/V2 文档；
  没有有效文档时才选唯一有效 bootstrap，无效候选不会阻止这两种唯一选择。
  所选层级有多个有效候选或只有无效候选时返回脱敏的 `502 gist_read_failed`。
  使用 ETag 前核对 `workspace.gistId`，版本号不标识 Gist。
- Health 始终 HTTP 200，必须检查 `ok`。它只检查 secret 存在，不验证 GitHub
  权限、发现结果或协调器 binding。
- 节点写入不修改已有发布输出。审查相关规则后在浏览器重新发布。

错误格式为 `{ "error": { "code", "message", "disposition" } }`。按 `code`
和 `disposition` 分支，不解析 `message`。可重试 GitHub 故障可能附带有界的
`gateway` 元数据和 `Retry-After`，不返回原始上游响应体。

## 重试

- GET：传输或 `retryable-upstream` 故障可使用有界退避。
- by-key PUT：只有确认尚未提交的可重试故障才可重试。不确定响应后先 GET 列表，
  查找精确 external 标签；盲目重放可再次推进 revision。没有 GET-by-key 端点。
- PATCH：结果不确定时先重读节点与版本。
- POST：不盲目重试未知结果，以免重复创建。
- DELETE：未知结果后先重读；重复删除可能返回 `entity_deleted` 或 `entity_not_found`。

`retryable-upstream` 不证明写入尚未提交；PATCH 超时、回读验证或提交索引失败可能
发生在写入成功之后。先核实结果，再按安全重试时间决定是否重新提交。
领域限制使用 `400 invalid_mutation`，超过 9 MiB 的请求体使用
`413 payload_too_large`；`500 workspace_size_limit` 表示 `operator-repair`。

## 运行限制

每次写入都带版本，协调器防止丢失更新，但 Gist 仍适合低频写入。
首次写入可原地迁移 V1 并创建不可变 `subman.v1.backup.json`；遇到
`migration_backup_conflict` 应调查备份，不覆盖它。CORS 不向任意浏览器来源开放，
也不是鉴权边界。`duplicate_node_raw` 表示 URI 已存在或资产清单不一致，先检查既有
节点。可信脚本宿主被入侵时轮换 API Token。
