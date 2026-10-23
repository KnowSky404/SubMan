# sing-box 客户端导出

[English](sing-box-export.md) | 简体中文

SubMan 从已有聚合规则生成完整 sing-box 客户端配置。生成器是纯应用代码，
不调用 GitHub、不写 Gist，也不读取浏览器存储。`/exports` 负责配置编辑和展示；
发布通过既有的版本化工作区 mutation。

本文 URI 映射于 2026-09-03 对照 sing-box `1.14.0`、对应 outbound schema 和
Hysteria2 URI 规范审计。CI 也使用官方多架构 `1.14.0` 容器检查生成 fixture。
只有源 URI 字段具有可靠的 sing-box 对应项时才增加映射。

## 支持矩阵

| URI | outbound | 映射字段 | 说明 |
| --- | --- | --- | --- |
| `vless://` | `vless` | 服务器/端口、UUID、flow、network、packet encoding、TLS/Reality、transport、multiplex | 支持 `none`/`tls`/`reality`；Reality 必须有公钥和支持的 uTLS 指纹；flow 仅 `xtls-rprx-vision` |
| `vmess://` | `vmess` | base64 JSON 服务器/端口/UUID、security、alter ID、global padding、authenticated length、network、TLS、transport、packet encoding、multiplex | security 仅 `auto`、`none`、`zero`、`aes-128-cfb`、`aes-128-gcm`、`chacha20-poly1305`；必须是合法 base64 UTF-8 JSON |
| `trojan://` | `trojan` | 服务器/端口、密码、TLS、transport、multiplex | 默认启用 TLS |
| `ss://` | `shadowsocks` | method、密码、服务器/端口、network、SIP003 plugin/options、UDP-over-TCP、multiplex | 支持明文与 base64 authority；method/plugin 按目标白名单；UDP-over-TCP 与 multiplex 互斥 |
| `hysteria2://`、`hy2://` | `hysteria2` | 默认/单端口、跳跃端口列表/范围、密码或 userpass、network、TLS/SNI/ALPN/insecure/uTLS、Salamander/Gecko | 默认 `443`，支持方括号 IPv6；未知参数、证书固定和 ECH 拒绝转换 |
| `tuic://` | `tuic` | 服务器/端口、UUID、密码、congestion control、UDP relay mode、UDP-over-stream、zero-RTT、heartbeat、network、TLS/SNI/ALPN/insecure | 拥塞控制为 `cubic`/`new_reno`/`bbr`；显式 relay mode 不能与 UDP-over-stream 同时使用 |
| `anytls://` | `anytls` | 服务器/端口、密码、TLS/SNI/ALPN/insecure、idle-session 设置 | 不合成或复制 `client_metadata` |
| `ssr://` | 无 | 无 | 跳过并给稳定警告，不生成伪造 outbound |

TLS 映射含 SNI、ALPN、`insecure`、uTLS、VLESS Reality 公钥/short ID。
uTLS 指纹转为小写，只允许 `chrome`、`firefox`、`edge`、`safari`、`360`、`qq`、
`ios`、`android`、`random`、`randomized`。支持 WebSocket、gRPC、HTTP、HTTPUpgrade
和 TLS QUIC。QUIC URI 的 encryption/key 被拒绝，因为 sing-box 的 V2Ray QUIC
不实现 v2ray-core 对应参数。`packetaddr`、`xudp` 直接输出，显式 `none` 省略字段。
不支持的传输、安全、packet encoding 或非法 percent/base64 只警告并跳过当前行，
不丢弃其他可转换节点。

需要凭据的协议缺失凭据时拒绝解析。重复显示标签按数字后缀确定性去重；
固定 selector、URL-test、direct 和 block 标签保留。

## Hysteria2 URI 保真度

录入校验和导出共用解析器，避免编辑器接受后导出才拒绝同一 URI。支持：

- `hy2://password@example.com`，端口默认 `443`。
- `hy2://username:password@example.com:8443`，保留完整 `username:password`。
- `443,8443,9443` 独立端口列表。
- `5000-6000` 范围。
- `443,5000-6000,8443` 混合列表/范围。
- 使用相同跳跃语法的方括号 IPv6。

单一端口写 `server_port`；多个端口或范围写 `server_ports`，不同时写冲突的单端口。
URI 范围 `start-end` 转成 sing-box 的 `start:end`，独立端口转成 `443:443` 精确范围。

`obfs-password` 或旧别名 `obfs_password` 非空时支持 Salamander、Gecko。
分享 URI 不携带的 Gecko 包大小不会凭空生成。

查询参数采用明确白名单：混淆及密码、SNI 别名、证书校验别名、ALPN、uTLS 指纹别名、
`network`、`pinSHA256`、`ech`。未知未来参数给安全警告并跳过，不静默忽略；
验证分享语义和目标映射后才添加。

安全字段无法可靠映射时拒绝转换：

