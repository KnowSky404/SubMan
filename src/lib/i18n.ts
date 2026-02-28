import { browser } from "$app/environment";
import { derived, writable } from "svelte/store";

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
	"Gist-first Proxy Manager": "Gist 优先代理管理器",
	Language: "语言",
	GitHub: "GitHub",
	English: "English",
	"简体中文": "简体中文",
	"Workspace Gist subscription hub for proxy nodes": "面向代理节点的 Workspace Gist 订阅中心",
	"Manage nodes and subscriptions, build reusable aggregation rules, and publish stable subscription links from one GitHub Workspace Gist.":
		"在一个 GitHub Workspace Gist 中管理节点和订阅、构建可复用聚合规则，并发布稳定订阅链接。",
	"Connect Workspace": "连接工作区",
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
	"Add Node": "添加节点",
	"Node name": "节点名称",
	Shadowsocks: "Shadowsocks",
	Other: "其他",
	"Raw node URI": "原始节点 URI",
	"Tags (comma separated)": "标签（逗号分隔）",
	"Add Subscription": "添加订阅",
	"Subscription name": "订阅名称",
	"Subscription URL": "订阅 URL",
	items: "项",
	"No nodes yet.": "暂无节点。",
	Enabled: "启用",
	Remove: "移除",
	Tags: "标签",
	Subscriptions: "订阅",
	"Search by name, URL, or tag": "按名称、URL 或标签搜索",
	All: "全部",
	"Enabled only": "仅启用",
	"Disabled only": "仅禁用",
	"Showing {visible} of {total}": "显示 {visible} / {total}",
	"Copy failed.": "复制失败。",
	"No subscriptions yet.": "暂无订阅。",
	"No subscriptions match current filters.": "当前筛选条件下无匹配订阅。",
	Copy: "复制",
	Hide: "收起",
	Details: "详情",
	Delete: "删除",
	Updated: "更新时间",
	'Remove subscription "{name}"?': '确认移除订阅“{name}”？',
	"Copied URL for {name}.": "已复制 {name} 的 URL。",
	"Removed {name}.": "已移除 {name}。",
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
	"Workspace gist linked (local data unchanged).": "Workspace Gist 已绑定（本地数据未变）。",
	"Token cleared. Local mode enabled.": "Token 已清除，已切换为本地模式。",
	"Export ready.": "导出内容已生成。",
	"Copied to clipboard.": "已复制到剪贴板。",
	"Clipboard copy failed.": "剪贴板复制失败。",
	"Import complete.": "导入完成。",
	"Import failed.": "导入失败。",
	"Gist Workspace": "Gist 工作区",
	"View published files inside your workspace gist.": "查看工作区 Gist 内已发布的文件。",
	"Open Workspace": "打开工作区",
	"Loading...": "加载中...",
	Refresh: "刷新",
	"Missing GitHub token. Configure workspace first.": "缺少 GitHub Token，请先配置工作区。",
	"Workspace gist not set. Configure workspace first.": "未设置工作区 Gist，请先配置工作区。",
	"Workspace gist refreshed.": "Workspace Gist 已刷新。",
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
	"No workspace": "未绑定工作区",
	"{file} is protected. All other workspace files can be deleted.":
		"{file} 受保护。其余工作区文件均可删除。",
	Working: "处理中...",
	"Clean All Except {file}": "清理除 {file} 之外的所有文件",
	"Refresh to load files.": "请刷新以加载文件。",
	"No files in workspace.": "工作区中暂无文件。",
	"Workspace config": "工作区配置",
	"Managed output": "受管理输出",
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
	"Edit names, remove tags, and prepare rename mappings.": "编辑名称、排除标签并准备重命名映射。",
	"New rule": "新建规则",
	"Rule name": "规则名称",
	"Exclude tags (comma separated)": "排除标签（逗号分隔）",
	"Rename map: old=new per line": "重命名映射：每行 old=new",
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
	"Using workspace gist: {id} (config file: {file})": "使用工作区 Gist：{id}（配置文件：{file}）",
	"No workspace gist selected. Publishing will create a new gist containing config and output files.":
		"尚未选择工作区 Gist。发布时将新建一个包含配置和输出文件的 Gist。",
	"Building...": "构建中...",
	"Build Output": "构建输出",
	"Publishing...": "发布中...",
	"Publish to Gist": "发布到 Gist",
	"Subscription link": "订阅链接",
	"Select a rule for this publish target.": "请为该发布目标选择规则。",
	"File name is required.": "文件名不能为空。",
	"SubMan aggregate": "SubMan 聚合",
	"Publish target updated.": "发布目标已更新。",
	"Publish target saved.": "发布目标已保存。",
	"Failed to save publish target.": "保存发布目标失败。",
	"Delete this publish target? This does not delete gist files.": "确认删除该发布目标？该操作不会删除 Gist 文件。",
	"Publish target deleted.": "发布目标已删除。",
	"Rule not found.": "未找到规则。",
	'Delete rule "{name}"?\nThis will remove {count} publish target(s) bound to this rule.':
		'确认删除规则“{name}”？\n这将删除绑定到此规则的 {count} 个发布目标。',
	"Also delete {count} workspace output file(s)?\n{files}":
		"是否同时删除 {count} 个工作区输出文件？\n{files}",
	"Rule deleted. Removed {count} publish target(s).": "规则已删除，已移除 {count} 个发布目标。",
	"{count} shared file(s) kept: {files}.": "已保留 {count} 个共享文件：{files}。",
	"Deleted {count} workspace file(s): {files}.": "已删除 {count} 个工作区文件：{files}。",
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
	"Aggregation published (raw link unavailable).": "聚合已发布（raw 链接不可用）。",
	"Failed to publish aggregation.": "发布聚合失败。"
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

function format(template: string, params?: Record<string, string | number>): string {
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
