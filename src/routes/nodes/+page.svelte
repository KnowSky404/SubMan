<script lang="ts">
import { tick } from "svelte";
import { fly, slide } from "svelte/transition";
import GitHubSelect from "$lib/components/GitHubSelect.svelte";
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import type {
	NodeItem,
	NodeTag,
	ProxyType,
	SubscriptionItem,
} from "$lib/models";
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
	tag as tagIcon,
	trash,
	x,
} from "$lib/octicons";
import {
	findDuplicateNodeRaw,
	findDuplicateSubscriptionUrl,
	formatResourceNameTimestamp,
	makeUniqueResourceName,
} from "$lib/resource-dedupe";
import {
	appState,
	removeNode,
	removeSubscription,
	upsertNode,
	upsertSubscription,
} from "$lib/stores/app";
import { requestConfirm } from "$lib/stores/confirm";
import { showToast } from "$lib/stores/toast";
import {
	decodeBase64Utf8,
	extractSubscriptionNodeLines,
	inferNodeNameFromRaw,
	inferNodeTypeFromDraft,
	inferNodeTypeFromRaw,
	loadSubscriptionContent,
} from "$lib/subscription";
import { cn } from "$lib/utils/cn";
import { createId } from "$lib/utils/id";
import { nowIso } from "$lib/utils/time";

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
let deletingResourceId: string | null = null;

// Preview State
let previewSubscriptionId: string | null = null;
let subscriptionPreviewCache: Record<
	string,
	{
		status: "loading" | "ready" | "error";
		nodes: Pick<NodeItem, "id" | "name" | "type" | "raw">[];
		error: string | null;
	}
> = {};

// Edit State
let editingResource:
	| { type: "node"; id: string }
	| { type: "subscription"; id: string }
	| null = null;
let nodeDrafts: Record<
	string,
	{ name: string; type: ProxyType; raw: string; tags: string }
> = {};
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
	filterStatus: "resource-filter-status",
};
const nodeTypeOptions = [
	{ value: "vless", label: "VLESS" },
	{ value: "vmess", label: "VMess" },
	{ value: "trojan", label: "Trojan" },
	{ value: "ss", label: "SS" },
	{ value: "ssr", label: "SSR" },
	{ value: "hysteria2", label: "Hysteria2" },
	{ value: "tuic", label: "TUIC" },
	{ value: "anytls", label: "AnyTLS" },
];
$: filterStatusOptions = [
	{ value: "all", label: $t("All") },
	{ value: "enabled", label: $t("Enabled") },
	{ value: "disabled", label: $t("Disabled") },
];

function showToastNotify(
	message: string,
	type: "success" | "info" | "error" = "success",
) {
	showToast(message, type);
}

function parseTags(value: string): NodeTag[] {
	return value
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean)
		.map((label) => ({ id: createId("tag"), label }));
}

function stringifyTags(tags: NodeTag[]): string {
	return tags.map((t) => t.label).join(", ");
}

$: filteredNodes = $appState.nodes
	.filter((n) =>
		filterStatus === "all"
			? true
			: filterStatus === "enabled"
				? n.enabled
				: !n.enabled,
	)
	.filter((n) => {
		const q = searchQuery.toLowerCase();
		return (
			!q ||
			n.name.toLowerCase().includes(q) ||
			n.type.toLowerCase().includes(q) ||
			n.tags.some((t) => t.label.toLowerCase().includes(q))
		);
	})
	.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

$: filteredSubscriptions = $appState.subscriptions
	.filter((s) =>
		filterStatus === "all"
			? true
			: filterStatus === "enabled"
				? s.enabled
				: !s.enabled,
	)
	.filter((s) => {
		const q = searchQuery.toLowerCase();
		return (
			!q ||
			s.name.toLowerCase().includes(q) ||
			s.url.toLowerCase().includes(q) ||
			s.tags.some((t) => t.label.toLowerCase().includes(q))
		);
	})
	.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

$: enabledNodeCount = $appState.nodes.filter((node) => node.enabled).length;
$: enabledSubscriptionCount = $appState.subscriptions.filter(
	(subscription) => subscription.enabled,
).length;
const formatUpdatedAt = (value: string) =>
	new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));

