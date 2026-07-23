import { derived, writable } from "svelte/store";
import { browser } from "$app/environment";

export type Locale = "en" | "zh-CN";

const STORAGE_KEY = "subman:locale:v1";
const DEFAULT_LOCALE: Locale = "en";

const zhCN: Record<string, string> = {
	SubMan: "SubMan",
	Overview: "概览",
	Gists: "Gists",
	Nodes: "节点",
	Aggregate: "聚合",
	Workspace: "工作区",
	Manager: "管理器",
	Connected: "已连接",
	"Local Mode": "本地模式",
	"Gist-first Proxy Manager": "Gist 优先代理管理器",
	Language: "语言",
	Menu: "菜单",
	Appearance: "外观",
	System: "跟随系统",
	Light: "浅色",
	Dark: "深色",
	GitHub: "GitHub",
	English: "English",
	简体中文: "简体中文",
	"Workspace Gist subscription hub for proxy nodes":
		"面向代理节点的 Workspace Gist 订阅中心",
	"Manage nodes and subscriptions, build reusable aggregation rules, and publish stable subscription links from one GitHub Workspace Gist.":
		"在一个 GitHub Workspace Gist 中管理节点和订阅、构建可复用聚合规则，并发布稳定订阅链接。",
	"Connect Workspace": "连接工作区",
	Documentation: "文档",
	"Explore Nodes": "浏览节点",
	"Powerful Core Features": "核心能力",
	"Open Module": "打开模块",
	"Modern Workspace": "现代工作区",
	"Subscription Hub": "订阅中心",
	"Ready to simplify your workflow?": "准备简化你的工作流了吗？",
	"Everything you need for seamless proxy subscription management":
		"覆盖代理订阅管理核心流程的一整套能力",
	"Manage nodes, build reusable aggregation rules, and publish stable links directly to your private GitHub Gist.":
		"管理节点、构建可复用聚合规则，并直接向你的私有 GitHub Gist 发布稳定链接。",
	"Connect your GitHub account and start managing your workspace in seconds.":
		"连接 GitHub 账号后，几秒内就能开始管理你的工作区。",
	"SubMan v0.1": "SubMan v0.1",
	"Publish Subscription": "发布订阅",
	"Workspace Sync": "工作区同步",
	"Bind to your fixed Workspace Gist, resolve local and remote conflicts, and keep data in sync.":
		"绑定固定 Workspace Gist，处理本地与远端冲突，并保持数据同步。",
	"Open Workspace ->": "打开工作区 ->",
	"Node Management": "节点管理",
	"Add or edit single nodes and subscription sources with tags, filters, and quick status toggles.":
		"通过标签、筛选和快捷开关新增或编辑单节点与订阅源。",
	"Manage Nodes ->": "管理节点 ->",
	"Publish Targets": "发布目标",
	"Reuse one rule across multiple output files and keep client links stable with overwrite publishing.":
		"一个规则复用多个输出文件，通过覆盖发布保持客户端链接稳定。",
	"Open Aggregate ->": "打开聚合 ->",
	"Nodes & Subscriptions": "节点与订阅",
	"Add single nodes or subscription URLs, tag them, and toggle availability.":
		"新增单节点或订阅 URL，设置标签并切换可用状态。",
	"Manage your proxy sources and connectivity settings":
		"管理你的代理来源与连通性设置",
	"Add Node": "添加节点",
	"New Node": "新建节点",
	"New Subscription": "新建订阅",
	Search: "搜索",
	"Add New Node": "添加新节点",
	"Add New Subscription": "添加新订阅",
	"Node name": "节点名称",
	Name: "名称",
	Type: "类型",
	URL: "URL",
	Shadowsocks: "Shadowsocks",
	Other: "其他",
	"Raw node URI": "原始节点 URI",
	"Raw node URI (vless://...)": "原始节点 URI（vless://...）",
	"Raw URI": "原始 URI",
	"Tags (comma separated)": "标签（逗号分隔）",
	"Add Subscription": "添加订阅",
	Subscription: "订阅",
	"Subscription Preview": "订阅预览",
	"Subscription name": "订阅名称",
	"Subscription URL": "订阅 URL",
	items: "项",
	"No nodes yet.": "暂无节点。",
	"No nodes found matching your criteria.": "没有符合当前筛选条件的节点。",
	Enabled: "启用",
	Disabled: "禁用",
	Remove: "移除",
	Tags: "标签",
	Subscriptions: "订阅",
	"Detected nodes": "识别到的节点",
	Host: "主机",
	"Search by name, URL, or tag": "按名称、URL 或标签搜索",
	"Search {type}...": "搜索{type}...",
	All: "全部",
	"All Status": "全部状态",
	"Enabled only": "仅启用",
	"Disabled only": "仅禁用",
	"Showing {visible} of {total}": "显示 {visible} / {total}",
	"Copy failed.": "复制失败。",
	"Copy failed": "复制失败",
	"Copied {label}": "已复制 {label}",
	"No subscriptions yet.": "暂无订阅。",
	"No subscriptions found.": "暂无订阅。",
	"No subscriptions match current filters.": "当前筛选条件下无匹配订阅。",
	"A node with the same raw URI already exists: {name}":
		"已存在相同原始 URI 的节点：{name}",
	"A subscription with the same URL already exists: {name}":
		"已存在相同 URL 的订阅：{name}",
	"Single Entry": "单条添加",
	"Batch Import": "批量导入",
	"Raw node URI (one per line)": "原始节点 URI（每行一个）",
	"Subscription URL or Name = URL (one per line)":
		"订阅 URL 或 名称 = URL（每行一条）",
	"Tags applied to all imported items (comma separated)":
		"应用到所有导入项的标签（逗号分隔）",
	"Batch import nodes": "批量导入节点",
	"Batch import subscriptions": "批量导入订阅",
	"One node URI per line. Names and protocol types are inferred automatically.":
		"每行一个节点 URI，名称和协议类型会自动推断。",
	"One subscription per line. Use either a raw URL or Name = URL.":
		"每行一个订阅，可直接写 URL，或使用 名称 = URL 格式。",
	"Lines detected: {count}": "检测到行数：{count}",
	"Existing or repeated raw URIs are skipped automatically during import.":
		"导入时会自动跳过已存在或重复的原始 URI。",
	"Existing or repeated subscription URLs are skipped automatically during import.":
		"导入时会自动跳过已存在或重复的订阅 URL。",
	"Imported Node {index}": "导入节点 {index}",
	"Imported Subscription {index}": "导入订阅 {index}",
	"No lines to import.": "没有可导入的内容。",
	"No valid lines were imported.": "没有有效内容被导入。",
	"Batch import complete: {imported} imported, {duplicates} duplicate, {invalid} invalid.":
		"批量导入完成：已导入 {imported} 条，跳过重复 {duplicates} 条，无效 {invalid} 条。",
	"Import Preview": "导入预览",
	"Preview import results before saving.": "在真正保存前先预览导入结果。",
	"No batch preview yet. Paste lines to preview them here.":
		"还没有批量导入预览，把内容粘贴到左侧后会显示结果。",
	Importable: "可导入",
	Duplicates: "重复",
	Invalid: "无效",
	"Duplicate of existing node: {name}": "与现有节点重复：{name}",
	"Duplicate of existing subscription: {name}": "与现有订阅重复：{name}",
	"Duplicate line in this batch.": "与本次批量导入中的其他行重复。",
	"Invalid node URI.": "无效的节点 URI。",
	"Expanded from base64 subscription content.": "已从 Base64 订阅内容中展开。",
	"Pasted base64 subscription content is expanded into individual nodes automatically.":
		"直接粘贴 Base64 订阅内容时，会自动展开为单个节点。",
	"Invalid subscription URL.": "无效的订阅 URL。",
	"Line {line}": "第 {line} 行",
	"Filter preview by name or detail": "按名称或明细筛选预览",
	"Only visible importable items will be imported.":
		"最终只会导入当前预览中可见且可导入的项目。",
	"No preview items match the current filters.":
		"当前筛选条件下没有匹配的预览项目。",
	"Click preview to inspect included nodes.":
		"点击预览以查看该订阅包含的节点。",
	"No detectable nodes found in this subscription.":
		"这个订阅里没有识别到可展示的节点。",
	"Only visible selected importable items will be imported.":
		"最终只会导入当前可见且已勾选的可导入项目。",
	"Select visible": "全选可见项",
	"Clear visible selection": "清空可见选择",
	"Selected importable items: {count}": "已选择可导入项：{count}",
	"No visible selected items to import.": "当前没有可见且已选中的导入项目。",
	"All protocols": "全部协议",
	"Loading subscription preview...": "正在加载订阅预览...",
	"Subscription preview failed.": "订阅预览失败。",
	"Refresh preview": "刷新预览",
	"Close preview": "关闭预览",
	"Last preview": "上次预览",
	"Last preview: {time}": "上次预览：{time}",
	"The existing item has been expanded for quick review.":
		"已自动展开现有条目，方便你快速检查。",
	"Unsaved changes": "未保存更改",
	"Editing draft": "正在编辑草稿",
	"Changes apply only after you click Save.": "点击保存后更改才会生效。",
	Copy: "复制",
	Cancel: "取消",
	Confirm: "确认",
	"Confirm Action": "确认操作",
	Hide: "收起",
	Show: "展开",
	Details: "详情",
	Delete: "删除",
	Clear: "清空",
	Save: "保存",
	Updated: "更新时间",
	Unavailable: "不可用",
	"Are you sure you want to remove {name}?": "确认删除 {name} 吗？",
	'Remove subscription "{name}"?': "确认移除订阅“{name}”？",
	"Copied URL for {name}.": "已复制 {name} 的 URL。",
	"Removed {name}.": "已移除 {name}。",
	"Removed {name}": "已移除 {name}",
	"Node added successfully": "节点添加成功",
	"Node updated.": "节点已更新。",
	"Subscription added successfully": "订阅添加成功",
	"Subscription updated.": "订阅已更新。",
	"Use a GitHub token to sync with the workspace gist, or keep data locally.":
		"使用 GitHub Token 与 Workspace Gist 同步，或仅保留本地数据。",
	"GitHub Token": "GitHub Token",
	"Workspace marker: {desc} / {file}": "工作区标识：{desc} / {file}",
	"GitHub token": "GitHub token",
	"Setting up...": "配置中...",
	"Save Token": "保存 Token",
	"Clear Token": "清除 Token",
	"Mode: {mode}": "模式：{mode}",
	"Gist sync": "Gist 同步",
	"Local only": "仅本地",
	"Workspace gist: {id} (file: {file})": "工作区 Gist：{id}（文件：{file}）",
	"Workspace Sync Options": "工作区同步选项",
	"Push Now": "立即推送",
	"Push Local": "推送本地",
	"Overwrite remote workspace data with current local state?":
		"用当前本地状态覆盖远端工作区数据吗？",
	"Remote Change Detected": "检测到远端变更",
	"Remote workspace changed since your last sync.":
		"远端工作区在上次同步后发生了变化。",
	"Remote workspace changed since your last sync. Choose how to continue.":
		"远端工作区在上次同步后发生了变化。请选择如何继续。",
	"Force Push": "强制推送",
	"Force push will overwrite remote workspace changes. Continue?":
		"强制推送会覆盖远端工作区变更。继续吗？",
	"Overwrite remote changes": "覆盖远端变更",
	"Merge local and remote data, then save the merged state?":
		"合并本地和远端数据，然后保存合并后的状态吗？",
	"Pushed successfully": "推送成功",
	"Push failed": "推送失败",
	"Workspace is linked. Choose if you want to sync now or keep local data as-is.":
		"已绑定工作区。请选择立即同步，或保持本地数据不变。",
	Local: "本地",
	Remote: "远端",
	"Nodes: {count}": "节点：{count}",
	"Subscriptions: {count}": "订阅：{count}",
	"Aggregates: {count}": "聚合规则：{count}",
	"Publish targets: {count}": "发布目标：{count}",
	"Updated: {time}": "更新时间：{time}",
	"Keep Local (Link Only)": "保留本地（仅绑定）",
	"Local -> Remote": "本地 -> 远端",
	"Remote -> Local": "远端 -> 本地",
	"Merge & Save": "合并并保存",
	"Local Import / Export": "本地导入 / 导出",
	"Use this for backups or moving data without GitHub.":
		"用于备份或在不依赖 GitHub 的情况下迁移数据。",
	"Generate Export": "生成导出",
	Import: "导入",
	"Exported JSON will appear here. Paste JSON to import.":
		"导出的 JSON 会显示在这里。粘贴 JSON 可导入。",
	"Token is required.": "Token 不能为空。",
	"Workspace gist created.": "Workspace Gist 已创建。",
	"Workspace file missing. Local data seeded as initial workspace.":
		"工作区文件缺失，已将本地数据初始化到工作区。",
	"Workspace data unavailable.": "工作区数据不可用。",
	"Workspace gist linked. No sync needed.": "Workspace Gist 已绑定，无需同步。",
	"Workspace gist linked. Review sync options below.":
		"Workspace Gist 已绑定，请在下方选择同步策略。",
	"Failed to setup workspace gist.": "初始化 Workspace Gist 失败。",
	"Remote data loaded.": "已加载远端数据。",
	"Token missing.": "缺少 Token。",
	"Local data pushed to workspace.": "本地数据已推送到工作区。",
	"Merged data saved to workspace.": "合并数据已保存到工作区。",
	"Failed to resolve conflict.": "处理冲突失败。",
	"Workspace gist linked (local data unchanged).":
		"Workspace Gist 已绑定（本地数据未变）。",
	"Token cleared. Local mode enabled.": "Token 已清除，已切换为本地模式。",
	"Export ready.": "导出内容已生成。",
	"Copied to clipboard.": "已复制到剪贴板。",
	"Clipboard copy failed.": "剪贴板复制失败。",
	"Import complete.": "导入完成。",
	"Import failed.": "导入失败。",
	"Gist Workspace": "Gist 工作区",
	"View published files inside your workspace gist.":
		"查看工作区 Gist 内已发布的文件。",
	"Open Workspace": "打开工作区",
	"Loading...": "加载中...",
	Refresh: "刷新",
	"Missing GitHub token. Configure workspace first.":
		"缺少 GitHub Token，请先配置工作区。",
	"Workspace gist not set. Configure workspace first.":
		"未设置工作区 Gist，请先配置工作区。",
	"Workspace gist refreshed.": "Workspace Gist 已刷新。",
	"Workspace auto-refresh failed.": "Workspace 自动刷新失败。",
	"Open workspace gist": "打开 Workspace Gist",
	"Copy workspace gist URL": "复制 Workspace Gist URL",
	"Workspace gist URL unavailable.": "Workspace Gist URL 不可用。",
	"Workspace gist URL copied.": "Workspace Gist URL 已复制。",
	"Workspace Health": "工作区健康检查",
	"Run a quick check for token access, gist binding, workspace config, and readable sync data.":
		"快速检查 Token 访问、Gist 绑定、工作区配置文件以及同步数据是否可读。",
	"Run Health Check": "运行健康检查",
	"Checking...": "检查中...",
	"Workspace health check complete.": "工作区健康检查完成。",
	"GitHub token is connected.": "GitHub Token 已连接。",
	"GitHub token is missing.": "GitHub Token 缺失。",
	"Workspace binding": "工作区绑定",
	"Workspace gist is bound to {id}.": "Workspace Gist 已绑定到 {id}。",
	"Workspace gist is not bound yet.": "Workspace Gist 尚未绑定。",
	"Workspace gist access": "Workspace Gist 访问",
	"Workspace gist is reachable with {count} file(s).":
		"Workspace Gist 可访问，共有 {count} 个文件。",
	"Workspace config file": "工作区配置文件",
	"Workspace config file {file} exists.": "工作区配置文件 {file} 已存在。",
	"Workspace config file {file} is missing.": "工作区配置文件 {file} 缺失。",
	"Workspace data format": "工作区数据格式",
	"Workspace config data is readable.": "工作区配置数据可正常读取。",
	"Workspace data unreadable.": "工作区数据不可读取。",
	"Workspace gist check failed.": "Workspace Gist 检查失败。",
	"Repair Workspace Config": "修复 Workspace 配置",
	"Repairing...": "修复中...",
	"Workspace config repaired.": "Workspace 配置已修复。",
	"Workspace config file was restored from the current local state.":
		"Workspace 配置文件已根据当前本地状态恢复。",
	"Workspace config repair failed.": "Workspace 配置修复失败。",
	"Workspace change was not saved: {error}": "工作区更改未保存：{error}",
	"Workspace repair unavailable.": "Workspace 修复当前不可用。",
	Healthy: "健康",
	"Needs attention": "需要关注",
	"Action needed": "需要处理",
	"Last checked: {time}": "上次检查：{time}",
	Warning: "警告",
	Info: "信息",
	"Recent Workspace Activity": "最近工作区活动",
	"Track recent workspace setup, sync, and repair actions on this device.":
		"查看这台设备上的最近工作区连接、同步和修复操作。",
	"Clear history": "清空记录",
	"Clear recent workspace activity log?": "清空最近的工作区活动记录吗？",
	"Workspace activity log cleared.": "工作区活动记录已清空。",
	"Last Auto Sync": "最近一次自动同步",
	"See the latest background sync status from this browser session and the most recent saved result.":
		"查看当前浏览器会话中的最新后台同步状态，以及最近一次保存的结果。",
	"Last sync succeeded": "上次同步成功",
	"Last sync failed": "上次同步失败",
	"Sync in progress": "同步进行中",
	"Latest attempt": "最近一次尝试",
	"Latest result": "最近一次结果",
	"No auto sync attempt yet.": "还没有自动同步尝试记录。",
	"Sync target file: {file}": "同步目标文件：{file}",
	"Last sync succeeded at {time}": "上次同步成功时间：{time}",
	"Last sync failed at {time}": "上次同步失败时间：{time}",
	"No sync result yet.": "还没有同步结果。",
	"Failure reason: {message}": "失败原因：{message}",
	"Background sync updates this status automatically when local changes are pushed to the workspace gist.":
		"当本地改动被自动推送到 Workspace Gist 时，这里的状态会自动更新。",
	"No recent workspace activity yet.": "暂时还没有最近的工作区活动。",
	Errors: "错误事件",
	"Sync Events": "同步事件",
	Repairs: "修复事件",
	"Remote workspace state replaced the local view.":
		"已使用远端工作区状态替换当前本地视图。",
	"Local state was uploaded to the workspace gist.":
		"本地状态已上传到 Workspace Gist。",
	"Local and remote workspace states were merged and saved.":
		"本地与远端工作区状态已合并并保存。",
	"Sync Local State Now": "立即同步本地状态",
	"Manual workspace sync complete.": "手动工作区同步完成。",
	"Current local state was pushed to workspace gist {id}.":
		"当前本地状态已推送到 Workspace Gist {id}。",
	"Manual workspace sync failed.": "手动工作区同步失败。",
	"Workspace sync is disabled until a token is connected again.":
		"在重新连接 Token 之前，工作区同步已停用。",
	Error: "错误",
	"Failed to fetch workspace gist.": "获取 Workspace Gist 失败。",
	"Raw link unavailable.": "原始链接不可用。",
	"Link copied.": "链接已复制。",
	"Missing workspace authorization.": "缺少工作区授权。",
	"{file} is protected and cannot be deleted.": "{file} 受保护，无法删除。",
	"Delete {filename} from workspace gist? This cannot be undone.":
		"确认从工作区 Gist 删除 {filename}？此操作不可撤销。",
	"Deleted {filename}.": "已删除 {filename}。",
	"Failed to delete file.": "删除文件失败。",
	"Refresh workspace first.": "请先刷新工作区。",
	"No removable files found.": "未找到可删除文件。",
	"Delete {count} workspace file(s) except {file}? This cannot be undone.":
		"确认删除除 {file} 外的 {count} 个工作区文件？此操作不可撤销。",
	"Deleted {count} file(s).": "已删除 {count} 个文件。",
	"Failed to clean files.": "清理文件失败。",
	"Workspace Files": "工作区文件",
	Exports: "导出",
	"sing-box Client": "sing-box 客户端",
	"Source Aggregate Rule": "来源聚合规则",
	"Create an Aggregate rule before exporting.": "请先创建聚合规则再导出。",
	"Create an export profile first": "请先创建导出配置。",
	"Copied sing-box config": "已复制 sing-box 配置。",
	"Published sing-box config": "已发布 sing-box 配置。",
	"Generate a preview to inspect config.json": "生成预览以检查 config.json。",
	"Export failed: {error}": "导出失败：{error}",
	"Export Profile": "导出配置",
	"New profile": "新建配置",
	Profiles: "配置",
	profiles: "配置",
	"Missing Aggregate rule": "缺失聚合规则",
	"Delete Profile": "删除配置",
	"Delete export profile": "删除导出配置",
	"Delete export profile {name}?": "删除导出配置 {name}？",
	"Deleted export profile": "已删除导出配置",
	"Edit export profile": "编辑导出配置",
	"Listen Address": "监听地址",
	"Listen Port": "监听端口",
	"Selector Tag": "Selector 标签",
	"URL Test Tag": "URL Test 标签",
	"Include Experimental": "包含 experimental 配置",
	"Generate Preview": "生成预览",
	Summary: "摘要",
	"Total Lines": "总行数",
	Outbounds: "出站",
	Skipped: "已跳过",
	"Warning Count": "警告数",
	Warnings: "警告",
	"Select an Aggregate rule": "选择聚合规则",
	"Copy remote profile URL": "复制远程配置 URL",
	"Publish the generated JSON to the workspace gist, then copy the raw URL as a remote profile URL for compatible sing-box clients.":
		"将生成的 JSON 发布到 Workspace Gist，然后复制 raw URL 作为兼容 sing-box 客户端的远程配置 URL。",
	"No workspace": "未绑定工作区",
	"{file} is protected. All other workspace files can be deleted.":
		"{file} 受保护。其余工作区文件均可删除。",
	Working: "处理中...",
	"Clean All Except {file}": "清理除 {file} 之外的所有文件",
	"Loading workspace files...": "正在加载工作区文件...",
	"Fetching the active gist from GitHub.": "正在从 GitHub 获取当前 Gist。",
	"Last refreshed {time}": "最近刷新：{time}",
	"Refresh to load files.": "请刷新以加载文件。",
	"No files in workspace.": "工作区中暂无文件。",
	"Workspace config": "工作区配置",
	"Remote config matches current local state.": "远端配置与当前本地状态一致。",
	"Remote config differs from current local state.":
		"远端配置与当前本地状态不一致。",
	"Managed output": "受管理输出",
	"Recent Publish Events": "最近发布事件",
	"Latest file replacement activity for workspace outputs.":
		"查看工作区输出文件最近的替换与清理记录。",
	"No publish events match this filter.": "当前筛选条件下没有匹配的发布事件。",
	"Auto cleaned": "已自动清理",
	"Shared old file": "旧文件被共用",
	"Different workspace": "不同工作区",
	"Manual cleanup": "需手动清理",
	"Renamed output from {from} to {to}. Old workspace file was removed automatically.":
		"输出文件已从 {from} 更名为 {to}。旧的工作区文件已自动删除。",
	"Renamed output from {from} to {to}. Old file was kept because another publish target still uses it.":
		"输出文件已从 {from} 更名为 {to}。旧文件仍被其他发布目标使用，因此被保留。",
	"Renamed output from {from} to {to}. Old file was kept because it belongs to a different workspace gist.":
		"输出文件已从 {from} 更名为 {to}。旧文件属于另一个工作区 gist，因此被保留。",
	"Renamed output from {from} to {to}. Old file was kept for manual cleanup.":
		"输出文件已从 {from} 更名为 {to}。旧文件保留待手动清理。",
	"Unmanaged file": "未管理文件",
	Open: "打开",
	"Aggregation Builder": "聚合构建器",
	"Select nodes and subscriptions, apply filters, and generate a single subscription output.":
		"选择节点与订阅，应用筛选，并生成单个订阅输出。",
	"Pick Sources": "选择来源",
	"Choose individual nodes and subscriptions.": "选择单独节点和订阅。",
	"No nodes available.": "暂无可用节点。",
	"No subscriptions available.": "暂无可用订阅。",
	Rules: "规则",
	"Edit names, remove tags, and prepare rename mappings.":
		"编辑名称、排除标签并准备重命名映射。",
	"New rule": "新建规则",
	"Rule name": "规则名称",
	"Exclude tags (comma separated)": "排除标签（逗号分隔）",
	"Rename map: old=new per line": "重命名映射：每行 old=new",
	"Auto prepend region flags": "自动添加地区旗帜",
	"Custom region flag map": "自定义地区旗帜映射表",
	"Custom region flag map issues": "自定义地区旗帜映射问题",
	"Import built-in template": "导入内置模板",
	"Normalize and sort map": "规范化并排序映射表",
	"Fix custom region flag map errors before normalizing.":
		"请先修复自定义地区旗帜映射错误，再进行规范化。",
	"No custom region flag rules to normalize.":
		"没有可规范化的自定义地区旗帜规则。",
	"Custom region flag map is already normalized.":
		"自定义地区旗帜映射表已经是规范化状态。",
	"Custom region flag map normalized.": "已规范化自定义地区旗帜映射表。",
	"Replace the current custom region flag map with the built-in template?":
		"用内置模板替换当前自定义地区旗帜映射表吗？",
	"Built-in template imported.": "已导入内置模板。",
	"Append missing built-in rules": "追加缺失的内置规则",
	"Click to insert at cursor": "点击插入到当前光标位置",
	Insert: "插入",
	"Built-in rule inserted at cursor.": "已将内置规则插入到当前光标位置。",
	"Built-in rule inserted. Browser kept open.":
		"已插入内置规则，映射浏览器保持打开。",
	"Built-in rule replaced in custom map.": "已在自定义映射表中覆盖该内置规则。",
	"Built-in rule replaced. Browser kept open.":
		"已覆盖该内置规则，映射浏览器保持打开。",
	"Click to preview highlight. Ctrl/Cmd + click inserts or replaces without closing.":
		"单击仅高亮预览；按住 Ctrl/Cmd 点击可插入或覆盖且不关闭弹窗。",
	"This code already exists and will be replaced":
		"该代码已存在，插入时会直接覆盖",
	"Double-click to replace": "双击覆盖",
	"Ctrl/Cmd + click to insert without closing":
		"按住 Ctrl/Cmd 点击可插入且不关闭弹窗",
	"Click to preview highlight. Ctrl/Cmd + click inserts without closing.":
		"单击仅高亮预览；按住 Ctrl/Cmd 点击可插入且不关闭弹窗。",
	"Click to preview highlight": "单击高亮预览",
	"Already present": "已存在",
	"Code already exists in custom map": "该代码已存在于自定义映射表中",
	"Double-click to insert": "双击插入",
	"Missing built-in rules appended.": "已追加缺失的内置规则。",
	"All built-in rules are already present.": "所有内置规则都已存在。",
	"Built-in template is already loaded.": "内置模板已导入。",
	Replace: "替换",
	"Fix custom region flag map errors before previewing or saving.":
		"请先修复自定义地区旗帜映射错误，再预览或保存。",
	"Line {line}: use FLAG_CODE = keyword1, keyword2":
		"第 {line} 行：请使用 FLAG_CODE = keyword1, keyword2 格式。",
	"Line {line}: add at least one keyword after {code} =":
		"第 {line} 行：请在 {code} = 后至少填写一个关键词。",
	"Browse built-in region map": "查看内置地区映射表",
	"Built-in region flag map": "内置地区旗帜映射表",
	"Search built-in region rules by country code, city, or keyword.":
		"按国家代码、城市或关键词搜索内置地区规则。",
	"Search code or keyword": "搜索代码或关键词",
	"Built-in rules: {count}": "内置规则：{count}",
	"No built-in region rules match this search.":
		"没有匹配此搜索条件的内置地区规则。",
	"Close built-in region map": "关闭内置地区映射表",
	Keywords: "关键词",
	"Use one rule per line: FLAG_CODE = keyword1, keyword2. Custom rules are matched before the built-in region table.":
		"每行一条规则：FLAG_CODE = keyword1, keyword2。自定义规则会优先于内置地区识别表匹配。",
	"Custom rules are matched before the built-in region table.":
		"自定义规则会优先于内置地区识别表匹配。",
	"Detect country or region keywords like US, HK, JP, and SG in final node names and prepend the matching flag automatically.":
		"根据最终节点名称中的国家或地区关键词（如 US、HK、JP、SG）自动在名称前添加对应旗帜。",
	Protocols: "协议",
	"Leave empty to include all protocols.": "留空则包含所有协议。",
	Preview: "预览",
	"Saving...": "保存中...",
	"Update Rule": "更新规则",
	"Save Rule": "保存规则",
	"Delete Rule": "删除规则",
	"Deleting...": "删除中...",
	"Processed output for the current selections.": "当前选择项处理后的输出。",
	"Summary will appear here.": "摘要会显示在这里。",
	"Building preview...": "正在生成预览...",
	View: "查看",
	"Line copied.": "单行已复制。",
	"Copy Line": "复制该行",
	"Lines: {count}": "行数：{count}",
	"Publish Aggregation": "发布聚合",
	"Bind rules to stable output files. Reuse one rule across multiple publish targets.":
		"将规则绑定到稳定输出文件。一个规则可复用到多个发布目标。",
	"New publish target": "新建发布目标",
	"Target name": "目标名称",
	"Select rule": "选择规则",
	"File name (e.g. aggregate.txt)": "文件名（例如 aggregate.txt）",
	"Gist description": "Gist 描述",
	"Public gist": "公开 Gist",
	"Update Target": "更新目标",
	"Save Target": "保存目标",
	"New Target": "新建目标",
	"Delete Target": "删除目标",
	"Using workspace gist: {id} (config file: {file})":
		"使用工作区 Gist：{id}（配置文件：{file}）",
	"No workspace gist selected. Publishing will create a new gist containing config and output files.":
		"尚未选择工作区 Gist。发布时将新建一个包含配置和输出文件的 Gist。",
	"Building...": "构建中...",
	"Build Output": "构建输出",
	"Publishing...": "发布中...",
	"Publish Now": "立即发布",
	"Publish to Gist": "发布到 Gist",
	"Subscription link": "订阅链接",
	"Stable Link": "稳定链接",
	"Stable link help": "稳定链接说明",
	"Keep the same file name to keep the stable link unchanged across republishes.":
		"保持相同文件名，重复发布时稳定链接就不会变化。",
	"Changing the file name will create a new stable link on next publish. The old workspace file stays until you delete it, and clients using the old link must be updated manually.":
		"修改文件名会在下次发布时生成新的稳定链接。旧的工作区文件会保留，直到你手动删除；仍在使用旧链接的客户端也需要手动更新。",
	"Current published file: {file}": "当前已发布文件：{file}",
	"On next publish, SubMan will create a new stable link and delete the previous workspace file automatically. Clients using the old link still need to be updated manually.":
		"下次发布时，SubMan 会生成新的稳定链接，并自动删除之前的工作区文件。仍在使用旧链接的客户端仍需要手动更新。",
	"On next publish, SubMan will create a new stable link. The previous workspace file is still used by another publish target, so it will be kept.":
		"下次发布时，SubMan 会生成新的稳定链接。之前的工作区文件仍被其他发布目标使用，因此会被保留。",
	"On next publish, SubMan will create a new stable link. The previous file belongs to a different workspace gist, so it cannot be deleted automatically.":
		"下次发布时，SubMan 会生成新的稳定链接。之前的文件属于另一个工作区 gist，因此无法自动删除。",
	"On next publish, SubMan will create a new stable link. The previous workspace file cannot be deleted automatically, so you may need to clean it up manually.":
		"下次发布时，SubMan 会生成新的稳定链接。之前的工作区文件无法自动删除，因此你可能仍需要手动清理。",
	'Publishing to "{next}" will create a new stable link. Current published file: {current}. Existing clients using the old link must be updated manually.':
		"发布到“{next}”会生成新的稳定链接。当前已发布文件为：{current}。仍在使用旧链接的客户端需要手动更新。",
	'Publishing to "{next}" will create a new stable link and delete the previous workspace file "{current}" automatically. Existing clients using the old link must be updated manually.':
		"发布到“{next}”会生成新的稳定链接，并自动删除之前的工作区文件“{current}”。仍在使用旧链接的客户端需要手动更新。",
	'Publishing to "{next}" will create a new stable link. The previous workspace file "{current}" is still used by another publish target, so it will be kept.':
		"发布到“{next}”会生成新的稳定链接。之前的工作区文件“{current}”仍被其他发布目标使用，因此会被保留。",
	'Publishing to "{next}" will create a new stable link. The previous file "{current}" belongs to a different workspace gist, so it cannot be deleted automatically.':
		"发布到“{next}”会生成新的稳定链接。之前的文件“{current}”属于另一个工作区 gist，因此无法自动删除。",
	'Publishing to "{next}" will create a new stable link. The previous workspace file "{current}" cannot be deleted automatically, so you may need to clean it up manually.':
		"发布到“{next}”会生成新的稳定链接。之前的工作区文件“{current}”无法自动删除，因此你可能仍需要手动清理。",
	'Published to Gist successfully! Previous workspace file "{file}" was removed automatically.':
		"已成功发布到 Gist，之前的工作区文件“{file}”已自动删除。",
	"Select a rule for this publish target.": "请为该发布目标选择规则。",
	"File name is required.": "文件名不能为空。",
	"SubMan aggregate": "SubMan 聚合",
	"Publish target updated.": "发布目标已更新。",
	"Publish target saved.": "发布目标已保存。",
	"Failed to save publish target.": "保存发布目标失败。",
	"Delete this publish target? This does not delete gist files.":
		"确认删除该发布目标？该操作不会删除 Gist 文件。",
	"Publish target deleted.": "发布目标已删除。",
	"Rule not found.": "未找到规则。",
	'Delete rule "{name}"?\nThis will remove {count} publish target(s) bound to this rule.':
		"确认删除规则“{name}”？\n这将删除绑定到此规则的 {count} 个发布目标。",
	"Also delete {count} workspace output file(s)?\n{files}":
		"是否同时删除 {count} 个工作区输出文件？\n{files}",
	"Rule deleted. Removed {count} publish target(s).":
		"规则已删除，已移除 {count} 个发布目标。",
	"{count} shared file(s) kept: {files}.":
		"已保留 {count} 个共享文件：{files}。",
	"Deleted {count} workspace file(s): {files}.":
		"已删除 {count} 个工作区文件：{files}。",
	"Failed to delete workspace files.": "删除工作区文件失败。",
	"Workspace file cleanup failed: {message} Clean remaining files in /gists.":
		"工作区文件清理失败：{message}。请在 /gists 清理剩余文件。",
	"Workspace files were not deleted (missing token or workspace gist): {files}.":
		"工作区文件未删除（缺少 token 或工作区 gist）：{files}。",
	"Workspace files kept: {files}.": "已保留工作区文件：{files}。",
	"Rule name is required.": "规则名称不能为空。",
	"Rule updated.": "规则已更新。",
	"Rule saved.": "规则已保存。",
	"Failed to save rule.": "保存规则失败。",
	"Save and select a publish target first.": "请先保存并选择一个发布目标。",
	"Publish target not found.": "未找到发布目标。",
	"Save target changes before building output.": "构建输出前请先保存目标修改。",
	"Save target changes before publishing.": "发布前请先保存目标修改。",
	"Selected target rule no longer exists.": "所选目标关联规则已不存在。",
	"Output ready for {file}.": "{file} 的输出已准备好。",
	"No output generated.": "未生成输出。",
	"Missing GitHub token. Connect first.": "缺少 GitHub Token，请先连接。",
	"Aggregation published.": "聚合已发布。",
	"Aggregation published (raw link unavailable).":
		"聚合已发布（raw 链接不可用）。",
	"Failed to publish aggregation.": "发布聚合失败。",
	"Active Gist ID": "当前 Gist ID",
	"Backup & Migration": "备份与迁移",
	"Building subscription output...": "正在生成订阅输出...",
	"Changes to rules and targets are automatically synced to your workspace gist when active.":
		"当工作区同步启用时，规则和目标的改动会自动同步到你的 workspace gist。",
	"Clash Config...": "Clash 配置...",
	"Clean All Output Files": "清理全部输出文件",
	"Clean failed.": "清理失败。",
	"Configure workspace first.": "请先配置工作区。",
	"Configure your cloud sync and data persistence": "配置云端同步与数据持久化",
	"Conflict resolution failed.": "冲突处理失败。",
	"Connect GitHub first.": "请先连接 GitHub。",
	"Connect your GitHub token in Workspace settings to publish this aggregation.":
		"请先在工作区设置中连接 GitHub Token，才能发布这个聚合。",
	"Copy JSON": "复制 JSON",
	"Create a single node or import a batch of raw URIs.":
		"新增单个节点，或批量导入原始 URI。",
	"Create a single subscription or import a batch of URLs.":
		"新增单个订阅，或批量导入 URL 列表。",
	"Define Aggregate Rule": "定义聚合规则",
	"Delete all {count} files except config?":
		"确认删除除配置文件外的 {count} 个文件吗？",
	"Delete failed.": "删除失败。",
	"Delete {filename} forever?": "确认永久删除 {filename} 吗？",
	Disconnect: "断开连接",
	"Export Config": "导出配置",
	"Export generated.": "导出内容已生成。",
	"Failed to fetch gist.": "获取 Gist 失败。",
	"Failed to setup workspace.": "初始化工作区失败。",
	"File Name": "文件名",
	Files: "文件",
	"Filter saved nodes and subscriptions by type, status, or keyword.":
		"按类型、状态或关键词筛选已保存的节点和订阅。",
	Filtered: "已筛选",
	"Get Token": "获取 Token",
	"GitHub Personal Access Token": "GitHub Personal Access Token",
	"Global Proxy Rule...": "全局代理规则...",
	"Import Config": "导入配置",
	"Inspect workspace config, managed outputs, and any extra files stored in this gist.":
		"查看这个 gist 中的工作区配置、受管输出和其他附加文件。",
	"Keep Local & Skip Sync": "保留本地并跳过同步",
	"Link unavailable.": "链接不可用。",
	"Load Workspace": "加载工作区",
	"Local State": "本地状态",
	"Local data pushed.": "本地数据已推送。",
	"Manage raw files directly in your GitHub Gist":
		"直接管理 GitHub Gist 里的原始文件",
	"Manage saved node entries, raw URIs, and metadata.":
		"管理已保存的节点条目、原始 URI 和元数据。",
	"Manage saved subscription sources and inspect included nodes.":
		"管理已保存的订阅源，并查看其中包含的节点。",
	"Managed Output": "受管输出",
	"Merge Both States": "合并两边状态",
	"Merged data saved.": "合并后的数据已保存。",
	Mode: "模式",
	"No filters applied.": "未应用任何筛选。",
	"No removable files.": "没有可删除文件。",
	None: "无",
	"Offline Mode": "离线模式",
	"Output Lines": "输出行数",
	"Preview Output": "预览输出",
	"Preview generated {time}": "预览已生成：{time}",
	"Protected Config": "受保护配置",
	Published: "已发布",
	"Published to Gist successfully!": "已成功发布到 Gist！",
	"Refresh to view your cloud files.": "刷新以查看你的云端文件。",
	Refreshing: "刷新中",
	"Refreshing...": "刷新中...",
	"Remote Workspace": "远端工作区",
	"Review sync options to finish setup.": "查看同步选项以完成设置。",
	"Review your bound gist, copy stable links, and keep published output files tidy.":
		"查看已绑定的 gist、复制稳定链接，并保持已发布输出文件整洁。",
	"Save and select a target first.": "请先保存并选择一个目标。",
	"Select a rule first.": "请先选择一条规则。",
	"Select at least one node or subscription.": "请至少选择一个节点或订阅。",
	Selected: "已选择",
	"SubMan uses a dedicated Gist ({desc}) to store your configuration. Enter your token with 'gist' scope to enable auto-sync.":
		"SubMan 使用专用 Gist（{desc}）保存配置。请输入带有 gist 权限的 Token 以启用自动同步。",
	"Sync Active": "同步已启用",
	"Sync Conflict Detected": "检测到同步冲突",
	"The Gist is empty.": "这个 Gist 为空。",
	"Token cleared. Local mode.": "Token 已清除，已切换为本地模式。",
	"Unmanaged File": "未管理文件",
	"Use Local": "使用本地",
	"Use Remote": "使用远端",
	"Verifying...": "验证中...",
	Visible: "可见",
	"Workspace Status": "工作区状态",
	"Workspace cleaned.": "工作区已清理。",
	"Workspace file inventory": "工作区文件清单",
	"Workspace file missing. Local data seeded.":
		"工作区文件缺失，已写入本地数据作为初始内容。",
	"Workspace files": "工作区文件",
	"Workspace linked (Local only).": "工作区已绑定（仅本地）。",
	"Workspace linked. No sync needed.": "工作区已绑定，无需同步。",
	"Saved locally": "已保存到本机",
	Queued: "等待工作区同步",
	Syncing: "正在同步",
	"Saved to Workspace": "已保存到工作区",
	"Saved locally; retrying Workspace sync":
		"已保存到本机，工作区同步失败，将自动重试",
	"Saved locally; manual push required": "已保存到本机，等待手动推送",
	"Saved locally; sync paused by conflict": "已保存到本机，同步因冲突暂停",
	"Sign in to resume Workspace sync": "请登录以恢复工作区同步",
	"Workspace sync needs repair": "工作区同步需要修复",
	"Workspace local state needs repair": "工作区本地状态需要修复",
	"{count} queued": "{count} 项待同步",
	Repair: "修复",
	"Saved locally; Workspace synchronization needs repair: {error}":
		"已保存到本机；工作区同步需要修复：{error}",
	"Export Diagnostics": "导出诊断",
	"Diagnostics exported": "诊断已导出",
	"Discard Pending Changes": "丢弃待同步更改",
	"Discard {count} pending Workspace changes? This cannot be undone.":
		"要丢弃 {count} 项待同步的工作区更改吗？此操作无法撤销。",
	"Discard {count} Changes": "丢弃 {count} 项更改",
	"Repair Sync State": "修复同步状态",
	"Reconnect GitHub before repairing Workspace sync.":
		"请先重新连接 GitHub，再修复工作区同步。",
	"Workspace sync state repaired": "工作区同步状态已修复",
	"Choose Pull, Merge, or Push to repair synchronization.":
		"请选择拉取、合并或推送来修复同步。",
	"Workspace sync repair failed": "工作区同步修复失败",
	"Workspace overview": "工作区概览",
	"Your local data and the cloud workspace don't match. Please choose how to resolve this.":
		"你的本地数据与云端工作区不一致，请选择处理方式。",
	"Output filename conflicts need repair": "输出文件名冲突需要修复",
	"Change output file": "修改输出文件",
	"Delete current rule": "删除当前规则",
	Continue: "继续",
	"Previous output file": "旧输出文件",
	"Delete the previous output file if no other target or export profile references it?":
		"如果没有其他目标或导出配置引用旧输出文件，是否将其删除？",
	"Delete old file": "删除旧文件",
	"Keep old file": "保留旧文件",
	Yes: "是",
	No: "否",
	"Output filename is invalid": "输出文件名无效",
	"Delete target {name}?\nRule: {rule}\nOutput: {file}\nPublished: {published}\nOther owners: {owners}":
		"删除目标 {name}？\n规则：{rule}\n输出：{file}\n已发布：{published}\n其他所有者：{owners}",
	"Output file": "输出文件",
	"Also delete unreferenced output file {file}?":
		"是否同时删除无引用的输出文件 {file}？",
	"Delete target and file": "删除目标和文件",
	"Keep output file": "保留输出文件",
	"Delete rule {name}?\nPublish targets: {targets}\nClient exports: {exports}\nOutput files: {files}":
		"删除规则 {name}？\n发布目标：{targets}\n客户端导出：{exports}\n输出文件：{files}",
	"Output files": "输出文件",
	"Also delete unreferenced published output files?\n{files}":
		"是否同时删除无引用的已发布输出文件？\n{files}",
	"Delete rule and files": "删除规则和文件",
	"Keep output files": "保留输出文件",
	"Rule deleted.": "规则已删除。",
	"Draft Preview": "草稿预览",
	"Saved Rule Preview": "已保存规则预览",
	"Push and Publish": "推送并发布",
	"Save and Publish": "保存并发布",
	"Target configuration changed after its last publish. Publish again to refresh the output and stable link.":
		"目标配置在上次发布后已更改。请重新发布以刷新输出和稳定链接。",
	"Push local Workspace changes before publishing":
		"发布前请先推送本地工作区更改",
	"domestic, gaming...": "国内, 游戏...",
	"{file} is protected.": "{file} 受保护。",
};

function normalizeLocale(value: string | null | undefined): Locale {
	return value === "zh-CN" ? "zh-CN" : "en";
}

function loadInitialLocale(): Locale {
	if (!browser) {
		return DEFAULT_LOCALE;
	}
	return normalizeLocale(localStorage.getItem(STORAGE_KEY));
}

export const locale = writable<Locale>(loadInitialLocale());

if (browser) {
	locale.subscribe((value) => {
		localStorage.setItem(STORAGE_KEY, value);
		document.documentElement.lang = value;
	});
}

function format(
	template: string,
	params?: Record<string, string | number>,
): string {
	if (!params) {
		return template;
	}
	return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
		const value = params[name];
		return value === undefined ? `{${name}}` : String(value);
	});
}

export const t = derived(locale, ($locale) => {
	return (key: string, params?: Record<string, string | number>) => {
		const message = $locale === "zh-CN" ? (zhCN[key] ?? key) : key;
		return format(message, params);
	};
});
