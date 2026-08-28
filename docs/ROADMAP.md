# SubMan Roadmap

Status: 2026-08-28. This roadmap is deliberately split between shipped
capabilities, contract work, and protocol work that still needs design. It is
not a promise to deploy or mutate a production Workspace.

## Shipped in the current line

- Workspace Schema V2 with one Durable Object coordinator per Workspace,
  revisioned mutations, idempotency, tombstones, byte-exact V1 backup, and
  browser queue recovery.
- sing-box client export support for VLESS, VMess, Trojan, Shadowsocks,
  Hysteria2, TUIC, and AnyTLS. ShadowsocksR remains importable and is skipped
  from sing-box output with a warning; unknown and malformed lines are
  warning-first.
- Shared Hysteria2 URI validation and export parsing for implicit port `443`,
  password and userpass authentication, bracketed IPv6, port-hopping lists and
  ranges, and Salamander or Gecko obfuscation. Hysteria2 certificate pinning,
  ECH, and Realm sharing fail closed instead of being silently mis-mapped.
- Bounded subscription fetching with a 15 second timeout, a 4 MiB response
  limit, fatal UTF-8 decoding, HTTP status classes, and network/CORS-safe
  diagnostics.
- Localized, actionable subscription diagnostics in node and aggregate previews
  for timeout, CORS, HTTP, response-size, encoding, Base64, and empty-content
  failures. UI diagnostics retain only the safe error class and HTTP status;
  source URLs and credentials are excluded.
- One shared proxy URI compatibility layer used by node entry, aggregation,
  Server API type validation, and sing-box export parsing.
- Structured Worker observability with an allowlisted field set and hashed
  Workspace identifiers. Wrangler type generation is reproducible and checked
  for drift.
- GitHub CI validates generated Worker types, the Cloudflare integration suite,
  a Wrangler deployment dry run, and browser behavior through the local Workers
  runtime before Chromium-dependent checks. Production deployment is an
  explicit, environment-gated workflow rather than an automatic push action.

## Next product and reliability work

1. Continue sing-box protocol fidelity using checked-in fixtures and upstream
   schema review. Candidate slices include verified Hysteria2 ECH semantics,
   Realm as a separate sharing scheme, and additional transport/TLS fields for
   other supported protocols. Each mapping must preserve warning-first behavior
   for partial or legacy input and fail closed for security-sensitive fields.
2. Add the first public API expansion only after the contract in
   [`docs/api/roadmap.md`](api/roadmap.md) is reviewed. All writes continue to
   use the Workspace coordinator.
3. Continue accessibility and responsive browser coverage for every primary
   route. Browser checks must distinguish local/mock evidence from authenticated
   Workspace or production evidence.
4. Keep generated Worker types and Cloudflare configuration in the normal local
   and CI verification path; change the compatibility date only after the
   complete runtime, Cloudflare, browser, deployment dry-run, and type gates
   pass.

## Deferred Workspace V3 design work

The following items are intentionally not implemented as maintenance shortcuts:

- publication freshness and read-before-write semantics for independently
  changed output files;
- tombstone compaction with a protocol for proving that old IDs can no longer
  be replayed;
- processed-mutation pruning with a retention, replay, and backup contract;
- operator recovery tooling for ambiguous upstream commits, including explicit
  acknowledgement and audit semantics.

These require a new protocol design, migration rules, failure-injection tests,
and recovery evidence. Time-based deletion or a direct Gist patch would violate
the current Workspace invariants.

## Verification policy

Every implementation slice should retain the local gates:

```bash
bun test
bun run check
bun run lint
bun run build
bun run test:cf
bun run deploy:check
bun run test:e2e
```

Authenticated browser checks, real Gist writes, production deployment, and
Cloudflare secret operations remain operator-authorized steps.