function updateSingleNodeRaw(value: string) {
	nodeRaw = value;
	nodeType = inferNodeTypeFromDraft(value, nodeType);
}

function updateNodeDraftRaw(id: string, value: string) {
	const draft = nodeDrafts[id];
	if (!draft) return;
	draft.raw = value;
	draft.type = inferNodeTypeFromDraft(value, draft.type);
}

function uniqueNodeName(name: string, excludeId?: string) {
	return makeUniqueResourceName(
		name,
		$appState.nodes
			.filter((node) => node.id !== excludeId)
			.map((node) => node.name),
		formatResourceNameTimestamp(),
	);
}

function uniqueSubscriptionName(name: string, excludeId?: string) {
	return makeUniqueResourceName(
		name,
		$appState.subscriptions
			.filter((subscription) => subscription.id !== excludeId)
			.map((subscription) => subscription.name),
		formatResourceNameTimestamp(),
	);
}

function handleAdd() {
	if (addMode === "single") {
		if (activeTab === "nodes") {
			const raw = nodeRaw.trim();
			if (!raw) return;
			const duplicate = findDuplicateNodeRaw($appState.nodes, raw);
			if (duplicate) {
				showToastNotify(
					$t("A node with the same raw URI already exists: {name}", {
						name: duplicate.name,
					}),
					"error",
				);
				return;
			}
			const name = uniqueNodeName(
				nodeName.trim() || inferNodeNameFromRaw(raw, "Imported Node"),
			);
			upsertNode({
				id: createId("node"),
				name,
				type: inferNodeTypeFromDraft(raw, nodeType),
				raw,
				tags: parseTags(nodeTags),
				enabled: true,
				updatedAt: nowIso(),
				source: "single",
			});
			nodeName = "";
			nodeRaw = "";
			nodeTags = "";
		} else {
			const url = subUrl.trim();
			if (!subName.trim() || !url) return;
			const duplicate = findDuplicateSubscriptionUrl(
				$appState.subscriptions,
				url,
			);
			if (duplicate) {
				showToastNotify(
					$t("A subscription with the same URL already exists: {name}", {
						name: duplicate.name,
					}),
					"error",
				);
				return;
			}
			const name = uniqueSubscriptionName(subName.trim());
			upsertSubscription({
				id: createId("sub"),
				name,
				url,
				enabled: true,
				tags: parseTags(subTags),
				updatedAt: nowIso(),
			});
			subName = "";
			subUrl = "";
			subTags = "";
		}
		showToastNotify($t("Resource added"));
	} else {
		// Batch Import Logic
		const lines = batchContent
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		let count = 0;

		if (activeTab === "nodes") {
			const seenRaw = new Set($appState.nodes.map((node) => node.raw.trim()));
			let importedNames = $appState.nodes.map((node) => node.name);
			for (const line of lines) {
				const nodes = extractSubscriptionNodeLines(line);
				for (const raw of nodes) {
					const normalizedRaw = raw.trim();
					if (seenRaw.has(normalizedRaw)) {
						continue;
					}
					const name = makeUniqueResourceName(
						inferNodeNameFromRaw(normalizedRaw, `Imported Node ${count + 1}`),
						importedNames,
						formatResourceNameTimestamp(),
					);
					upsertNode({
						id: createId("node"),
						name,
						type: inferNodeTypeFromRaw(normalizedRaw),
						raw: normalizedRaw,
						tags: parseTags(batchTags),
						enabled: true,
						updatedAt: nowIso(),
						source: "single",
					});
					seenRaw.add(normalizedRaw);
					importedNames = [name, ...importedNames];
					count++;
				}
			}
		} else {
			const seenUrl = new Set(
				$appState.subscriptions.map((subscription) => subscription.url.trim()),
			);
			let importedNames = $appState.subscriptions.map(
				(subscription) => subscription.name,
			);
			for (const line of lines) {
				// Support "Name = URL" or just "URL"
				const parts = line.split("=").map((p) => p.trim());
				let name = "";
				let url = "";
				if (parts.length >= 2) {
					name = parts[0];
					url = parts[1];
				} else {
					url = parts[0];
					try {
						name = new URL(url).hostname;
					} catch {
						name = `Sub ${count + 1}`;
					}
				}

				if (url.includes("://")) {
					if (seenUrl.has(url)) {
						continue;
					}
					name = makeUniqueResourceName(
						name,
						importedNames,
						formatResourceNameTimestamp(),
					);
					upsertSubscription({
						id: createId("sub"),
						name,
						url,
						enabled: true,
						tags: parseTags(batchTags),
						updatedAt: nowIso(),
					});
					seenUrl.add(url);
					importedNames = [name, ...importedNames];
					count++;
				}
			}
		}
		batchContent = "";
		batchTags = "";
		showToastNotify($t("Imported {count} items", { count }));
	}
	isAddModalOpen = false;
}

