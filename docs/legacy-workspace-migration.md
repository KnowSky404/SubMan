# 旧版规则与发布记录的排查、迁移指南

适用于升级后在 `/aggregate` 看不到历史规则或发布目标，但 GitHub Gist
仍保留配置或发布文件的情况。以下结论来自仓库历史和本地合成样例测试；
不能据此断定某个用户 Gist 的具体故障原因。

## 先区分三类数据

- **规则**：`subman.json` 中的 `data.aggregates`。
- **发布目标与最后一次发布信息**：`data.publishTargets` 中的 `ruleId`、
  `fileName`、`lastPublishedAt` 和 `lastPublishedUrl`。
  sing-box 导出使用另一组 `data.clientExports`，在 `/exports` 查看。
- **已发布内容**：Gist 中的 `.txt`、sing-box `.json` 等输出文件。
  文件存在不等于配置里保存了发布目标，也不证明当前规则与该文件内容一致。

SubMan 保存的是目标的最后一次发布元数据，不是每次发布的完整历史。
没有目标引用的旧输出会被文件管理页归为外部文件；不会自动反推生成它的规则。
聚合发布目标在 `/aggregate` 的目标选择器中查看，不在 `/exports` 中。

## 已核实的格式边界

本次本地检出没有应用发行版本标签可用于划分这些格式，因此以下用实际提交和日期标识，
不要把 `package.json` 的 `0.0.1` 当作数据格式版本。

| 历史阶段 | 当前读取与迁移行为 | 用户需要做什么 |
| --- | --- | --- |
| 2026-02-26 `bb23bed`：V1 导出，规则没有 `allowedTypes` | V1 Gist 读取补为 `[]`，表示不限制协议类型 | 可沿正常 Workspace 连接流程迁移 |
| 2026-02-27 `3ca9da5`：直接发布输出，尚无持久化发布目标 | 能读取规则，但不能从输出推导目标、规则关联或准确发布时间 | 保留输出与链接，手动重建目标 |
| 2026-02-28 `74ed11f`：新增 `publishTargets` | 正常 V1 目标的文件名、最后发布时间与 URL 可以保留 | 先确认配置中确实有目标记录 |
| 2026-03-08 `eadf826`：新增发布文件切换记录 | 更早 V1 目标缺少四个 `lastPublishTransition*` 字段时补为 `null` | 不需要编造历史切换记录 |
| 2026-05-12 `95cf2ff`：新增 `clientExports` | 更早 V1 文档缺少此集合时补为 `[]` | 聚合发布目标仍在 `/aggregate` 查看 |
| 2026-07-22 `77aed70`：Workspace Schema V2 | V1 文档先校验；首次成功 mutation 才备份并写成 V2 | 使用同一 Gist，通过协调器提交 |
| 旧浏览器 `subman:state:v1` 缓存 | 迁入 IndexedDB 时按完整的当前快照校验，缺集合或实体字段可能被隔离 | 从有效 Gist 或升级前导出恢复；浏览器迁移与 Gist 迁移不是同一条路径 |

V1 指没有 `schemaVersion`、外层为 `{ "version": 1, "data": ... }` 的文档；
兼容读取也允许省略 `version`。不要手工添加 `schemaVersion: 1`，当前不支持这个声明。
V2 Workspace 文档必须有 `schemaVersion: 2`、Workspace 身份、revision 和 tombstones。
设置页导出的 `{ "version": 2, "kind": "subman-business-configuration", ... }`
则是业务配置交换文件，**不是 V2 Workspace 文档**。

以下情况可能让整个旧 Workspace 被判为无效，而不是只隐藏一个出错条目：

- 规则引用了已经不存在的 node/subscription；目标或导出引用了不存在的规则。
- 重复 ID、重复标签或选择项、未支持字段、非法枚举值。
- 时间不符合 `2026-02-28T00:00:00.000Z` 这样的规范 UTC 格式。
- 输出文件名包含路径分隔符、控制字符或使用保留文件名。
- V2 文档的 `workspaceId` 与实际 Gist ID 不一致。

自动发现还要求 Gist 描述**精确等于** `SubMan-Data`，配置文件名为
`subman.json`（或有效的初始化标记）。早期直接发布允许自定义描述和配置文件名，
所以 Gist 有文件也可能不符合现在的发现条件。多个有效候选时需明确选择原 Gist。

## 1. 保存恢复来源，确认正在看哪个 Workspace

