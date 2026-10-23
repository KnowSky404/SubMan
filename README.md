# SubMan

English | [简体中文](README.zh-CN.md)

Manage proxy nodes, combine subscriptions, and publish stable subscription links.
SubMan supports VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC, and AnyTLS,
with sing-box client configuration exports and an API for trusted backend scripts.

Built with SvelteKit, TypeScript, and Tailwind CSS on Cloudflare Workers.
Business data lives in one private GitHub Gist; a Durable Object coordinates writes.

## Features

- Manage nodes and subscriptions with tags, search, and batch import.
- Aggregate, filter, rename, and sort nodes, including manual drag-and-drop ordering.
- Preview, copy, download, and publish sing-box configurations.
- Keep stable subscription URLs by publishing to the same Gist filename.
- Load current cloud data before editing and confirm saves after cloud delivery.
- Automate node provisioning through the authenticated Server API.

## Get started

1. Open `/auth`, connect a GitHub token with `gist` permission, and load your
   `SubMan-Data` Gist. Enter the original Gist ID if discovery is ambiguous.
2. Add nodes or subscription URLs in `/nodes`.
3. Create an aggregation rule in `/aggregate`.
4. Preview or export in `/exports`, then publish and copy the subscription link.

Each device keeps one cloud binding. Pending changes must settle before further
edits. Tokens use session storage unless you explicitly choose persistence.
See the [user guide](docs/wiki/User-Guide.md) for setup and recovery.

## Local development

Use Bun **1.3.14**:

```bash
bun install --frozen-lockfile
bun run dev -- --host :: --port 5173
```

On a local machine open `http://localhost:5173`; for the project VPS use
`http://oc-de-fra-1.knowsky.uk:5173`.
See [development](docs/wiki/Development.md) for Worker runtime testing and checks.

## Documentation

[GitHub Wiki](https://github.com/KnowSky404/SubMan/wiki) ·
[English source index](docs/wiki/Home.md) · [中文文档](docs/wiki/Home.zh-CN.md)

| Guide | English | 简体中文 |
| --- | --- | --- |
| Usage and recovery | [User guide](docs/wiki/User-Guide.md) | [使用指南](docs/wiki/User-Guide.zh-CN.md) |
| Development and Wiki maintenance | [Development](docs/wiki/Development.md) | [开发指南](docs/wiki/Development.zh-CN.md) |
| API and automation | [Server API](docs/api/server-api.md) | [接口文档](docs/api/server-api.zh-CN.md) |
| Operations and deployment | [Operations](docs/workspace-v2-operations.md) | [运维指南](docs/workspace-v2-operations.zh-CN.md) |
| Project changes | [Changelog](docs/wiki/Changelog.md) | [变更记录](docs/wiki/Changelog.zh-CN.md) |

The [documentation index](docs/README.md) also covers migration, export formats,
integrations, and the roadmap. [OpenAPI](docs/api/openapi.yaml) is the API contract;
[AGENTS.md](AGENTS.md) and [DESIGN.md](DESIGN.md) describe contributor conventions.

## License

[GNU Affero General Public License v3.0 only](LICENSE).