// Edit Logic
function startEditNode(node: NodeItem) {
	nodeDrafts[node.id] = {
		name: node.name,
		type: node.type,
		raw: node.raw,
		tags: stringifyTags(node.tags),
	};
	editingResource = { type: "node", id: node.id };
}

function saveEditNode(id: string) {
	const draft = nodeDrafts[id];
	const original = $appState.nodes.find((n) => n.id === id);
	if (!draft || !original) return;
	const raw = draft.raw.trim();
	const duplicate = findDuplicateNodeRaw($appState.nodes, raw, id);
	if (duplicate) {
		showToastNotify(
			$t("A node with the same raw URI already exists: {name}", {
				name: duplicate.name,
			}),
			"error",
		);
		return;
	}
	upsertNode({
		...original,
		name: uniqueNodeName(draft.name.trim(), id),
		type: inferNodeTypeFromDraft(raw, draft.type),
		raw,
		tags: parseTags(draft.tags),
		updatedAt: nowIso(),
	});
	closeEditModal();
	showToastNotify($t("Node updated"));
}

function startEditSub(sub: SubscriptionItem) {
	subDrafts[sub.id] = {
		name: sub.name,
		url: sub.url,
		tags: stringifyTags(sub.tags),
	};
	editingResource = { type: "subscription", id: sub.id };
}

function saveEditSub(id: string) {
	const draft = subDrafts[id];
	const original = $appState.subscriptions.find((s) => s.id === id);
	if (!draft || !original) return;
	const url = draft.url.trim();
	const duplicate = findDuplicateSubscriptionUrl(
		$appState.subscriptions,
		url,
		id,
	);
	if (duplicate) {
		showToastNotify(
			$t("A subscription with the same URL already exists: {name}", {
				name: duplicate.name,
			}),
			"error",
		);
		return;
	}

	upsertSubscription({
		...original,
		name: uniqueSubscriptionName(draft.name.trim(), id),
		url,
		tags: parseTags(draft.tags),
		updatedAt: nowIso(),
	});
	closeEditModal();
	showToastNotify($t("Subscription updated"));
}

function closeEditModal() {
	editingResource = null;
}

