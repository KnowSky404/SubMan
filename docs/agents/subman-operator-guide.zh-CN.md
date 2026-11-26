# 从 Hermes Agent 操作 SubMan

[English](subman-operator-guide.md) | 简体中文

将 MCP 客户端连接到已配置的 SubMan Worker，即可查找代理节点并查看安全摘要。
为客户端提供可选的写入凭证后，可以单次启用或停用一个节点。
[SubMan 操作 Skill](subman-operator/SKILL.zh-CN.md) 指导 Agent 定位目标和解读结果。

## 配置 Worker

使用已有的私有 `SubMan-Data` Gist，其中需要有有效的 Workspace Schema V2
`subman.json`。通过 Wrangler 的交互提示或现有凭证管理流程配置 Worker。

| Worker 设置 | 用途 |
| --- | --- |
| `GITHUB_TOKEN` | Worker 已有的 GitHub 凭证，需拥有目标 Gist 的访问权限，仅保存在 Worker。 |
| `SUBMAN_MCP_GIST_ID` | 该 Gist 的 ID，可从 GitHub Gist 页面获取。 |
| `SUBMAN_MCP_READ_TOKEN` | 专用于节点查询的 Bearer 令牌。 |
| `SUBMAN_MCP_WRITE_TOKEN` | 可选的独立 Bearer 令牌，可查询节点以及启用或停用单个节点。 |

分别用安全的随机数生成器生成 MCP 令牌，例如 `openssl rand -hex 32`。每个令牌使用
32 至 512 个字符，可使用字母、数字、`-` 和 `_`。两个 MCP 令牌必须彼此不同，也与 GitHub
凭证和已有的 `SUBMAN_API_TOKEN` 不同。

```sh
bun wrangler secret put SUBMAN_MCP_GIST_ID
bun wrangler secret put SUBMAN_MCP_READ_TOKEN
# 仅在需要让 Agent 启停节点时配置。
bun wrangler secret put SUBMAN_MCP_WRITE_TOKEN
```

Worker 配齐 Gist ID、读令牌和 GitHub 凭证后才会启用 MCP。Worker 直接读取指定 Gist。
文档缺失、无效或需要迁移时，请先在 SubMan 中处理。默认连接使用读令牌，只有明确授权
Agent 改动节点时，才向相应的 Hermes 配置档提供写令牌。

## 连接 Hermes

1. 在当前 Hermes 配置档的 `.env` 中将 `SUBMAN_MCP_TOKEN` 设置为 SubMan 读令牌。
   若要启用写入，使用独立的写令牌作为该值。默认配置档的 `.env` 位于 `~/.hermes/`。
2. 将以下片段加入当前配置档的 `config.yaml`。若已有 `mcp_servers`，合并到该配置段。
   将示例地址替换为自己的 SubMan Worker 地址。

   ```yaml
   mcp_servers:
     subman:
       url: "https://subman.example.com/mcp"
       headers:
         Authorization: "Bearer ${SUBMAN_MCP_TOKEN}"
       trust: untrusted
   ```

   默认配置档使用 `~/.hermes/config.yaml`。请求头通过变量引用已保存的凭证。Hermes 审批启用时，
   `trust: untrusted` 会在写入前请求批准。Worker 独立校验每个令牌可调用的工具。
   [Hermes MCP 配置参考](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)

3. 在 Hermes 所在的终端运行下列命令，再开始新对话或在现有对话中使用 `/reload-mcp`。

   ```sh
   hermes skills install KnowSky404/SubMan/docs/agents/subman-operator
   hermes mcp test subman
   ```

   也可以手动将[操作 Skill](subman-operator/SKILL.md) 复制到客户端技能目录的
   `subman-operator/SKILL.md`。使用[中文版](subman-operator/SKILL.zh-CN.md)时，
   安装后的文件名同样为 `SKILL.md`。
   [Hermes Skill 安装说明](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills#installing-individual-skills-directly-without-adding-a-tap)

其他 MCP 客户端也可通过各自的凭证配置使用同一 Streamable HTTP 地址和 Bearer 请求头。
MCP 工具可独立使用，安装 Skill 后 Agent 会获得操作流程指引。

## 试一次操作

在对话中说「列出带 `hk` 标签且已启用的节点」。读令牌可以发现 `list_nodes` 和
`get_node`，写令牌还可发现 `set_node_enabled`。`hermes mcp test subman` 检查工具发现，
在对话中实际查询可以验证工具能读取已配置的工作区。

使用写令牌时，可以说「停用 `HK-B`，告诉我变更是否已确认」。Hermes 可用稳定的节点 ID
和最新工作区修订号提交。若有多个节点匹配，先指定要变更的节点。

| 结果 | 含义 |
| --- | --- |
| `committed` | SubMan 已核验云端提交，返回本次提交的修订号。 |
| `no_change` | 节点已符合目标状态，无需写入。 |
| `state_conflict` | 工作区已变化，Agent 应重读并判断原请求是否仍适用。 |
| `outcome_uncertain` | 本次提交尚未确认。考虑再次写入前，先查询节点当前状态。 |

节点摘要包括 ID、名称、类型、启用状态、来源、更新时间和标签。响应不返回原始代理 URI 字段、
订阅链接或 Gist 凭证。已有聚合和 sing-box 输出文件通过 SubMan 的单独发布操作更新。
