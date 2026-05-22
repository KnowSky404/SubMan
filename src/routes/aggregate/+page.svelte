<script lang="ts">
import { fade, fly, slide } from "svelte/transition";
import { type DndEvent, dndzone } from "svelte-dnd-action";
import {
	BUILT_IN_REGION_FLAG_RULES,
	buildAggregateOutput,
	type RegionFlagRule,
	regionCodeToFlagEmoji,
} from "$lib/aggregate";
import GitHubSelect from "$lib/components/GitHubSelect.svelte";
import Octicon from "$lib/components/Octicon.svelte";
import { createGist, toStableGistRawUrl, updateGist } from "$lib/gist";
import { t } from "$lib/i18n";
import type {
	AggregatePublishTarget,
	AggregateRule,
	ProxyType,
	SortMode,
} from "$lib/models";
import {
	checkCircle,
	checklist,
	copy,
	database,
	eye,
	fileCode,
	globe,
	search,
	sliders,
	sync,
	trash,
	upload,
	workflow,
	x,
} from "$lib/octicons";
import { exportSyncState } from "$lib/serialization";
import {
	appState,
	removeAggregate,
	removePublishTarget,
	upsertAggregate,
	upsertPublishTarget,
} from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { requestConfirm } from "$lib/stores/confirm";
import { showToast } from "$lib/stores/toast";
import { cn } from "$lib/utils/cn";
import { createId } from "$lib/utils/id";
import { nowIso } from "$lib/utils/time";
import { WORKSPACE_FILE } from "$lib/workspace";

let ruleName = "";
let selectedNodeIds: string[] = [];
let selectedSubscriptionIds: string[] = [];
let excludeTags = "";
let renameMap = "";
let customRegionFlagMap = "";
let allowedTypes: ProxyType[] = [];
let prependRegionFlags = true;
let sortMode: SortMode = "none";
let sortPriority = "";

// Menu State
let showRuleMenu = false;
let showNodesMenu = false;
let showSubsMenu = false;
let nodeSearchQuery = "";
let subSearchQuery = "";

// Region Browser State
let showBuiltInRegionMap = false;
let builtInRegionMapSearch = "";

type PreviewEntry = {
	id: string;
	line: string;
	protocol: string;
	name: string;
};

let previewEntries: PreviewEntry[] = [];
let previewLoading = false;

let selectedTargetId = "";
let publishTargetName = "";
let publishTargetRuleId = "";
let publishTargetFile = "subman-aggregate.txt";
let publishTargetDescription = "SubMan aggregate";
let publishTargetPublic = false;
let publishUrl: string | null = null;
let publishing = false;
let editingRuleId = "";
const fieldIds = {
	ruleName: "aggregate-rule-name",
	excludeTags: "aggregate-exclude-tags",
	nodesMenu: "aggregate-source-nodes",
	subsMenu: "aggregate-source-subscriptions",
	nodeSearch: "aggregate-node-search",
	subSearch: "aggregate-sub-search",
	renameMap: "aggregate-rename-map",
	allowedTypes: "aggregate-allowed-types",
	sortMode: "aggregate-sort-mode",
	sortPriority: "aggregate-sort-priority",
	customRegionFlagMap: "aggregate-region-flag-map",
	prependRegionFlags: "aggregate-prepend-region-flags",
	publishTargetPublic: "aggregate-publish-target-public",
	builtInRegionMapSearch: "aggregate-region-map-search",
	targetSelect: "aggregate-target-select",
	targetRule: "aggregate-target-rule",
	targetFile: "aggregate-target-file",
};

const protocolOptions: { id: ProxyType; label: string }[] = [
	{ id: "vless", label: "VLESS" },
	{ id: "vmess", label: "VMess" },
	{ id: "trojan", label: "Trojan" },
	{ id: "ss", label: "Shadowsocks" },
	{ id: "ssr", label: "SSR" },
	{ id: "hysteria2", label: "Hysteria2" },
	{ id: "tuic", label: "TUIC" },
	{ id: "anytls", label: "AnyTLS" },
];