1. 在 GitHub 页面确认旧 Gist ID，保存 `subman.json` 的原始字节、所有输出文件、
   当前订阅链接和 Gist 历史版本；如有 `subman.v1.backup.json` 也一并下载。
   这些文件可能包含节点凭据或订阅地址，请保存在私人位置。
2. 如果浏览器仍有未同步数据，先在 `/auth` 导出业务配置。
   暂停同步并关闭其他会编辑同一 Workspace 的旧版标签页，保留现有浏览器数据。
   诊断导出只有安全元数据，不能用来恢复规则或节点；不要先清空存储。
3. 对照 `/auth` 中的活动 Gist ID 与 GitHub 页面，检查是不是绑定了新建或另一份 Gist。
   升级后换了域名、浏览器或浏览器配置文件，也不会自动共享原浏览器存储。
4. 在下载的配置中检查 `data.aggregates`、`data.publishTargets` 和
   `data.clientExports`。如果当前配置为空，继续检查 Gist 历史和 V1 备份，
   不要仅因输出文件存在就认为配置里也有规则。

## 2. 离线核对下载的配置

在项目根目录、依赖已准备好的环境中运行。工具只读取本地文件，不需要 Token，
不发网络请求，也不写 Gist：

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json
```

V2 文档可额外检查是否属于预期 Gist（填写 Gist ID，不是完整 URL）：

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json --gist-id YOUR_GIST_ID
```

成功输出 schema 版本、各集合数量，以及有 `lastPublishedAt` 的目标数量。
这里只证明配置格式有效；不验证输出文件、链接可访问性或最新发布内容。
后续导入及提交还要满足当前 mutation 的字节、数量和业务校验限制。
失败只输出安全错误码，不打印原文、字段值或堆栈：

| 错误码 | 后续处理 |
| --- | --- |
| `invalid_workspace_document` | 在私人副本中对照上面的校验边界，检查字段、时间、重复项及引用 |
| `unsupported_schema` | 确认输入是不是业务配置导出、其他工具文件或更新的未知格式；不要通过改版本号绕过校验 |
| `workspace_mismatch` | 输入的 Gist ID 与 V2 身份不一致；找回原 Workspace，不要直接改身份 |
| `v1_export_required` | `--export-v1` 仅处理 V1；V2 的恢复还必须保留 revision 与 tombstones |
| `local_file_operation_failed` | 检查输入可读、目标目录可写、输出文件尚不存在 |

退出码为 `0`（成功）、`1`（校验/文件操作失败）或 `2`（参数错误）。

## 3A. 有效 V1：优先在原 Gist 上正常迁移

1. 在 `/auth` 连接原 Workspace，核对 Gist ID。如果需要在候选列表选择，
   应能看到 `Legacy V1`。若描述不符合固定标识，先完成备份，再由所有者确认
   是否将描述改为 `SubMan-Data`。其他配置文件名或无效文档走下面的离线恢复流程。
2. 本地与远端不同时，确认已经备份本地数据和完整待发送队列，再选择
   `Use Remote` / `Pull Remote` 来加载旧 Gist 数据。不要用空白本地数据覆盖远端。
   拉取会替换本地视图，并可能丢弃该 Workspace 的待发送队列。
3. 在 `/aggregate` 核对规则和目标选择器，在 `/exports` 核对导出配置。
   仅绑定或保留本地模式不会把远端数据变成当前显示的快照。
4. 确认数据后，执行一次所需的普通保存操作，通过协调器完成首次 V2 提交。
   **单纯读取或拉取不改写 Gist**。协调器会将原 V1 字节保存为
   `subman.v1.backup.json`，再将迁移与本次变更一同提交。
5. 确认界面报告已保存到 Workspace，并核对 Gist 的 schema、实体数量和备份。
   普通配置保存不需要重新发布旧输出；它也不证明旧输出已经反映当前规则。

若报 `migration_backup_conflict`，说明现存 V1 备份与待迁移原文不一致。
先保存并比对两份来源，交由维护者处理；不要删除、覆盖该备份或反复强制推送。

## 3B. 有效 V1 但需离线恢复：生成可导入的业务配置

适用于找回旧配置、旧浏览器快照校验失败，或准备迁移到新 Workspace。
工具只沿现有 V1 校验和迁移规则转换；不会猜测未知字段或从输出文件创建目标：

```bash
bun run scripts/audit-workspace.ts /private/path/subman.json \
  --export-v1 /private/path/subman-import.json
```

