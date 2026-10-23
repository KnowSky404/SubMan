# 旧版数据排查与迁移

[English](legacy-workspace-migration.md) | 简体中文

云端 Gist 的 `subman.json` 是唯一业务数据源。当前应用每次启动先读取云端，
只绑定一个 Gist，不再提供工作区切换、本地模式、业务 JSON 备份/导入、
手动推送或本地合并覆盖。浏览器仍保留同步日志和旧版恢复证据，升级时不要清空它们。

识别到有效 V1 时，正常连接会显示升级预览。首次连接可填写原 Gist ID；
未绑定时也可在“手动迁移工作区”填写原 ID，先只读检查，再另行确认升级。
旧版检查不支持留空扫描或切换已绑定 Gist，也不会创建 Gist。
已有绑定的重新登录和刷新始终指向原 ID；原 Gist 暂时不可访问时会报错，
不会改绑或自动创建空白数据。

如果旧版曾错误绑定到另一份空 Gist，先保留现有浏览器证据并核对原 Gist。
可在独立浏览器配置文件中通过明确 ID 连接原云端数据，以免影响原设备的待发送日志；
这仍是云端连接，不是本地导入或多工作区切换。已有设备绑定修复属于维护者恢复操作，
不能靠删除队列、改写 Workspace 身份或重置 revision 绕过。

## 先区分三类数据

- **规则**：`subman.json` 的 `data.aggregates`。
- **发布目标与最后一次发布信息**：`data.publishTargets` 的 `ruleId`、
  `fileName`、`lastPublishedAt`、`lastPublishedUrl`。
  sing-box 导出使用 `data.clientExports`，在 `/exports` 查看。
- **已发布内容**：Gist 中的 `.txt`、sing-box `.json` 等输出文件。
  文件存在不代表配置中保存了目标，也不证明它反映当前规则。

SubMan 保存最后一次发布元数据，不保存每次发布的完整历史。
没有目标引用的旧输出会被归为外部文件，不会自动反推规则；聚合发布目标在
`/aggregate` 查看，客户端导出在 `/exports` 查看。

## 格式边界

`package.json` 的 `0.0.1` 不是数据格式版本。已核实的历史边界如下：

| 历史阶段 | 当前读取行为 | 处理方式 |
| --- | --- | --- |
| 2026-02-26 `bb23bed`：V1 规则没有 `allowedTypes` | 补为 `[]`，不限制协议类型 | 沿原 Gist 升级流程处理 |
| 2026-02-27 `3ca9da5`：直接发布，未持久化发布目标 | 不能从输出推导完整目标或准确发布时间 | 保留原输出与链接，人工重建目标 |
| 2026-02-28 `74ed11f`：新增 `publishTargets` | 保留有效目标的文件名、发布时间与 URL | 先确认配置中确有记录 |
| 2026-03-08 `eadf826`：新增文件切换记录 | 缺少 `lastPublishTransition*` 时补 `null` | 不编造历史 |
| 2026-05-12 `95cf2ff`：新增 `clientExports` | 缺失时补为 `[]` | 聚合目标仍在 `/aggregate` |
| 2026-07-22 `77aed70`：Workspace V2 | 先校验 V1，首次成功 mutation 才备份和写 V2 | 原 Gist、协调器提交 |
| 旧浏览器 `subman:state:v1` | 按当前完整快照校验；无效内容可能隔离 | 保留技术证据，由维护者检查；不再支持页面 JSON 恢复 |

V1 是没有 `schemaVersion`、外层为 `{ "version": 1, "data": ... }` 的文档，
兼容读取也允许省略 `version`；不支持手工添加 `schemaVersion: 1`。
V2 必须包含 `schemaVersion: 2`、Workspace 身份、revision 和 tombstones。
历史 `kind: subman-business-configuration` 文件是业务交换文件，缺少版本链与墓碑，
不是 V2 Workspace 文档，不能替换 `subman.json`。

以下问题会让整个文档无效：引用不存在的来源或规则、重复 ID/标签/选择项、
未知字段、非法枚举、非规范 UTC 时间、非法/保留输出文件名，以及 Workspace 身份不匹配。
发现和直接检查均要求描述精确为 `SubMan-Data`，配置文件为 `subman.json`
或有效初始化标记。多份候选时首次连接必须填写原 Gist ID。

## 1. 保留来源并确认身份

1. 在 GitHub 保存原 Gist ID、`subman.json` 原始字节、全部输出文件、订阅链接、
   历史版本和已有 `subman.v1.backup.json`。来源可能含凭据，保存在私人位置。
2. 保留旧浏览器存储与待同步证据，关闭会继续编辑的旧版标签页。当前设置页不再导出
   或恢复业务 JSON；安全诊断只含元数据，不能恢复规则和节点，不要先清空存储。
3. 对照 `/auth` 绑定 ID 与原 Gist，检查是否曾连接另一份数据。域名、浏览器或
   浏览器配置文件变化不共享原浏览器技术日志，必须明确核对云端身份。
