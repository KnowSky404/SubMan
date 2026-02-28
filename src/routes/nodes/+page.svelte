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
	import { cn } from "$lib/utils/cn";
	import { 
		Plus, 
		Search, 
		Filter, 
		Trash2, 
		Copy, 
		Edit3, 
		ChevronDown, 
		ChevronUp, 
		Globe, 
		Tag,
		Network,
		Link as LinkIcon,
		Check,
		AlertCircle,
		MoreVertical,
		Zap,
		Shield,
		Wifi,
		Cpu
	} from "lucide-svelte";
	import { fade, slide, fly } from "svelte/transition";

	let activeTab: 'nodes' | 'subscriptions' = 'nodes';
	let isAddModalOpen = false;

	// Node form
	let nodeName = "";
	let nodeType: ProxyType = "vless";
	let nodeRaw = "";
	let nodeTags = "";

	// Sub form
	let subName = "";
	let subUrl = "";
	let subTags = "";

	let searchQuery = "";
	let filterStatus: "all" | "enabled" | "disabled" = "all";
	let expandedId: string | null = null;
	
	let toast: { message: string, type: 'success' | 'info' | 'error' } | null = null;
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	function showToast(message: string, type: 'success' | 'info' | 'error' = 'success') {
		toast = { message, type };
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toast = null, 3000);
	}

	$: filteredNodes = $appState.nodes
		.filter(node => filterStatus === 'all' ? true : filterStatus === 'enabled' ? node.enabled : !node.enabled)
		.filter(node => {
			const query = searchQuery.trim().toLowerCase();
			if (!query) return true;
			return node.name.toLowerCase().includes(query) || 
				   node.type.toLowerCase().includes(query) ||
				   node.tags.some(t => t.label.toLowerCase().includes(query));
		})
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	$: filteredSubscriptions = $appState.subscriptions
		.filter(sub => filterStatus === 'all' ? true : filterStatus === 'enabled' ? sub.enabled : !sub.enabled)
		.filter(sub => {
			const query = searchQuery.trim().toLowerCase();
			if (!query) return true;
			return sub.name.toLowerCase().includes(query) || 
				   sub.url.toLowerCase().includes(query) ||
				   sub.tags.some(t => t.label.toLowerCase().includes(query));
		})
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	function parseTags(value: string): NodeTag[] {
		return value.split(",").map(t => t.trim()).filter(Boolean).map(label => ({ id: createId("tag"), label }));
	}

	function handleAdd() {
		if (activeTab === 'nodes') {
			if (!nodeName || !nodeRaw) return;
			upsertNode({
				id: createId("node"), name: nodeName, type: nodeType, raw: nodeRaw,
				tags: parseTags(nodeTags), enabled: true, updatedAt: nowIso(), source: "single"
			});
			nodeName = ""; nodeRaw = ""; nodeTags = "";
			showToast($t("Node added successfully"));
		} else {
			if (!subName || !subUrl) return;
			upsertSubscription({
				id: createId("sub"), name: subName, url: subUrl, enabled: true,
				tags: parseTags(subTags), updatedAt: nowIso()
			});
			subName = ""; subUrl = ""; subTags = "";
			showToast($t("Subscription added successfully"));
		}
		isAddModalOpen = false;
	}

	function toggleEnabled(id: string, type: 'node' | 'sub') {
		if (type === 'node') {
			const node = $appState.nodes.find(n => n.id === id);
			if (node) upsertNode({ ...node, enabled: !node.enabled, updatedAt: nowIso() });
		} else {
			const sub = $appState.subscriptions.find(s => s.id === id);
			if (sub) upsertSubscription({ ...sub, enabled: !sub.enabled, updatedAt: nowIso() });
		}
	}

	function remove(id: string, type: 'node' | 'sub', name: string) {
		if (!confirm($t("Are you sure you want to remove {name}?", { name }))) return;
		if (type === 'node') removeNode(id);
		else removeSubscription(id);
		showToast($t("Removed {name}", { name }), 'info');
	}

	async function copy(text: string, label: string) {
		try {
			await navigator.clipboard.writeText(text);
			showToast($t("Copied {label}", { label }));
		} catch {
			showToast($t("Copy failed"), 'error');
		}
	}

	function getHost(url: string): string {
		try { return new URL(url).host; } catch { return url; }
	}

	const typeColors: Record<ProxyType, string> = {
		vless: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
		vmess: "bg-purple-500/10 text-purple-400 border-purple-500/20",
		trojan: "bg-rose-500/10 text-rose-400 border-rose-500/20",
		ss: "bg-amber-500/10 text-amber-400 border-amber-500/20",
		hysteria2: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
		tuic: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
		other: "bg-slate-500/10 text-slate-400 border-slate-500/20"
	};

	onDestroy(() => { if (toastTimer) clearTimeout(toastTimer); });
