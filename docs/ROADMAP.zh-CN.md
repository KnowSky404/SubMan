# SubMan 路线图

[English](ROADMAP.md) | 简体中文

状态：2026-10-23。这里区分已交付能力、后续接口工作和仍需设计的协议；
不构成部署或修改生产工作区的授权。

## 当前已交付

- 单个绑定的私有云端 Gist，启动先加载云端，变更立即按版本同步。
  只有云端确认才报告保存成功，待发送或阻塞状态禁止继续业务编辑。
  已移除工作区切换、本地业务模式、手动推送/合并和业务 JSON 备份/导入；保留历史恢复证据。
- 文档默认英文，可通过配对文档链接切换简体中文。
- Workspace Schema V2：每个工作区一个 Durable Object 协调器，版本化变更、
  mutation 幂等、墓碑、逐字节 V1 备份及浏览器队列恢复。
- sing-box 客户端导出支持 VLESS、VMess、Trojan、Shadowsocks、Hysteria2、TUIC、AnyTLS。
  ShadowsocksR 可导入聚合，但导出跳过并警告；未知或非法行独立警告。
  明确的 `1.14` 目标使用版本化加密方法、插件、混淆和 uTLS 白名单。
- Hysteria2 共享解析覆盖默认 `443`、密码与 userpass、方括号 IPv6、端口列表/范围、
  Salamander/Gecko；证书固定、ECH 和 Realm 未有可靠映射时拒绝转换。
- 订阅抓取有 15 秒超时、4 MiB 上限、严格 UTF-8、HTTP 分类与安全的网络/CORS 诊断。
  节点与聚合预览提供本地化诊断，涵盖超时、CORS、HTTP、大小、编码、Base64 和空内容，
  只保留安全错误类别与 HTTP 状态，不包含源 URL 或凭据。
- 节点录入、聚合、Server API 类型校验和导出共用 URI 兼容层。
- Worker 结构化日志使用字段白名单和工作区 ID 哈希；生成类型可复现并检查漂移。
- GitHub CI 用固定 digest 的 sing-box `1.14.0` 验证合成导出，检查 Worker 类型、
  Cloudflare 集成、部署 dry-run 与本地 Workers 浏览器行为。生产部署须显式触发并经过环境门禁。

## 后续产品与可靠性工作

1. 依据提交的 fixture 和上游 schema 持续完善协议保真度，包括核实 Hysteria2 ECH、
   独立 Realm scheme，以及其他协议的传输/TLS 字段。部分旧输入保留独立警告，安全字段不静默丢弃。
2. 首次扩展公共 API 前先审阅[接口路线图](api/roadmap.zh-CN.md)，写入仍通过协调器。
3. 持续覆盖各主页面的可访问性和响应式浏览器测试，明确本地/模拟、真实认证和生产证据边界。
4. 维持 Worker 类型和 Cloudflare 配置的本地/CI 检查；完整运行时、集成、浏览器、
   dry-run 和类型门禁通过后才能调整兼容日期。

## 延后的 Workspace V3 设计

- 独立变更输出文件时的发布新鲜度和先读后写语义。
- 证明旧 ID 不可重放的墓碑压缩协议。
- 有保留、重放和备份约定的 processed-mutation 清理。
- 上游提交结果不明确时的维护者恢复、确认和审计语义。

这些工作需要新协议、迁移规则、故障注入和恢复证据。按时间删除或直接 PATCH Gist
不能作为维护捷径。

## 验证策略

每个实现范围保留适用的本地门禁：

```bash
bun test
bun run test:sing-box
bun run check
bun run lint
bun run build
bun run test:cf
bun run deploy:check
bun run test:e2e
```

真实认证浏览器检查、Gist 写入、生产部署和 Cloudflare secret 操作需要单独授权。
