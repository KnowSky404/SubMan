# sing-box-vps 与 SubMan 对接

[English](sing-box-vps.md) | [简体中文](sing-box-vps.zh-CN.md)

本文面向通过 SubMan 管理节点的可信安装脚本和后端 Agent。支持的接口是
[Server API](../api/server-api.zh-CN.md)，机器可读定义见
[OpenAPI](../api/openapi.yaml)。浏览器改为单一云端绑定不改变这些公开路径。

## 两端配置

SubMan Worker 保存具有 `gist` 权限的 `GITHUB_TOKEN` 和一个
`SUBMAN_API_TOKEN`。安装脚本只需要 SubMan 源站地址和 `SUBMAN_API_TOKEN`，
无需持有 Worker 的 GitHub 凭证。目前 Bearer 可以操作全部节点接口，没有调用方
scope 或单独撤销能力。请存入受保护的服务器配置，不要放进 URL 或日志。
上传 Secret 和部署需要目标 Worker 的操作授权。

在 sing-box-vps 现有配置流程中设置 `SUBMAN_API_URL`、`SUBMAN_API_TOKEN`
和稳定的 `SUBMAN_NODE_PREFIX`。URL 填 SubMan 源站，例如
`https://subman.example.com`。修改前缀会改变资源身份，需要明确安排旧节点清理。
已有的 `sbv agent subman-sync --json` 会实际写入远端，执行时必须具有该写入授权。

`GET /api/health` 无需 Bearer，始终返回 HTTP 200，仅报告 Secret 是否存在。
先检查 `ok`，再通过带鉴权的 `GET /api/nodes` 检查实际 Workspace。
API 使用 Worker 凭证独立发现目标，不读取浏览器绑定。写入前确认
`workspace.gistId` 是预期 Gist；没有 Workspace 时，节点 GET 也可能创建
bootstrap Gist。多份或无效候选会停止操作；公开接口没有 Workspace 选择参数。

## 支持的操作

| 安装脚本任务 | 公开操作 | 结果 |
| --- | --- | --- |
| 查看节点或核对结果不确定的写入 | `GET /api/nodes` | 节点及观察到的 Workspace 身份和版本 |
| 创建或替换一个受管节点 | `PUT /api/nodes/by-key/:externalKey` | HTTP 200、已提交节点及版本 |
| 查看已知 ID 的节点 | `GET /api/nodes/:id` | 节点及观察到的版本 |
| 删除受管节点 | 从列表精确查找 key 标记，再带 `If-Match` 调用 `DELETE /api/nodes/:id` | HTTP 200、`data.deleted: true` 及提交版本 |

没有 GET-by-key、DELETE-by-key、批量事务，也没有公开的聚合规则、订阅、发布或
客户端导出接口。安装脚本不得调用 `/api/workspaces/:workspaceId/mutations`
或直接 PATCH `subman.json`。该浏览器内部协议不属于支持的第三方集成面。

## 资源身份与请求内容

每个机器、协议、实例、用户和地址组合使用稳定 key，例如
`sing-box-vps:edge-1:vless-reality:ipv4`。当前调用方已经有各协议自己的 key
格式；升级时保持现有格式，不要根据显示名称重新构造身份。

将整个 key 作为一个 URL 路径段，仅编码一次（`jq @uri` 或
`encodeURIComponent`）。去除首尾空白后区分大小写。校验的是**编码前的 UTF-8
字节数**，不是百分号编码后的长度：

| 字段 | 新建或修改值的实际限制 |
| --- | --- |
| External key | 119 UTF-8 字节，为 128 字节标签中的 `external:` 留出 9 字节 |
| by-key PUT 普通调用方标签 | 63 个不同 label，为 key 标记保留第 64 个位置 |
| 标签 label | 128 UTF-8 字节 |
| 节点名称 | 256 UTF-8 字节 |
| 节点 raw URI | 16 KiB |
| JSON 请求 | 按流统计 9 MiB |

不要自行传入 `external:` 标签，协调器会添加。PUT 替换可写字段，应发送完整的
`name`、`type`、`raw`、`enabled`、`source` 和普通 `tags`。
省略 `enabled`、`source`、`tags` 会分别使用 `true`、`single` 和空列表。
PATCH 的 tags 会替换全部标签并可能移除 key 标记，受管节点标签请使用 by-key PUT。