4. 检查配置的 `data.aggregates`、`data.publishTargets`、`data.clientExports`。
   当前为空时继续检查 Gist 历史与 V1 备份，不能仅凭输出文件认定规则还在。

## 2. 离线审计

在项目根目录运行。工具只读取本地文件，不需要 Token，不请求网络，也不写 Gist：

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json
bun run scripts/audit-workspace.ts /private/path/subman.json --gist-id YOUR_GIST_ID
```

成功报告 schema、集合数量和有发布时间的目标数量；不证明输出新鲜度或链接可达性。
失败只输出安全错误码，不输出原文、字段值或堆栈。

| 错误码 | 后续处理 |
| --- | --- |
| `invalid_workspace_document` | 检查字段、时间、重复项和引用 |
| `unsupported_schema` | 确认是否为未知格式或业务交换文件，不改版本号绕过 |
| `workspace_mismatch` | 找回原 Gist，不直接改 V2 身份 |
| `v1_export_required` | `--export-v1` 只处理 V1，V2 恢复还需保留 revision/墓碑 |
| `local_file_operation_failed` | 检查文件权限和目标是否已经存在 |

退出码为 `0`（成功）、`1`（校验/文件失败）、`2`（参数错误）。

## 3. 有效 V1：原 Gist 就地升级

1. 未绑定时在 `/auth` 填写原 Gist ID 连接或检查，核对固定描述、文件名及有效格式。
   描述不符时，先保存来源，再由所有者决定是否改为 `SubMan-Data`。
2. 在升级预览中核对 Gist ID、规则数量、目标文件名与原链接。此时不改远端，
   不把旧浏览器缓存上传为云端配置。
3. 点击“迁移并加载工作区”。先处理待发送队列和修复证据；迁移不偷偷发送其他请求。
   排队或重试仍不是完成，只有 `remote-committed` 完成升级。
4. 协调器核对预览源文件 SHA-256，匹配时把原 V1 字节备份到
   `subman.v1.backup.json` 并写 V2。原输出不参与 PATCH，发布元数据保持原值。
   源文件变化时重新检查并确认新预览。
5. 核对 schema、实体数量、备份字节以及规则/目标/导出关联。原 Gist 和输出文件名
   不变即可保留旧链接；升级不需要重新发布，也不证明输出已反映最新规则。

`migration_backup_conflict` 表示已有备份与待升级原文不同。保留两份来源交由维护者
处理，不删除或覆盖不可变备份，不强制推送。

## 4. 异常格式：维护者离线恢复

保留的 V1 转换命令只生成维护者检查用的规范化业务文件：

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json \
  --export-v1 /private/path/subman-recovery.json
```

新文件独占创建、权限 `0600`，不覆盖来源或已有目标，不写 Gist。
它保留可识别的业务集合、ID、文件名和原发布元数据，并按现有规则转换旧排除标签。
它不含 Workspace 版本链、墓碑、队列或认证信息。**当前应用没有 JSON 导入/恢复入口**，
不能把该文件当作完整云端备份，也不能直接替换 `subman.json`。

无效原 Gist 无法通过普通业务 mutation 修复，协调器写前同样会验证它。
维护者应在私人工作副本中依据历史恢复缺失来源/规则，核实重复项、时间和文件名含义，
记录具体差异并重新离线审计。未知发布时间保留 `null`，不使用恢复时间冒充。
只有用户另行授权、停止所有写入并核对现状、历史、备份与协调器状态后，才能制定
原 Gist 的独立恢复操作；这里不提供直接 PATCH 的捷径。
V2 恢复遵循[运维回滚流程](workspace-v2-operations.zh-CN.md#rollback)，不得退成 V1、
清空墓碑或重置 revision 来绕过保护。

如果历史配置从未保存目标，在原云端数据恢复有效后，基于确认过的规则和原文件名
重新建立目标。已有输出仍在原 Gist 时，客户端链接可以继续使用；重建目标不会恢复
可信历史发布时间。先预览并核对旧输出，再决定是否发布。
恢复完成前不要批量清理外部文件，旧输出可能仍被客户端使用。

## 完成标准

- 规则、目标与导出数量符合来源，引用正确；记录保留、输出存在、新发布成功分别核对。
- 原 Gist 与文件名保持原链接；新 Gist 或改名需要更新客户端，旧 URL 元数据不会复制文件。
- 原始来源可读，V1 备份字节一致，未绕过 revision、身份、墓碑或幂等校验。
- 云端重新加载后才开放编辑，成功提示只来自远端提交，不依赖旧浏览器缓存。

后续格式变更应写明支持范围、自动规范化、确认升级、维护者恢复和回滚来源，
使用最早支持的历史字段形状验证 Gist 读取与技术缓存迁移。
实现依据：`workspace.ts`、`workspace-document.ts`、`workspace-persistence.ts`、
`workspace-file-inventory.ts`、`scripts/audit-workspace.ts` 及对应测试。