- `pinSHA256` 是完整证书指纹，不等于哈希公钥的 `certificate_public_key_sha256`，不能直接复制。
- `ech` 的源 config-list 语义尚未核实为结构化 TLS ECH options，因此不转换。
- `hysteria2+realm://` 与 `hysteria2+realm+http://` 是独立 scheme，普通解析器不处理。

不支持或非法行给稳定警告并跳过，其他合法行仍可导出。警告不包含原 URI、认证值、
证书指纹、ECH 内容或混淆密码。

## 订阅输入

生成聚合或导出时由浏览器抓取订阅，订阅服务器必须允许浏览器 CORS；SubMan 没有开放式后端中继。

- 15 秒超时，包含响应体流式读取。
- 最大响应 4 MiB，同时检查响应头和已读取字节。
- 严格 UTF-8 解码。
- 支持 URI 文本或 base64 UTF-8。
- 分别报告超时、网络/CORS、HTTP 4xx/5xx、大小、编码、base64 和空内容警告。

警告含订阅名称和稳定错误码，不含源 URL、查询串、凭据或响应原文。
某订阅失败时跳过它，其他聚合输入仍可导出。

## 云端工作区和输出行为

应用先加载唯一绑定的云端工作区再允许业务编辑。复制/下载从聚合规则和导出配置生成文件，
不会发布输出或确认云端保存。应用没有本地业务模式或业务 JSON 备份/导入流程。
发布需要已认证且就绪的工作区；输出和更新后的工作区文档通过同一个协调器 mutation 提交。
协调器是唯一 `subman.json` 写入者，生成文件和配置使用同一 Gist PATCH。
只有 `remote-committed` 报告发布成功；待发送或阻塞状态必须先处理。
输出文件名不能占用 `subman.json`、`subman.v1.backup.json` 或 `subman.bootstrap.json`。

sing-box-vps 等自动化使用的公共节点 API 只更新节点记录，不重新生成聚合或 sing-box 输出。
详见[集成指南](integrations/sing-box-vps.zh-CN.md)。

## 版本目标和可执行验证

目前唯一实现目标为 `"1.14"`，由中央注册表固定到 sing-box `1.14.0`。
不提供随上游变化的 `"latest"`。新增目标须先有独立字段表、回归预期和固定可执行 fixture，
再扩展 TypeScript 类型。第二个目标出现前不增加只有一个值的持久化 profile/UI selector。

浏览器不打包或执行 sing-box。CI/本地可执行门禁：

```bash
bun run test:sing-box
```

它向真实聚合/导出路径注入合成本地订阅，生成所有协议及必要传输/TLS 组合，
检查二进制版本，再把 JSON 交给 `sing-box check`。镜像固定为：

`ghcr.io/sagernet/sing-box:v1.14.0@sha256:4bed9332a0013fef72c31200a84e8fc0ed91a5ab2fe373a69f0acbbbbfbef3c5`

该 digest 是多架构 OCI index。fixture 只用保留/合成地址及凭据，不抓真实订阅、
不连服务器、不访问 Gist、不写生产；门禁需要 Docker。

## 审计结论与边界

- 以真实 `1.14.0` 初始化为兼容依据：接受 VMess `aes-128-cfb`，拒绝 `aes-128-ctr`。
- Shadowsocks method 与内置 `obfs-local`/`v2ray-plugin` 白名单化；保留 network，提前拒绝
  UDP-over-TCP/multiplex 冲突。
- Reality 无 uTLS、TUIC 同时设置 relay mode 和 UDP-over-stream 都会被提前拒绝。
- 不合成 AnyTLS `client_metadata`；Realm、证书固定、ECH、Gecko 包大小、hop interval、
  BBR profile 和 Chrome-parrot 控制在可靠 URI 契约建立前不映射。
- 生成子集没有 `1.14` schema 弃用字段；selector fallback 的 `block` outbound 仍合法。
- `sing-box check` 证明合成矩阵的 schema/初始化，不证明真实服务器凭据或握手。
  SubMan 不复制 sing-box 的全部凭据语义校验，实际部署前仍应检查下载的配置。

官方参考：

- [VLESS](https://sing-box.sagernet.org/configuration/outbound/vless/)
- [VMess](https://sing-box.sagernet.org/configuration/outbound/vmess/)
- [Trojan](https://sing-box.sagernet.org/configuration/outbound/trojan/)
- [Shadowsocks](https://sing-box.sagernet.org/configuration/outbound/shadowsocks/)
- [Hysteria2](https://sing-box.sagernet.org/configuration/outbound/hysteria2/)
- [Hysteria2 URI](https://v2.hysteria.network/docs/developers/URI-Scheme/)
- [TUIC](https://sing-box.sagernet.org/configuration/outbound/tuic/)
- [AnyTLS](https://sing-box.sagernet.org/configuration/outbound/anytls/)
- [V2Ray transport](https://sing-box.sagernet.org/configuration/shared/v2ray-transport/)