function toggleSelection<T extends string>(list: T[], id: T) {
	return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function selectAllNodes() {
	const visibleIds = filteredNodesInRule.map((n) => n.id);
	const allSelected = visibleIds.every((id) => selectedNodeIds.includes(id));
	if (allSelected) {
		selectedNodeIds = selectedNodeIds.filter((id) => !visibleIds.includes(id));
	} else {
		selectedNodeIds = Array.from(new Set([...selectedNodeIds, ...visibleIds]));
	}
}

function selectAllSubs() {
	const visibleIds = filteredSubsInRule.map((s) => s.id);
	const allSelected = visibleIds.every((id) =>
		selectedSubscriptionIds.includes(id),
	);
	if (allSelected) {
		selectedSubscriptionIds = selectedSubscriptionIds.filter(
			(id) => !visibleIds.includes(id),
		);
	} else {
		selectedSubscriptionIds = Array.from(
			new Set([...selectedSubscriptionIds, ...visibleIds]),
		);
	}
}

$: filteredNodesInRule = $appState.nodes.filter((n) =>
	n.name.toLowerCase().includes(nodeSearchQuery.toLowerCase()),
);
$: filteredSubsInRule = $appState.subscriptions.filter((s) =>
	s.name.toLowerCase().includes(subSearchQuery.toLowerCase()),
);
$: filteredRegionRules = BUILT_IN_REGION_FLAG_RULES.filter(
	(r) =>
		r.code.toLowerCase().includes(builtInRegionMapSearch.toLowerCase()) ||
		r.keywords.some((k) =>
			k.toLowerCase().includes(builtInRegionMapSearch.toLowerCase()),
		),
);

$: activeNodeCount = selectedNodeIds.filter((id) =>
	$appState.nodes.some((n) => n.id === id),
).length;
$: activeSubCount = selectedSubscriptionIds.filter((id) =>
	$appState.subscriptions.some((s) => s.id === id),
).length;
$: currentRulePickerLabel =
	$appState.aggregates.find((rule) => rule.id === editingRuleId)?.name ||
	$t("New Rule");
$: sortModeOptions = [
	{ value: "none", label: $t("None (Original Order)") },
	{ value: "name", label: $t("Alphabetical (A-Z)") },
	{ value: "type", label: $t("By Protocol") },
	{ value: "region", label: $t("By Region") },
];
$: targetSelectOptions = [
	{ value: "", label: `+ ${$t("New target")}` },
	...$appState.publishTargets.map((target) => ({
		value: target.id,
		label: target.name,
	})),
];
$: targetRuleOptions = $appState.aggregates.map((rule) => ({
	value: rule.id,
	label: rule.name,
}));

function loadRule(rule: AggregateRule | undefined) {
	if (!rule) return;
	editingRuleId = rule.id;
	ruleName = rule.name;
	// Filter out any IDs that no longer exist in the global state
	selectedNodeIds = (rule.nodeIds || []).filter((id: string) =>
		$appState.nodes.some((n) => n.id === id),
	);
	selectedSubscriptionIds = (rule.subscriptionIds || []).filter((id: string) =>
		$appState.subscriptions.some((s) => s.id === id),
	);
	excludeTags = (rule.excludeTagIds || []).join(", ");
	renameMap = rule.renameRules
		? rule.renameRules.join("\n")
		: Object.entries(rule.renameMap || {})
				.map(([k, v]) => `${k}=${v}`)
				.join("\n");
	customRegionFlagMap = rule.customRegionFlagMap || "";
	allowedTypes = rule.allowedTypes || [];
	prependRegionFlags = rule.prependRegionFlags ?? true;
	sortMode = rule.sortMode || "none";
	sortPriority = rule.sortPriority || "";
}

$: publishedTargetCount = $appState.publishTargets.filter(
	(target) => target.lastPublishedUrl,
).length;
$: isWorkspaceConnected = Boolean($authState.token && $appState.activeGistId);

function resetRuleForm() {
	editingRuleId = "";
	ruleName = "";
	selectedNodeIds = [];
	selectedSubscriptionIds = [];
	excludeTags = "";
	renameMap = "";
	customRegionFlagMap = "";
	allowedTypes = [];
	prependRegionFlags = true;
	sortMode = "none";
	sortPriority = "";
	previewEntries = [];
}

function loadPublishTarget(target: AggregatePublishTarget) {
	selectedTargetId = target.id;
	publishTargetName = target.name;
	publishTargetRuleId = target.ruleId;
	publishTargetFile = target.fileName;
	publishTargetDescription = target.description;
	publishTargetPublic = target.isPublic;
	publishUrl = target.lastPublishedUrl;
}

function resetTargetForm() {
	selectedTargetId = "";
	publishTargetName = "";
	publishTargetRuleId = $appState.aggregates[0]?.id || "";
	publishTargetFile = "aggregate.txt";
	publishTargetDescription = "SubMan aggregate";
	publishTargetPublic = false;
	publishUrl = null;
}

async function saveRule() {
	if (!ruleName.trim()) return;
	const id = editingRuleId || createId("agg");

	// Ensure we only save IDs that actually exist in the global state
	const finalNodeIds = selectedNodeIds.filter((id) =>
		$appState.nodes.some((n) => n.id === id),
	);
	const finalSubIds = selectedSubscriptionIds.filter((id) =>
		$appState.subscriptions.some((s) => s.id === id),
	);
	const renameRules = renameMap
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	upsertAggregate({
		id,
		name: ruleName.trim(),
		nodeIds: finalNodeIds,
		subscriptionIds: finalSubIds,
		excludeTagIds: excludeTags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean),
		renameMap: {}, // Migrate to renameRules
		renameRules,
		customRegionFlagMap,
		allowedTypes,
		prependRegionFlags,
		sortMode,
		sortPriority,
		updatedAt: nowIso(),
	});
	editingRuleId = id;
	showToast($t("Rule saved successfully"), "success");
}

