# sing-box Client Export

SubMan generates a complete sing-box client configuration from an existing
Aggregate rule. The generator is pure application code: it does not call
GitHub, write a Gist, or read browser storage. The `/exports` page owns profile
editing and presentation; Workspace publication goes through the existing
revisioned mutation boundary.

The URI mappings in this document were checked against the current sing-box
outbound documentation for the v1.14 line on 2026-08-28. A mapping is added
only when the source URI field has a reliable sing-box equivalent.

## Supported outbound matrix

| Source URI | Generated outbound | Mapped fields | Notes |
| --- | --- | --- | --- |
| `vless://` | `vless` | server, port, UUID, flow, network, packet encoding, TLS/Reality, transport, multiplex | `none`, `tls`, and `reality` security; only `xtls-rprx-vision` flow is accepted |
| `vmess://` | `vmess` | base64 JSON server/port/UUID, security, alter ID, global padding, authenticated length, network, TLS, transport, packet encoding, multiplex | Includes the legacy `aes-128-ctr` security value; payload must be valid base64 UTF-8 JSON |
| `trojan://` | `trojan` | server, port, password, TLS, transport, multiplex | Trojan's TLS outbound is enabled by default |
| `ss://` | `shadowsocks` | method, password, server/port, SIP003 plugin/options, UDP-over-TCP, multiplex | Direct and base64 authority forms are accepted |
| `hysteria2://`, `hy2://` | `hysteria2` | server/port, password, network, TLS/SNI/ALPN/insecure, Salamander obfuscation | Only the `salamander` obfuscation type is emitted |
| `tuic://` | `tuic` | server/port, UUID, password, congestion control, UDP relay mode, UDP-over-stream, zero-RTT, heartbeat, network, TLS/SNI/ALPN/insecure | Supported congestion controls are `cubic`, `new_reno`, and `bbr` |
| `anytls://` | `anytls` | server/port, password, TLS/SNI/ALPN/insecure, idle-session settings | `client_metadata` is never synthesized or copied |
| `ssr://` | none | none | The line is skipped with a stable warning; no fake outbound is generated |

TLS mappings include SNI, ALPN, certificate verification bypass (`insecure`),
and the VLESS Reality public key/short ID when present. WebSocket, gRPC, HTTP,
and HTTPUpgrade transport fields preserve their path, host, and service name
where the source format provides them. Packet encoding values `packetaddr` and
`xudp` are emitted directly; an explicit `none` disables the field and is
therefore omitted from generated JSON. Unsupported transport, security,
packet-encoding, or malformed percent/base64 values produce a warning for that
line and do not discard other convertible lines.

The parser also rejects missing required credentials for the protocols that
need them. Duplicate display tags are made deterministic by adding a numeric
suffix; fixed selector, URL-test, direct, and block tags are reserved.

## Subscription input

Subscription URLs are fetched by the browser when an Aggregate or export is
generated. The browser must be allowed by the subscription server's CORS
policy; SubMan does not provide an open server-side relay. The fetch contract
is:

- 15 second timeout, including response-body streaming;
- 4 MiB maximum response bytes, checked from both headers and streamed data;
- fatal UTF-8 decoding;
- plain URI text or base64 UTF-8 content;
- separate warnings for timeout, network/CORS, HTTP 4xx, HTTP 5xx, size,
  encoding, malformed base64, and empty content.

Warnings contain a subscription name and stable error code, but not the source
URL, query string, credentials, or raw response body. A failed subscription is
skipped while other Aggregate inputs remain eligible for export.

## Local and Workspace behavior

Copy and download work in Local mode. Publishing requires a connected
Workspace and submits the generated output and the updated Workspace document
through one coordinator mutation. The coordinator remains the only component
that can create, replace, or mutate `subman.json`; the generated file is
included in the same Gist PATCH. Export filenames cannot replace the protected
`subman.json` file.

The generator intentionally does not run the sing-box binary in the browser.
The output is checked structurally by unit tests and should be validated with
the target sing-box version by the operator before production use.

Official schema references:

- [VLESS outbound](https://sing-box.sagernet.org/configuration/outbound/vless/)
- [VMess outbound](https://sing-box.sagernet.org/configuration/outbound/vmess/)
- [Trojan outbound](https://sing-box.sagernet.org/configuration/outbound/trojan/)
- [Shadowsocks outbound](https://sing-box.sagernet.org/configuration/outbound/shadowsocks/)
- [Hysteria2 outbound](https://sing-box.sagernet.org/configuration/outbound/hysteria2/)
- [TUIC outbound](https://sing-box.sagernet.org/configuration/outbound/tuic/)
- [AnyTLS outbound](https://sing-box.sagernet.org/configuration/outbound/anytls/)
