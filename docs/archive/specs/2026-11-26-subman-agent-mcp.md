# SubMan Agent 接入首版 SPEC

日期 2026-11-26 · 范围为节点查询与单节点启停

## 目标与方案

用户可以对 Hermes Agent 说「找出带 hk 标签的节点，停用 HK-B，告诉我是否已提交」。发布一份可独立安装的 `subman-operator` Skill，描述查询、目标消歧、写入和结果汇报。部署标准 Streamable HTTP `/mcp`，由 Worker 强制执行权限和参数校验。Hermes 使用原生 MCP 客户端，其他支持同一传输和 Bearer 请求头的客户端可复用这套接口。

仅用 Skill 调用现有 REST API 可以演示流程，但现有共享令牌拥有全部节点操作权限，现有读路由的发现逻辑还可能初始化 Gist。通用 OpenAPI 转发也会暴露带凭证的节点字段。首版选择三个固定业务工具，复用已有 GitHub 网关、Workspace 文档解析和协调器提交路径。现有 Server API 和浏览器 mutation 协议继续按原契约运行。SubMan 不托管模型或 Agent，MCP 传输层使用无状态 SDK handler，持久写入仍由既有 Durable Object 串行处理。

## 开通与权限

- 管理员在 Worker 配置 `SUBMAN_MCP_GIST_ID` 和 `SUBMAN_MCP_READ_TOKEN`，复用 Worker 已有的 `GITHUB_TOKEN`。只有配置完整时启用 MCP。用独立的高熵随机凭证。可选的 `SUBMAN_MCP_WRITE_TOKEN` 增加单节点启停权限，同时可读。
- 读写令牌彼此独立，也与 GitHub 和 REST API 凭证不同。每次请求均校验 Bearer。工具发现只公布当前令牌可调用的工具，服务端对直接调用执行同一权限约束。传输不使用 Cookie，浏览器跨源 Origin 被拒绝，允许无 Origin 的原生客户端。
- 固定读取指定 Gist 的现有 V2 `subman.json`，校验返回的 Gist ID 和文档 Workspace ID，缺失、V1、无效时返回安全错误。读路径不扫描、创建、迁移 Gist。协调器写入同一个 Gist。MCP 返回由专用凭证签名的 opaque `workspace` 标识，用来拒绝改绑后拿旧快照写入，避免向模型披露 Gist ID。
- 响应禁止缓存。返回字段采用显式投影，排除原始节点内容、订阅链接、Gist ID 和凭证。自由文本仅作为数据展示。服务端只返回安全的错误分类和必要的版本信息。

## 工具契约

| 工具 | 输入 | 结果 |
| --- | --- | --- |
| `list_nodes` | 可选 `name` 子串（忽略大小写）、`tag` 精确标签、`enabled`、`offset`、`limit` | Workspace 标识、revision、节点摘要、匹配总数及下一页偏移（若有） |
| `get_node` | `nodeId` | Workspace 标识、revision 和单节点摘要 |
| `set_node_enabled` | `nodeId`、`enabled`、读取返回的 `workspace` 与 `expectedRevision` | `committed` 或 `no_change`、Workspace 标识、revision、节点摘要 |

摘要字段为 ID、名称、类型、启用状态、来源、更新时间与限定长度和数量的标签。典型列表默认 20 条，每次最多 50 条，按当前文档顺序。筛选参数同时给出时取交集。MCP 请求 JSON 上限为 16 KiB，工具输入使用严格 schema。

## 写入与结果

1. 先验证 Workspace 标识与当前 revision，再查找稳定节点 ID。版本不匹配返回 `state_conflict`，节点不存在返回 `not_found`。目标已达到时返回 `no_change`，无 mutation。
2. 复用 `server-api` 的 `node.upsert` patch 变体，仅传 `enabled`。一次调用至多提交一个带精确 revision 和现有 reset fencing 的 mutation。并发冲突由协调器拒绝。
3. 协调器完成云端提交和回读核验后，才返回 `committed` 和已提交 revision。未能确认 RPC 或写入结果时返回 `outcome_uncertain`。客户端先按 ID 读取当前状态，区分已观察到目标状态与已确认本次提交。重复旧请求不能越过 revision；本期不定义跨调用的请求重放或回执查询协议。
4. 节点启停写入配置。已有聚合与 sing-box 输出需要独立发布才会反映变化。用户明确指定单个唯一节点且已授予写权限时，Skill 可直接操作；目标歧义时先询问。

## 实现与验收

1. 先添加 Worker 集成测试，使用合成 GitHub 响应和真实本地协调器。
2. 实现有界传输、独立鉴权、固定 Gist 查询和单节点启停，再添加 Hermes 配置、双语接入指南和可独立安装的 Skill。
3. 验证 MCP 握手、工具发现、筛选与分页、凭证权限、缺失/旧版 Gist、跨源拒绝、错误脱敏、旧 revision、重复请求、无变化和未知结果。成功写入只 PATCH `subman.json` 一次，回读核验状态及 revision；用 Hermes 对合成环境检查连接并实际调用工具。
4. 后续沿 Server API 路线图增加订阅和聚合读取，再做绑定 revision 与产物哈希的发布预览和确认。批量变更、删除、自动发布、多用户 OAuth 和 Hermes 分发包留待独立验证。

参考 [Server API](../../api/server-api.zh-CN.md)、[API 路线图](../../api/roadmap.zh-CN.md)、[MCP SDK Web 标准 handler](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard) 和 [Hermes MCP 配置](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)。
