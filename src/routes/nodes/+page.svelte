<script lang="ts">
	import { onDestroy } from "svelte";
	import { t } from "$lib/i18n";
	import {
		appState,
		removeNode,
		removeSubscription,
		upsertNode,
		upsertSubscription
	} from "$lib/stores/app";
	import type { NodeItem, NodeTag, ProxyType, SubscriptionItem } from "$lib/models";
	import { createId } from "$lib/utils/id";
	import { nowIso } from "$lib/utils/time";
	import { requestConfirm } from "$lib/stores/confirm";
	import { cn } from "$lib/utils/cn";
	import {
		decodeBase64Utf8,
		extractSubscriptionNodeLines,
		inferNodeNameFromRaw,
		inferNodeTypeFromRaw,
		loadSubscriptionContent
	} from "$lib/subscription";
	import { showToast } from "$lib/stores/toast";
	import {
		Plus,
		Search,
		Trash2,
		Copy,
		Edit3,
		Tag,
		Network,
		Link as LinkIcon,
		Check,
		AlertCircle,
		X,
		ExternalLink,
		ChevronDown,
		Save,
		RefreshCw,
		Eye
	} from "lucide-svelte";
	import { fade, slide, fly } from "svelte/transition";

	let activeTab: "nodes" | "subscriptions" = "nodes";
	let isAddModalOpen = false;
	let addMode: "single" | "batch" = "single";

	// Add Form State
	let nodeName = "";
	let nodeType: ProxyType = "vless";
	let nodeRaw = "";
	let nodeTags = "";
	let subName = "";
	let subUrl = "";
	let subTags = "";
	let batchContent = "";
	let batchTags = "";

	// Filter & List State
	let searchQuery = "";
	let filterStatus: "all" | "enabled" | "disabled" = "all";
	let expandedId: string | null = null;
	
	// Preview State
	let previewSubscriptionId: string | null = null;
	let subscriptionPreviewCache: Record<string, { status: 'loading' | 'ready' | 'error', nodes: any[], error: string | null }> = {};

	// Edit State
	let nodeDrafts: Record<string, { name: string; type: ProxyType; raw: string; tags: string }> = {};
	let subDrafts: Record<string, { name: string; url: string; tags: string }> = {};

	function showToastNotify(message: string, type: "success" | "info" | "error" = "success") {
		showToast(message, type);
	}

	function parseTags(value: string): NodeTag[] {
		return value.split(",").map(t => t.trim()).filter(Boolean).map(label => ({ id: createId("tag"), label }));
	}

	function stringifyTags(tags: NodeTag[]): string {
		return tags.map(t => t.label).join(", ");
	}

	$: filteredNodes = $appState.nodes
		.filter(n => (filterStatus === "all" ? true : filterStatus === "enabled" ? n.enabled : !n.enabled))
		.filter(n => {
			const q = searchQuery.toLowerCase();
			return !q || n.name.toLowerCase().includes(q) || n.type.toLowerCase().includes(q) || n.tags.some(t => t.label.toLowerCase().includes(q));
		})
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	$: filteredSubscriptions = $appState.subscriptions
		.filter(s => (filterStatus === "all" ? true : filterStatus === "enabled" ? s.enabled : !s.enabled))
		.filter(s => {
			const q = searchQuery.toLowerCase();
			return !q || s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q) || s.tags.some(t => t.label.toLowerCase().includes(q));
		})
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	function handleAdd() {
		if (activeTab === "nodes") {
			if (!nodeName.trim() || !nodeRaw.trim()) return;
			upsertNode({
				id: createId("node"), name: nodeName.trim(), type: nodeType, raw: nodeRaw.trim(),
				tags: parseTags(nodeTags), enabled: true, updatedAt: nowIso(), source: "single"
			});
			nodeName = ""; nodeRaw = ""; nodeTags = "";
		} else {
			if (!subName.trim() || !subUrl.trim()) return;
			upsertSubscription({
				id: createId("sub"), name: subName.trim(), url: subUrl.trim(), enabled: true,
				tags: parseTags(subTags), updatedAt: nowIso()
			});
			subName = ""; subUrl = ""; subTags = "";
		}
		isAddModalOpen = false;
		showToastNotify($t("Resource added"));
	}

	// Edit Logic
	function startEditNode(node: NodeItem) {
		if (expandedId === node.id) {
			expandedId = null;
			return;
		}
		nodeDrafts[node.id] = {
			name: node.name,
			type: node.type,
			raw: node.raw,
			tags: stringifyTags(node.tags)
		};
		expandedId = node.id;
	}

	function saveEditNode(id: string) {
		const draft = nodeDrafts[id];
		const original = $appState.nodes.find(n => n.id === id);
		if (!draft || !original) return;

		upsertNode({
			...original,
			name: draft.name.trim(),
			type: draft.type,
			raw: draft.raw.trim(),
			tags: parseTags(draft.tags),
			updatedAt: nowIso()
		});
		expandedId = null;
		showToastNotify($t("Node updated"));
	}

	function startEditSub(sub: SubscriptionItem) {
		if (expandedId === sub.id) {
			expandedId = null;
			return;
		}
		subDrafts[sub.id] = {
			name: sub.name,
			url: sub.url,
			tags: stringifyTags(sub.tags)
		};
		expandedId = sub.id;
	}

	function saveEditSub(id: string) {
		const draft = subDrafts[id];
		const original = $appState.subscriptions.find(s => s.id === id);
		if (!draft || !original) return;

		upsertSubscription({
			...original,
			name: draft.name.trim(),
			url: draft.url.trim(),
			tags: parseTags(draft.tags),
			updatedAt: nowIso()
		});
		expandedId = null;
		showToastNotify($t("Subscription updated"));
	}

	async function loadSubscriptionPreview(subscription: SubscriptionItem, force = false) {
		if (!force && subscriptionPreviewCache[subscription.id]?.status === 'ready') return;
		
		subscriptionPreviewCache[subscription.id] = { status: 'loading', nodes: [], error: null };
		try {
			const { content, warning } = await loadSubscriptionContent(subscription.url);
			if (warning) throw new Error(warning);
			
			const lines = extractSubscriptionNodeLines(content);
			const nodes = lines.map((raw, idx) => ({
				id: `preview-${idx}`,
				name: inferNodeNameFromRaw(raw, `Node ${idx + 1}`),
				type: inferNodeTypeFromRaw(raw),
				raw
			}));
			
			subscriptionPreviewCache[subscription.id] = { status: 'ready', nodes, error: null };
		} catch (err) {
			subscriptionPreviewCache[subscription.id] = { 
				status: 'error', 
				nodes: [], 
				error: err instanceof Error ? err.message : String(err) 
			};
		}
	}

	function openSubscriptionPreview(sub: SubscriptionItem) {
		previewSubscriptionId = sub.id;
		loadSubscriptionPreview(sub);
	}

	function closeSubscriptionPreview() {
		previewSubscriptionId = null;
	}

	async function remove(id: string, type: "node" | "sub", name: string) {
		const confirmed = await requestConfirm({
			title: $t("Confirm Deletion"),
			message: $t("Delete {name} forever?", { name }),
			confirmText: $t("Delete"),
			danger: true
		});
		if (!confirmed) return;
		if (type === "node") removeNode(id);
		else removeSubscription(id);
		showToastNotify($t("Deleted {name}"));
	}

	function toggleEnabled(id: string, type: "node" | "sub") {
		if (type === "node") {
			const node = $appState.nodes.find(n => n.id === id);
			if (node) upsertNode({ ...node, enabled: !node.enabled, updatedAt: nowIso() });
		} else {
			const sub = $appState.subscriptions.find(s => s.id === id);
			if (sub) upsertSubscription({ ...sub, enabled: !sub.enabled, updatedAt: nowIso() });
		}
	}

	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		showToastNotify($t("Copied to clipboard"));
	}
