# Operate SubMan from Hermes Agent

English | [简体中文](subman-operator-guide.zh-CN.md)

Connect an MCP client to a configured SubMan Worker to find proxy nodes and
inspect safe summaries. The optional write credential lets the client enable or
disable one node at a time. The [SubMan operator skill](subman-operator/SKILL.md)
teaches the agent how to find the right node and interpret the result.

## Configure the Worker

Use an existing private `SubMan-Data` Gist with a valid Workspace Schema V2
`subman.json`. Set these values in your Worker deployment. Use Wrangler's
interactive prompt or the deployment's existing secret management workflow.

| Worker setting | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Existing Worker credential with access to the target Gist. Keep it on the Worker. |
| `SUBMAN_MCP_GIST_ID` | ID of that Gist. Use the ID from its GitHub Gist page. |
| `SUBMAN_MCP_READ_TOKEN` | Dedicated Bearer token for node reads. |
| `SUBMAN_MCP_WRITE_TOKEN` | Optional dedicated Bearer token for node reads and single-node enable or disable. |

Generate each MCP token separately with a secure generator such as
`openssl rand -hex 32`. Use 32 to 512 URL-safe characters drawn from letters,
digits, `-`, and `_`. Keep the two MCP tokens distinct from each other, the
GitHub token, and the existing `SUBMAN_API_TOKEN`.

```sh
bun wrangler secret put SUBMAN_MCP_GIST_ID
bun wrangler secret put SUBMAN_MCP_READ_TOKEN
# Optional. Configure only if an agent needs to enable or disable nodes.
bun wrangler secret put SUBMAN_MCP_WRITE_TOKEN
```

The Worker needs the Gist ID, read token, and GitHub credential to enable MCP.
It reads the configured Gist directly. If the document is missing, invalid, or
requires migration, resolve that in SubMan before using MCP. Use the read token
for the default connection and grant the write token only to a profile you
intend to authorize for node changes.

## Connect Hermes

1. In the active Hermes profile's `.env`, set `SUBMAN_MCP_TOKEN` to the SubMan
   read token. For the optional write connection, use the dedicated write token
   as that value. The default Hermes profile stores `.env` in `~/.hermes/`.
2. Add this to the active profile's `config.yaml`, merging it with any existing
   `mcp_servers` section. Replace the example URL with your SubMan Worker URL.

   ```yaml
   mcp_servers:
     subman:
       url: "https://subman.example.com/mcp"
       headers:
         Authorization: "Bearer ${SUBMAN_MCP_TOKEN}"
       trust: untrusted
   ```

   The default profile uses `~/.hermes/config.yaml`. The header references the
   stored secret. `trust: untrusted` asks for approval on write calls when Hermes
   approvals are enabled. The Worker independently enforces each token's tool
   permissions. [Hermes MCP configuration](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)

3. Run these commands in Hermes' shell, then start a new session or use
   `/reload-mcp` in an open session.

   ```sh
   hermes skills install KnowSky404/SubMan/docs/agents/subman-operator
   hermes mcp test subman
   ```

   The [operator skill](subman-operator/SKILL.md) is also available to copy into
   `subman-operator/SKILL.md` in your client's skills directory. The
   [Chinese edition](subman-operator/SKILL.zh-CN.md) can be installed under the
   same `SKILL.md` filename. [Hermes Skill installation](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills#installing-individual-skills-directly-without-adding-a-tap)

Other MCP clients can use the same Streamable HTTP URL and Bearer header with
their own secret configuration. MCP tools work with or without the skill.

## Try an operation

Ask “List the enabled nodes tagged `hk`.” The read credential discovers
`list_nodes` and `get_node`. The write credential also discovers
`set_node_enabled`. `hermes mcp test subman` verifies discovery. The query in
chat verifies that the discovered tool can read the configured Workspace.

With the write credential, ask “Disable `HK-B` and tell me whether the change
was confirmed.” Hermes can use the stable node ID and the latest workspace
revision. If several nodes match, specify the intended node before the write.

| Result | Meaning |
| --- | --- |
| `committed` | SubMan verified the cloud commit. The reply includes the committed revision. |
| `no_change` | The node already had the requested state. No write was needed. |
| `state_conflict` | The latest workspace changed. The agent must re-read before deciding whether the request still applies. |
| `outcome_uncertain` | The commit could not be confirmed. Read the current node state before considering another write. |

Node summaries include ID, name, type, enabled status, source, update time, and
tags. The response omits raw proxy URI fields, subscription links, and Gist
credentials. Published aggregate and sing-box output files are updated by a
separate publication in SubMan.
