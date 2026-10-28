<script lang="ts">
import { tick } from "svelte";
import { tooltip } from "$lib/actions/tooltip";
import ActionButton from "$lib/components/ActionButton.svelte";
import CopyButton from "$lib/components/CopyButton.svelte";
import Dialog from "$lib/components/Dialog.svelte";
import GitHubSelect from "$lib/components/GitHubSelect.svelte";
import Octicon from "$lib/components/Octicon.svelte";
import OperationFeedback from "$lib/components/OperationFeedback.svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import { locale, t } from "$lib/i18n";
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
import { validateProxyUri } from "$lib/proxy-protocol";
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
import {
	presentSubscriptionFetchDiagnostic,
	type SubscriptionFetchDiagnostic,
	toSubscriptionFetchDiagnostic,
} from "$lib/subscription-diagnostics";
import { reconcileTags } from "$lib/tags";
import { collapseMotion } from "$lib/ui-motion";
import { cn } from "$lib/utils/cn";
import { createId } from "$lib/utils/id";
import { nowIso } from "$lib/utils/time";
import {
	presentWorkspaceOperation,
	type WorkspaceOperationPresentation,
	type WorkspaceOperationPresentationOptions,
} from "$lib/workspace-operation-presenter";
import type { WorkspaceOperationResult } from "$lib/workspace-operation-result";
import { workspaceSyncStatus } from "$lib/workspace-sync-status";

let operationFeedback: WorkspaceOperationPresentation | null = null;

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
let togglingResourceId: string | null = null;