</script>

<div class="flex flex-col gap-6">
	<!-- Page Header -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-default pb-4">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-canvas-subtle border border-border-default">
				<Network class="h-5 w-5 text-fg-muted" />
			</div>
			<div>
				<h1 class="text-xl font-bold">{$t("Nodes & Subscriptions")}</h1>
				<p class="text-sm text-fg-muted">{$t("Manage your proxy sources and connectivity settings")}</p>
			</div>
		</div>
		<button class="gh-btn gh-btn-primary" on:click={() => (isAddModalOpen = !isAddModalOpen)}>
			<Plus class="h-4 w-4" />
			{$t("New Resource")}
		</button>
	</div>

	<!-- Add Modal / Embedded Form -->
	{#if isAddModalOpen}
		<div class="gh-box" transition:slide>
			<div class="gh-box-header">
				<div class="flex items-center gap-4">
					<button class={cn("gh-tab", addMode === "single" && "gh-tab-active")} on:click={() => (addMode = "single")}>{$t("Single Entry")}</button>
					<button class={cn("gh-tab", addMode === "batch" && "gh-tab-active")} on:click={() => (addMode = "batch")}>{$t("Batch Import")}</button>
				</div>
				<button class="text-fg-muted hover:text-fg-default" on:click={() => (isAddModalOpen = false)}><X class="h-4 w-4" /></button>
			</div>
			<div class="p-4 bg-canvas-default flex flex-col gap-4">
				{#if addMode === "single"}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<label class="text-sm font-semibold">{$t("Name")}</label>
							{#if activeTab === "nodes"}
								<input class="gh-input" placeholder={$t("Friendly name")} bind:value={nodeName} />
							{:else}
								<input class="gh-input" placeholder={$t("Friendly name")} bind:value={subName} />
							{/if}
						</div>
						{#if activeTab === "nodes"}
							<div class="flex flex-col gap-1.5">
								<label class="text-sm font-semibold">{$t("Protocol")}</label>
								<select class="gh-input" bind:value={nodeType}>
									<option value="vless">VLESS</option><option value="vmess">VMess</option><option value="trojan">Trojan</option>
									<option value="ss">SS</option><option value="ssr">SSR</option><option value="hysteria2">Hysteria2</option>
								</select>
							</div>
						{/if}
						<div class="md:col-span-2 flex flex-col gap-1.5">
							<label class="text-sm font-semibold">{activeTab === "nodes" ? $t("Raw URI") : $t("URL")}</label>
							{#if activeTab === "nodes"}
								<textarea class="gh-input gh-textarea font-mono" placeholder="vless://..." bind:value={nodeRaw}></textarea>
							{:else}
								<textarea class="gh-input gh-textarea font-mono" placeholder="https://..." bind:value={subUrl}></textarea>
							{/if}
						</div>
						<div class="md:col-span-2 flex flex-col gap-1.5">
							<label class="text-sm font-semibold">{$t("Tags (comma separated)")}</label>
							{#if activeTab === "nodes"}
								<input class="gh-input" placeholder="tag1, tag2..." bind:value={nodeTags} />
							{:else}
								<input class="gh-input" placeholder="tag1, tag2..." bind:value={subTags} />
							{/if}
						</div>
					</div>
				{:else}
					<div class="flex flex-col gap-4">
						<textarea class="gh-input gh-textarea font-mono h-40" placeholder={$t("One per line...")} bind:value={batchContent}></textarea>
						<input class="gh-input" placeholder={$t("Common tags for this batch...")} bind:value={batchTags} />
					</div>
				{/if}
			</div>
			<div class="p-4 bg-canvas-subtle border-t border-border-default flex justify-end gap-2">
				<button class="gh-btn" on:click={() => (isAddModalOpen = false)}>{$t("Cancel")}</button>
				<button class="gh-btn gh-btn-primary px-6" on:click={handleAdd}>{$t("Save Resource")}</button>
			</div>
		</div>
	{/if}

	<!-- Filter Bar -->
	<div class="flex flex-col sm:flex-row items-center justify-between gap-4">
		<div class="gh-tabs w-full sm:w-auto">
			<button class={cn("gh-tab", activeTab === "nodes" && "gh-tab-active")} on:click={() => { activeTab = "nodes"; expandedId = null; }}>
				<Network class="h-4 w-4 inline mr-1" /> {$t("Nodes")}
				<span class="ml-1 px-1.5 py-0.5 rounded-full bg-canvas-subtle border border-border-default text-[10px]">{ $appState.nodes.length }</span>
			</button>
			<button class={cn("gh-tab", activeTab === "subscriptions" && "gh-tab-active")} on:click={() => { activeTab = "subscriptions"; expandedId = null; }}>
				<LinkIcon class="h-4 w-4 inline mr-1" /> {$t("Subscriptions")}
				<span class="ml-1 px-1.5 py-0.5 rounded-full bg-canvas-subtle border border-border-default text-[10px]">{ $appState.subscriptions.length }</span>
			</button>
		</div>

		<div class="flex items-center gap-2 w-full sm:w-auto">
			<div class="relative flex-1 sm:w-64">
				<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
				<input class="gh-input pl-9 h-9" placeholder={$t("Filter resources...")} bind:value={searchQuery} />
			</div>
			<select class="gh-input w-32 h-9" bind:value={filterStatus}>
				<option value="all">{$t("All")}</option>
				<option value="enabled">{$t("Enabled")}</option>
				<option value="disabled">{$t("Disabled")}</option>
			</select>
		</div>
	</div>

	<!-- Content Box -->
	<div class="gh-box shadow-sm">
		<div class="gh-box-header text-sm">
			<span>{$t("Resources")}</span>
			<span class="text-xs text-fg-muted font-normal">{activeTab === "nodes" ? filteredNodes.length : filteredSubscriptions.length} results</span>
		</div>

		{#if activeTab === "nodes"}
			{#if filteredNodes.length === 0}
				<div class="blankslate">
					<Network class="h-10 w-10 text-fg-subtle mb-3" />
					<h3 class="text-lg font-bold">{$t("No nodes found")}</h3>
					<p class="text-fg-muted text-sm mb-4">{$t("Add a single node or import a batch to get started.")}</p>
					<button class="gh-btn" on:click={() => (isAddModalOpen = true)}>{$t("Create node")}</button>
				</div>
			{:else}
				{#each filteredNodes as node (node.id)}
					<div class={cn("gh-box-row group flex flex-col gap-0", !node.enabled && "opacity-60")}>
						<div class="flex items-start justify-between gap-4">
							<div class="flex items-start gap-3 min-w-0">
								<button class={cn("mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", node.enabled ? "bg-accent-emphasis border-accent-emphasis text-white" : "border-border-default bg-canvas-default")} on:click={() => toggleEnabled(node.id, "node")}>
									{#if node.enabled}<Check class="h-3.5 w-3.5" />{/if}
								</button>
								<div class="flex flex-col gap-1 min-w-0">
									<div class="flex items-center gap-2">
										<h3 class="font-bold text-accent-fg hover:underline cursor-pointer truncate" on:click={() => startEditNode(node)}>{node.name}</h3>
										<span class="px-1.5 py-0.5 rounded border border-border-default bg-canvas-subtle text-[10px] font-black uppercase tracking-tight text-fg-muted">{node.type}</span>
									</div>
									<code class="text-[11px] text-fg-muted truncate font-mono bg-canvas-subtle px-1 rounded">{node.raw}</code>
									{#if node.tags.length > 0}
										<div class="flex flex-wrap gap-1 mt-1">
											{#each node.tags as tag}
												<span class="badge"><Tag class="h-3 w-3 mr-1" />{tag.label}</span>
											{/each}
										</div>
									{/if}
								</div>
							</div>
							<div class="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
								<button class="gh-btn gh-btn-sm" on:click={() => startEditNode(node)} title={$t("Edit")}><Edit3 class="h-3.5 w-3.5" /></button>
								<button class="gh-btn gh-btn-sm" on:click={() => copy(node.raw)} title={$t("Copy URI")}><Copy class="h-3.5 w-3.5" /></button>
								<button class="gh-btn gh-btn-sm text-danger-fg" on:click={() => remove(node.id, "node", node.name)} title={$t("Delete")}><Trash2 class="h-3.5 w-3.5" /></button>
							</div>
						</div>

						<!-- Inline Editor for Node -->
						{#if expandedId === node.id && nodeDrafts[node.id]}
							<div class="mt-4 p-4 border border-border-default rounded-md bg-canvas-subtle flex flex-col gap-4" transition:slide>
								<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
									<div class="flex flex-col gap-1.5">
										<label class="text-xs font-bold uppercase text-fg-muted">{$t("Name")}</label>
										<input class="gh-input" bind:value={nodeDrafts[node.id].name} />
									</div>
									<div class="flex flex-col gap-1.5">
										<label class="text-xs font-bold uppercase text-fg-muted">{$t("Protocol")}</label>
										<select class="gh-input" bind:value={nodeDrafts[node.id].type}>
											<option value="vless">VLESS</option><option value="vmess">VMess</option><option value="trojan">Trojan</option>
											<option value="ss">SS</option><option value="ssr">SSR</option><option value="hysteria2">Hysteria2</option>
										</select>
									</div>
									<div class="md:col-span-2 flex flex-col gap-1.5">
										<label class="text-xs font-bold uppercase text-fg-muted">{$t("Raw URI")}</label>
										<textarea class="gh-input gh-textarea font-mono text-xs" bind:value={nodeDrafts[node.id].raw}></textarea>
									</div>
									<div class="md:col-span-2 flex flex-col gap-1.5">
										<label class="text-xs font-bold uppercase text-fg-muted">{$t("Tags")}</label>
										<input class="gh-input" bind:value={nodeDrafts[node.id].tags} />
									</div>
								</div>
								<div class="flex justify-end gap-2">
									<button class="gh-btn gh-btn-sm" on:click={() => (expandedId = null)}>{$t("Cancel")}</button>
									<button class="gh-btn gh-btn-sm gh-btn-primary" on:click={() => saveEditNode(node.id)}><Save class="h-3 w-3 mr-1" />{$t("Save")}</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		{:else}
			{#if filteredSubscriptions.length === 0}
				<div class="blankslate">
					<LinkIcon class="h-10 w-10 text-fg-subtle mb-3" />
					<h3 class="text-lg font-bold">{$t("No subscriptions found")}</h3>
					<p class="text-fg-muted text-sm mb-4">{$t("Subscribe to a link to auto-fetch nodes.")}</p>
					<button class="gh-btn" on:click={() => (isAddModalOpen = true)}>{$t("Add subscription")}</button>
				</div>
			{:else}
				{#each filteredSubscriptions as sub (sub.id)}
					<div class={cn("gh-box-row group flex flex-col gap-0", !sub.enabled && "opacity-60")}>
						<div class="flex items-start justify-between gap-4">
							<div class="flex items-start gap-3 min-w-0">
								<button class={cn("mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", sub.enabled ? "bg-green-600 border-green-600 text-white" : "border-border-default bg-canvas-default")} on:click={() => toggleEnabled(sub.id, "sub")}>
									{#if sub.enabled}<Check class="h-3.5 w-3.5" />{/if}
								</button>
								<div class="flex flex-col gap-1 min-w-0">
									<h3 class="font-bold text-accent-fg hover:underline cursor-pointer truncate" on:click={() => startEditSub(sub)}>{sub.name}</h3>
									<div class="flex items-center gap-2 text-[11px] text-fg-muted">
										<ExternalLink class="h-3 w-3" />
										<span class="truncate">{sub.url}</span>
									</div>
									{#if sub.tags.length > 0}
										<div class="flex flex-wrap gap-1 mt-1">
											{#each sub.tags as tag}
												<span class="badge"><Tag class="h-3 w-3 mr-1" />{tag.label}</span>
											{/each}
										</div>
									{/if}
								</div>
							</div>
							<div class="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
								<button class="gh-btn gh-btn-sm" on:click={() => openSubscriptionPreview(sub)} title={$t("Preview Nodes")}><Eye class="h-3.5 w-3.5" /></button>
								<button class="gh-btn gh-btn-sm" on:click={() => startEditSub(sub)} title={$t("Edit")}><Edit3 class="h-3.5 w-3.5" /></button>
								<button class="gh-btn gh-btn-sm" on:click={() => copy(sub.url)} title={$t("Copy URL")}><Copy class="h-3.5 w-3.5" /></button>
								<button class="gh-btn gh-btn-sm text-danger-fg" on:click={() => remove(sub.id, "sub", sub.name)} title={$t("Delete")}><Trash2 class="h-3.5 w-3.5" /></button>
							</div>
						</div>

						<!-- Inline Editor for Subscription -->
						{#if expandedId === sub.id && subDrafts[sub.id]}
							<div class="mt-4 p-4 border border-border-default rounded-md bg-canvas-subtle flex flex-col gap-4" transition:slide>
								<div class="flex flex-col gap-3">
									<div class="flex flex-col gap-1.5">
										<label class="text-xs font-bold uppercase text-fg-muted">{$t("Name")}</label>
										<input class="gh-input" bind:value={subDrafts[sub.id].name} />
									</div>
									<div class="flex flex-col gap-1.5">
										<label class="text-xs font-bold uppercase text-fg-muted">{$t("URL")}</label>
										<input class="gh-input font-mono" bind:value={subDrafts[sub.id].url} />
									</div>
									<div class="flex flex-col gap-1.5">
										<label class="text-xs font-bold uppercase text-fg-muted">{$t("Tags")}</label>
										<input class="gh-input" bind:value={subDrafts[sub.id].tags} />
									</div>
								</div>
								<div class="flex justify-end gap-2">
									<button class="gh-btn gh-btn-sm" on:click={() => (expandedId = null)}>{$t("Cancel")}</button>
									<button class="gh-btn gh-btn-sm gh-btn-primary" on:click={() => saveEditSub(sub.id)}><Save class="h-3 w-3 mr-1" />{$t("Save")}</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		{/if}
	</div>
</div>

<!-- Subscription Preview Modal -->
{#if previewSubscriptionId}
	{@const sub = $appState.subscriptions.find(s => s.id === previewSubscriptionId)}
	{@const cache = subscriptionPreviewCache[previewSubscriptionId]}
	<div class="fixed inset-0 z-[150] flex items-center justify-center p-4">
		<div class="fixed inset-0 bg-black/50 backdrop-blur-sm" on:click={closeSubscriptionPreview}></div>
		<div class="relative w-full max-w-2xl gh-box shadow-2xl flex flex-col max-h-[80vh]" in:fly={{ y: 20 }}>
			<div class="gh-box-header">
				<div class="flex items-center gap-2">
					<Eye class="h-4 w-4" />
					<span>{$t("Subscription Preview")}</span>
					{#if sub}<span class="text-xs text-fg-muted font-normal">({sub.name})</span>{/if}
				</div>
				<button class="hover:text-accent-fg" on:click={closeSubscriptionPreview}><X class="h-4 w-4" /></button>
			</div>
			
			<div class="p-4 bg-canvas-default overflow-y-auto flex-1">
				{#if cache?.status === 'loading'}
					<div class="flex flex-col items-center justify-center py-12 gap-3 text-fg-muted">
						<RefreshCw class="h-8 w-8 animate-spin" />
						<p>{$t("Fetching subscription content...")}</p>
					</div>
				{:else if cache?.status === 'error'}
					<div class="p-4 rounded-md bg-red-50 border border-red-200 text-red-800 flex items-start gap-3">
						<AlertCircle class="h-5 w-5 shrink-0 mt-0.5" />
						<div>
							<p class="font-bold">{$t("Failed to load subscription")}</p>
							<p class="text-sm opacity-80">{cache.error}</p>
						</div>
					</div>
				{:else if cache?.status === 'ready'}
					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between mb-2">
							<span class="text-xs font-bold text-fg-muted uppercase">{$t("Nodes Found")} ({cache.nodes.length})</span>
							<button class="text-xs text-accent-fg hover:underline" on:click={() => sub && loadSubscriptionPreview(sub, true)}>{$t("Refresh")}</button>
						</div>
						{#each cache.nodes as node}
							<div class="p-2 border border-border-default rounded hover:bg-canvas-subtle transition-colors group/item">
								<div class="flex items-center justify-between gap-4">
									<div class="flex items-center gap-2 min-w-0">
										<span class="text-xs font-bold truncate">{node.name}</span>
										<span class="px-1 py-0.5 rounded bg-canvas-default border border-border-default text-[9px] font-black uppercase text-fg-muted">{node.type}</span>
									</div>
									<button class="gh-btn gh-btn-sm opacity-0 group-hover/item:opacity-100" on:click={() => copy(node.raw)}><Copy class="h-3 w-3" /></button>
								</div>
								<code class="block mt-1 text-[10px] font-mono text-fg-muted truncate">{node.raw}</code>
							</div>
						{/each}
					</div>
				{/if}
			</div>
			
			<div class="p-3 bg-canvas-subtle border-t border-border-default flex justify-end">
				<button class="gh-btn" on:click={closeSubscriptionPreview}>{$t("Close")}</button>
			</div>
		</div>
	</div>
{/if}