async function loadSubscriptionPreview(
	subscription: SubscriptionItem,
	force = false,
) {
	if (!force && subscriptionPreviewCache[subscription.id]?.status === "ready")
		return;

	subscriptionPreviewCache[subscription.id] = {
		status: "loading",
		nodes: [],
		error: null,
	};
	try {
		const { content, warning } = await loadSubscriptionContent(
			subscription.url,
		);
		if (warning) throw new Error(warning);

		const lines = extractSubscriptionNodeLines(content);
		const nodes = lines.map((raw, idx) => ({
			id: `preview-${idx}`,
			name: inferNodeNameFromRaw(raw, `Node ${idx + 1}`),
			type: inferNodeTypeFromRaw(raw),
			raw,
		}));

		subscriptionPreviewCache[subscription.id] = {
			status: "ready",
			nodes,
			error: null,
		};
	} catch (err) {
		subscriptionPreviewCache[subscription.id] = {
			status: "error",
			nodes: [],
			error: err instanceof Error ? err.message : String(err),
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
	if (deletingResourceId) return;

	const confirmed = await requestConfirm({
		title: $t("Confirm Deletion"),
		message: $t("Delete {name} forever?", { name }),
		confirmText: $t("Delete"),
		danger: true,
	});
	if (!confirmed) return;

	deletingResourceId = id;
	await tick();

	try {
		if (editingResource?.id === id) closeEditModal();
		if (type === "node") {
			removeNode(id);
			delete nodeDrafts[id];
		} else {
			removeSubscription(id);
			delete subDrafts[id];
		}
		showToastNotify($t("Deleted {name}", { name }));
	} finally {
		deletingResourceId = null;
	}
}

function toggleEnabled(id: string, type: "node" | "sub") {
	if (type === "node") {
		const node = $appState.nodes.find((n) => n.id === id);
		if (node)
			upsertNode({ ...node, enabled: !node.enabled, updatedAt: nowIso() });
	} else {
		const sub = $appState.subscriptions.find((s) => s.id === id);
		if (sub)
			upsertSubscription({
				...sub,
				enabled: !sub.enabled,
				updatedAt: nowIso(),
			});
	}
}

async function copy(text: string) {
	await navigator.clipboard.writeText(text);
	showToastNotify($t("Copied to clipboard"));
}
</script>

<div class="gh-page">
	<header class="gh-page-header">
		<div class="gh-page-heading">
			<h1 class="gh-page-title">{$t("Nodes")}</h1>
			<p class="gh-page-subtitle">
				{$t("Manage single proxy URIs and upstream subscriptions used by aggregate rules.")}
			</p>
			<div class="gh-page-meta">
				<span class="gh-page-meta-item">{$t("{count} nodes", { count: $appState.nodes.length })}</span>
				<span class="gh-page-meta-item">{$t("{count} subscriptions", { count: $appState.subscriptions.length })}</span>
				<span class="gh-page-meta-item">{$t("{count} enabled", { count: enabledNodeCount + enabledSubscriptionCount })}</span>
			</div>
		</div>
		<div class="gh-page-actions">
			<button type="button" class="gh-btn gh-btn-primary" on:click={() => (isAddModalOpen = !isAddModalOpen)}>
				<Octicon icon={plus} className="h-4 w-4" />
				{$t("New Resource")}
			</button>
		</div>
	</header>

	<!-- Add Modal / Embedded Form -->
	{#if isAddModalOpen}
		<div class="gh-box !overflow-visible" transition:slide>
			<div class="gh-box-header">
				<div class="flex items-center gap-4">
					<button type="button" class={cn("gh-tab", addMode === "single" && "gh-tab-active")} on:click={() => (addMode = "single")}>{$t("Single Entry")}</button>
					<button type="button" class={cn("gh-tab", addMode === "batch" && "gh-tab-active")} on:click={() => (addMode = "batch")}>{$t("Batch Import")}</button>
				</div>
				<button type="button" class="gh-icon-button h-7 w-7" on:click={() => (isAddModalOpen = false)} aria-label={$t("Close add resource panel")}><Octicon icon={x} className="h-4 w-4" /></button>
			</div>
			<div class="gh-section-body">
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
								<GitHubSelect id={addFormIds.nodeType} bind:value={nodeType} options={nodeTypeOptions} />
							</div>
						{/if}
						<div class="md:col-span-2 flex flex-col gap-1.5">
							<label class="gh-form-label" for={activeTab === "nodes" ? addFormIds.nodeRaw : addFormIds.subUrl}>{activeTab === "nodes" ? $t("Raw URI") : $t("URL")}</label>
							{#if activeTab === "nodes"}
								<textarea id={addFormIds.nodeRaw} class="gh-input gh-textarea font-mono" placeholder="vless://..." value={nodeRaw} on:input={(event) => updateSingleNodeRaw(event.currentTarget.value)}></textarea>
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
							<textarea id={addFormIds.batchContent} class="gh-input gh-textarea h-36 font-mono" placeholder={$t("One per line...")} bind:value={batchContent}></textarea>
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={addFormIds.batchTags}>{$t("Common tags")}</label>
							<input id={addFormIds.batchTags} class="gh-input" placeholder={$t("Common tags for this batch...")} bind:value={batchTags} />
						</div>
					</div>
				{/if}
			</div>
			<div class="gh-section-footer">
				<button type="button" class="gh-btn" on:click={() => (isAddModalOpen = false)}>{$t("Cancel")}</button>
				<button type="button" class="gh-btn gh-btn-primary px-6" on:click={handleAdd}>{$t("Save Resource")}</button>
			</div>
		</div>
	{/if}

	<!-- Filter Bar -->
	<div class="gh-filter-bar">
		<div class="gh-filter-controls">
			<div class="nodes-filter-tabs gh-tabs w-full sm:w-auto">
				<button type="button" class={cn("gh-tab", activeTab === "nodes" && "gh-tab-active")} on:click={() => { activeTab = "nodes"; closeEditModal(); }}>
					<Octicon icon={server} className="h-4 w-4" />
					{$t("Nodes")}
					<span class="gh-counter">{$appState.nodes.length}</span>
				</button>
				<button type="button" class={cn("gh-tab", activeTab === "subscriptions" && "gh-tab-active")} on:click={() => { activeTab = "subscriptions"; closeEditModal(); }}>
					<Octicon icon={link} className="h-4 w-4" />
					{$t("Subscriptions")}
					<span class="gh-counter">{$appState.subscriptions.length}</span>
				</button>
			</div>

			<div class="nodes-filter-search relative min-w-0 flex-1">
				<Octicon icon={search} className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
				<label class="sr-only" for={addFormIds.filterQuery}>{$t("Filter resources")}</label>
				<input id={addFormIds.filterQuery} class="gh-input h-8 pl-9" placeholder={$t("Filter resources...")} bind:value={searchQuery} />
			</div>
			<div class="nodes-filter-status flex min-w-36 flex-col gap-1 sm:w-36">
				<label class="sr-only" for={addFormIds.filterStatus}>{$t("Filter status")}</label>
				<GitHubSelect id={addFormIds.filterStatus} bind:value={filterStatus} options={filterStatusOptions} />
			</div>
		</div>
		<button type="button" class="nodes-filter-action gh-btn shrink-0" on:click={() => (isAddModalOpen = !isAddModalOpen)}>
			<Octicon icon={plus} className="h-4 w-4" />
			{$t("New Resource")}
		</button>
	</div>

	<!-- Content Box -->
	<div class="gh-box shadow-sm">
		<div class="gh-box-header text-sm">
			<span>{activeTab === "nodes" ? $t("Nodes") : $t("Subscriptions")}</span>
			<div class="flex items-center gap-2">
				{#if activeTab === "nodes"}
					<span class="badge">{filteredNodes.length} {$t("results")}</span>
					<span class="badge">{enabledNodeCount} {$t("enabled")}</span>
				{:else}
					<span class="badge">{filteredSubscriptions.length} {$t("results")}</span>
					<span class="badge">{enabledSubscriptionCount} {$t("enabled")}</span>
				{/if}
			</div>
		</div>
		<div class="gh-list-header hidden sm:grid sm:grid-cols-[minmax(0,1.7fr)_140px_auto]">
			<span>{$t("Title")}</span>
			<span>{$t("Meta")}</span>
			<span class="text-right">{$t("Actions")}</span>
		</div>

		{#if activeTab === "nodes"}
			{#if filteredNodes.length === 0}
				<div class="blankslate">
					<Octicon icon={server} className="mb-3 h-10 w-10 text-fg-subtle" />
					<h3 class="text-lg font-bold">{$t("No nodes yet")}</h3>
					<p class="mb-4 text-sm text-fg-muted">{$t("Add one URI or import a batch.")}</p>
					<button type="button" class="gh-btn" on:click={() => (isAddModalOpen = true)}>{$t("Add node")}</button>
				</div>
			{:else}
				{#each filteredNodes as node (node.id)}
					<div class={cn("gh-box-row group flex flex-col gap-0", !node.enabled && "opacity-70")} out:slide={{ duration: 180 }}>
							<div class="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1.7fr)_140px_auto] sm:items-start sm:gap-4">
								<div class="gh-row-main">
									<input
										type="checkbox"
										class="mt-0.5"
										checked={node.enabled}
										on:change={() => toggleEnabled(node.id, "node")}
										aria-label={$t(node.enabled ? "Disable node" : "Enable node")}
										disabled={deletingResourceId === node.id}
									/>
									<div class="flex min-w-0 flex-col gap-1">
										<div class="flex min-w-0 flex-wrap items-center gap-2">
											<button type="button" class="gh-row-title" on:click={() => startEditNode(node)} disabled={deletingResourceId === node.id}>{node.name}</button>
											<span class="gh-label">{node.type}</span>
											<span class={cn("gh-label gh-label-muted", node.enabled && "badge-success")}>
												{node.enabled ? $t("Enabled") : $t("Disabled")}
											</span>
										</div>
										<div class="gh-list-meta">
											<span>{$t("Updated {time}", { time: formatUpdatedAt(node.updatedAt) })}</span>
											<span>{$t("Source: {source}", { source: node.source })}</span>
											<span>{$t("{count} tags", { count: node.tags.length })}</span>
										</div>
										<code class="gh-list-meta-code">{node.raw}</code>
										{#if node.tags.length > 0}
											<div class="flex flex-wrap gap-1">
												{#each node.tags as nodeTag}
													<span class="gh-label gh-label-muted"><Octicon icon={tagIcon} className="h-3 w-3" />{nodeTag.label}</span>
												{/each}
											</div>
										{/if}
									</div>
								</div>

								<div class="gh-list-meta sm:block">
									<span>{$t("Type: {type}", { type: node.type.toUpperCase() })}</span>
									<span>{$t(node.enabled ? "Enabled" : "Disabled")}</span>
								</div>

								<div class="gh-row-actions gh-btn-group">
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => startEditNode(node)} aria-label={$t("Edit node")} title={$t("Edit node")} disabled={deletingResourceId === node.id}><Octicon icon={pencil} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => copy(node.raw)} aria-label={$t("Copy URI")} title={$t("Copy URI")} disabled={deletingResourceId === node.id}><Octicon icon={copyIcon} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => remove(node.id, "node", node.name)} aria-label={$t("Delete node")} title={$t("Delete node")} disabled={deletingResourceId === node.id}>
										{#if deletingResourceId === node.id}
											<Octicon icon={sync} className="h-3.5 w-3.5 animate-spin" />
											<span class="sr-only">{$t("Deleting...")}</span>
										{:else}
											<Octicon icon={trash} className="h-3.5 w-3.5" />
										{/if}
									</button>
								</div>
							</div>
					</div>
				{/each}
			{/if}
		{:else}
			{#if filteredSubscriptions.length === 0}
				<div class="blankslate">
					<Octicon icon={link} className="mb-3 h-10 w-10 text-fg-subtle" />
					<h3 class="text-lg font-bold">{$t("No subscriptions yet")}</h3>
					<p class="mb-4 text-sm text-fg-muted">{$t("Add a feed URL to fetch nodes.")}</p>
					<button type="button" class="gh-btn" on:click={() => (isAddModalOpen = true)}>{$t("Add subscription")}</button>
				</div>
			{:else}
				{#each filteredSubscriptions as sub (sub.id)}
					<div class={cn("gh-box-row group flex flex-col gap-0", !sub.enabled && "opacity-70")} out:slide={{ duration: 180 }}>
							<div class="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1.7fr)_140px_auto] sm:items-start sm:gap-4">
								<div class="gh-row-main">
									<input
										type="checkbox"
										class="mt-0.5"
										checked={sub.enabled}
										on:change={() => toggleEnabled(sub.id, "sub")}
										aria-label={$t(sub.enabled ? "Disable subscription" : "Enable subscription")}
										disabled={deletingResourceId === sub.id}
									/>
									<div class="flex min-w-0 flex-col gap-1">
										<div class="flex min-w-0 flex-wrap items-center gap-2">
											<button type="button" class="gh-row-title" on:click={() => startEditSub(sub)} disabled={deletingResourceId === sub.id}>{sub.name}</button>
											<span class={cn("gh-label gh-label-muted", sub.enabled && "badge-success")}>
												{sub.enabled ? $t("Enabled") : $t("Disabled")}
											</span>
										</div>
										<div class="gh-list-meta">
											<span>{$t("Updated {time}", { time: formatUpdatedAt(sub.updatedAt) })}</span>
											<span>{$t("{count} tags", { count: sub.tags.length })}</span>
										</div>
										<div class="flex items-center gap-1.5 text-[10px] text-fg-muted">
											<Octicon icon={linkExternal} className="h-3 w-3" />
											<span class="gh-list-meta-code">{sub.url}</span>
										</div>
										{#if sub.tags.length > 0}
											<div class="flex flex-wrap gap-1">
												{#each sub.tags as subTag}
													<span class="gh-label gh-label-muted"><Octicon icon={tagIcon} className="h-3 w-3" />{subTag.label}</span>
												{/each}
											</div>
										{/if}
									</div>
								</div>

								<div class="gh-list-meta sm:block">
									<span class={cn("gh-label gh-label-muted", sub.enabled && "badge-success")}>
										{sub.enabled ? $t("Enabled") : $t("Disabled")}
									</span>
								</div>

								<div class="gh-row-actions gh-btn-group">
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => openSubscriptionPreview(sub)} aria-label={$t("Preview nodes")} title={$t("Preview nodes")} disabled={deletingResourceId === sub.id}><Octicon icon={eye} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => startEditSub(sub)} aria-label={$t("Edit subscription")} title={$t("Edit subscription")} disabled={deletingResourceId === sub.id}><Octicon icon={pencil} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => copy(sub.url)} aria-label={$t("Copy URL")} title={$t("Copy URL")} disabled={deletingResourceId === sub.id}><Octicon icon={copyIcon} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => remove(sub.id, "sub", sub.name)} aria-label={$t("Delete subscription")} title={$t("Delete subscription")} disabled={deletingResourceId === sub.id}>
										{#if deletingResourceId === sub.id}
											<Octicon icon={sync} className="h-3.5 w-3.5 animate-spin" />
											<span class="sr-only">{$t("Deleting...")}</span>
										{:else}
											<Octicon icon={trash} className="h-3.5 w-3.5" />
										{/if}
									</button>
								</div>
							</div>
					</div>
				{/each}
			{/if}
		{/if}
	</div>
</div>

<!-- Edit Resource Modal -->
{#if editingResource}
	{@const edit = editingResource}
	<div class="fixed inset-0 z-[150] flex items-center justify-center p-4">
		<button type="button" class="fixed inset-0 bg-black/50 backdrop-blur-sm" on:click={closeEditModal} aria-label={$t("Close edit modal")}></button>
		<div class="gh-box relative flex max-h-[85vh] w-full max-w-2xl flex-col shadow-[var(--shadow-medium)]" in:fly={{ y: 20 }}>
			<div class="gh-box-header">
				<div class="flex min-w-0 items-center gap-2">
					<Octicon icon={pencil} className="h-4 w-4" />
					<span>{edit.type === "node" ? $t("Edit Node") : $t("Edit Subscription")}</span>
				</div>
				<button type="button" class="gh-icon-button h-7 w-7" on:click={closeEditModal} aria-label={$t("Close edit modal")}><Octicon icon={x} className="h-4 w-4" /></button>
			</div>

			<div class="gh-section-body flex-1 overflow-y-auto">
				{#if edit.type === "node" && nodeDrafts[edit.id]}
					<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={`node-name-${edit.id}`}>{$t("Name")}</label>
							<input id={`node-name-${edit.id}`} class="gh-input" bind:value={nodeDrafts[edit.id].name} />
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={`node-type-${edit.id}`}>{$t("Protocol")}</label>
							<GitHubSelect id={`node-type-${edit.id}`} bind:value={nodeDrafts[edit.id].type} options={nodeTypeOptions} />
						</div>
						<div class="flex flex-col gap-1.5 md:col-span-2">
							<label class="gh-form-label" for={`node-raw-${edit.id}`}>{$t("Raw URI")}</label>
							<textarea id={`node-raw-${edit.id}`} class="gh-input gh-textarea font-mono text-xs" value={nodeDrafts[edit.id].raw} on:input={(event) => updateNodeDraftRaw(edit.id, event.currentTarget.value)}></textarea>
						</div>
						<div class="flex flex-col gap-1.5 md:col-span-2">
							<label class="gh-form-label" for={`node-tags-${edit.id}`}>{$t("Tags")}</label>
							<input id={`node-tags-${edit.id}`} class="gh-input" bind:value={nodeDrafts[edit.id].tags} />
						</div>
					</div>
				{:else if edit.type === "subscription" && subDrafts[edit.id]}
					<div class="flex flex-col gap-3">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={`sub-name-${edit.id}`}>{$t("Name")}</label>
							<input id={`sub-name-${edit.id}`} class="gh-input" bind:value={subDrafts[edit.id].name} />
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={`sub-url-${edit.id}`}>{$t("URL")}</label>
							<input id={`sub-url-${edit.id}`} class="gh-input font-mono" bind:value={subDrafts[edit.id].url} />
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={`sub-tags-${edit.id}`}>{$t("Tags")}</label>
							<input id={`sub-tags-${edit.id}`} class="gh-input" bind:value={subDrafts[edit.id].tags} />
						</div>
					</div>
				{/if}
			</div>

			<div class="gh-section-footer">
				<button type="button" class="gh-btn" on:click={closeEditModal}>{$t("Cancel")}</button>
				{#if edit.type === "node"}
					<button type="button" class="gh-btn gh-btn-primary" on:click={() => saveEditNode(edit.id)}><Octicon icon={save} className="h-3.5 w-3.5" />{$t("Save")}</button>
				{:else}
					<button type="button" class="gh-btn gh-btn-primary" on:click={() => saveEditSub(edit.id)}><Octicon icon={save} className="h-3.5 w-3.5" />{$t("Save")}</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Subscription Preview Modal -->
{#if previewSubscriptionId}
	{@const sub = $appState.subscriptions.find(s => s.id === previewSubscriptionId)}
	{@const cache = subscriptionPreviewCache[previewSubscriptionId]}
	<div class="fixed inset-0 z-[150] flex items-center justify-center p-4">
		<button type="button" class="fixed inset-0 bg-black/50 backdrop-blur-sm" on:click={closeSubscriptionPreview} aria-label={$t("Close subscription preview")}></button>
		<div class="gh-box relative flex max-h-[80vh] w-full max-w-2xl flex-col shadow-[var(--shadow-medium)]" in:fly={{ y: 20 }}>
			<div class="gh-box-header">
				<div class="flex min-w-0 items-center gap-2">
					<Octicon icon={eye} className="h-4 w-4" />
					<span>{$t("Subscription Preview")}</span>
					{#if sub}<span class="truncate text-xs font-normal text-fg-muted">({sub.name})</span>{/if}
				</div>
				<button type="button" class="gh-icon-button h-7 w-7" on:click={closeSubscriptionPreview} aria-label={$t("Close subscription preview")}><Octicon icon={x} className="h-4 w-4" /></button>
			</div>

			<div class="gh-section-body flex-1 overflow-y-auto">
				{#if cache?.status === 'loading'}
					<div class="flex flex-col items-center justify-center gap-3 py-12 text-fg-muted">
						<Octicon icon={sync} className="h-8 w-8 animate-spin" />
						<p>{$t("Fetching subscription content...")}</p>
					</div>
				{:else if cache?.status === 'error'}
					<div class="gh-alert gh-alert-danger">
						<Octicon icon={alert} className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--danger-emphasis)]" />
						<div class="min-w-0">
							<p class="font-semibold">{$t("Failed to load subscription")}</p>
							<p class="text-sm text-fg-muted">{cache.error}</p>
						</div>
					</div>
				{:else if cache?.status === 'ready'}
					<div class="flex flex-col gap-2">
						<div class="mb-2 flex items-center justify-between">
							<span class="gh-form-caption">{$t("Nodes Found")} ({cache.nodes.length})</span>
							<button type="button" class="gh-link text-xs" on:click={() => sub && loadSubscriptionPreview(sub, true)}>{$t("Refresh")}</button>
						</div>
						{#each cache.nodes as node}
							<div class="group/item rounded-md border border-border-default bg-canvas-default p-2 transition-colors hover:bg-canvas-subtle">
								<div class="flex items-center justify-between gap-4">
									<div class="flex min-w-0 items-center gap-2">
										<span class="truncate text-xs font-semibold">{node.name}</span>
										<span class="gh-label shrink-0">{node.type}</span>
									</div>
									<button type="button" class="gh-btn gh-btn-sm opacity-100 transition-opacity sm:opacity-0 sm:group-hover/item:opacity-100" on:click={() => copy(node.raw)} aria-label={$t("Copy node URI")}><Octicon icon={copyIcon} className="h-3 w-3" /></button>
								</div>
								<code class="gh-list-meta-code mt-1 block">{node.raw}</code>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="gh-section-footer">
				<button type="button" class="gh-btn" on:click={closeSubscriptionPreview}>{$t("Close")}</button>
			</div>
		</div>
	</div>
{/if}