raw URI 与其他节点相同时返回 `409 duplicate_node_raw`；重名会追加时间戳。
以返回 ID 为准。删除会为原 ID 写 tombstone，并移除聚合规则引用。
以后使用同一 key 的 PUT 可以新建不同 ID，不会恢复已删除 ID 及其旧聚合成员关系。

## 校验成功、处理并发

每次节点成功响应应核对以下信息一致：

- `workspace.file` 为 `subman.json`，`workspace.gistId` 为预期 Gist；
- `workspace.revision` 是非负整数；
- `X-SubMan-Revision` 等于该十进制版本；
- `ETag` 为 `"subman-revision-<revision>"`，响应为 `no-store`；
- upsert 返回节点 ID 及精确的 `external:<key>` 标记；
- 删除返回 `data.deleted: true`。

写入 2xx 代表协调器已经提交并回读核验远端 Workspace。浏览器排队状态或健康检查
不能替代此证据。上游失败和响应丢失可能导致结果不确定，包括 GitHub 已接受 PATCH
之后发生的错误。

需要保护读取后修改或删除时，将读取获得的 strong ETag 放入 `If-Match`。
ETag 只对应 Workspace 的版本，因此也要核对 Gist ID。
`412 precondition_failed` 或 `409 revision_conflict` 要先重新读取，再明确重放意图。
`If-Match: *` 不提供版本保护。

API 不支持 `Idempotency-Key`。重复 by-key PUT 保持资源身份，但仍可能再次推进版本。
传输失败或写入结果不确定时，先重新读取，找到精确标记并比较目标状态，再决定是否需要
另一次写入。不要自动重放 POST 或 DELETE。已确认写入前失败且可以重试时，使用有界退避，
遵守安全的 `Retry-After` 元数据。根据错误 `code` 和 `disposition` 分支，不解析
翻译后的 message。批量同步时保留逐节点成功和失败结果；多次请求不构成一个原子事务。

## 当前 sing-box-vps 兼容性检查

检查日期为 **2026-10-23**，依据 SubMan `9c5ab76` 和
[sing-box-vps `9bac47e`](https://github.com/KnowSky404/sing-box-vps/commit/9bac47e)。
下述调用方结论仅对应这份源码快照，后续 sing-box-vps 版本需重新核对。

本地检查的调用方已经做到 key 仅编码一次、核验提交版本/ETag/key 标记、读取稳定错误、
报告传输结果不确定，以及先列举再带版本删除旧 key。这些操作与当前 SubMan API 兼容。

sing-box-vps 有三项调用方校验需要适配：

1. `validate_subman_node_request` 和部分 key 构造函数仍允许 256 字节 key，
   但服务端生成的标签使实际可用长度为 **119 字节**。发起写入前应检查完整 key，
   包括前缀、实例/用户摘要和地址后缀。必要时缩短配置前缀，或明确迁移到新的确定性身份
   方案；不要静默截断既有 key。
2. 通用 payload 校验允许 64 个调用方标签。by-key 请求必须保留标记位置，最多
   **63 个不同的普通 label**。
3. `validate_subman_workspace_response` 会核对文件、版本、ETag 和 key 标记，
   但**没有**将 `workspace.gistId` 与预期 Gist 比较。调用方加入预期 Gist 防护前，
   上文目标身份核对仍需运营者手动完成；现有成功校验不能证明 API 选中了浏览器绑定
   或其他预期 Gist。

SubMan 已强制执行这些限制。本文没有修改接口或 sing-box-vps 仓库。
失败时应在调用方修正；放宽通用协议字段限制并不能放宽标签限制。

调用方支持的协议也少于 SubMan 节点类型枚举。其 VLESS、Hysteria2、Trojan、VMess
和加密双网络 Shadowsocks 专用路径有各自的无损表达检查与逐用户跳过逻辑。
当前不支持的协议必须明确跳过，不要作为 `other` 上传。SubMan 接受某个类型不代表安装
脚本能无损序列化该协议所有设置。请以所安装 sing-box-vps 版本的 capabilities 和
warnings 为准；[SubMan 导出矩阵](../sing-box-export.zh-CN.md)描述另一层客户端转换边界。

更新节点不会重新生成已发布订阅或 sing-box 文件。请在浏览器检查并发布受影响输出。
未来自动化接口仍是[路线图](../api/roadmap.zh-CN.md)，不属于现有功能。

本次核对依据本地源码与合成契约测试，不能证明生产部署、真实 Gist 写入或与线上
sing-box-vps 主机的端到端同步。