async function saveTarget() {
	if (!publishTargetFile.trim() || !publishTargetRuleId) return;
	const id = selectedTargetId || createId("pub");
	upsertPublishTarget({
		id,
		name: publishTargetName.trim() || publishTargetFile,
		ruleId: publishTargetRuleId,
		fileName: publishTargetFile.trim(),
		description: publishTargetDescription.trim(),
		isPublic: publishTargetPublic,
		lastPublishedAt: null,
		lastPublishedUrl: null,
		lastPublishTransitionAt: null,
		lastPublishTransitionFromFileName: null,
		lastPublishTransitionToFileName: null,
		lastPublishTransitionOutcome: null,
		updatedAt: nowIso(),
	});
	selectedTargetId = id;
	showToast($t("Publish target saved"), "success");
}

async function publish() {
	if (!$authState.token || !selectedTargetId) return;
	const target = $appState.publishTargets.find(
		(t) => t.id === selectedTargetId,
	);
	const rule = $appState.aggregates.find((r) => r.id === target?.ruleId);
	if (!target || !rule) return;

	publishing = true;
	try {
		const result = await buildAggregateOutput(
			rule,
			$appState.nodes,
			$appState.subscriptions,
		);
		const config = exportSyncState($appState);
		const files = {
			[target.fileName]: { content: result.content },
			[WORKSPACE_FILE]: { content: config },
		};
		const response = $appState.activeGistId
			? await updateGist($authState.token, {
					gistId: $appState.activeGistId,
					files,
				})
			: await createGist($authState.token, {
					description: target.description,
					isPublic: target.isPublic,
					files,
				});

		const fileMeta = response.files.find((f) => f.filename === target.fileName);
		publishUrl = toStableGistRawUrl(fileMeta?.rawUrl) || null;
		appState.update((s) => ({ ...s, activeGistId: response.id }));
		upsertPublishTarget({
			...target,
			lastPublishedAt: nowIso(),
			lastPublishedUrl: publishUrl,
		});
		showToast($t("Published successfully to GitHub Gist"), "success");
	} catch (err) {
		showToast(
			$t("Publish failed: {error}", {
				error: err instanceof Error ? err.message : String(err),
			}),
			"error",
		);
	} finally {
		publishing = false;
	}
}

async function buildPreview() {
	if (!selectedNodeIds.length && !selectedSubscriptionIds.length) {
		showToast($t("Select nodes or subs."), "error");
		return;
	}
	previewLoading = true;
	try {
		const renameRules = renameMap
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		const rule: AggregateRule = {
			id: "preview",
			name: ruleName || "Preview",
			nodeIds: selectedNodeIds,
			subscriptionIds: selectedSubscriptionIds,
			excludeTagIds: excludeTags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean),
			renameMap: {},
			renameRules,
			customRegionFlagMap,
			allowedTypes,
			prependRegionFlags,
			sortMode,
			sortPriority,
			updatedAt: nowIso(),
		};
		const result = await buildAggregateOutput(
			rule,
			$appState.nodes,
			$appState.subscriptions,
		);
		const lines = result.content
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		previewEntries = lines.map((line, idx) => {
			const schemeIdx = line.indexOf("://");
			const protocol = schemeIdx > 0 ? line.slice(0, schemeIdx) : "unknown";
			let name = "unnamed";
			const hashIdx = line.lastIndexOf("#");
			if (hashIdx > schemeIdx) {
				try {
					name = decodeURIComponent(line.slice(hashIdx + 1));
				} catch {
					name = line.slice(hashIdx + 1);
				}
			}
			return { id: `p-${idx}-${line}`, line, protocol, name };
		});
		if (previewEntries.length === 0)
			showToast($t("No nodes matched criteria"), "info");
		else showToast($t("Preview generated"), "success");
	} catch (err) {
		showToast($t("Preview failed"), "error");
	} finally {
		previewLoading = false;
	}
}