</script>

<svelte:head>
	<title>{$t("Nodes & Subscriptions")} | {$t("SubMan")}</title>
</svelte:head>

<div class="space-y-6 pb-12">
	<!-- Header & Global Actions -->
	<header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-extrabold text-white tracking-tight">{$t("Nodes & Subscriptions")}</h1>
			<p class="text-slate-400 text-sm">{$t("Manage your proxy sources and connectivity settings")}</p>
		</div>
		
		<button 
			on:click={() => isAddModalOpen = !isAddModalOpen}
			class="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-500 active:scale-[0.98]"
		>
			<Plus class="h-4 w-4" />
			{activeTab === 'nodes' ? $t("New Node") : $t("New Subscription")}
		</button>
	</header>

	<!-- Add Modal / Form (Collapsible) -->
	{#if isAddModalOpen}
		<section 
			transition:slide
			class="overflow-hidden rounded-3xl border border-indigo-500/20 bg-indigo-500/5 p-6 shadow-2xl shadow-indigo-500/5"
		>
			<div class="flex items-center justify-between mb-6">
				<h2 class="text-lg font-bold text-white flex items-center gap-2">
					<Plus class="h-5 w-5 text-indigo-400" />
					{activeTab === 'nodes' ? $t("Add New Node") : $t("Add New Subscription")}
				</h2>
				<button on:click={() => isAddModalOpen = false} class="text-slate-500 hover:text-white transition-colors">
					<ChevronUp class="h-5 w-5" />
				</button>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				{#if activeTab === 'nodes'}
					<div class="space-y-4">
						<input
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
							placeholder={$t("Node name")}
							bind:value={nodeName}
						/>
						<select
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-indigo-500/50 transition-all"
							bind:value={nodeType}
						>
							<option value="vless">VLESS</option>
							<option value="vmess">VMess</option>
							<option value="trojan">Trojan</option>
							<option value="ss">Shadowsocks</option>
							<option value="hysteria2">Hysteria2</option>
							<option value="tuic">TUIC</option>
							<option value="other">Other</option>
						</select>
					</div>
					<div class="space-y-4">
						<textarea
							class="w-full h-[104px] rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs font-mono text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
							placeholder={$t("Raw node URI (vless://...)")}
							bind:value={nodeRaw}
						/>
					</div>
					<div class="sm:col-span-2">
						<input
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
							placeholder={$t("Tags (comma separated)")}
							bind:value={nodeTags}
						/>
					</div>
				{:else}
					<div class="space-y-4">
						<input
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
							placeholder={$t("Subscription name")}
							bind:value={subName}
						/>
						<input
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
							placeholder={$t("Subscription URL")}
							bind:value={subUrl}
						/>
					</div>
					<div class="sm:col-span-2">
						<input
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
							placeholder={$t("Tags (comma separated)")}
							bind:value={subTags}
						/>
					</div>
				{/if}
			</div>

			<div class="mt-6 flex justify-end gap-3">
				<button 
					on:click={() => isAddModalOpen = false}
					class="px-5 py-2.5 text-sm font-bold text-slate-400 hover:text-white transition-colors"
				>
					{$t("Cancel")}
				</button>
				<button 
					on:click={handleAdd}
					class="rounded-xl bg-indigo-600 px-8 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-500 active:scale-[0.98]"
				>
					{$t("Save")}
				</button>
			</div>
		</section>
	{/if}

	<!-- Tabs & Search -->
	<div class="flex flex-col gap-4 md:flex-row md:items-center">
		<div class="flex p-1 rounded-2xl bg-slate-900/50 border border-slate-800/60 w-fit">
			<button 
				on:click={() => activeTab = 'nodes'}
				class={cn(
					"px-6 py-2 rounded-xl text-sm font-bold transition-all",
					activeTab === 'nodes' ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
				)}
			>
				{$t("Nodes")}
			</button>
			<button 
				on:click={() => activeTab = 'subscriptions'}
				class={cn(
					"px-6 py-2 rounded-xl text-sm font-bold transition-all",
					activeTab === 'subscriptions' ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
				)}
			>
				{$t("Subscriptions")}
			</button>
		</div>

		<div class="relative flex-1 group">
			<Search class="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
			<input
				class="w-full rounded-2xl border border-slate-800 bg-slate-900/40 pl-11 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
				placeholder={$t("Search {type}...", { type: activeTab })}
				bind:value={searchQuery}
			/>
		</div>

		<select
			class="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500/50 transition-all"
			bind:value={filterStatus}
		>
			<option value="all">{$t("All Status")}</option>
			<option value="enabled">{$t("Enabled")}</option>
			<option value="disabled">{$t("Disabled")}</option>
		</select>
	</div>

	<!-- List Section -->
	<div class="grid grid-cols-1 gap-4">
		{#if activeTab === 'nodes'}
			{#if filteredNodes.length === 0}
				<div class="py-20 text-center rounded-[2.5rem] border border-slate-800/40 border-dashed">
					<Cpu class="h-12 w-12 text-slate-700 mx-auto mb-4" />
					<p class="text-slate-500 font-medium">{$t("No nodes found matching your criteria.")}</p>
				</div>
			{:else}
				{#each filteredNodes as node (node.id)}
					<div 
						transition:fade
						class={cn(
							"group relative overflow-hidden rounded-3xl border transition-all duration-300",
							node.enabled ? "border-slate-800/60 bg-slate-900/30" : "border-slate-900/40 bg-slate-950/20 grayscale opacity-60"
						)}
					>
						<div class="flex items-center gap-4 p-5">
							<!-- Toggle -->
							<button 
								on:click={() => toggleEnabled(node.id, 'node')}
								class={cn(
									"h-10 w-10 flex items-center justify-center rounded-xl transition-all",
									node.enabled ? "bg-indigo-500/10 text-indigo-400" : "bg-slate-800 text-slate-600"
								)}
							>
								{#if node.enabled}<Wifi class="h-5 w-5" />{:else}<Shield class="h-5 w-5" />{/if}
							</button>

							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2 flex-wrap">
									<h3 class="font-bold text-white truncate">{node.name}</h3>
									<span class={cn("px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border", typeColors[node.type])}>
										{node.type}
									</span>
								</div>
								<div class="flex items-center gap-2 mt-1">
									{#each node.tags as tag}
										<span class="flex items-center gap-1 text-[10px] font-medium text-slate-500">
											<Tag class="h-2.5 w-2.5" />
											{tag.label}
										</span>
									{/each}
								</div>
							</div>

							<div class="flex items-center gap-1">
								<button 
									on:click={() => copy(node.raw, node.name)}
									class="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-all"
								>
									<Copy class="h-4 w-4" />
								</button>
								<button 
									on:click={() => expandedId = expandedId === node.id ? null : node.id}
									class="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-all"
								>
									<Edit3 class="h-4 w-4" />
								</button>
								<button 
									on:click={() => remove(node.id, 'node', node.name)}
									class="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						</div>

						{#if expandedId === node.id}
							<div transition:slide class="border-t border-slate-800/60 p-5 bg-slate-950/40 space-y-4">
								<div class="grid gap-4 sm:grid-cols-2">
									<div class="space-y-1.5">
										<label class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Name")}</label>
										<input 
											class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
											value={node.name}
											on:input={(e) => upsertNode({...node, name: e.currentTarget.value, updatedAt: nowIso()})}
										/>
									</div>
									<div class="space-y-1.5">
										<label class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Type")}</label>
										<select 
											class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
											value={node.type}
											on:change={(e) => upsertNode({...node, type: e.currentTarget.value, updatedAt: nowIso()})}
										>
											<option value="vless">VLESS</option>
											<option value="vmess">VMess</option>
											<option value="trojan">Trojan</option>
											<option value="ss">Shadowsocks</option>
											<option value="hysteria2">Hysteria2</option>
											<option value="tuic">TUIC</option>
											<option value="other">Other</option>
										</select>
									</div>
								</div>
								<div class="space-y-1.5">
									<label class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Raw URI")}</label>
									<textarea 
										class="w-full h-24 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-mono text-white outline-none focus:border-indigo-500/40 transition-all"
										value={node.raw}
										on:input={(e) => upsertNode({...node, raw: e.currentTarget.value, updatedAt: nowIso()})}
									/>
								</div>
								<div class="space-y-1.5">
									<label class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Tags (comma separated)")}</label>
									<input 
										class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
										value={node.tags.map(t => t.label).join(", ")}
										on:change={(e) => upsertNode({...node, tags: parseTags(e.currentTarget.value), updatedAt: nowIso()})}
									/>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		{:else}
			{#if filteredSubscriptions.length === 0}
				<div class="py-20 text-center rounded-[2.5rem] border border-slate-800/40 border-dashed">
					<LinkIcon class="h-12 w-12 text-slate-700 mx-auto mb-4" />
					<p class="text-slate-500 font-medium">{$t("No subscriptions found.")}</p>
				</div>
			{:else}
				{#each filteredSubscriptions as sub (sub.id)}
					<div 
						transition:fade
						class={cn(
							"group relative overflow-hidden rounded-3xl border transition-all duration-300",
							sub.enabled ? "border-slate-800/60 bg-slate-900/30" : "border-slate-900/40 bg-slate-950/20 grayscale opacity-60"
						)}
					>
						<div class="flex items-center gap-4 p-5">
							<button 
								on:click={() => toggleEnabled(sub.id, 'sub')}
								class={cn(
									"h-10 w-10 flex items-center justify-center rounded-xl transition-all",
									sub.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800 text-slate-600"
								)}
							>
								<LinkIcon class="h-5 w-5" />
							</button>

							<div class="min-w-0 flex-1">
								<h3 class="font-bold text-white truncate">{sub.name}</h3>
								<p class="text-[10px] text-slate-500 font-mono truncate">{getHost(sub.url)}</p>
								<div class="flex items-center gap-2 mt-1">
									{#each sub.tags as tag}
										<span class="flex items-center gap-1 text-[10px] font-medium text-slate-500">
											<Tag class="h-2.5 w-2.5" />
											{tag.label}
										</span>
									{/each}
								</div>
							</div>

							<div class="flex items-center gap-1">
								<button 
									on:click={() => copy(sub.url, sub.name)}
									class="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-all"
								>
									<Copy class="h-4 w-4" />
								</button>
								<button 
									on:click={() => expandedId = expandedId === sub.id ? null : sub.id}
									class="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-all"
								>
									<Edit3 class="h-4 w-4" />
								</button>
								<button 
									on:click={() => remove(sub.id, 'sub', sub.name)}
									class="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						</div>

						{#if expandedId === sub.id}
							<div transition:slide class="border-t border-slate-800/60 p-5 bg-slate-950/40 space-y-4">
								<div class="grid gap-4 sm:grid-cols-2">
									<div class="space-y-1.5">
										<label class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Name")}</label>
										<input 
											class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
											value={sub.name}
											on:input={(e) => upsertSubscription({...sub, name: e.currentTarget.value, updatedAt: nowIso()})}
										/>
									</div>
									<div class="space-y-1.5">
										<label class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("URL")}</label>
										<input 
											class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
											value={sub.url}
											on:input={(e) => upsertSubscription({...sub, url: e.currentTarget.value, updatedAt: nowIso()})}
										/>
									</div>
								</div>
								<div class="space-y-1.5">
									<label class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Tags (comma separated)")}</label>
									<input 
										class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
										value={sub.tags.map(t => t.label).join(", ")}
										on:change={(e) => upsertSubscription({...sub, tags: parseTags(e.currentTarget.value), updatedAt: nowIso()})}
									/>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		{/if}
	</div>
</div>

<!-- Simple Toast -->
{#if toast}
	<div 
		transition:fly={{ y: 50, duration: 400 }}
		class={cn(
			"fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-2xl px-6 py-3 shadow-2xl border backdrop-blur-xl",
			toast.type === 'success' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
			toast.type === 'error' ? "bg-red-500/10 border-red-500/20 text-red-400" :
			"bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
		)}
	>
		{#if toast.type === 'success'}<Check class="h-4 w-4" />
		{:else if toast.type === 'error'}<AlertCircle class="h-4 w-4" />
		{:else}<Zap class="h-4 w-4" />{/if}
		<span class="text-sm font-bold">{toast.message}</span>
	</div>
{/if}
