# SubMan

[English](README.md) | 简体中文

管理代理节点、聚合订阅并发布稳定的订阅链接。支持 VLESS、VMess、Trojan、Shadowsocks、
Hysteria2、TUIC 和 AnyTLS，提供 sing-box 客户端配置导出及面向可信后端脚本的 API。

使用 SvelteKit、TypeScript 和 Tailwind CSS，运行于 Cloudflare Workers。
业务数据保存在一个私有 GitHub Gist 中，由 Durable Object 协调写入。

## 主要功能

- 节点和订阅管理：标签、搜索、批量导入。
- 聚合、过滤、重命名和排序，支持手动拖拽。
- sing-box 配置预览、复制、下载和发布。
- 向同一 Gist 文件发布，保持订阅链接稳定。
- 编辑前读取最新云端数据，云端确认后才报告保存成功。
- 通过鉴权 Server API 自动管理节点。

## 开始使用

1. 在 `/auth` 连接具有 `gist` 权限的 GitHub Token，加载 `SubMan-Data` Gist；
   如果发现多个候选，输入原 Gist ID。
2. 在 `/nodes` 添加节点或订阅地址。
3. 在 `/aggregate` 创建聚合规则。
4. 在 `/exports` 预览或导出配置，发布后复制订阅链接。

每台设备保留一个云端绑定；待发送的变更处理完毕后才能继续编辑。
Token 默认仅在当前会话保存，持久保存需主动选择。
详细设置和恢复步骤见[使用指南](docs/wiki/User-Guide.zh-CN.md)。

## 本地开发

使用 Bun **1.3.14**：

```bash
bun install --frozen-lockfile
bun run dev -- --host :: --port 5173
```

本机访问 `http://localhost:5173`；项目 VPS 使用
`http://oc-de-fra-1.knowsky.uk:5173`。
Worker 运行时验证与完整检查见[开发指南](docs/wiki/Development.zh-CN.md)。

## 文档

[GitHub Wiki](https://github.com/KnowSky404/SubMan/wiki/Home.zh-CN) ·
[中文文档源](docs/wiki/Home.zh-CN.md) · [English](docs/wiki/Home.md)

| 指南 | English | 简体中文 |
| --- | --- | --- |
| 使用与恢复 | [User guide](docs/wiki/User-Guide.md) | [使用指南](docs/wiki/User-Guide.zh-CN.md) |
| 开发与 Wiki 维护 | [Development](docs/wiki/Development.md) | [开发指南](docs/wiki/Development.zh-CN.md) |
| API 与自动化 | [Server API](docs/api/server-api.md) | [接口文档](docs/api/server-api.zh-CN.md) |
| 运维与部署 | [Operations](docs/workspace-v2-operations.md) | [运维指南](docs/workspace-v2-operations.zh-CN.md) |
| 项目变更 | [Changelog](docs/wiki/Changelog.md) | [变更记录](docs/wiki/Changelog.zh-CN.md) |

[完整文档目录](docs/README.zh-CN.md)还包括迁移、导出格式、集成和路线图。
[OpenAPI](docs/api/openapi.yaml) 为 API 契约；
[AGENTS.md](AGENTS.md) 和 [DESIGN.md](DESIGN.md) 说明贡献约定。

## 许可证

[GNU Affero General Public License v3.0 only](LICENSE)。