// Preview State
let previewSubscriptionId: string | null = null;
let subscriptionPreviewCache: Record<
	string,
	{
		status: "loading" | "ready" | "error";
		nodes: Pick<NodeItem, "id" | "name" | "type" | "raw">[];
		error: SubscriptionFetchDiagnostic | null;
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

function showWorkspaceResult(
	result: Awaited<ReturnType<typeof upsertNode>["completion"]>,
	options: WorkspaceOperationPresentationOptions = {},
): boolean {
	const presentation = presentWorkspaceOperation(result, options);
	operationFeedback = presentation;
	if (presentation.remoteCommitted || (!editingResource && !isAddModalOpen))
		showToastNotify(
			$t(presentation.messageKey, presentation.messageParams),
			presentation.tone,
		);
	return presentation.finalizeDraft;
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
	new Intl.DateTimeFormat($locale, {
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

$: nodeUriValidation = nodeRaw.trim()
	? validateProxyUri(nodeRaw, nodeType)
	: null;

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

async function handleAdd() {
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
			const handle = upsertNode({
				id: createId("node"),
				name,
				type: inferNodeTypeFromDraft(raw, nodeType),
				raw,
				tags: reconcileTags(nodeTags),
				enabled: true,
				updatedAt: nowIso(),
				source: "single",
			});
			const result = await handle.completion;
			if (
				!showWorkspaceResult(result, {
					remoteCommittedMessageKey: "Resource added",
				})
			)
				return;
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
			const handle = upsertSubscription({
				id: createId("sub"),
				name,
				url,
				enabled: true,
				tags: reconcileTags(subTags),
				updatedAt: nowIso(),
			});
			const result = await handle.completion;
			if (
				!showWorkspaceResult(result, {
					remoteCommittedMessageKey: "Resource added",
				})
			)
				return;
			subName = "";
			subUrl = "";
			subTags = "";
		}
	} else {
		// Batch Import Logic
		const lines = batchContent
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		let count = 0;
		let skipped = 0;
		let failed = 0;
		let durablePresentation: ReturnType<
			typeof presentWorkspaceOperation
		> | null = null;
		let failurePresentation: ReturnType<
			typeof presentWorkspaceOperation
		> | null = null;

		if (activeTab === "nodes") {
			const seenRaw = new Set($appState.nodes.map((node) => node.raw.trim()));
			let importedNames = $appState.nodes.map((node) => node.name);
			for (const line of lines) {
				const nodes = extractSubscriptionNodeLines(line);
				if (nodes.length === 0) {
					failed++;
					continue;
				}
				for (const raw of nodes) {
					const normalizedRaw = raw.trim();
					if (seenRaw.has(normalizedRaw)) {
						skipped++;
						continue;
					}
					const name = makeUniqueResourceName(
						inferNodeNameFromRaw(normalizedRaw, `Imported Node ${count + 1}`),
						importedNames,
						formatResourceNameTimestamp(),
					);
					const result = await upsertNode({
						id: createId("node"),
						name,
						type: inferNodeTypeFromRaw(normalizedRaw),
						raw: normalizedRaw,
						tags: reconcileTags(batchTags),
						enabled: true,
						updatedAt: nowIso(),
						source: "single",
					}).completion;
					const presentation = presentWorkspaceOperation(result);
					if (!presentation.finalizeDraft) {
						failed++;
						failurePresentation ??= presentation;
						continue;
					}
					durablePresentation ??= presentation;
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
						skipped++;
						continue;
					}
					name = makeUniqueResourceName(
						name,
						importedNames,
						formatResourceNameTimestamp(),
					);
					const result = await upsertSubscription({
						id: createId("sub"),
						name,
						url,
						enabled: true,
						tags: reconcileTags(batchTags),
						updatedAt: nowIso(),
					}).completion;
					const presentation = presentWorkspaceOperation(result);
					if (!presentation.finalizeDraft) {
						failed++;
						failurePresentation ??= presentation;
						continue;
					}
					durablePresentation ??= presentation;
					seenUrl.add(url);
					importedNames = [name, ...importedNames];
					count++;
				} else {
					failed++;
				}
			}
		}
		operationFeedback = failurePresentation ?? durablePresentation;
		if (failed === 0) {
			batchContent = "";
			batchTags = "";
		}
		const summary = $t(
			"Imported {count} items; skipped {skipped}; failed {failed}",
			{
				count,
				skipped,
				failed,
			},
		);
		const details = [
			summary,
			durablePresentation
				? $t(durablePresentation.messageKey, durablePresentation.messageParams)
				: null,
			failurePresentation
				? $t(failurePresentation.messageKey, failurePresentation.messageParams)
				: null,
		].filter((message): message is string => Boolean(message));
		showToastNotify(
			details.join(" "),
			failed > 0 ? "error" : (durablePresentation?.tone ?? "success"),
		);
		if (failed > 0) return;
	}
	isAddModalOpen = false;
}

// Edit Logic
function startEditNode(node: NodeItem) {
	operationFeedback = null;
	nodeDrafts[node.id] = {
		name: node.name,
		type: node.type,
		raw: node.raw,
		tags: stringifyTags(node.tags),
	};
	editingResource = { type: "node", id: node.id };
}

async function saveEditNode(id: string) {
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
	const result = await upsertNode({
		...original,
		name: uniqueNodeName(draft.name.trim(), id),
		type: inferNodeTypeFromDraft(raw, draft.type),
		raw,
		tags: reconcileTags(draft.tags, original.tags),
		updatedAt: nowIso(),
	}).completion;
	if (
		!showWorkspaceResult(result, {
			remoteCommittedMessageKey: "Node updated",
		})
	)
		return;
	closeEditModal();
}

function startEditSub(sub: SubscriptionItem) {
	operationFeedback = null;
	subDrafts[sub.id] = {
		name: sub.name,
		url: sub.url,
		tags: stringifyTags(sub.tags),
	};
	editingResource = { type: "subscription", id: sub.id };
}

async function saveEditSub(id: string) {
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

	const result = await upsertSubscription({
		...original,
		name: uniqueSubscriptionName(draft.name.trim(), id),
		url,
		tags: reconcileTags(draft.tags, original.tags),
		updatedAt: nowIso(),
	}).completion;
	if (
		!showWorkspaceResult(result, {
			remoteCommittedMessageKey: "Subscription updated",
		})
	)
		return;
	closeEditModal();
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
		const { content, error } = await loadSubscriptionContent(subscription.url);
		if (error) {
			subscriptionPreviewCache[subscription.id] = {
				status: "error",
				nodes: [],
				error: toSubscriptionFetchDiagnostic(error),
			};
			return;
		}

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
	} catch {
		subscriptionPreviewCache[subscription.id] = {
			status: "error",
			nodes: [],
			error: { code: "network-or-cors" },
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
		const result = await (type === "node"
			? removeNode(id).completion
			: removeSubscription(id).completion);
		if (
			!showWorkspaceResult(result, {
				remoteCommittedMessageKey: "Deleted {name}",
				successMessageParams: { name },
			})
		)
			return;
		if (type === "node") delete nodeDrafts[id];
		else delete subDrafts[id];
		if (editingResource?.id === id) closeEditModal();
	} finally {
		deletingResourceId = null;
	}
}

async function toggleEnabled(id: string, type: "node" | "sub") {
	if (togglingResourceId) return;
	togglingResourceId = id;
	try {
		let result: WorkspaceOperationResult;
		if (type === "node") {
			const node = $appState.nodes.find((item) => item.id === id);
			if (!node) return;
			result = await upsertNode({
				...node,
				enabled: !node.enabled,
				updatedAt: nowIso(),
			}).completion;
		} else {
			const subscription = $appState.subscriptions.find(
				(item) => item.id === id,
			);
			if (!subscription) return;
			result = await upsertSubscription({
				...subscription,
				enabled: !subscription.enabled,
				updatedAt: nowIso(),
			}).completion;
		}
		showWorkspaceResult(result);
	} finally {
		togglingResourceId = null;
	}
}
</script>

<svelte:head>
	<title>{$t("Nodes")} - SubMan</title>
</svelte:head>

<div class="gh-page">
 <PageHeader title={$t("Nodes")} description={$t("Manage nodes and subscription sources.")}>
  <button type="button" class="gh-btn gh-btn-primary" on:click={() => { operationFeedback = null; isAddModalOpen = !isAddModalOpen; }}>
   <Octicon icon={plus} className="h-4 w-4" />{$t("New Resource")}
  </button>
 </PageHeader>

	<!-- Add Modal / Embedded Form -->
	{#if isAddModalOpen}
		<div class="gh-box !overflow-visible" transition:collapseMotion>
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
								{#if nodeUriValidation && nodeUriValidation.issues.length > 0}
									<p class="text-xs text-attention-fg" aria-live="polite">
										{$t("URI warning: {issues}", { issues: nodeUriValidation.issues.join(", ") })}
									</p>
								{/if}
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
 <div class="px-5"><OperationFeedback feedback={operationFeedback} /></div>
			<div class="gh-section-footer">
				<button type="button" class="gh-btn" on:click={() => (isAddModalOpen = false)}>{$t("Cancel")}</button>
				<ActionButton label={$t("Save Resource")} action={handleAdd} feedback={operationFeedback} variant="primary" className="px-6" />
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
	</div>

	<!-- Content Box -->
	<div class="gh-box gh-resource-list">
  <div class="gh-resource-header">
   <span>{$t("Enable")}</span><span>{$t("Resource")}</span>
   <span class="gh-resource-summary">{activeTab === "nodes" ? filteredNodes.length : filteredSubscriptions.length} {$t("results")} · {activeTab === "nodes" ? enabledNodeCount : enabledSubscriptionCount} {$t("enabled")}</span>
   <span>{$t("Actions")}</span>
  </div>

		{#if activeTab === "nodes"}
			{#if filteredNodes.length === 0}
				<div class="blankslate">
					<Octicon icon={server} className="mb-3 h-10 w-10 text-fg-subtle" />
					{#if $appState.nodes.length > 0}
						<h3 class="text-lg font-semibold">{$t("No matching resources")}</h3>
						<p class="mb-4 text-sm text-fg-muted">{$t("Try another search or clear the filters.")}</p>
						<button type="button" class="gh-btn" on:click={() => { searchQuery = ""; filterStatus = "all"; }}>{$t("Clear filters")}</button>
					{:else}
					<h3 class="text-lg font-bold">{$t("No nodes yet")}</h3>
					<p class="mb-4 text-sm text-fg-muted">{$t("Add one URI or import a batch.")}</p>
					<button type="button" class="gh-btn" on:click={() => (isAddModalOpen = true)}>{$t("Add node")}</button>
					{/if}
				</div>
			{:else}
				{#each filteredNodes as node (node.id)}
					<div class={cn("gh-box-row group flex flex-col gap-0", !node.enabled && "gh-resource-disabled")}>
							<div class="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4">
								<div class="gh-row-main">
									<input
										type="checkbox"
										class="mt-0.5"
										checked={node.enabled}
										on:change={() => toggleEnabled(node.id, "node")}
										aria-label={$t(node.enabled ? "Disable node" : "Enable node")}
										disabled={deletingResourceId === node.id || togglingResourceId === node.id || $workspaceSyncStatus.queueCount > 0}
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
											<span>{$t("Source: {source}", { source: $t(node.source === "single" ? "Single URI" : "Subscription") })}</span>
											{#if node.tags.length}<span>{$t("{count} tags", { count: node.tags.length })}</span>{/if}
										</div>
										{#if node.tags.length > 0}
											<div class="flex flex-wrap gap-1">
												{#each node.tags as nodeTag}
													<span class="gh-label gh-label-muted"><Octicon icon={tagIcon} className="h-3 w-3" />{nodeTag.label}</span>
												{/each}
											</div>
										{/if}
									</div>
								</div>

								<div class="gh-row-actions">
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => startEditNode(node)} aria-label={$t("Edit node")} title={$t("Edit node")} use:tooltip={$t("Edit node")} disabled={deletingResourceId === node.id}><Octicon icon={pencil} className="h-3.5 w-3.5" /></button>
									<CopyButton value={node.raw} label={$t("Copy URI")} disabled={deletingResourceId === node.id} />
									<button type="button" class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => remove(node.id, "node", node.name)} aria-label={$t("Delete node")} title={$t("Delete node")} use:tooltip={$t("Delete node")} disabled={deletingResourceId === node.id}>
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
					{#if $appState.subscriptions.length > 0}
						<h3 class="text-lg font-semibold">{$t("No matching resources")}</h3>
						<p class="mb-4 text-sm text-fg-muted">{$t("Try another search or clear the filters.")}</p>
						<button type="button" class="gh-btn" on:click={() => { searchQuery = ""; filterStatus = "all"; }}>{$t("Clear filters")}</button>
					{:else}
					<h3 class="text-lg font-bold">{$t("No subscriptions yet")}</h3>
					<p class="mb-4 text-sm text-fg-muted">{$t("Add a feed URL to fetch nodes.")}</p>
					<button type="button" class="gh-btn" on:click={() => (isAddModalOpen = true)}>{$t("Add subscription")}</button>
					{/if}
				</div>
			{:else}
				{#each filteredSubscriptions as sub (sub.id)}
					<div class={cn("gh-box-row group flex flex-col gap-0", !sub.enabled && "gh-resource-disabled")}>
							<div class="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4">
								<div class="gh-row-main">
									<input
										type="checkbox"
										class="mt-0.5"
										checked={sub.enabled}
										on:change={() => toggleEnabled(sub.id, "sub")}
										aria-label={$t(sub.enabled ? "Disable subscription" : "Enable subscription")}
										disabled={deletingResourceId === sub.id || togglingResourceId === sub.id || $workspaceSyncStatus.queueCount > 0}
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
											{#if sub.tags.length}<span>{$t("{count} tags", { count: sub.tags.length })}</span>{/if}
										</div>
										<div class="flex items-center gap-1.5 text-xs text-fg-muted">
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

								<div class="gh-row-actions">
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => openSubscriptionPreview(sub)} aria-label={$t("Preview nodes")} title={$t("Preview nodes")} use:tooltip={$t("Preview nodes")} disabled={deletingResourceId === sub.id}><Octicon icon={eye} className="h-3.5 w-3.5" /></button>
									<button type="button" class="gh-btn gh-btn-sm" on:click={() => startEditSub(sub)} aria-label={$t("Edit subscription")} title={$t("Edit subscription")} use:tooltip={$t("Edit subscription")} disabled={deletingResourceId === sub.id}><Octicon icon={pencil} className="h-3.5 w-3.5" /></button>
									<CopyButton value={sub.url} label={$t("Copy URL")} disabled={deletingResourceId === sub.id} />
									<button type="button" class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => remove(sub.id, "sub", sub.name)} aria-label={$t("Delete subscription")} title={$t("Delete subscription")} use:tooltip={$t("Delete subscription")} disabled={deletingResourceId === sub.id}>
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
 <Dialog label={edit.type === "node" ? $t("Edit Node") : $t("Edit Subscription")} closeLabel={$t("Close edit modal")} onclose={closeEditModal}>
			<div class="gh-box-header">
				<div class="flex min-w-0 items-center gap-2">
					<Octicon icon={pencil} className="h-4 w-4" />
					<span>{edit.type === "node" ? $t("Edit Node") : $t("Edit Subscription")}</span>
				</div>
				<button type="button" class="gh-icon-button h-7 w-7" on:click={closeEditModal} aria-label={$t("Close edit modal")}><Octicon icon={x} className="h-4 w-4" /></button>
			</div>

			<div class="gh-section-body flex-1 overflow-y-auto">
 <fieldset class="contents" disabled={$workspaceSyncStatus.queueCount > 0}>
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
 </fieldset>
 <OperationFeedback feedback={operationFeedback} />
			</div>

			<div class="gh-section-footer">
				<button type="button" class="gh-btn" on:click={closeEditModal}>{$t("Cancel")}</button>
				{#if edit.type === "node"}
					<ActionButton label={$t("Save")} action={() => saveEditNode(edit.id)} feedback={operationFeedback} variant="primary" icon={save} />
				{:else}
					<ActionButton label={$t("Save")} action={() => saveEditSub(edit.id)} feedback={operationFeedback} variant="primary" icon={save} />
				{/if}
			</div>
 </Dialog>
{/if}

<!-- Subscription Preview Modal -->
{#if previewSubscriptionId}
	{@const sub = $appState.subscriptions.find(s => s.id === previewSubscriptionId)}
	{@const cache = subscriptionPreviewCache[previewSubscriptionId]}
 <Dialog label={$t("Subscription Preview")} closeLabel={$t("Close subscription preview")} onclose={closeSubscriptionPreview}>
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
				{:else if cache?.status === "error" && cache.error}
					{@const presentation = presentSubscriptionFetchDiagnostic(cache.error)}
					<div class="gh-alert gh-alert-danger flex-col items-start" role="alert" aria-live="assertive">
						<div class="flex items-start gap-2">
							<Octicon icon={alert} className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--danger-emphasis)]" />
							<div class="min-w-0">
								<p class="font-semibold">{$t(presentation.titleKey, presentation.params)}</p>
								<p class="text-sm text-fg-muted">{$t(presentation.detailKey, presentation.params)}</p>
							</div>
						</div>
						{#if sub}
							<button type="button" class="gh-btn gh-btn-sm" on:click={() => loadSubscriptionPreview(sub, true)}>
								<Octicon icon={sync} className="h-3.5 w-3.5" />
								{$t("Retry subscription preview")}
							</button>
						{/if}
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
									<CopyButton value={node.raw} label={$t("Copy node URI")} />
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
 </Dialog>
{/if}
