# sing-box Client Export

SubMan generates a complete sing-box client configuration from an existing
Aggregate rule. The generator is pure application code: it does not call
GitHub, write a Gist, or read browser storage. The `/exports` page owns profile
editing and presentation; Workspace publication goes through the existing
revisioned mutation boundary.

The URI mappings in this document were audited against sing-box `1.14.0`, its
versioned outbound schema, and the Hysteria2 URI specification on 2026-09-03.
CI also runs the generated fixture configuration through the official
multi-architecture `1.14.0` container. A mapping is added only when the source
URI field has a reliable sing-box equivalent.

## Supported outbound matrix

| Source URI | Generated outbound | Mapped fields | Notes |
| --- | --- | --- | --- |
| `vless://` | `vless` | server, port, UUID, flow, network, packet encoding, TLS/Reality, transport, multiplex | `none`, `tls`, and `reality` security; Reality requires both its public key and a supported uTLS fingerprint; only `xtls-rprx-vision` flow is accepted |
| `vmess://` | `vmess` | base64 JSON server/port/UUID, security, alter ID, global padding, authenticated length, network, TLS, transport, packet encoding, multiplex | Security is restricted to the target schema: `auto`, `none`, `zero`, `aes-128-cfb`, `aes-128-gcm`, or `chacha20-poly1305`; payload must be valid base64 UTF-8 JSON |
| `trojan://` | `trojan` | server, port, password, TLS, transport, multiplex | Trojan's TLS outbound is enabled by default |
| `ss://` | `shadowsocks` | method, password, server/port, network, SIP003 plugin/options, UDP-over-TCP, multiplex | Direct and base64 authority forms are accepted; methods and plugins are checked against the target schema; UDP-over-TCP and multiplex cannot be combined |
| `hysteria2://`, `hy2://` | `hysteria2` | server, default/single port, port-hopping lists and ranges, password or userpass, network, TLS/SNI/ALPN/insecure/uTLS, Salamander or Gecko obfuscation | Omitted port defaults to `443`; bracketed IPv6 is accepted; unknown parameters, certificate pinning, and ECH fail closed |
| `tuic://` | `tuic` | server/port, UUID, password, congestion control, UDP relay mode, UDP-over-stream, zero-RTT, heartbeat, network, TLS/SNI/ALPN/insecure | Supported congestion controls are `cubic`, `new_reno`, and `bbr`; an explicit relay mode cannot be combined with UDP-over-stream |
| `anytls://` | `anytls` | server/port, password, TLS/SNI/ALPN/insecure, idle-session settings | `client_metadata` is never synthesized or copied |
| `ssr://` | none | none | The line is skipped with a stable warning; no fake outbound is generated |

TLS mappings include SNI, ALPN, certificate verification bypass (`insecure`),
uTLS, and the VLESS Reality public key/short ID when present. uTLS fingerprints
are normalized to lowercase and restricted to `chrome`, `firefox`, `edge`,
`safari`, `360`, `qq`, `ios`, `android`, `random`, or `randomized`. WebSocket,
gRPC, HTTP, HTTPUpgrade, and TLS-backed QUIC transports are supported. QUIC URI
encryption/key fields fail closed because sing-box's V2Ray QUIC transport does
not implement those v2ray-core settings. Packet encoding values `packetaddr`
and `xudp` are emitted directly; an explicit `none` disables the field and is
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

The accepted Hysteria2 query surface is an explicit allowlist: obfuscation and
its password, SNI aliases, certificate-verification aliases, ALPN, uTLS
fingerprint aliases, `network`, `pinSHA256`, and `ech`. Unknown future
parameters are skipped with a safe warning instead of being silently discarded.
They can be added after their sharing semantics and sing-box mapping are
verified for the selected target.

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

## Version target and executable validation

The only selectable implementation target is currently `"1.14"`, resolved by
the central target registry to sing-box `1.14.0`. A `"latest"` target is
intentionally not exposed: it would make URI acceptance and generated schema
depend on mutable upstream state. Adding another target requires its own field
tables, regression expectations, and pinned executable fixture before the
TypeScript target union is expanded. A persisted profile/UI selector is deferred
until there is a second supported target, avoiding a schema field with only one
valid value.

The browser generator intentionally does not bundle or run sing-box. The CI and
local executable gate is:

```bash
bun run test:sing-box
```

It injects a synthetic local subscription into the real aggregate/export path,
generates outbounds for all supported protocols and the required transport/TLS
variants, checks the reported binary version, and pipes the JSON to `sing-box
check`. The image is fixed to
`ghcr.io/sagernet/sing-box:v1.14.0@sha256:4bed9332a0013fef72c31200a84e8fc0ed91a5ab2fe373a69f0acbbbbfbef3c5`.
The digest is a multi-architecture OCI index. The fixture uses only reserved or
synthetic addresses and credentials; it performs no subscription fetch, server
connection, Gist access, or production write. Docker is required for this gate.

## Audit conclusions and remaining risk

- Actual `1.14.0` initialization, rather than older documentation, is the
  compatibility authority. It accepts VMess `aes-128-cfb` but rejects
  `aes-128-ctr`; the exporter now does the same.
- Shadowsocks methods and its two built-in SIP003 plugins (`obfs-local` and
  `v2ray-plugin`) are allowlisted. Network is preserved, and the documented
  UDP-over-TCP/multiplex conflict is rejected before export.
- Reality without uTLS and TUIC with both relay mode and UDP-over-stream are
  rejected before export; both combinations fail sing-box initialization.
- AnyTLS `client_metadata` is not synthesized. Hysteria2 Realm, certificate
  pinning, ECH, Gecko packet-size tuning, hop-interval tuning, BBR profiles, and
  Chrome-parrot controls remain intentionally unmapped until a source URI
  contract exists.
- The generated subset uses no field deprecated by the `1.14` outbound schema.
  The `block` outbound remains valid for the selector fallback in `1.14`.
- `sing-box check` proves schema parsing and outbound initialization for the
  synthetic matrix; it does not prove that a real remote server accepts the
  credentials or transport handshake. SubMan also does not duplicate every
  semantic credential check performed by sing-box. Operators should still run
  `sing-box check` on downloaded user configurations before deployment.

Official schema references:

- [VLESS outbound](https://sing-box.sagernet.org/configuration/outbound/vless/)
- [VMess outbound](https://sing-box.sagernet.org/configuration/outbound/vmess/)
- [Trojan outbound](https://sing-box.sagernet.org/configuration/outbound/trojan/)
- [Shadowsocks outbound](https://sing-box.sagernet.org/configuration/outbound/shadowsocks/)
- [Hysteria2 outbound](https://sing-box.sagernet.org/configuration/outbound/hysteria2/)
- [Hysteria2 URI scheme](https://v2.hysteria.network/docs/developers/URI-Scheme/)
- [TUIC outbound](https://sing-box.sagernet.org/configuration/outbound/tuic/)
- [AnyTLS outbound](https://sing-box.sagernet.org/configuration/outbound/anytls/)
- [V2Ray transport](https://sing-box.sagernet.org/configuration/shared/v2ray-transport/)
