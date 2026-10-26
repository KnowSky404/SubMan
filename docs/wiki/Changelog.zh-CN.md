# 变更记录

[English](Changelog.md) | 简体中文

按时间倒序记录有意义的产品、维护和迁移变化，中英文在同一提交中更新。
这里记录仓库变更；生产部署和真实服务验收需另有验证证据。

## 未发布

### 2026-10-26 - 精简页面与顶部工具栏

- 将顶部状态标签、Gist ID 和设置按钮收为状态、主题、GitHub 三个图标，
  保留无障碍名称、悬停提示、待处理/异常提示与修复入口。
- 删除各页重复说明和统计胶囊、首页状态面板、Gist 信息侧栏、导出统计卡片；
  保留实际告警、发布链接及列表旁的必要计数。
- 首页计数可直接进入对应页面，小屏幕顶部工具栏保持单行。

### 2026-10-26 - Worktree 与 PR 开发工作流

- 参考 FlareMail，统一任务隔离、当前 head 的 Codex review、rebase 合并、
  主分支核对/同步及已合并 worktree/分支清理约定。
- 增加 PR 模板和双语操作指南，明确远端分支条件删除与 rebase 后的整合核对。
- 保留 SubMan 的 CI、Bun 版本和发布/部署授权规则；
  仓库约定不等于已配置 GitHub review 集成或 ruleset。

### 2026-10-26 - API 与 sing-box-vps 兼容性核对

- 在 OpenAPI 和中英文 API、Agent 参考中明确分层 Gist 发现策略与非空 PATCH 要求，
  补充 PATCH schema 契约检查。
- 说明对象标签在 label 规范化为空 ID 时必须显式提供 ID，推荐调用方使用字符串标签。
- 依据 SubMan `ed6fa5a` 重新核对 sing-box-vps `9bac47e`；在 key、标签、预期 Gist
  校验缺口之外，记录响应头解析的可移植性问题，并增加基于模拟数据的适配验收标准。
- 在中英文 README 增加集成指南入口，统一运维和部署清单中的文档门禁说明。
  运行时 API 行为保持不变。

### 2026-10-23 - 仓库与文档整理

- 精简中英文 README，将详细使用、开发说明整理进双语 Wiki。
- 增加 Wiki 页面生成、语言导航和本地文档检查。
- 统一使用 `DESIGN.md`，保留 `AGENTS.md` 作为项目 Agent 入口，删除重复的 Agent 文件和过时的根目录日志。
- 历史设计与计划归档至 `docs/archive/`；品牌设计原稿移出生产静态目录。
- 删除无调用的手动同步、时间戳合并、旧浏览器 mutation 模块、配套过时测试、空的库导出入口，以及未使用的 Lucide 依赖。

## 早期开发里程碑

- [单一云端数据源](https://github.com/KnowSky404/SubMan/commit/9c5ab76)：每台设备一个绑定，
  编辑前读取云端，变更立即按修订号发送，云端确认后才报告保存成功。
- [保留 API 外部键](https://github.com/KnowSky404/SubMan/commit/7a5cb8f)：保留节点外部键，统一公共集成契约。

原根目录日志记录的是最初的浏览器原型需求：GitHub Gist 存储、节点和订阅聚合、重命名与过滤，
以及 Svelte、Tailwind、Bun 技术栈。它属于项目起点说明，并非版本日志。
当前产品还包含 Cloudflare Worker 和 Durable Object；原始说明保留在 Git 历史中。
