<script lang="ts">
	import { onDestroy } from "svelte";
	import { t } from "$lib/i18n";
	import {
		appState,
		removeAggregate,
		removePublishTarget,
		upsertAggregate,
		upsertPublishTarget
	} from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import { BUILT_IN_REGION_FLAG_RULES, buildAggregateOutput, regionCodeToFlagEmoji } from "$lib/aggregate";
	import { createGist, toStableGistRawUrl, updateGist } from "$lib/gist";
	import { exportSyncState } from "$lib/serialization";
	import { WORKSPACE_FILE } from "$lib/workspace";
	import { createId } from "$lib/utils/id";
	import { nowIso } from "$lib/utils/time";
	import { requestConfirm } from "$lib/stores/confirm";
	import { showToast } from "$lib/stores/toast";
	import { cn } from "$lib/utils/cn";
	import { 
		Zap, 
		Plus, 
		Save, 
		Trash2, 
		CloudUpload, 
		Copy, 
		Eye, 
		Settings2, 
		FileText, 
		CheckCircle2, 
		AlertCircle,
		RefreshCw,
		Globe,
		ExternalLink,
		Settings,
		Search,
		Cpu,
		Database,
		X,
		Info,
		ChevronDown,
		Filter,
		SquareCheck,
		Square,
		ChevronUp,
		ListFilter,
		GripVertical,
		Flag
	} from "lucide-svelte";
	import { fade, slide, fly } from "svelte/transition";
	import { dndzone, type DndEvent } from "svelte-dnd-action";

	let ruleName = "";
	let selectedNodeIds: string[] = [];
	let selectedSubscriptionIds: string[] = [];
	let excludeTags = "";
	let renameMap = "";
	let customRegionFlagMap = "";
	let allowedTypes: string[] = [];
	let prependRegionFlags = true;
	let sortMode: string = "none";
	let sortPriority = "";
	
	// Menu State
	let showNodesMenu = false;
	let showSubsMenu = false;
	let nodeSearchQuery = "";
	let subSearchQuery = "";
	
	// Region Browser State
	let showBuiltInRegionMap = false;
	let builtInRegionMapSearch = "";

	let previewEntries: { id: string; protocol: string; name: string }[] = [];
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

	const protocolOptions: { id: string; label: string }[] = [
		{ id: "vless", label: "VLESS" },
		{ id: "vmess", label: "VMess" },
		{ id: "trojan", label: "Trojan" },
		{ id: "ss", label: "Shadowsocks" },
		{ id: "ssr", label: "SSR" },
		{ id: "hysteria2", label: "Hysteria2" },
		{ id: "tuic", label: "TUIC" }
	];

	function toggleSelection(list: string[], id: string) {
		return list.includes(id) ? list.filter(item => item !== id) : [...list, id];
	}

	function selectAllNodes() {
		const visibleIds = filteredNodesInRule.map(n => n.id);
		const allSelected = visibleIds.every(id => selectedNodeIds.includes(id));
		if (allSelected) {
			selectedNodeIds = selectedNodeIds.filter(id => !visibleIds.includes(id));
		} else {
			selectedNodeIds = Array.from(new Set([...selectedNodeIds, ...visibleIds]));
		}
	}

	function selectAllSubs() {
		const visibleIds = filteredSubsInRule.map(s => s.id);
		const allSelected = visibleIds.every(id => selectedSubscriptionIds.includes(id));
		if (allSelected) {
			selectedSubscriptionIds = selectedSubscriptionIds.filter(id => !visibleIds.includes(id));
		} else {
			selectedSubscriptionIds = Array.from(new Set([...selectedSubscriptionIds, ...visibleIds]));
		}
	}

	$: filteredNodesInRule = $appState.nodes.filter(n => n.name.toLowerCase().includes(nodeSearchQuery.toLowerCase()));
	$: filteredSubsInRule = $appState.subscriptions.filter(s => s.name.toLowerCase().includes(subSearchQuery.toLowerCase()));
	$: filteredRegionRules = BUILT_IN_REGION_FLAG_RULES.filter(r => 
		r.code.toLowerCase().includes(builtInRegionMapSearch.toLowerCase()) || 
		r.keywords.some(k => k.toLowerCase().includes(builtInRegionMapSearch.toLowerCase()))
	);

	$: activeNodeCount = selectedNodeIds.filter(id => $appState.nodes.some(n => n.id === id)).length;
	$: activeSubCount = selectedSubscriptionIds.filter(id => $appState.subscriptions.some(s => s.id === id)).length;

	function loadRule(rule: any) {
		editingRuleId = rule.id;
		ruleName = rule.name;
		// Filter out any IDs that no longer exist in the global state
		selectedNodeIds = (rule.nodeIds || []).filter(id => $appState.nodes.some(n => n.id === id));
		selectedSubscriptionIds = (rule.subscriptionIds || []).filter(id => $appState.subscriptions.some(s => s.id === id));
		excludeTags = (rule.excludeTagIds || []).join(", ");
		renameMap = rule.renameRules ? rule.renameRules.join("\n") : Object.entries(rule.renameMap || {}).map(([k, v]) => `${k}=${v}`).join("\n");
		customRegionFlagMap = rule.customRegionFlagMap || "";
		allowedTypes = rule.allowedTypes || [];
		prependRegionFlags = rule.prependRegionFlags ?? true;
		sortMode = rule.sortMode || "none";
		sortPriority = rule.sortPriority || "";
	}

	function resetRuleForm() {
		editingRuleId = ""; ruleName = ""; selectedNodeIds = [];
		selectedSubscriptionIds = []; excludeTags = ""; renameMap = ""; 
		customRegionFlagMap = ""; allowedTypes = []; prependRegionFlags = true;
		sortMode = "none"; sortPriority = "";
		previewEntries = [];
	}

	function loadPublishTarget(target: any) {
		selectedTargetId = target.id;
		publishTargetName = target.name;
		publishTargetRuleId = target.ruleId;
		publishTargetFile = target.fileName;
		publishTargetDescription = target.description;
		publishTargetPublic = target.isPublic;
		publishUrl = target.lastPublishedUrl;
	}

	function resetTargetForm() {
		selectedTargetId = ""; publishTargetName = "";
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
		const finalNodeIds = selectedNodeIds.filter(id => $appState.nodes.some(n => n.id === id));
		const finalSubIds = selectedSubscriptionIds.filter(id => $appState.subscriptions.some(s => s.id === id));
		const renameRules = renameMap.split("\n").map(l => l.trim()).filter(Boolean);

		upsertAggregate({
			id, name: ruleName.trim(), 
			nodeIds: finalNodeIds, 
			subscriptionIds: finalSubIds,
			excludeTagIds: excludeTags.split(",").map(t => t.trim()).filter(Boolean),
			renameMap: {}, // Migrate to renameRules
			renameRules,
			customRegionFlagMap, allowedTypes: allowedTypes as any[], prependRegionFlags,
			sortMode: sortMode as any, sortPriority, updatedAt: nowIso()
		});
		editingRuleId = id;
		showToast($t("Rule saved successfully"), 'success');
	}

	async function saveTarget() {
		if (!publishTargetFile.trim() || !publishTargetRuleId) return;
		const id = selectedTargetId || createId("pub");
		upsertPublishTarget({
			id, name: publishTargetName.trim() || publishTargetFile,
			ruleId: publishTargetRuleId, fileName: publishTargetFile.trim(),
			description: publishTargetDescription.trim(), isPublic: publishTargetPublic,
			updatedAt: nowIso()
		} as any);
		selectedTargetId = id;
		showToast($t("Publish target saved"), 'success');
	}

	async function publish() {
		if (!$authState.token || !selectedTargetId) return;
		const target = $appState.publishTargets.find(t => t.id === selectedTargetId);
		const rule = $appState.aggregates.find(r => r.id === target?.ruleId);
		if (!target || !rule) return;

		publishing = true;
		try {
			const result = await buildAggregateOutput(rule, $appState.nodes, $appState.subscriptions);
			const config = exportSyncState($appState);
			const files = { [target.fileName]: { content: result.content }, [WORKSPACE_FILE]: { content: config } };
			const response = $appState.activeGistId 
				? await updateGist($authState.token, { gistId: $appState.activeGistId, files })
				: await createGist($authState.token, { description: target.description, isPublic: target.isPublic, files });
			
			const fileMeta = response.files.find(f => f.filename === target.fileName);
			publishUrl = toStableGistRawUrl(fileMeta?.rawUrl) || null;
			appState.update(s => ({ ...s, activeGistId: response.id }));
			upsertPublishTarget({ ...target, lastPublishedAt: nowIso(), lastPublishedUrl: publishUrl } as any);
			showToast($t("Published successfully to GitHub Gist"), 'success');
		} catch (err) { 
			showToast($t("Publish failed: {error}", { error: err instanceof Error ? err.message : String(err) }), 'error'); 
		} finally { 
			publishing = false; 
		}
	}

	async function buildPreview() {
		if (!selectedNodeIds.length && !selectedSubscriptionIds.length) {
			showToast($t("Select nodes or subs."), 'error');
			return;
		}
		previewLoading = true;
		try {
			const renameRules = renameMap.split("\n").map(l => l.trim()).filter(Boolean);
			const rule: any = {
				id: "preview", name: ruleName || "Preview",
				nodeIds: selectedNodeIds, subscriptionIds: selectedSubscriptionIds,
				excludeTagIds: excludeTags.split(",").map(t => t.trim()).filter(Boolean),
				renameMap: {},
				renameRules,
				customRegionFlagMap, allowedTypes, prependRegionFlags,
				sortMode, sortPriority, updatedAt: nowIso()
			};
			const result = await buildAggregateOutput(rule, $appState.nodes, $appState.subscriptions);
			const lines = result.content.split("\n").map(l => l.trim()).filter(Boolean);
			previewEntries = lines.map((line, idx) => {
				const schemeIdx = line.indexOf("://");
				const protocol = schemeIdx > 0 ? line.slice(0, schemeIdx) : "unknown";
				let name = "unnamed";
				const hashIdx = line.lastIndexOf("#");
				if (hashIdx > schemeIdx) {
					try { name = decodeURIComponent(line.slice(hashIdx + 1)); } catch { name = line.slice(hashIdx + 1); }
				}
				return { id: `p-${idx}-${line}`, line, protocol, name };
			});
			if (previewEntries.length === 0) showToast($t("No nodes matched criteria"), 'info');
			else showToast($t("Preview generated"), 'success');
		} catch (err) {
			showToast($t("Preview failed"), 'error');
		} finally { previewLoading = false; }
	}

	async function copyLine(line: string) {
		try {
			await navigator.clipboard.writeText(line);
			showToast($t("Copied to clipboard"), 'success');
		} catch {
			showToast($t("Copy failed"), 'error');
		}
	}

	function insertRegionRule(rule: any) {
		const line = `${rule.code} = ${rule.keywords.join(", ")}`;
		customRegionFlagMap = customRegionFlagMap.trim() ? `${customRegionFlagMap}\n${line}` : line;
		showBuiltInRegionMap = false;
	}

	function handlePreviewDndConsider(e: CustomEvent<DndEvent<{ id: string; protocol: string; name: string }>>) {
		previewEntries = e.detail.items;
	}

	function handlePreviewDndFinalize(e: CustomEvent<DndEvent<{ id: string; protocol: string; name: string }>>) {
		previewEntries = e.detail.items;
		// Update sortPriority with the actual order of names
		sortPriority = previewEntries.map(entry => entry.name).join("\n");
		// Auto-save the rule to make it permanent
		saveRule();
	}
