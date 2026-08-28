# sing-box Client Export

SubMan generates a complete sing-box client configuration from an existing
Aggregate rule. The generator is pure application code: it does not call
GitHub, write a Gist, or read browser storage. The `/exports` page owns profile
editing and presentation; Workspace publication goes through the existing
revisioned mutation boundary.

The URI mappings in this document were checked against the current sing-box
outbound documentation for the v1.14 line and the Hysteria2 URI specification
on 2026-08-28. A mapping is added only when the source URI field has a reliable
sing-box equivalent.

## Supported outbound matrix

| Source URI | Generated outbound | Mapped fields | Notes |
| --- | --- | --- | --- |
| `vless://` | `vless` | server, port, UUID, flow, network, packet encoding, TLS/Reality, transport, multiplex | `none`, `tls`, and `reality` security; only `xtls-rprx-vision` flow is accepted |
| `vmess://` | `vmess` | base64 JSON server/port/UUID, security, alter ID, global padding, authenticated length, network, TLS, transport, packet encoding, multiplex | Includes the legacy `aes-128-ctr` security value; payload must be valid base64 UTF-8 JSON |
| `trojan://` | `trojan` | server, port, password, TLS, transport, multiplex | Trojan's TLS outbound is enabled by default |
| `ss://` | `shadowsocks` | method, password, server/port, SIP003 plugin/options, UDP-over-TCP, multiplex | Direct and base64 authority forms are accepted |
| `hysteria2://`, `hy2://` | `hysteria2` | server, default/single port, port-hopping lists and ranges, password or userpass, network, TLS/SNI/ALPN/insecure, Salamander or Gecko obfuscation | Omitted port defaults to `443`; bracketed IPv6 is accepted; certificate pinning and ECH fail closed until exact mappings exist |
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

## Hysteria2 URI fidelity

SubMan uses one shared Hysteria2 parser for node validation and sing-box export.
This avoids accepting an URI in the editor and rejecting the same URI only when
building a client configuration.

Supported authority forms include:

- `hy2://password@example.com`, with an implicit port of `443`;
- `hy2://username:password@example.com:8443`, preserving the complete
  `username:password` authentication value;
- independent port lists such as `443,8443,9443`;
- ranges such as `5000-6000`;
- mixed lists and ranges such as `443,5000-6000,8443`;
- bracketed IPv6 hosts with the same port-hopping syntax.

A single explicit or default port is emitted as `server_port`. Any URI that
contains more than one port or a range is emitted as `server_ports`, without a
conflicting `server_port`. Hysteria2 URI ranges use `start-end`; sing-box parses
port ranges as `start:end`, so SubMan converts each segment deterministically.
Independent ports in a multi-port URI become exact ranges such as `443:443`.

Both Salamander and Gecko obfuscation are supported when `obfs-password` (or the
legacy `obfs_password` alias) is non-empty. Gecko packet-size values are not
invented because the standard sharing URI does not carry them.

Known connection-security fields fail closed instead of being silently dropped:

- Hysteria2 `pinSHA256` is a full certificate fingerprint. It is not equivalent
  to sing-box `certificate_public_key_sha256`, which hashes the certificate
  public key, so SubMan does not copy or reinterpret it.
- Hysteria2 `ech` is not converted until the source ECH config-list semantics
  have a verified mapping to sing-box's structured TLS ECH options.
- `hysteria2+realm://` and `hysteria2+realm+http://` are separate Realm sharing
  schemes and are not handled by the ordinary Hysteria2 parser.

An unsupported or malformed Hysteria2 line produces a stable warning and is
skipped. Other valid lines in the same Aggregate remain eligible for export.
Warnings never include the original URI, authentication value, certificate
fingerprint, ECH payload, or obfuscation password.

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
- [Hysteria2 URI scheme](https://v2.hysteria.network/docs/developers/URI-Scheme/)
- [TUIC outbound](https://sing-box.sagernet.org/configuration/outbound/tuic/)
- [AnyTLS outbound](https://sing-box.sagernet.org/configuration/outbound/anytls/)