async function copyLine(line: string) {
	try {
		await navigator.clipboard.writeText(line);
		showToast($t("Copied to clipboard"), "success");
	} catch {
		showToast($t("Copy failed"), "error");
	}
}

function insertRegionRule(rule: RegionFlagRule) {
	const line = `${rule.code} = ${rule.keywords.join(", ")}`;
	customRegionFlagMap = customRegionFlagMap.trim()
		? `${customRegionFlagMap}\n${line}`
		: line;
	showBuiltInRegionMap = false;
}

function handlePreviewDndConsider(e: CustomEvent<DndEvent<PreviewEntry>>) {
	previewEntries = e.detail.items;
}

function handlePreviewDndFinalize(e: CustomEvent<DndEvent<PreviewEntry>>) {
	previewEntries = e.detail.items;
	// Update sortPriority with the actual order of names
	sortPriority = previewEntries.map((entry) => entry.name).join("\n");
	// Auto-save the rule to make it permanent
	saveRule();
}
</script>

<div class="gh-page">
	<header class="gh-page-header">
		<div class="gh-page-heading">
			<h1 class="gh-page-title">{$t("Aggregate")}</h1>
			<p class="gh-page-subtitle">
				{$t("Build source selection, filtering, rename, sorting, preview, and publish rules.")}
			</p>
			<div class="gh-page-meta">
				<span class="gh-page-meta-item">{$t("{count} rules", { count: $appState.aggregates.length })}</span>
				<span class="gh-page-meta-item">{$t("{count} targets", { count: $appState.publishTargets.length })}</span>
				<span class={cn("gh-page-meta-item", isWorkspaceConnected && "badge-success")}>
					{isWorkspaceConnected ? $t("Workspace connected") : $t("Local-only")}
				</span>
			</div>
		</div>
		<div class="gh-page-actions">
			<button type="button" class="gh-btn" on:click={buildPreview} disabled={previewLoading}>
				{#if previewLoading}<Octicon icon={sync} className="h-4 w-4 animate-spin" />{:else}<Octicon icon={eye} className="h-4 w-4" />{/if}
				{$t("Preview")}
			</button>
			<button type="button" class="gh-btn gh-btn-primary" on:click={saveRule}>
				<Octicon icon={checkCircle} className="h-4 w-4" />
				{$t("Save Rule")}
			</button>
		</div>
	</header>

	<div class="gh-layout-sidebar lg:grid-cols-[minmax(0,1fr)_340px]">
		<!-- Main Rule Editor -->
		<div class="gh-layout-main">
			<div class="gh-box shadow-sm !overflow-visible">
				<div class="gh-box-header">
					<div class="flex min-w-0 items-center gap-2">
						<Octicon icon={sliders} className="h-4 w-4" />
						<span>{$t("Rule Definition")}</span>
						<span class="gh-counter">{$appState.aggregates.length}</span>
					</div>
					<div class="gh-toolbar-group min-w-0 relative">
						<button
							type="button"
							class="gh-select gh-select-sm flex w-48 items-center justify-between text-left"
							on:click={() => { showRuleMenu = !showRuleMenu; showNodesMenu = false; showSubsMenu = false; }}
							aria-haspopup="menu"
							aria-expanded={showRuleMenu}
						>
							<span class="min-w-0 truncate">{currentRulePickerLabel}</span>
						</button>
						{#if showRuleMenu}
							<button type="button" class="fixed inset-0 z-[110]" on:click={() => (showRuleMenu = false)} aria-label={$t("Close rule menu")}></button>
							<div class="gh-dropdown-menu right-0 top-full w-56" transition:slide={{ duration: 150 }}>
								<div class="gh-dropdown-body flex flex-col gap-0.5">
									<button type="button" class="gh-dropdown-item font-semibold text-accent-fg" on:click={() => { resetRuleForm(); showRuleMenu = false; }}>
										+ {$t("New Rule")}
									</button>
									{#if $appState.aggregates.length}
										<div class="border-t border-border-default my-1"></div>
										{#each $appState.aggregates as rule}
											<button type="button" class={cn("gh-dropdown-item", editingRuleId === rule.id ? "font-semibold text-fg-default" : "text-fg-default")} on:click={() => { loadRule(rule); showRuleMenu = false; }}>
												<span class="min-w-0 flex-1 truncate">{rule.name}</span>
												{#if editingRuleId === rule.id}
													<span class="gh-label">{$t("Active")}</span>
												{/if}
											</button>
										{/each}
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
				<div class="gh-section-body gap-6">
					<!-- Basics -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.ruleName}>{$t("Rule Name")}</label>
							<input id={fieldIds.ruleName} class="gh-input" placeholder="e.g. Global" bind:value={ruleName} />
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.excludeTags}>{$t("Exclude Tags")}</label>
							<input id={fieldIds.excludeTags} class="gh-input" placeholder="domestic, bypass..." bind:value={excludeTags} />
						</div>
					</div>

					<!-- Selection Dropdowns -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
						<!-- Nodes Dropdown -->
						<div class="flex flex-col gap-1.5 relative">
							<div id={`${fieldIds.nodesMenu}-label`} class="gh-form-label">{$t("Source Nodes")}</div>
							<button 
								type="button"
								id={fieldIds.nodesMenu}
								class="gh-select w-full text-left flex items-center justify-between" 
								on:click={() => { showNodesMenu = !showNodesMenu; showSubsMenu = false; }}
								aria-haspopup="dialog"
								aria-expanded={showNodesMenu}
								aria-labelledby={`${fieldIds.nodesMenu}-label ${fieldIds.nodesMenu}`}
							>
								<span class="truncate">
									{activeNodeCount > 0 ? $t("{count} nodes selected", { count: activeNodeCount }) : $t("Select nodes...")}
								</span>
							</button>
							
							{#if showNodesMenu}
								<button type="button" class="fixed inset-0 z-[110]" on:click={() => (showNodesMenu = false)} aria-label={$t("Close source nodes menu")}></button>
								<div class="gh-dropdown-menu left-0 top-full w-full min-w-[280px]" transition:slide={{ duration: 150 }}>
									<div class="gh-dropdown-header">
										<div class="relative">
											<Octicon icon={search} className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
											<label class="sr-only" for={fieldIds.nodeSearch}>{$t("Filter nodes")}</label>
											<input id={fieldIds.nodeSearch} class="gh-input pl-8 h-7 text-xs w-full" placeholder={$t("Filter nodes...")} bind:value={nodeSearchQuery} />
										</div>
									</div>
									<div class="gh-dropdown-body flex flex-col gap-0.5">
										<button type="button" class="gh-dropdown-item font-semibold text-accent-fg" on:click={selectAllNodes}>
											<Octicon icon={checklist} className="h-3.5 w-3.5" /> {$t("Select visible")}
										</button>
										<div class="border-t border-border-default my-1"></div>
										{#each filteredNodesInRule as node}
											<label class="gh-dropdown-item">
												<input type="checkbox" class="rounded border-border-default" checked={selectedNodeIds.includes(node.id)} on:change={() => (selectedNodeIds = toggleSelection(selectedNodeIds, node.id))} />
												<span class="min-w-0 flex-1 truncate">{node.name}</span>
												<span class="gh-label">{node.type}</span>
											</label>
										{/each}
										{#if !filteredNodesInRule.length}<p class="text-[10px] text-fg-muted p-4 text-center italic">{$t("No nodes found")}</p>{/if}
									</div>
								</div>
							{/if}
						</div>

						<!-- Subscriptions Dropdown -->
						<div class="flex flex-col gap-1.5 relative">
							<div id={`${fieldIds.subsMenu}-label`} class="gh-form-label">{$t("Source Subscriptions")}</div>
							<button 
								type="button"
								id={fieldIds.subsMenu}
								class="gh-select w-full text-left flex items-center justify-between" 
								on:click={() => { showSubsMenu = !showSubsMenu; showNodesMenu = false; }}
								aria-haspopup="dialog"
								aria-expanded={showSubsMenu}
								aria-labelledby={`${fieldIds.subsMenu}-label ${fieldIds.subsMenu}`}
							>
								<span class="truncate">
									{activeSubCount > 0 ? $t("{count} subs selected", { count: activeSubCount }) : $t("Select subscriptions...")}
								</span>
							</button>

							{#if showSubsMenu}
								<button type="button" class="fixed inset-0 z-[110]" on:click={() => (showSubsMenu = false)} aria-label={$t("Close source subscriptions menu")}></button>
								<div class="gh-dropdown-menu left-0 top-full w-full min-w-[280px]" transition:slide={{ duration: 150 }}>
									<div class="gh-dropdown-header">
										<div class="relative">
											<Octicon icon={search} className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
											<label class="sr-only" for={fieldIds.subSearch}>{$t("Filter subscriptions")}</label>
											<input id={fieldIds.subSearch} class="gh-input pl-8 h-7 text-xs w-full" placeholder={$t("Filter subs...")} bind:value={subSearchQuery} />
										</div>
									</div>
									<div class="gh-dropdown-body flex flex-col gap-0.5">
										<button type="button" class="gh-dropdown-item font-semibold text-accent-fg" on:click={selectAllSubs}>
											<Octicon icon={checklist} className="h-3.5 w-3.5" /> {$t("Select visible")}
										</button>
										<div class="border-t border-border-default my-1"></div>
										{#each filteredSubsInRule as sub}
											<label class="gh-dropdown-item">
												<input type="checkbox" class="rounded border-border-default" checked={selectedSubscriptionIds.includes(sub.id)} on:change={() => (selectedSubscriptionIds = toggleSelection(selectedSubscriptionIds, sub.id))} />
												<span class="min-w-0 flex-1 truncate">{sub.name}</span>
											</label>
										{/each}
										{#if !filteredSubsInRule.length}<p class="text-[10px] text-fg-muted p-4 text-center italic">{$t("No subs found")}</p>{/if}
									</div>
								</div>
							{/if}
						</div>
					</div>

					<!-- Allowed Types -->
					<div class="flex flex-col gap-2">
						<div id={fieldIds.allowedTypes} class="text-sm font-semibold">{$t("Allowed Protocols")}</div>
						<div class="gh-btn-group flex-wrap" role="group" aria-labelledby={fieldIds.allowedTypes}>
							{#each protocolOptions as opt}
								<button 
									type="button"
									class={cn("gh-btn gh-btn-sm", allowedTypes.includes(opt.id) ? "gh-btn-primary" : "bg-canvas-default")}
									on:click={() => (allowedTypes = toggleSelection(allowedTypes, opt.id))}
								>
									{opt.label}
								</button>
							{/each}
						</div>
						<p class="gh-form-caption">{$t("Leave empty to allow all protocols.")}</p>
					</div>

					<!-- Sorting Configuration -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.sortMode}>{$t("Sort Mode")}</label>
							<GitHubSelect id={fieldIds.sortMode} bind:value={sortMode} options={sortModeOptions} />
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.sortPriority}>{$t("Priority Keywords (per line)")}</label>
							<textarea id={fieldIds.sortPriority} class="gh-input gh-textarea h-20 text-xs font-mono" placeholder="e.g.\nHK\nSG" bind:value={sortPriority}></textarea>
						</div>
					</div>

					<!-- Rename Rules -->
					<div class="flex flex-col gap-1.5">
						<label class="gh-form-label" for={fieldIds.renameMap}>{$t("Rename Rules")}</label>
						<textarea id={fieldIds.renameMap} class="gh-input gh-textarea font-mono text-xs" placeholder="Old Name = New Name" bind:value={renameMap}></textarea>
						<p class="gh-form-caption">
							{$t("Supports Regex: /pattern/flags = replacement (e.g. /^HK-(.*)/ = Hong Kong $1)")}
						</p>
					</div>

					<!-- Region Flags -->
					<div class="flex flex-col gap-3">
						<div class="flex items-center justify-between">
							<label class="gh-form-label flex items-center gap-2" for={fieldIds.customRegionFlagMap}><Octicon icon={globe} className="h-4 w-4" />{$t("Region Flag Map")}</label>
							<button type="button" class="gh-link text-xs" on:click={() => (showBuiltInRegionMap = true)}>{$t("Browse Icons")}</button>
						</div>
						<textarea id={fieldIds.customRegionFlagMap} class="gh-input gh-textarea font-mono text-xs h-32" placeholder="US = US, USA, America" bind:value={customRegionFlagMap}></textarea>
						
						<div class="gh-checkbox-row">
							<input id={fieldIds.prependRegionFlags} type="checkbox" class="rounded border-border-default" bind:checked={prependRegionFlags} />
							<div class="flex flex-col">
								<label class="text-sm font-medium" for={fieldIds.prependRegionFlags}>{$t("Auto-prepend Region Flags")}</label>
								<span class="gh-form-caption">{$t("Uses emoji flags based on country codes")}</span>
							</div>
						</div>
					</div>
				</div>
				<div class="gh-section-footer">
					<div class="gh-btn-group">
						{#if editingRuleId}
							<button type="button" class="gh-btn gh-btn-danger" on:click={() => { removeAggregate(editingRuleId); resetRuleForm(); }} aria-label={$t("Delete current rule")} title={$t("Delete current rule")}><Octicon icon={trash} className="h-4 w-4" /></button>
						{/if}
						<button type="button" class="gh-btn" on:click={buildPreview} disabled={previewLoading}>
							{#if previewLoading}<Octicon icon={sync} className="mr-1 h-4 w-4 animate-spin" />{:else}<Octicon icon={eye} className="mr-1 h-4 w-4" />{/if}
							{$t("Preview")}
						</button>
						<button type="button" class="gh-btn gh-btn-primary px-8" on:click={saveRule}><Octicon icon={checkCircle} className="mr-1 h-4 w-4" />{$t("Save")}</button>
					</div>
				</div>
			</div>

			{#if previewEntries.length > 0}
				<div class="gh-box shadow-sm" transition:slide>
					<div class="gh-box-header">
						<div class="flex items-center gap-2">
							<Octicon icon={fileCode} className="h-4 w-4" />
							<span>{$t("Preview Results")}</span>
							<span class="badge ml-2">{previewEntries.length} {$t("Nodes")}</span>
						</div>
						<button type="button" class="gh-icon-button h-7 w-7" on:click={() => (previewEntries = [])} aria-label={$t("Close preview results")}><Octicon icon={x} className="h-4 w-4" /></button>
					</div>
					<div 
						class="flex max-h-96 flex-col gap-1 overflow-y-auto bg-canvas-default p-2"
						use:dndzone={{ items: previewEntries, flipDurationMs: 200, dragDisabled: false }}
						on:consider={handlePreviewDndConsider}
						on:finalize={handlePreviewDndFinalize}
					>
						{#each previewEntries as entry (entry.id)}
							<div class="group flex cursor-grab items-center justify-between rounded-md border border-transparent bg-canvas-default p-2 transition-colors hover:border-border-default hover:bg-canvas-subtle active:cursor-grabbing">
								<div class="flex items-center gap-3 min-w-0">
									<div class="text-fg-subtle shrink-0">
										<div class="grid grid-cols-2 gap-px opacity-50" aria-hidden="true">
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
										</div>
									</div>
									<span class="gh-label shrink-0">{entry.protocol}</span>
									<span class="text-xs font-bold truncate">{entry.name}</span>
								</div>
								<button type="button" class="gh-btn gh-btn-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" on:click={() => copyLine(entry.line)} aria-label={$t("Copy preview line")}><Octicon icon={copy} className="h-3.5 w-3.5" /></button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Sidebar: Publish Settings -->
		<aside class="gh-layout-aside">
				<div class="gh-box shadow-sm !overflow-visible">
					<div class="gh-box-header text-sm">
						<div class="flex items-center gap-2"><Octicon icon={upload} className="h-4 w-4" />{$t("Publish to Gist")}</div>
						<span class="badge">{$appState.publishTargets.length}</span>
					</div>
					<div class="gh-section-body">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.targetSelect}>{$t("Select Target")}</label>
							<GitHubSelect id={fieldIds.targetSelect} bind:value={selectedTargetId} options={targetSelectOptions} onValueChange={(id) => { const target = $appState.publishTargets.find(t => t.id === id); target ? loadPublishTarget(target) : resetTargetForm(); }} />
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.targetRule}>{$t("Binding Rule")}</label>
							<GitHubSelect id={fieldIds.targetRule} bind:value={publishTargetRuleId} options={targetRuleOptions} placeholder={$t("Select an Aggregate rule")} />
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.targetFile}>{$t("Output File")}</label>
							<input id={fieldIds.targetFile} class="gh-input font-mono" placeholder="nodes.txt" bind:value={publishTargetFile} />
						</div>

					<div class="gh-checkbox-row">
						<input id={fieldIds.publishTargetPublic} type="checkbox" class="rounded border-border-default" bind:checked={publishTargetPublic} />
						<label class="text-sm font-medium" for={fieldIds.publishTargetPublic}>{$t("Public Gist")}</label>
					</div>

						<div class="flex flex-col gap-2 pt-2 border-t border-border-default">
							<button type="button" class="gh-btn w-full" on:click={saveTarget}>{$t("Save Target")}</button>
							{#if isWorkspaceConnected}
								<button type="button" class="gh-btn gh-btn-primary w-full py-3 h-auto" on:click={publish} disabled={publishing || !isWorkspaceConnected}>
									{#if publishing}<Octicon icon={sync} className="h-4 w-4 animate-spin" />{:else}<Octicon icon={upload} className="h-4 w-4" />{/if}
									{$t("Publish")}
								</button>
							{:else}
								<a href="/auth" class="gh-btn gh-btn-primary w-full py-3 h-auto">
									<Octicon icon={database} className="h-4 w-4" />
									{$t("Connect to Publish")}
								</a>
							{/if}
						</div>

						{#if publishUrl}
							<div class="gh-alert gh-alert-success mt-2 flex-col gap-2" in:fade>
								<div class="flex items-center justify-between text-xs font-semibold text-[color:var(--success-emphasis)]">
									<span>{$t("Live Link")}</span>
									<Octicon icon={checkCircle} className="h-3 w-3" />
								</div>
								<code class="gh-code-block break-all">{publishUrl}</code>
									<button type="button" class="gh-btn gh-btn-sm" on:click={async () => { 
										try {
										if (!publishUrl) return;
										await navigator.clipboard.writeText(publishUrl); 
										showToast($t("Link copied to clipboard"), 'success'); 
								} catch {
									showToast($t("Copy failed"), 'error');
								}
							}}><Octicon icon={copy} className="h-3 w-3" />{$t("Copy")}</button>
						</div>
					{/if}
				</div>
			</div>

			{#if !$authState.token}
				<div class="blankslate p-4 py-6">
					<Octicon icon={database} className="mb-2 h-8 w-8 text-fg-subtle" />
					<p class="mb-3 text-xs leading-relaxed text-fg-muted">{$t("Connect GitHub to sync and publish from a gist.")}</p>
					<a href="/auth" class="gh-btn gh-btn-sm">{$t("Go to Settings")}</a>
				</div>
			{/if}
		</aside>
	</div>
</div>

<!-- Region Flags Browser Modal -->
{#if showBuiltInRegionMap}
	<div class="fixed inset-0 z-[150] flex items-center justify-center p-4">
		<button type="button" class="fixed inset-0 bg-black/60 backdrop-blur-sm" on:click={() => (showBuiltInRegionMap = false)} aria-label={$t("Close region flag rules")}></button>
		<div class="gh-box relative flex max-h-[85vh] w-full max-w-4xl flex-col bg-canvas-default shadow-[var(--shadow-medium)]" in:fly={{ y: 20 }}>
				<div class="gh-box-header">
					<div class="flex items-center gap-2">
						<Octicon icon={globe} className="h-4 w-4" />
						<span>{$t("Built-in Region Flag Rules")}</span>
					</div>
					<button type="button" class="gh-icon-button h-7 w-7" on:click={() => (showBuiltInRegionMap = false)} aria-label={$t("Close region flag rules")}><Octicon icon={x} className="h-4 w-4" /></button>
				</div>
				
				<div class="border-b border-border-default bg-canvas-subtle p-4">
					<div class="relative">
						<Octicon icon={search} className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
						<label class="sr-only" for={fieldIds.builtInRegionMapSearch}>{$t("Search code or keyword")}</label>
						<input id={fieldIds.builtInRegionMapSearch} class="gh-input pl-9 h-10" placeholder={$t("Search code or keyword...")} bind:value={builtInRegionMapSearch} />
					</div>
				</div>

			<div class="flex-1 overflow-y-auto p-4">
				<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
					{#each filteredRegionRules as rule}
						<button 
							class="group flex flex-col gap-2 rounded-md border border-border-default bg-canvas-subtle p-3 text-left transition-colors hover:border-accent-emphasis hover:bg-canvas-default"
							on:click={() => insertRegionRule(rule)}
						>
							<div class="flex items-center gap-3">
								<span class="text-2xl shrink-0">{regionCodeToFlagEmoji(rule.code)}</span>
								<span class="font-bold text-sm text-accent-fg group-hover:underline">{rule.code}</span>
							</div>
							<p class="text-[10px] text-fg-muted line-clamp-2 leading-relaxed">
								{rule.keywords.join(", ")}
							</p>
						</button>
					{/each}
				</div>
			</div>
			
			<div class="gh-section-footer">
				<button type="button" class="gh-btn" on:click={() => (showBuiltInRegionMap = false)}>{$t("Close")}</button>
			</div>
		</div>
	</div>
{/if}