源文件和已存在的输出文件都不会被覆盖，新文件权限为 `0600`。
输出可以由 `/auth` 的配置导入入口读取，包含规范化的五组业务集合；
保留已有目标 ID、规则 ID、文件名、原发布时间和 URL。
旧排除标签 ID 会按现有迁移规则解析为可识别的标签名称。
文件不包含 Workspace 绑定、revision、队列或认证信息，不能替换 Gist 的 `subman.json`。

1. 使用一个单独的浏览器配置文件，在**未连接 Workspace 的本地模式**打开当前应用。
2. 在 `/auth` 的 JSON 输入区粘贴生成文件内容并导入。导入替换当前业务快照，
   所以先保存本地导出；不要在已连接自动同步的 Workspace 中试导入。
3. 核对节点、订阅、规则、目标的数量和关联，再预览聚合结果。
   本地模式可能不展示已提交的发布链接；生成文件中的 URL 仍被保留，
   不要据此把本地恢复误认为已经完成远端发布。
4. 若原 Gist 有效，优先回到 3A，避免整体导入覆盖其他已有数据。
   若要创建新 Workspace，使用设置页的正常连接、创建及冲突确认流程，
   由协调器提交恢复后的业务配置，等待明确的远端提交结果。
5. 换 Gist 会改变输出链接。旧 URL 元数据不会把旧输出文件复制到新 Gist；
   协调器对新建目标会将导入声称的发布时间和 URL 清为 `null`，只信任远端已建立的
   发布记录。因此 3B 保留的历史信息用于本地核对，不能让新 Workspace 自动获得
   “已发布”状态。新 Workspace 发布前检查目标指向、文件名与实际归属，
   发布后更新客户端链接。

## 3C. 无效旧文档或只剩发布输出：人工修复与重建

在原始备份之外另建私人工作副本，按明确含义修复，然后重新离线校验：

- 缺失 node/subscription 引用：优先从历史恢复对应源条目；确认已经删除的来源，
  才从规则选择列表移除引用。这会改变未来聚合结果。
- 目标缺失规则：恢复原规则，或经用户确认重新绑定；输出无法还原完整规则。
- 时间：只有原值确实代表一个可确定的时刻时才转为规范 UTC；未知发布时间
  使用允许的 `null`，不要拿迁移时间充当旧发布时间。
- 未知字段、重复 ID 或非法文件名：人工判断含义和关系，记录修复前后差异；
  不批量丢字段、重生成所有 ID 或自动改名。

修复通过后，可用 3B 将副本导入本地模式并迁移到新 Workspace。
**原 Gist 上的无效配置无法靠普通导入修好**：协调器在写前也会读取和校验它。
如必须保留原 Gist ID 和链接，需要维护者在停止所有写入、保存现状与历史、
核对备份及协调器状态后做单独的恢复操作；本指南不提供在线直接 PATCH 的捷径。
V2 故障恢复遵循 [运维回滚流程](workspace-v2-operations.md#rollback)，
不得改成 V1、清空 tombstones 或重置 revision 来绕过保护。

如果配置根本没有目标记录，在 `/aggregate` 手动建立目标，选择确认过的规则与
**原文件名**。原输出留在原 Gist 时，已有客户端链接可以继续使用；
重建目标本身不会恢复可信的历史发布时间，也不需要立刻覆盖旧输出。
预览与旧输出核对、确认变化后再发布。只有正常远端发布成功，才会产生新的发布时间。
迁移完成前不要运行非配置文件批量清理：旧输出可能正被识别为外部文件。

## 完成标准与后续发行要求

- 规则、目标与导出数量符合备份；源引用与 `ruleId` 关联正确。
- 区分记录保留、输出文件仍存在和新版本成功发布；三者分别核对。
- 同一 Gist、同一输出文件名保留原链接；换 Gist 或改名需更新客户端。
- 原始备份可读，首次 V1 升级备份字节一致，没有绕过墓碑或版本检查。

后续改变持久化格式时，发行说明应写明支持的输入格式、自动迁移范围、
人工迁移步骤和回滚来源，并用最早支持的历史字段形状测试 Gist 读取、
浏览器缓存迁移和配置导入三个入口。不能仅用当前实体构造 V1 外壳来证明历史兼容。

实现依据：`src/lib/workspace.ts`、`src/lib/workspace-document.ts`、
`src/lib/workspace-persistence.ts`、`src/lib/serialization.ts`、
`src/lib/workspace-file-inventory.ts`；可运行证据见
`scripts/audit-workspace.test.ts` 与现有 Workspace 测试。
