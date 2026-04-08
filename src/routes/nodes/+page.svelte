<script lang="ts">
import { t } from "$lib/i18n";
import {
	appState,
	removeNode,
	removeSubscription,
	upsertNode,
	upsertSubscription,
} from "$lib/stores/app";
import type {
	NodeItem,
	NodeTag,
	ProxyType,
	SubscriptionItem,
} from "$lib/models";
import { createId } from "$lib/utils/id";
import { nowIso } from "$lib/utils/time";
import { requestConfirm } from "$lib/stores/confirm";
import { cn } from "$lib/utils/cn";
import {
	decodeBase64Utf8,
	extractSubscriptionNodeLines,
	inferNodeNameFromRaw,
	inferNodeTypeFromRaw,
	loadSubscriptionContent,
} from "$lib/subscription";
import { showToast } from "$lib/stores/toast";
import Octicon from "$lib/components/Octicon.svelte";
import {
	alert,
	check,
	copy as copyIcon,
	eye,
	link,
	linkExternal,
	pencil,
	plus,
	save,
	search,
	server,
	sync,
	tag,
	trash,
	x,
} from "$lib/octicons";
import { slide, fly } from "svelte/transition";

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
	const addFormIds = {
		nodeName: "node-name",
		nodeType: "node-type",
		nodeRaw: "node-raw",
		nodeTags: "node-tags",
		subName: "subscription-name",
		subUrl: "subscription-url",
		subTags: "subscription-tags",
		batchContent: "batch-content",
		batchTags: "batch-tags",
		filterQuery: "resource-filter-query",
		filterStatus: "resource-filter-status"
	};

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
		if (addMode === "single") {
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
			showToastNotify($t("Resource added"));
		} else {
			// Batch Import Logic
			const lines = batchContent.split("\n").map(l => l.trim()).filter(Boolean);
			let count = 0;

			if (activeTab === "nodes") {
				for (const line of lines) {
					const nodes = extractSubscriptionNodeLines(line);
					for (const raw of nodes) {
						upsertNode({
							id: createId("node"),
							name: inferNodeNameFromRaw(raw, `Imported Node ${count + 1}`),
							type: inferNodeTypeFromRaw(raw),
							raw,
							tags: parseTags(batchTags),
							enabled: true,
							updatedAt: nowIso(),
							source: "single"
						});
						count++;
					}
				}
			} else {
				for (const line of lines) {
					// Support "Name = URL" or just "URL"
					const parts = line.split("=").map(p => p.trim());
					let name = "";
					let url = "";
					if (parts.length >= 2) {
						name = parts[0];
						url = parts[1];
					} else {
						url = parts[0];
						try { name = new URL(url).hostname; } catch { name = `Sub ${count + 1}`; }
					}
					
					if (url.includes("://")) {
						upsertSubscription({
							id: createId("sub"),
							name,
							url,
							enabled: true,
							tags: parseTags(batchTags),
							updatedAt: nowIso()
						});
						count++;
					}
				}
			}
			batchContent = ""; batchTags = "";
			showToastNotify($t("Imported {count} items", { count }));
		}
		isAddModalOpen = false;
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
	<div class="gh-page-header">
		<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-canvas-subtle border border-border-default">
				<Octicon icon={server} className="h-5 w-5 text-fg-muted" />
			</div>
			<div>
				<h1 class="text-[2rem] font-semibold leading-tight">{$t("Nodes & Subscriptions")}</h1>
				<p class="gh-page-subtitle">{$t("Manage your proxy sources and connectivity settings")}</p>
			</div>
		</div>
		<button type="button" class="gh-btn gh-btn-primary" on:click={() => (isAddModalOpen = !isAddModalOpen)}>
			<Octicon icon={plus} className="h-4 w-4" />
			{$t("New Resource")}
		</button>
	</div>
	</div>

	<!-- Add Modal / Embedded Form -->
	{#if isAddModalOpen}
		<div class="gh-box" transition:slide>
			<div class="gh-box-header">
				<div class="flex items-center gap-4">
					<button type="button" class={cn("gh-tab", addMode === "single" && "gh-tab-active")} on:click={() => (addMode = "single")}>{$t("Single Entry")}</button>
					<button type="button" class={cn("gh-tab", addMode === "batch" && "gh-tab-active")} on:click={() => (addMode = "batch")}>{$t("Batch Import")}</button>
				</div>
				<button type="button" class="gh-icon-button h-7 w-7" on:click={() => (isAddModalOpen = false)} aria-label={$t("Close add resource panel")}><Octicon icon={x} className="h-4 w-4" /></button>
			</div>
			<div class="p-4 bg-canvas-default flex flex-col gap-4">
				{#if addMode === "single"}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={activeTab === "nodes" ? addFormIds.nodeName : addFormIds.subName}>{$t("Name")}</label>
							{#if activeTab === "nodes"}
								<input id={addFormIds.nodeName} class="gh-input" placeholder={$t("Friendly name")} bind:value={nodeName} />
							{:else}
								<input id={addFormIds.subName} class="gh-input" placeholder={$t("Friendly name")} bind:value={subName} />
							{/if}
						</div>
						{#if activeTab === "nodes"}
							<div class="flex flex-col gap-1.5">
								<label class="gh-form-label" for={addFormIds.nodeType}>{$t("Protocol")}</label>
								<select id={addFormIds.nodeType} class="gh-select" bind:value={nodeType}>
									<option value="vless">VLESS</option><option value="vmess">VMess</option><option value="trojan">Trojan</option>
									<option value="ss">SS</option><option value="ssr">SSR</option><option value="hysteria2">Hysteria2</option>
								</select>
							</div>
						{/if}
						<div class="md:col-span-2 flex flex-col gap-1.5">
							<label class="gh-form-label" for={activeTab === "nodes" ? addFormIds.nodeRaw : addFormIds.subUrl}>{activeTab === "nodes" ? $t("Raw URI") : $t("URL")}</label>
							{#if activeTab === "nodes"}
								<textarea id={addFormIds.nodeRaw} class="gh-input gh-textarea font-mono" placeholder="vless://..." bind:value={nodeRaw}></textarea>
							{:else}
								<textarea id={addFormIds.subUrl} class="gh-input gh-textarea font-mono" placeholder="https://..." bind:value={subUrl}></textarea>
							{/if}
						</div>
						<div class="md:col-span-2 flex flex-col gap-1.5">
							<label class="gh-form-label" for={activeTab === "nodes" ? addFormIds.nodeTags : addFormIds.subTags}>{$t("Tags (comma separated)")}</label>
							{#if activeTab === "nodes"}
								<input id={addFormIds.nodeTags} class="gh-input" placeholder="tag1, tag2..." bind:value={nodeTags} />
							{:else}
								<input id={addFormIds.subTags} class="gh-input" placeholder="tag1, tag2..." bind:value={subTags} />
							{/if}
						</div>
					</div>
				{:else}
					<div class="flex flex-col gap-4">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={addFormIds.batchContent}>{$t("Batch content")}</label>
							<textarea id={addFormIds.batchContent} class="gh-input gh-textarea font-mono h-40" placeholder={$t("One per line...")} bind:value={batchContent}></textarea>
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={addFormIds.batchTags}>{$t("Common tags")}</label>
							<input id={addFormIds.batchTags} class="gh-input" placeholder={$t("Common tags for this batch...")} bind:value={batchTags} />
						</div>
					</div>
				{/if}
			</div>
			<div class="p-4 bg-canvas-subtle border-t border-border-default flex justify-end gap-2">
				<button type="button" class="gh-btn" on:click={() => (isAddModalOpen = false)}>{$t("Cancel")}</button>
				<button type="button" class="gh-btn gh-btn-primary px-6" on:click={handleAdd}>{$t("Save Resource")}</button>
			</div>
		</div>
	{/if}

	<!-- Filter Bar -->
	<div class="flex flex-col sm:flex-row items-center justify-between gap-4">
		<div class="gh-tabs w-full sm:w-auto">
			<button type="button" class={cn("gh-tab", activeTab === "nodes" && "gh-tab-active")} on:click={() => { activeTab = "nodes"; expandedId = null; }}>
				<Octicon icon={server} className="mr-1 h-4 w-4" /> {$t("Nodes")}
				<span class="ml-1 px-1.5 py-0.5 rounded-full bg-canvas-subtle border border-border-default text-[10px]">{ $appState.nodes.length }</span>
			</button>
			<button type="button" class={cn("gh-tab", activeTab === "subscriptions" && "gh-tab-active")} on:click={() => { activeTab = "subscriptions"; expandedId = null; }}>
				<Octicon icon={link} className="mr-1 h-4 w-4" /> {$t("Subscriptions")}
				<span class="ml-1 px-1.5 py-0.5 rounded-full bg-canvas-subtle border border-border-default text-[10px]">{ $appState.subscriptions.length }</span>
			</button>
		</div>

		<div class="flex items-center gap-2 w-full sm:w-auto">
			<div class="relative flex-1 sm:w-64">
				<Octicon icon={search} className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
				<label class="sr-only" for={addFormIds.filterQuery}>{$t("Filter resources")}</label>
				<input id={addFormIds.filterQuery} class="gh-input pl-9 h-9" placeholder={$t("Filter resources...")} bind:value={searchQuery} />
			</div>
			<label class="sr-only" for={addFormIds.filterStatus}>{$t("Filter status")}</label>
			<select id={addFormIds.filterStatus} class="gh-select w-32 h-9" bind:value={filterStatus}>
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
						<Octicon icon={server} className="mb-3 h-10 w-10 text-fg-subtle" />
						<h3 class="text-lg font-bold">{$t("No nodes found")}</h3>
						<p class="text-fg-muted text-sm mb-4">{$t("Add a single node or import a batch to get started.")}</p>
						<button type="button" class="gh-btn" on:click={() => (isAddModalOpen = true)}>{$t("Create node")}</button>
					</div>
				{:else}
					{#each filteredNodes as node (node.id)}
						<div class={cn("gh-box-row group flex flex-col gap-0", !node.enabled && "opacity-60")}>
							<div class="flex items-start justify-between gap-4">
								<div class="flex items-start gap-3 min-w-0">
									<button type="button" class={cn("mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", node.enabled ? "bg-accent-emphasis border-accent-emphasis text-white" : "border-border-default bg-canvas-default")} on:click={() => toggleEnabled(node.id, "node")} aria-label={$t(node.enabled ? "Disable node" : "Enable node")}>
										{#if node.enabled}<Octicon icon={check} className="h-3.5 w-3.5" />{/if}
									</button>
									<div class="flex flex-col gap-1 min-w-0">
										<div class="flex items-center gap-2">
											<button type="button" class="gh-link truncate text-left font-semibold" on:click={() => startEditNode(node)}>{node.name}</button>
											<span class="px-1.5 py-0.5 rounded border border-border-default bg-canvas-subtle text-[10px] font-black uppercase tracking-tight text-fg-muted">{node.type}</span>
										</div>
										<code class="text-[11px] text-fg-muted truncate font-mono bg-canvas-subtle px-1 rounded">{node.raw}</code>
										{#if node.tags.length > 0}
											<div class="flex flex-wrap gap-1 mt-1">
												{#each node.tags as tag}
													<span class="badge"><Octicon icon={tag} className="mr-1 h-3 w-3" />{tag.label}</span>
												{/each}
											</div>
										{/if}
								</div>
							</div>
								<div class="flex items-center gap-1 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => startEditNode(node)} aria-label={$t("Edit node")}><Octicon icon={pencil} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => copy(node.raw)} aria-label={$t("Copy URI")}><Octicon icon={copyIcon} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => remove(node.id, "node", node.name)} aria-label={$t("Delete node")}><Octicon icon={trash} className="h-3.5 w-3.5" /></button>
								</div>
							</div>

							<!-- Inline Editor for Node -->
							{#if expandedId === node.id && nodeDrafts[node.id]}
								<div class="mt-4 p-4 border border-border-default rounded-md bg-canvas-subtle flex flex-col gap-4" transition:slide>
									<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
										<div class="flex flex-col gap-1.5">
											<label class="gh-form-label text-xs uppercase tracking-wide" for={`node-name-${node.id}`}>{$t("Name")}</label>
											<input id={`node-name-${node.id}`} class="gh-input" bind:value={nodeDrafts[node.id].name} />
										</div>
										<div class="flex flex-col gap-1.5">
											<label class="gh-form-label text-xs uppercase tracking-wide" for={`node-type-${node.id}`}>{$t("Protocol")}</label>
											<select id={`node-type-${node.id}`} class="gh-select" bind:value={nodeDrafts[node.id].type}>
												<option value="vless">VLESS</option><option value="vmess">VMess</option><option value="trojan">Trojan</option>
												<option value="ss">SS</option><option value="ssr">SSR</option><option value="hysteria2">Hysteria2</option>
											</select>
										</div>
										<div class="md:col-span-2 flex flex-col gap-1.5">
											<label class="gh-form-label text-xs uppercase tracking-wide" for={`node-raw-${node.id}`}>{$t("Raw URI")}</label>
											<textarea id={`node-raw-${node.id}`} class="gh-input gh-textarea font-mono text-xs" bind:value={nodeDrafts[node.id].raw}></textarea>
										</div>
										<div class="md:col-span-2 flex flex-col gap-1.5">
											<label class="gh-form-label text-xs uppercase tracking-wide" for={`node-tags-${node.id}`}>{$t("Tags")}</label>
											<input id={`node-tags-${node.id}`} class="gh-input" bind:value={nodeDrafts[node.id].tags} />
										</div>
									</div>
									<div class="flex justify-end gap-2">
										<button type="button" class="gh-btn gh-btn-sm" on:click={() => (expandedId = null)}>{$t("Cancel")}</button>
										<button type="button" class="gh-btn gh-btn-sm gh-btn-primary" on:click={() => saveEditNode(node.id)}><Octicon icon={save} className="mr-1 h-3 w-3" />{$t("Save")}</button>
									</div>
								</div>
							{/if}
					</div>
				{/each}
			{/if}
		{:else}
				{#if filteredSubscriptions.length === 0}
					<div class="blankslate">
						<Octicon icon={link} className="mb-3 h-10 w-10 text-fg-subtle" />
						<h3 class="text-lg font-bold">{$t("No subscriptions found")}</h3>
						<p class="text-fg-muted text-sm mb-4">{$t("Subscribe to a link to auto-fetch nodes.")}</p>
						<button type="button" class="gh-btn" on:click={() => (isAddModalOpen = true)}>{$t("Add subscription")}</button>
					</div>
				{:else}
					{#each filteredSubscriptions as sub (sub.id)}
						<div class={cn("gh-box-row group flex flex-col gap-0", !sub.enabled && "opacity-60")}>
							<div class="flex items-start justify-between gap-4">
								<div class="flex items-start gap-3 min-w-0">
									<button type="button" class={cn("mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", sub.enabled ? "bg-[color:var(--success-emphasis)] border-[color:var(--success-emphasis)] text-white" : "border-border-default bg-canvas-default")} on:click={() => toggleEnabled(sub.id, "sub")} aria-label={$t(sub.enabled ? "Disable subscription" : "Enable subscription")}>
										{#if sub.enabled}<Octicon icon={check} className="h-3.5 w-3.5" />{/if}
									</button>
									<div class="flex flex-col gap-1 min-w-0">
										<button type="button" class="gh-link truncate text-left font-semibold" on:click={() => startEditSub(sub)}>{sub.name}</button>
										<div class="flex items-center gap-2 text-[11px] text-fg-muted">
											<Octicon icon={linkExternal} className="h-3 w-3" />
											<span class="truncate">{sub.url}</span>
										</div>
										{#if sub.tags.length > 0}
											<div class="flex flex-wrap gap-1 mt-1">
												{#each sub.tags as tag}
													<span class="badge"><Octicon icon={tag} className="mr-1 h-3 w-3" />{tag.label}</span>
												{/each}
											</div>
										{/if}
								</div>
							</div>
								<div class="flex items-center gap-1 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => openSubscriptionPreview(sub)} aria-label={$t("Preview nodes")}><Octicon icon={eye} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => startEditSub(sub)} aria-label={$t("Edit subscription")}><Octicon icon={pencil} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => copy(sub.url)} aria-label={$t("Copy URL")}><Octicon icon={copyIcon} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => remove(sub.id, "sub", sub.name)} aria-label={$t("Delete subscription")}><Octicon icon={trash} className="h-3.5 w-3.5" /></button>
								</div>
							</div>

						<!-- Inline Editor for Subscription -->
						{#if expandedId === sub.id && subDrafts[sub.id]}
								<div class="mt-4 p-4 border border-border-default rounded-md bg-canvas-subtle flex flex-col gap-4" transition:slide>
									<div class="flex flex-col gap-3">
										<div class="flex flex-col gap-1.5">
											<label class="gh-form-label text-xs uppercase tracking-wide" for={`sub-name-${sub.id}`}>{$t("Name")}</label>
											<input id={`sub-name-${sub.id}`} class="gh-input" bind:value={subDrafts[sub.id].name} />
										</div>
										<div class="flex flex-col gap-1.5">
											<label class="gh-form-label text-xs uppercase tracking-wide" for={`sub-url-${sub.id}`}>{$t("URL")}</label>
											<input id={`sub-url-${sub.id}`} class="gh-input font-mono" bind:value={subDrafts[sub.id].url} />
										</div>
										<div class="flex flex-col gap-1.5">
											<label class="gh-form-label text-xs uppercase tracking-wide" for={`sub-tags-${sub.id}`}>{$t("Tags")}</label>
											<input id={`sub-tags-${sub.id}`} class="gh-input" bind:value={subDrafts[sub.id].tags} />
										</div>
									</div>
									<div class="flex justify-end gap-2">
										<button type="button" class="gh-btn gh-btn-sm" on:click={() => (expandedId = null)}>{$t("Cancel")}</button>
										<button type="button" class="gh-btn gh-btn-sm gh-btn-primary" on:click={() => saveEditSub(sub.id)}><Octicon icon={save} className="mr-1 h-3 w-3" />{$t("Save")}</button>
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
			<button type="button" class="fixed inset-0 bg-black/50 backdrop-blur-sm" on:click={closeSubscriptionPreview} aria-label={$t("Close subscription preview")}></button>
			<div class="relative w-full max-w-2xl gh-box shadow-2xl flex flex-col max-h-[80vh]" in:fly={{ y: 20 }}>
				<div class="gh-box-header">
					<div class="flex items-center gap-2">
						<Octicon icon={eye} className="h-4 w-4" />
						<span>{$t("Subscription Preview")}</span>
						{#if sub}<span class="text-xs text-fg-muted font-normal">({sub.name})</span>{/if}
					</div>
					<button type="button" class="gh-icon-button h-7 w-7" on:click={closeSubscriptionPreview} aria-label={$t("Close subscription preview")}><Octicon icon={x} className="h-4 w-4" /></button>
				</div>
			
			<div class="p-4 bg-canvas-default overflow-y-auto flex-1">
					{#if cache?.status === 'loading'}
						<div class="flex flex-col items-center justify-center py-12 gap-3 text-fg-muted">
							<Octicon icon={sync} className="h-8 w-8 animate-spin" />
							<p>{$t("Fetching subscription content...")}</p>
						</div>
					{:else if cache?.status === 'error'}
						<div class="p-4 rounded-md bg-red-50 border border-red-200 text-red-800 flex items-start gap-3">
							<Octicon icon={alert} className="mt-0.5 h-5 w-5 shrink-0" />
							<div>
								<p class="font-bold">{$t("Failed to load subscription")}</p>
								<p class="text-sm opacity-80">{cache.error}</p>
						</div>
					</div>
				{:else if cache?.status === 'ready'}
					<div class="flex flex-col gap-2">
							<div class="flex items-center justify-between mb-2">
								<span class="text-xs font-bold text-fg-muted uppercase">{$t("Nodes Found")} ({cache.nodes.length})</span>
								<button type="button" class="text-xs text-accent-fg hover:underline" on:click={() => sub && loadSubscriptionPreview(sub, true)}>{$t("Refresh")}</button>
							</div>
							{#each cache.nodes as node}
								<div class="p-2 border border-border-default rounded hover:bg-canvas-subtle transition-colors group/item">
									<div class="flex items-center justify-between gap-4">
										<div class="flex items-center gap-2 min-w-0">
											<span class="text-xs font-bold truncate">{node.name}</span>
											<span class="px-1 py-0.5 rounded bg-canvas-default border border-border-default text-[9px] font-black uppercase text-fg-muted">{node.type}</span>
										</div>
										<button type="button" class="gh-btn gh-btn-sm opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100" on:click={() => copy(node.raw)} aria-label={$t("Copy node URI")}><Octicon icon={copyIcon} className="h-3 w-3" /></button>
									</div>
									<code class="block mt-1 text-[10px] font-mono text-fg-muted truncate">{node.raw}</code>
								</div>
						{/each}
					</div>
				{/if}
				</div>
				
				<div class="p-3 bg-canvas-subtle border-t border-border-default flex justify-end">
					<button type="button" class="gh-btn" on:click={closeSubscriptionPreview}>{$t("Close")}</button>
				</div>
			</div>
		</div>
{/if}