</script>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3 border-b border-border-default pb-4">
		<Zap class="h-6 w-6 text-fg-muted" />
		<h1 class="text-2xl font-bold">{$t("Aggregation Builder")}</h1>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
		<!-- Main Rule Editor -->
		<div class="lg:col-span-2 flex flex-col gap-6">
			<div class="gh-box shadow-sm !overflow-visible">
				<div class="gh-box-header">
					<div class="flex items-center gap-2">
						<Settings2 class="h-4 w-4" />
						<span>{$t("Rule Definition")}</span>
					</div>
					<select class="gh-select gh-select-sm w-48" value={editingRuleId} on:change={(e) => { const id = e.currentTarget.value; id ? loadRule($appState.aggregates.find(r => r.id === id)) : resetRuleForm(); }}>
						<option value="">+ {$t("New Rule")}</option>
						{#each $appState.aggregates as rule}<option value={rule.id}>{rule.name}</option>{/each}
					</select>
				</div>
				<div class="p-4 bg-canvas-default flex flex-col gap-6">
					<!-- Basics -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<label class="text-sm font-semibold">{$t("Rule Name")}</label>
							<input class="gh-input" placeholder="e.g. My Proxy Rule" bind:value={ruleName} />
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="text-sm font-semibold">{$t("Exclude Tags")}</label>
							<input class="gh-input" placeholder="domestic, bypass..." bind:value={excludeTags} />
						</div>
					</div>

					<!-- Selection Dropdowns -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
						<!-- Nodes Dropdown -->
						<div class="flex flex-col gap-1.5 relative">
							<label class="text-sm font-semibold">{$t("Source Nodes")}</label>
							<button 
								class="gh-select w-full text-left flex items-center justify-between" 
								on:click={() => { showNodesMenu = !showNodesMenu; showSubsMenu = false; }}
							>
								<span class="truncate">
									{activeNodeCount > 0 ? $t("{count} nodes selected", { count: activeNodeCount }) : $t("Select nodes...")}
								</span>
							</button>
							
							{#if showNodesMenu}
								<div class="fixed inset-0 z-[110]" on:click={() => (showNodesMenu = false)}></div>
								<div class="absolute top-full left-0 mt-1 w-full min-w-[280px] gh-box shadow-xl z-[120] bg-canvas-default" transition:slide={{ duration: 150 }}>
									<div class="p-2 border-b border-border-default bg-canvas-subtle">
										<div class="relative">
											<Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
											<input class="gh-input pl-8 h-7 text-xs w-full" placeholder={$t("Filter nodes...")} bind:value={nodeSearchQuery} on:click|stopPropagation />
										</div>
									</div>
									<div class="max-h-[400px] overflow-y-auto p-1 flex flex-col gap-0.5">
										<button class="flex items-center gap-2 p-1.5 rounded hover:bg-canvas-subtle text-xs text-accent-fg font-semibold w-full text-left" on:click|stopPropagation={selectAllNodes}>
											<ListFilter class="h-3.5 w-3.5" /> {$t("Toggle All Visible")}
										</button>
										<div class="border-t border-border-default my-1"></div>
										{#each filteredNodesInRule as node}
											<label class="flex items-center gap-2 p-1.5 rounded hover:bg-canvas-subtle cursor-pointer text-xs transition-colors" on:click|stopPropagation>
												<input type="checkbox" class="rounded border-border-default" checked={selectedNodeIds.includes(node.id)} on:change={() => (selectedNodeIds = toggleSelection(selectedNodeIds, node.id))} />
												<span class="truncate flex-1">{node.name}</span>
												<span class="text-[9px] uppercase font-black text-fg-subtle">{node.type}</span>
											</label>
										{/each}
										{#if !filteredNodesInRule.length}<p class="text-[10px] text-fg-muted p-4 text-center italic">{$t("No nodes found")}</p>{/if}
									</div>
								</div>
							{/if}
						</div>

						<!-- Subscriptions Dropdown -->
						<div class="flex flex-col gap-1.5 relative">
							<label class="text-sm font-semibold">{$t("Source Subscriptions")}</label>
							<button 
								class="gh-select w-full text-left flex items-center justify-between" 
								on:click={() => { showSubsMenu = !showSubsMenu; showNodesMenu = false; }}
							>
								<span class="truncate">
									{activeSubCount > 0 ? $t("{count} subs selected", { count: activeSubCount }) : $t("Select subscriptions...")}
								</span>
							</button>

							{#if showSubsMenu}
								<div class="fixed inset-0 z-[110]" on:click={() => (showSubsMenu = false)}></div>
								<div class="absolute top-full left-0 mt-1 w-full min-w-[280px] gh-box shadow-xl z-[120] bg-canvas-default" transition:slide={{ duration: 150 }}>
									<div class="p-2 border-b border-border-default bg-canvas-subtle">
										<div class="relative">
											<Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
											<input class="gh-input pl-8 h-7 text-xs w-full" placeholder={$t("Filter subs...")} bind:value={subSearchQuery} on:click|stopPropagation />
										</div>
									</div>
									<div class="max-h-[400px] overflow-y-auto p-1 flex flex-col gap-0.5">
										<button class="flex items-center gap-2 p-1.5 rounded hover:bg-canvas-subtle text-xs text-accent-fg font-semibold w-full text-left" on:click|stopPropagation={selectAllSubs}>
											<ListFilter class="h-3.5 w-3.5" /> {$t("Toggle All Visible")}
										</button>
										<div class="border-t border-border-default my-1"></div>
										{#each filteredSubsInRule as sub}
											<label class="flex items-center gap-2 p-1.5 rounded hover:bg-canvas-subtle cursor-pointer text-xs transition-colors" on:click|stopPropagation>
												<input type="checkbox" class="rounded border-border-default" checked={selectedSubscriptionIds.includes(sub.id)} on:change={() => (selectedSubscriptionIds = toggleSelection(selectedSubscriptionIds, sub.id))} />
												<span class="truncate flex-1">{sub.name}</span>
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
						<label class="text-sm font-semibold">{$t("Allowed Protocols")}</label>
						<div class="flex flex-wrap gap-2">
							{#each protocolOptions as opt}
								<button 
									class={cn("gh-btn gh-btn-sm", allowedTypes.includes(opt.id) ? "gh-btn-primary" : "bg-canvas-default")}
									on:click={() => (allowedTypes = toggleSelection(allowedTypes, opt.id))}
								>
									{opt.label}
								</button>
							{/each}
						</div>
						<p class="text-[10px] text-fg-muted italic">{$t("Leave empty to allow all protocols.")}</p>
					</div>

					<!-- Sorting Configuration -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<label class="text-sm font-semibold">{$t("Sort Mode")}</label>
							<select class="gh-select" bind:value={sortMode}>
								<option value="none">{$t("None (Original Order)")}</option>
								<option value="name">{$t("Alphabetical (A-Z)")}</option>
								<option value="type">{$t("By Protocol")}</option>
								<option value="region">{$t("By Region")}</option>
							</select>
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="text-sm font-semibold">{$t("Priority Keywords (per line)")}</label>
							<textarea class="gh-input gh-textarea h-20 text-xs font-mono" placeholder="e.g.\nHK\nSG" bind:value={sortPriority}></textarea>
						</div>
					</div>

					<!-- Rename Rules -->
					<div class="flex flex-col gap-1.5">
						<label class="text-sm font-semibold">{$t("Rename Rules (old=new per line)")}</label>
						<textarea class="gh-input gh-textarea font-mono text-xs" placeholder="Original Name = New Name" bind:value={renameMap}></textarea>
						<p class="text-[10px] text-fg-muted italic">
							{$t("Supports Regex: /pattern/flags = replacement (e.g. /^HK-(.*)/ = Hong Kong $1)")}
						</p>
					</div>

					<!-- Region Flags -->
					<div class="flex flex-col gap-3">
						<div class="flex items-center justify-between">
							<label class="text-sm font-semibold flex items-center gap-2"><Flag class="h-4 w-4" />{$t("Region Flag Map")}</label>
							<button class="text-xs text-accent-fg hover:underline" on:click={() => (showBuiltInRegionMap = true)}>{$t("Browse Icons")}</button>
						</div>
						<textarea class="gh-input gh-textarea font-mono text-xs h-32" placeholder="US = US, USA, America" bind:value={customRegionFlagMap}></textarea>
						
						<div class="flex items-center gap-2 p-2.5 rounded bg-canvas-subtle border border-border-default">
							<input type="checkbox" class="rounded border-border-default" bind:checked={prependRegionFlags} />
							<div class="flex flex-col">
								<span class="text-xs font-bold">{$t("Auto-prepend Region Flags")}</span>
								<span class="text-[10px] text-fg-muted">{$t("Uses emoji flags based on country codes")}</span>
							</div>
						</div>
					</div>
				</div>
				<div class="p-4 bg-canvas-subtle border-t border-border-default flex justify-end gap-2">
					{#if editingRuleId}
						<button class="gh-btn gh-btn-danger" on:click={() => { removeAggregate(editingRuleId); resetRuleForm(); }}><Trash2 class="h-4 w-4" /></button>
					{/if}
					<button class="gh-btn" on:click={buildPreview} disabled={previewLoading}>
						{#if previewLoading}<RefreshCw class="h-4 w-4 animate-spin mr-1" />{:else}<Eye class="h-4 w-4 mr-1" />{/if}
						{$t("Preview Output")}
					</button>
					<button class="gh-btn gh-btn-primary px-8" on:click={saveRule}><Save class="h-4 w-4 mr-1" />{$t("Save Rule")}</button>
				</div>
			</div>

			{#if previewEntries.length > 0}
				<div class="gh-box shadow-sm" transition:slide>
					<div class="gh-box-header">
						<div class="flex items-center gap-2">
							<FileText class="h-4 w-4" />
							<span>{$t("Preview Results")}</span>
							<span class="badge ml-2">{previewEntries.length} {$t("Nodes")}</span>
						</div>
						<button class="text-fg-muted hover:text-fg-default" on:click={() => (previewEntries = [])}><X class="h-4 w-4" /></button>
					</div>
					<div 
						class="p-2 bg-canvas-default max-h-96 overflow-y-auto flex flex-col gap-1"
						use:dndzone={{ items: previewEntries, flipDurationMs: 200, dragDisabled: false }}
						on:consider={handlePreviewDndConsider}
						on:finalize={handlePreviewDndFinalize}
					>
						{#each previewEntries as entry (entry.id)}
							<div class="flex items-center justify-between p-2 rounded hover:bg-canvas-subtle transition-colors group cursor-grab active:cursor-grabbing bg-canvas-default border border-transparent hover:border-border-default">
								<div class="flex items-center gap-3 min-w-0">
									<div class="text-fg-subtle shrink-0">
										<GripVertical class="h-3.5 w-3.5 opacity-50" />
									</div>
									<span class="px-1.5 py-0.5 rounded bg-canvas-subtle border border-border-default text-[9px] font-black uppercase text-fg-muted shrink-0">{entry.protocol}</span>
									<span class="text-xs font-bold truncate">{entry.name}</span>
								</div>
								<button class="gh-btn gh-btn-sm opacity-0 group-hover:opacity-100 transition-opacity" on:click={() => copyLine(entry.line)}><Copy class="h-3.5 w-3.5" /></button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Sidebar: Publish Settings -->
		<div class="flex flex-col gap-6">
			<div class="gh-box shadow-sm !overflow-visible">
				<div class="gh-box-header text-sm">
					<div class="flex items-center gap-2"><CloudUpload class="h-4 w-4" />{$t("Publish to Gist")}</div>
				</div>
				<div class="p-4 bg-canvas-default flex flex-col gap-4">
					<div class="flex flex-col gap-1.5">
						<label class="text-xs font-bold text-fg-muted uppercase">{$t("Select Target")}</label>
						<select class="gh-select w-full" value={selectedTargetId} on:change={(e) => { const id = e.currentTarget.value; id ? loadPublishTarget($appState.publishTargets.find(t => t.id === id)) : resetTargetForm(); }}>
							<option value="">+ {$t("New Target")}</option>
							{#each $appState.publishTargets as target}<option value={target.id}>{target.name}</option>{/each}
						</select>
					</div>

					<div class="flex flex-col gap-1.5">
						<label class="text-xs font-bold text-fg-muted uppercase">{$t("Binding Rule")}</label>
						<select class="gh-select w-full" bind:value={publishTargetRuleId}>
							{#each $appState.aggregates as rule}<option value={rule.id}>{rule.name}</option>{/each}
						</select>
					</div>

					<div class="flex flex-col gap-1.5">
						<label class="text-xs font-bold text-fg-muted uppercase">{$t("Output File Name")}</label>
						<input class="gh-input font-mono" placeholder="nodes.txt" bind:value={publishTargetFile} />
					</div>

					<div class="flex items-center gap-2 p-2.5 rounded bg-canvas-subtle border border-border-default">
						<input type="checkbox" class="rounded border-border-default" bind:checked={publishTargetPublic} />
						<span class="text-xs font-bold">{$t("Public Gist")}</span>
					</div>

					<div class="flex flex-col gap-2 pt-2 border-t border-border-default">
						<button class="gh-btn w-full" on:click={saveTarget}>{$t("Save Target Info")}</button>
						<button class="gh-btn gh-btn-primary w-full py-3 h-auto" on:click={publish} disabled={publishing || !$authState.token}>
							{#if publishing}<RefreshCw class="h-4 w-4 animate-spin" />{:else}<CloudUpload class="h-4 w-4" />{/if}
							{$t("Publish Now")}
						</button>
					</div>

					{#if publishUrl}
						<div class="mt-2 p-3 rounded bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 flex flex-col gap-2" in:fade>
							<div class="flex items-center justify-between text-green-800 dark:text-green-400 text-[10px] font-bold uppercase">
								<span>{$t("Live Link")}</span>
								<CheckCircle2 class="h-3 w-3" />
							</div>
							<code class="text-[10px] break-all font-mono text-green-900 dark:text-green-300 opacity-80">{publishUrl}</code>
							<button class="gh-btn gh-btn-sm" on:click={async () => { 
								try {
									await navigator.clipboard.writeText(publishUrl); 
									showToast($t("Link copied to clipboard"), 'success'); 
								} catch {
									showToast($t("Copy failed"), 'error');
								}
							}}><Copy class="h-3 w-3" />{$t("Copy")}</button>
						</div>
					{/if}
				</div>
			</div>

			{#if !$authState.token}
				<div class="blankslate p-4 py-6">
					<Database class="h-8 w-8 text-fg-subtle mb-2" />
					<p class="text-xs text-fg-muted mb-3 leading-relaxed">{$t("Connect GitHub to enable cloud sync and auto-publishing.")}</p>
					<a href="/auth" class="gh-btn gh-btn-sm">{$t("Go to Settings")}</a>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Region Flags Browser Modal -->
{#if showBuiltInRegionMap}
	<div class="fixed inset-0 z-[150] flex items-center justify-center p-4">
		<div class="fixed inset-0 bg-black/60 backdrop-blur-sm" on:click={() => (showBuiltInRegionMap = false)}></div>
		<div class="relative w-full max-w-4xl gh-box shadow-2xl flex flex-col max-h-[85vh] bg-canvas-default" in:fly={{ y: 20 }}>
			<div class="gh-box-header">
				<div class="flex items-center gap-2">
					<Flag class="h-4 w-4" />
					<span>{$t("Built-in Region Flag Rules")}</span>
				</div>
				<button class="hover:text-accent-fg" on:click={() => (showBuiltInRegionMap = false)}><X class="h-4 w-4" /></button>
			</div>
			
			<div class="p-4 border-b border-border-default bg-canvas-subtle">
				<div class="relative">
					<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
					<input class="gh-input pl-9 h-10" placeholder={$t("Search code or keyword...")} bind:value={builtInRegionMapSearch} />
				</div>
			</div>

			<div class="flex-1 overflow-y-auto p-4">
				<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
					{#each filteredRegionRules as rule}
						<button 
							class="p-3 rounded-lg border border-border-default bg-canvas-subtle hover:border-accent-emphasis hover:bg-canvas-default text-left flex flex-col gap-2 transition-all group"
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
			
			<div class="p-3 bg-canvas-subtle border-t border-border-default flex justify-end">
				<button class="gh-btn" on:click={() => (showBuiltInRegionMap = false)}>{$t("Close")}</button>
			</div>
		</div>
	</div>
{/if}
