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
		loadSubscriptionContent,
		looksLikeBase64,
		splitNodeSourceLine
	} from "$lib/subscription";
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
		Cpu,
		Eye,
		RefreshCw,
		X
	} from "lucide-svelte";
	import { fade, slide, fly } from "svelte/transition";

	let activeTab: "nodes" | "subscriptions" = "nodes";
	let isAddModalOpen = false;
	let addMode: "single" | "batch" = "single";

	let nodeName = "";
	let nodeType: ProxyType = "vless";
	let nodeRaw = "";
	let nodeTags = "";

	let subName = "";
	let subUrl = "";
	let subTags = "";

	let batchContent = "";
	let batchTags = "";
	let batchPreviewSearch = "";
	let batchPreviewStatusFilter: "all" | BatchImportPreviewStatus = "all";
	let batchPreviewProtocolFilter: "all" | ProxyType = "all";
	let selectedBatchImportIds: string[] = [];
	let lastBatchPreviewSignature = "";

	type BatchImportPreviewStatus = "import" | "duplicate" | "invalid";
	type BatchImportPreviewItem = {
		id: string;
		kind: "node" | "sub";
		status: BatchImportPreviewStatus;
		lineNumber: number;
		label: string;
		detail: string;
		existingId: string | null;
		importData?: {
			name: string;
			raw?: string;
			url?: string;
			type?: ProxyType;
		};
	};

	type SubscriptionPreviewNode = {
		id: string;
		lineNumber: number;
		name: string;
		raw: string;
		type: ProxyType;
	};

	type SubscriptionPreviewState = {
		status: "loading" | "ready" | "error";
		nodes: SubscriptionPreviewNode[];
		error: string | null;
		fetchedAt: string | null;
	};

	const batchPreviewProtocolOptions: ("all" | ProxyType)[] = ["all", "vless", "vmess", "trojan", "ss", "ssr", "hysteria2", "tuic", "other"];
	const subscriptionPreviewProtocolOptions = batchPreviewProtocolOptions;

	let searchQuery = "";
	let filterStatus: "all" | "enabled" | "disabled" = "all";
	let expandedId: string | null = null;
	let previewSubscriptionId: string | null = null;
	let previewSearchQuery = "";
	let previewTypeFilter: "all" | ProxyType = "all";
	let subscriptionPreviewCache: Record<string, SubscriptionPreviewState> = {};

	let toast: { message: string; type: "success" | "info" | "error" } | null = null;
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	function showToast(message: string, type: "success" | "info" | "error" = "success") {
		toast = { message, type };
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3000);
	}

	function normalizeSourceValue(value: string): string {
		return value.trim();
	}

	function parseTags(value: string): NodeTag[] {
		return value
			.split(",")
			.map((tag) => tag.trim())
			.filter(Boolean)
			.map((label) => ({ id: createId("tag"), label }));
	}

	function expandBatchNodeInputLine(line: string): { raw: string; source: "direct" | "base64" }[] {
		const trimmed = normalizeSourceValue(line);
		if (!trimmed) {
			return [];
		}

		if (trimmed.includes("://")) {
			return splitNodeSourceLine(trimmed).map((raw) => ({ raw, source: "direct" }));
		}

		if (!looksLikeBase64(trimmed)) {
			return [];
		}

		const decoded = decodeBase64Utf8(trimmed);
		if (!decoded || !decoded.includes("://")) {
			return [];
		}

		const expanded = decoded
			.split(/\r?\n/)
			.flatMap((item) => splitNodeSourceLine(item));

		return expanded.map((raw) => ({ raw, source: "base64" as const }));
	}

	function parseBatchSubscriptionLine(line: string, index: number): { name: string; url: string } | null {
		const trimmed = normalizeSourceValue(line);
		if (!trimmed) return null;

		const namedMatch = trimmed.match(/^(.*?)\s*=\s*([A-Za-z][A-Za-z0-9+.-]*:\/\/.+)$/);
		const name = namedMatch?.[1]?.trim() ?? "";
		const url = normalizeSourceValue(namedMatch?.[2] ?? trimmed);

		try {
			new URL(url);
		} catch {
			return null;
		}

		return {
			name: name || $t("Imported Subscription {index}", { index }) || getHost(url),
			url
		};
	}

	function resetSingleForm() {
		nodeName = "";
		nodeType = "vless";
		nodeRaw = "";
		nodeTags = "";
		subName = "";
		subUrl = "";
		subTags = "";
	}

	function resetBatchForm() {
		batchContent = "";
		batchTags = "";
		batchPreviewSearch = "";
		batchPreviewStatusFilter = "all";
		batchPreviewProtocolFilter = "all";
		selectedBatchImportIds = [];
		lastBatchPreviewSignature = "";
	}

	function closeAddModal() {
		isAddModalOpen = false;
	}

	function openAddModal() {
		addMode = "single";
		batchPreviewSearch = "";
		batchPreviewStatusFilter = "all";
		batchPreviewProtocolFilter = "all";
		isAddModalOpen = true;
	}

	$: normalizedNodeRaw = normalizeSourceValue(nodeRaw);
	$: normalizedSubUrl = normalizeSourceValue(subUrl);
	$: duplicateNode = normalizedNodeRaw
		? $appState.nodes.find((node) => normalizeSourceValue(node.raw) === normalizedNodeRaw) ?? null
		: null;
	$: duplicateSubscription = normalizedSubUrl
		? $appState.subscriptions.find((sub) => normalizeSourceValue(sub.url) === normalizedSubUrl) ?? null
		: null;
	$: canSaveDraft = activeTab === "nodes"
		? Boolean(nodeName.trim() && normalizedNodeRaw && !duplicateNode)
		: Boolean(subName.trim() && normalizedSubUrl && !duplicateSubscription);

	function buildBatchImportPreview(
		content: string,
		tab: "nodes" | "subscriptions",
		nodes: NodeItem[],
		subscriptions: SubscriptionItem[]
	): {
		items: BatchImportPreviewItem[];
		importableCount: number;
		duplicateCount: number;
		invalidCount: number;
		firstDuplicateId: string | null;
		totalLines: number;
	} {
		const lines = content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);

		const items: BatchImportPreviewItem[] = [];
		let importableCount = 0;
		let duplicateCount = 0;
		let invalidCount = 0;
		let firstDuplicateId: string | null = null;

		if (tab === "nodes") {
			const existingMap = new Map(nodes.map((node) => [normalizeSourceValue(node.raw), node]));
			const seen = new Set<string>();
			for (const [index, rawLine] of lines.entries()) {
				const expanded = expandBatchNodeInputLine(rawLine);
				if (expanded.length === 0) {
					invalidCount += 1;
					items.push({
						id: `batch-node-invalid-${index}`,
						kind: "node",
						status: "invalid",
						lineNumber: index + 1,
						label: $t("Imported Node {index}", { index: index + 1 }),
						detail: $t("Invalid node URI."),
						existingId: null
					});
					continue;
				}

				for (const [expandedIndex, candidate] of expanded.entries()) {
					const raw = candidate.raw;
					const existingNode = existingMap.get(raw) ?? null;
					if (existingNode || seen.has(raw)) {
						duplicateCount += 1;
						if (!firstDuplicateId && existingNode) firstDuplicateId = existingNode.id;
						items.push({
							id: `batch-node-duplicate-${index}-${expandedIndex}`,
							kind: "node",
							status: "duplicate",
							lineNumber: index + 1,
							label: inferNodeNameFromRaw(raw, $t("Imported Node {index}", { index: index + 1 })),
							detail: existingNode
								? $t("Duplicate of existing node: {name}", { name: existingNode.name })
								: $t("Duplicate line in this batch."),
							existingId: existingNode?.id ?? null
						});
						continue;
					}

					seen.add(raw);
					const name = inferNodeNameFromRaw(raw, $t("Imported Node {index}", { index: index + 1 }));
					const type = inferNodeTypeFromRaw(raw);
					importableCount += 1;
					items.push({
						id: `batch-node-import-${index}-${expandedIndex}`,
						kind: "node",
						status: "import",
						lineNumber: index + 1,
						label: name,
						detail: candidate.source === "base64"
							? $t("Expanded from base64 subscription content.") + ` ${type.toUpperCase()} · ${raw}`
							: `${type.toUpperCase()} · ${raw}`,
						existingId: null,
						importData: { name, raw, type }
					});
				}
			}
		} else {
			const existingMap = new Map(subscriptions.map((sub) => [normalizeSourceValue(sub.url), sub]));
			const seen = new Set<string>();
			for (const [index, line] of lines.entries()) {
				const parsed = parseBatchSubscriptionLine(line, index + 1);
				if (!parsed) {
					invalidCount += 1;
					items.push({
						id: `batch-sub-invalid-${index}`,
						kind: "sub",
						status: "invalid",
						lineNumber: index + 1,
						label: $t("Imported Subscription {index}", { index: index + 1 }),
						detail: $t("Invalid subscription URL."),
						existingId: null
					});
					continue;
				}
				const existingSubscription = existingMap.get(parsed.url) ?? null;
				if (existingSubscription || seen.has(parsed.url)) {
					duplicateCount += 1;
					if (!firstDuplicateId && existingSubscription) firstDuplicateId = existingSubscription.id;
					items.push({
						id: `batch-sub-duplicate-${index}`,
						kind: "sub",
						status: "duplicate",
						lineNumber: index + 1,
						label: parsed.name,
						detail: existingSubscription
							? $t("Duplicate of existing subscription: {name}", { name: existingSubscription.name })
							: $t("Duplicate line in this batch."),
						existingId: existingSubscription?.id ?? null
					});
					continue;
				}
				seen.add(parsed.url);
				importableCount += 1;
				items.push({
					id: `batch-sub-import-${index}`,
					kind: "sub",
					status: "import",
					lineNumber: index + 1,
					label: parsed.name,
					detail: parsed.url,
					existingId: null,
					importData: { name: parsed.name, url: parsed.url }
				});
			}
		}

		return { items, importableCount, duplicateCount, invalidCount, firstDuplicateId, totalLines: lines.length };
	}

	$: batchImportPreview = buildBatchImportPreview(batchContent, activeTab, $appState.nodes, $appState.subscriptions);
	$: batchLineCount = batchImportPreview.totalLines;
	$: filteredBatchImportPreviewItems = batchImportPreview.items.filter((item) => {
		if (batchPreviewStatusFilter !== "all" && item.status !== batchPreviewStatusFilter) {
			return false;
		}
		if (activeTab === "nodes" && batchPreviewProtocolFilter !== "all") {
			if (item.kind !== "node" || item.importData?.type !== batchPreviewProtocolFilter) {
				return false;
			}
		}
		const query = batchPreviewSearch.trim().toLowerCase();
		if (!query) {
			return true;
		}
		return item.label.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query);
	});
	$: visibleImportableBatchCount = filteredBatchImportPreviewItems.filter((item) => item.status === "import").length;
	$: importableBatchItemIds = batchImportPreview.items.filter((item) => item.status === "import").map((item) => item.id);
	$: batchPreviewSignature = importableBatchItemIds.join("|");
	$: if (batchPreviewSignature !== lastBatchPreviewSignature) {
		selectedBatchImportIds = importableBatchItemIds;
		lastBatchPreviewSignature = batchPreviewSignature;
	}
	$: visibleSelectedImportableCount = filteredBatchImportPreviewItems.filter(
		(item) => item.status === "import" && selectedBatchImportIds.includes(item.id)
	).length;
	$: canImportBatch = visibleSelectedImportableCount > 0;

	function toggleBatchImportSelection(id: string) {
		selectedBatchImportIds = selectedBatchImportIds.includes(id)
			? selectedBatchImportIds.filter((itemId) => itemId !== id)
			: [...selectedBatchImportIds, id];
	}

	function selectAllVisibleBatchImportItems() {
		const visibleIds = filteredBatchImportPreviewItems
			.filter((item) => item.status === "import")
			.map((item) => item.id);
		selectedBatchImportIds = Array.from(new Set([...selectedBatchImportIds, ...visibleIds]));
	}

	function clearVisibleBatchImportItemsSelection() {
		const visibleIds = new Set(
			filteredBatchImportPreviewItems.filter((item) => item.status === "import").map((item) => item.id)
		);
		selectedBatchImportIds = selectedBatchImportIds.filter((id) => !visibleIds.has(id));
	}

	$: filteredNodes = $appState.nodes
		.filter((node) => (filterStatus === "all" ? true : filterStatus === "enabled" ? node.enabled : !node.enabled))
		.filter((node) => {
			const query = searchQuery.trim().toLowerCase();
			if (!query) return true;
			return (
				node.name.toLowerCase().includes(query) ||
				node.type.toLowerCase().includes(query) ||
				node.tags.some((tag) => tag.label.toLowerCase().includes(query))
			);
		})
		.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

	$: filteredSubscriptions = $appState.subscriptions
		.filter((sub) => (filterStatus === "all" ? true : filterStatus === "enabled" ? sub.enabled : !sub.enabled))
		.filter((sub) => {
			const query = searchQuery.trim().toLowerCase();
			if (!query) return true;
			return (
				sub.name.toLowerCase().includes(query) ||
				sub.url.toLowerCase().includes(query) ||
				sub.tags.some((tag) => tag.label.toLowerCase().includes(query))
			);
		})
		.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

	$: previewSubscription = previewSubscriptionId
		? $appState.subscriptions.find((item) => item.id === previewSubscriptionId) ?? null
		: null;
	$: activeSubscriptionPreview = previewSubscriptionId ? subscriptionPreviewCache[previewSubscriptionId] ?? null : null;
	$: filteredSubscriptionPreviewNodes = (activeSubscriptionPreview?.nodes ?? []).filter((node) => {
		if (previewTypeFilter !== "all" && node.type !== previewTypeFilter) {
			return false;
		}
		const query = previewSearchQuery.trim().toLowerCase();
		if (!query) {
			return true;
		}
		return node.name.toLowerCase().includes(query) || node.raw.toLowerCase().includes(query);
	});

	function setSubscriptionPreviewState(id: string, nextState: SubscriptionPreviewState): void {
		subscriptionPreviewCache = {
			...subscriptionPreviewCache,
			[id]: nextState
		};
	}

	function buildSubscriptionPreviewNodes(content: string): SubscriptionPreviewNode[] {
		return extractSubscriptionNodeLines(content).map((raw, index) => ({
			id: `preview-node-${index}-${raw.slice(0, 24)}`,
			lineNumber: index + 1,
			name: inferNodeNameFromRaw(raw, $t("Imported Node {index}", { index: index + 1 })),
			raw,
			type: inferNodeTypeFromRaw(raw)
		}));
	}

	function openSubscriptionPreview(subscription: SubscriptionItem): void {
		previewSubscriptionId = subscription.id;
		previewSearchQuery = "";
		previewTypeFilter = "all";
		void loadSubscriptionPreview(subscription);
	}

	function closeSubscriptionPreview(): void {
		previewSubscriptionId = null;
		previewSearchQuery = "";
		previewTypeFilter = "all";
	}

	function handlePreviewDialogKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape" && previewSubscriptionId) {
			closeSubscriptionPreview();
		}
	}

	async function loadSubscriptionPreview(subscription: SubscriptionItem, force = false): Promise<void> {
		const existing = subscriptionPreviewCache[subscription.id];
		if (!force && (existing?.status === "loading" || existing?.status === "ready")) {
			return;
		}

		setSubscriptionPreviewState(subscription.id, {
			status: "loading",
			nodes: existing?.nodes ?? [],
			error: null,
			fetchedAt: existing?.fetchedAt ?? null
		});

		try {
			const { content, warning } = await loadSubscriptionContent(subscription.url);
			if (warning) {
				throw new Error(warning);
			}

			setSubscriptionPreviewState(subscription.id, {
				status: "ready",
				nodes: buildSubscriptionPreviewNodes(content),
				error: null,
				fetchedAt: nowIso()
			});
		} catch (err) {
			setSubscriptionPreviewState(subscription.id, {
				status: "error",
				nodes: existing?.nodes ?? [],
				error: err instanceof Error ? err.message : $t("Subscription preview failed."),
				fetchedAt: existing?.fetchedAt ?? null
			});
		}
	}

	function handleAdd() {
		if (activeTab === "nodes") {
			if (!nodeName.trim() || !normalizedNodeRaw) return;
			if (duplicateNode) {
				expandedId = duplicateNode.id;
				showToast($t("A node with the same raw URI already exists: {name}", { name: duplicateNode.name }), "error");
				return;
			}
			upsertNode({
				id: createId("node"),
				name: nodeName.trim(),
				type: nodeType,
				raw: normalizedNodeRaw,
				tags: parseTags(nodeTags),
				enabled: true,
				updatedAt: nowIso(),
				source: "single"
			});
			resetSingleForm();
			showToast($t("Node added successfully"));
		} else {
			if (!subName.trim() || !normalizedSubUrl) return;
			if (duplicateSubscription) {
				expandedId = duplicateSubscription.id;
				showToast($t("A subscription with the same URL already exists: {name}", { name: duplicateSubscription.name }), "error");
				return;
			}
			upsertSubscription({
				id: createId("sub"),
				name: subName.trim(),
				url: normalizedSubUrl,
				enabled: true,
				tags: parseTags(subTags),
				updatedAt: nowIso()
			});
			resetSingleForm();
			showToast($t("Subscription added successfully"));
		}
		closeAddModal();
	}

	function handleBatchImport() {
		if (batchImportPreview.totalLines === 0) {
			showToast($t("No lines to import."), "info");
			return;
		}

		if (batchImportPreview.firstDuplicateId) {
			expandedId = batchImportPreview.firstDuplicateId;
		}

		const importableItems = filteredBatchImportPreviewItems.filter((item) => item.status === "import" && item.importData && selectedBatchImportIds.includes(item.id));
		if (importableItems.length === 0) {
			showToast($t("No visible selected items to import."), "info");
			return;
		}

		for (const item of importableItems) {
			if (item.kind === "node" && item.importData?.raw && item.importData.type) {
				upsertNode({
					id: createId("node"),
					name: item.importData.name,
					type: item.importData.type,
					raw: item.importData.raw,
					tags: parseTags(batchTags),
					enabled: true,
					updatedAt: nowIso(),
					source: "single"
				});
				continue;
			}

			if (item.kind === "sub" && item.importData?.url) {
				upsertSubscription({
					id: createId("sub"),
					name: item.importData.name,
					url: item.importData.url,
					enabled: true,
					tags: parseTags(batchTags),
					updatedAt: nowIso()
				});
			}
		}

		resetBatchForm();
		closeAddModal();
		showToast(
			$t("Batch import complete: {imported} imported, {duplicates} duplicate, {invalid} invalid.", {
				imported: importableItems.length,
				duplicates: batchImportPreview.duplicateCount,
				invalid: batchImportPreview.invalidCount
			}),
			batchImportPreview.duplicateCount > 0 || batchImportPreview.invalidCount > 0 ? "info" : "success"
		);
	}

	function toggleEnabled(id: string, type: "node" | "sub") {
		if (type === "node") {
			const node = $appState.nodes.find((item) => item.id === id);
			if (node) upsertNode({ ...node, enabled: !node.enabled, updatedAt: nowIso() });
		} else {
			const sub = $appState.subscriptions.find((item) => item.id === id);
			if (sub) upsertSubscription({ ...sub, enabled: !sub.enabled, updatedAt: nowIso() });
		}
	}

	async function remove(id: string, type: "node" | "sub", name: string) {
		const confirmed = await requestConfirm({
			title: $t("Confirm Action"),
			message: $t("Are you sure you want to remove {name}?", { name }),
			confirmText: $t("Delete"),
			cancelText: $t("Cancel"),
			danger: true
		});
		if (!confirmed) return;
		if (type === "node") removeNode(id);
		else removeSubscription(id);
		showToast($t("Removed {name}", { name }), "info");
	}

	async function copy(text: string, label: string) {
		try {
			await navigator.clipboard.writeText(text);
			showToast($t("Copied {label}", { label }));
		} catch {
			showToast($t("Copy failed"), "error");
		}
	}

	function getHost(url: string): string {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	}

	function formatTimestamp(value: string | null): string {
		if (!value) {
			return $t("Unavailable");
		}
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
	}

	function getPreviewTypeSummary(nodes: SubscriptionPreviewNode[]): Array<{ type: ProxyType; count: number }> {
		const counts = new Map<ProxyType, number>();
		for (const node of nodes) {
			counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
		}
		return Array.from(counts.entries())
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
			.map(([type, count]) => ({ type, count }));
	}

	const typePillClasses: Record<ProxyType, string> = {
		vless: "protocol-pill protocol-pill--vless",
		vmess: "protocol-pill protocol-pill--vmess",
		trojan: "protocol-pill protocol-pill--trojan",
		ss: "protocol-pill protocol-pill--ss",
		ssr: "protocol-pill protocol-pill--ssr",
		hysteria2: "protocol-pill protocol-pill--hysteria2",
		tuic: "protocol-pill protocol-pill--tuic",
		other: "protocol-pill protocol-pill--other"
	};

	onDestroy(() => {
		if (toastTimer) clearTimeout(toastTimer);
	});
</script>

<svelte:window on:keydown={handlePreviewDialogKeydown} />

<svelte:head>
	<title>{$t("Nodes & Subscriptions")} | {$t("SubMan")}</title>
</svelte:head>

<div class="page-stack">
	<section class="page-hero surface-card">
		<div class="page-hero__intro">
			<div class="page-hero__icon">
				<Network class="h-6 w-6" />
			</div>
			<div class="page-hero__body">
				<p class="page-hero__eyebrow">{activeTab === "nodes" ? $t("Nodes") : $t("Subscriptions")}</p>
				<h1 class="page-hero__title">{$t("Nodes & Subscriptions")}</h1>
				<p class="page-hero__description">{$t("Manage your proxy sources and connectivity settings")}</p>
			</div>
		</div>

		<div class="page-hero__actions">
			<button on:click={openAddModal} class="button-primary">
				<Plus class="h-4 w-4" />
				{activeTab === "nodes" ? $t("New Node") : $t("New Subscription")}
			</button>
		</div>
	</section>

	<div class="metric-grid">
		<div class="metric-card">
			<p class="metric-card__label">{$t("Nodes")}</p>
			<p class="metric-card__value">{$appState.nodes.length}</p>
			<p class="metric-card__meta">{$t("Enabled")}: {$appState.nodes.filter((node) => node.enabled).length}</p>
		</div>
		<div class="metric-card">
			<p class="metric-card__label">{$t("Subscriptions")}</p>
			<p class="metric-card__value">{$appState.subscriptions.length}</p>
			<p class="metric-card__meta">{$t("Enabled")}: {$appState.subscriptions.filter((sub) => sub.enabled).length}</p>
		</div>
		<div class="metric-card">
			<p class="metric-card__label">{$t("Visible")}</p>
			<p class="metric-card__value">{activeTab === "nodes" ? filteredNodes.length : filteredSubscriptions.length}</p>
			<p class="metric-card__meta">{$t("All Status")}: {$t(filterStatus === "all" ? "All" : filterStatus === "enabled" ? "Enabled" : "Disabled")}</p>
		</div>
		<div class="metric-card">
			<p class="metric-card__label">{$t("Search")}</p>
			<p class="metric-card__value">{searchQuery.trim() ? "1" : "0"}</p>
			<p class="metric-card__meta">{searchQuery.trim() ? searchQuery : $t("No filters applied.")}</p>
		</div>
	</div>

	{#if isAddModalOpen}
		<section transition:slide class="surface-card section-card section-card--accent">
			<div class="section-card__header">
				<div class="section-card__header-main">
					<div class="section-card__icon">
						<Plus class="h-5 w-5" />
					</div>
					<div class="section-card__title-wrap">
						<h2 class="section-card__title">{activeTab === "nodes" ? $t("Add New Node") : $t("Add New Subscription")}</h2>
						<p class="section-card__text">
							{activeTab === "nodes"
								? $t("Create a single node or import a batch of raw URIs.")
								: $t("Create a single subscription or import a batch of URLs.")}
						</p>
					</div>
				</div>

				<div class="section-card__actions">
					<div class="filter-pills">
						<button
							type="button"
							on:click={() => (addMode = "single")}
							class={cn("filter-pill", addMode === "single" && "filter-pill--active")}
						>
							{$t("Single Entry")}
						</button>
						<button
							type="button"
							on:click={() => (addMode = "batch")}
							class={cn("filter-pill", addMode === "batch" && "filter-pill--active")}
						>
							{$t("Batch Import")}
						</button>
					</div>

					<button type="button" on:click={closeAddModal} class="button-icon" aria-label={$t("Cancel")}>
						<ChevronUp class="h-4.5 w-4.5" />
					</button>
				</div>
			</div>

			{#if addMode === "single"}
				<div class="grid gap-4 sm:grid-cols-2">
					{#if activeTab === "nodes"}
						<div class="space-y-4">
							<div class="space-y-2">
								<p class="field-label">{$t("Name")}</p>
								<input class="field-input" placeholder={$t("Node name")} bind:value={nodeName} />
							</div>
							<div class="space-y-2">
								<p class="field-label">{$t("Type")}</p>
								<select class="field-select" bind:value={nodeType}>
									<option value="vless">VLESS</option>
									<option value="vmess">VMess</option>
									<option value="trojan">Trojan</option>
									<option value="ss">Shadowsocks</option>
									<option value="ssr">SSR</option>
									<option value="hysteria2">Hysteria2</option>
									<option value="tuic">TUIC</option>
									<option value="other">Other</option>
								</select>
							</div>
						</div>
						<div class="space-y-4">
							<div class="space-y-2">
								<p class="field-label">{$t("Raw URI")}</p>
								<textarea
									class={cn(
										"field-textarea field-textarea--mono h-[104px]",
										duplicateNode && "border-red-500/50 focus:border-red-500/60"
									)}
									placeholder={$t("Raw node URI (vless://...)")}
									bind:value={nodeRaw}
								></textarea>
							</div>
							{#if duplicateNode}
								<div class="inline-badge inline-badge--danger">
									<AlertCircle class="h-3.5 w-3.5" />
									{$t("A node with the same raw URI already exists: {name}", { name: duplicateNode.name })}
								</div>
								<p class="text-[11px] leading-relaxed text-[color:var(--app-text-faint)]">{$t("The existing item has been expanded for quick review.")}</p>
							{/if}
						</div>
						<div class="sm:col-span-2 space-y-2">
							<p class="field-label">{$t("Tags (comma separated)")}</p>
							<input class="field-input" placeholder={$t("Tags (comma separated)")} bind:value={nodeTags} />
						</div>
					{:else}
						<div class="space-y-4">
							<div class="space-y-2">
								<p class="field-label">{$t("Name")}</p>
								<input class="field-input" placeholder={$t("Subscription name")} bind:value={subName} />
							</div>
							<div class="space-y-2">
								<p class="field-label">{$t("URL")}</p>
								<input
									class={cn("field-input", duplicateSubscription && "border-red-500/50 focus:border-red-500/60")}
									placeholder={$t("Subscription URL")}
									bind:value={subUrl}
								/>
							</div>
							{#if duplicateSubscription}
								<div class="inline-badge inline-badge--danger">
									<AlertCircle class="h-3.5 w-3.5" />
									{$t("A subscription with the same URL already exists: {name}", { name: duplicateSubscription.name })}
								</div>
								<p class="text-[11px] leading-relaxed text-[color:var(--app-text-faint)]">{$t("The existing item has been expanded for quick review.")}</p>
							{/if}
						</div>
						<div class="sm:col-span-2 space-y-2">
							<p class="field-label">{$t("Tags (comma separated)")}</p>
							<input class="field-input" placeholder={$t("Tags (comma separated)")} bind:value={subTags} />
						</div>
					{/if}
				</div>
			{:else}
				<div class="space-y-4">
					<div class="space-y-2">
						<p class="field-label">{activeTab === "nodes" ? $t("Raw URI") : $t("URL")}</p>
						<textarea
							class="field-textarea field-textarea--mono min-h-[180px]"
							placeholder={activeTab === "nodes" ? $t("Raw node URI (one per line)") : $t("Subscription URL or Name = URL (one per line)")}
							bind:value={batchContent}
						></textarea>
					</div>
					<div class="space-y-2">
						<p class="field-label">{$t("Tags (comma separated)")}</p>
						<input
							class="field-input"
							placeholder={$t("Tags applied to all imported items (comma separated)")}
							bind:value={batchTags}
						/>
					</div>
				</div>

				<div class="surface-card section-card section-card--compact">
					<div class="section-card__header">
						<div class="section-card__title-wrap">
							<h3 class="section-card__title">{activeTab === "nodes" ? $t("Batch import nodes") : $t("Batch import subscriptions")}</h3>
							<p class="section-card__text">
								{activeTab === "nodes"
									? $t("One node URI per line. Names and protocol types are inferred automatically.") + " " + $t("Pasted base64 subscription content is expanded into individual nodes automatically.")
									: $t("One subscription per line. Use either a raw URL or Name = URL.")}
							</p>
						</div>
					</div>

					<div class="metric-grid">
						<div class="metric-card">
							<p class="metric-card__label">{$t("Lines detected: {count}", { count: batchLineCount })}</p>
							<p class="metric-card__value">{batchImportPreview.totalLines}</p>
						</div>
						<div class="metric-card">
							<p class="metric-card__label">{$t("Importable")}</p>
							<p class="metric-card__value">{batchImportPreview.importableCount}</p>
						</div>
						<div class="metric-card">
							<p class="metric-card__label">{$t("Duplicates")}</p>
							<p class="metric-card__value">{batchImportPreview.duplicateCount}</p>
							<p class="metric-card__meta">{$t("Invalid")}: {batchImportPreview.invalidCount}</p>
						</div>
					</div>

					<p class="section-card__text">
						{activeTab === "nodes"
							? $t("Existing or repeated raw URIs are skipped automatically during import.")
							: $t("Existing or repeated subscription URLs are skipped automatically during import.")}
					</p>

					<div class="surface-card section-card section-card--compact">
						<div class="section-card__header">
							<div class="section-card__title-wrap">
								<h4 class="section-card__title">{$t("Import Preview")}</h4>
								<p class="section-card__text">{$t("Preview import results before saving.")}</p>
							</div>
						</div>

						<div class="grid gap-3 sm:grid-cols-2">
							<div class="input-with-icon">
								<Search />
								<input class="field-input" placeholder={$t("Filter preview by name or detail")} bind:value={batchPreviewSearch} />
							</div>
							<div class="filter-pills">
								{#each ["all", "import", "duplicate", "invalid"] as filter}
									<button
										type="button"
										on:click={() => (batchPreviewStatusFilter = filter as typeof batchPreviewStatusFilter)}
										class={cn("filter-pill", batchPreviewStatusFilter === filter && "filter-pill--active")}
									>
										{$t(filter === "all" ? "All" : filter === "import" ? "Importable" : filter === "duplicate" ? "Duplicate" : "Invalid")}
									</button>
								{/each}
							</div>
						</div>

						{#if activeTab === "nodes"}
							<div class="filter-pills">
								{#each batchPreviewProtocolOptions as protocol}
									<button
										type="button"
										on:click={() => (batchPreviewProtocolFilter = protocol)}
										class={cn("filter-pill", batchPreviewProtocolFilter === protocol && "filter-pill--active")}
									>
										{$t(protocol === "all" ? "All protocols" : protocol)}
									</button>
								{/each}
							</div>
						{/if}

						<div class="flex flex-wrap items-center justify-between gap-3">
							<p class="section-card__text">{$t("Only visible selected importable items will be imported.")}</p>
							<div class="section-card__actions">
								<button type="button" on:click={selectAllVisibleBatchImportItems} class="button-secondary">{$t("Select visible")}</button>
								<button type="button" on:click={clearVisibleBatchImportItemsSelection} class="button-secondary">{$t("Clear visible selection")}</button>
							</div>
						</div>

						<div class="inline-badge">
							{$t("Selected importable items: {count}", { count: visibleSelectedImportableCount })}
						</div>

						{#if filteredBatchImportPreviewItems.length === 0}
							<div class="empty-state empty-state--compact">
								<div class="empty-state__icon">
									<Filter class="h-5 w-5" />
								</div>
								<p class="empty-state__text">{$t("No preview items match the current filters.")}</p>
							</div>
						{:else}
							<div class="max-h-72 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
								{#each filteredBatchImportPreviewItems as item (item.id)}
									<div
										class={cn(
											"metric-card space-y-2",
											item.status === "import" && selectedBatchImportIds.includes(item.id) && "ring-1 ring-emerald-400/40"
										)}
									>
										<div class="flex items-start justify-between gap-3">
											<div class="flex min-w-0 items-start gap-3">
												{#if item.status === "import"}
													<label class="mt-0.5 flex items-center gap-2 text-emerald-500">
														<input
															type="checkbox"
															class="h-4 w-4 rounded border-emerald-500/40 bg-transparent text-emerald-500 focus:ring-emerald-500"
															checked={selectedBatchImportIds.includes(item.id)}
															on:change={() => toggleBatchImportSelection(item.id)}
														/>
													</label>
												{/if}
												<div class="min-w-0">
													<p class="truncate text-sm font-bold text-white">{item.label}</p>
													<p class="metric-card__meta">{$t("Line {line}", { line: item.lineNumber })}</p>
												</div>
											</div>
											<div
												class={cn(
													"inline-badge",
													item.status === "import"
														? "inline-badge--success"
														: item.status === "duplicate"
															? "inline-badge--warning"
															: "inline-badge--danger"
												)}
											>
												{$t(item.status === "import" ? "Importable" : item.status === "duplicate" ? "Duplicate" : "Invalid")}
											</div>
										</div>
										<p class="break-all text-sm text-[color:var(--app-text-soft)]">{item.detail}</p>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<div class="section-card__actions justify-end">
				<button on:click={closeAddModal} class="button-secondary">{$t("Cancel")}</button>
				<button
					on:click={addMode === "single" ? handleAdd : handleBatchImport}
					disabled={addMode === "single" ? !canSaveDraft : !canImportBatch}
					class="button-primary disabled:cursor-not-allowed disabled:opacity-50"
				>
					{addMode === "single" ? $t("Save") : $t("Import")}
				</button>
			</div>
		</section>
	{/if}

	<section class="surface-card section-card section-card--compact">
		<div class="section-card__header">
			<div class="section-card__header-main">
				<div class="section-card__icon">
					<Filter class="h-5 w-5" />
				</div>
				<div class="section-card__title-wrap">
					<h2 class="section-card__title">{$t("Search")}</h2>
					<p class="section-card__text">{$t("Filter saved nodes and subscriptions by type, status, or keyword.")}</p>
				</div>
			</div>
		</div>

		<div class="flex flex-col gap-4">
			<div class="filter-pills">
				<button
					type="button"
					on:click={() => (activeTab = "nodes")}
					class={cn("filter-pill", activeTab === "nodes" && "filter-pill--active")}
				>
					{$t("Nodes")}
				</button>
				<button
					type="button"
					on:click={() => (activeTab = "subscriptions")}
					class={cn("filter-pill", activeTab === "subscriptions" && "filter-pill--active")}
				>
					{$t("Subscriptions")}
				</button>
			</div>

			<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
				<div class="input-with-icon">
					<Search />
					<input
						class="field-input"
						placeholder={$t("Search {type}...", { type: activeTab })}
						bind:value={searchQuery}
					/>
				</div>

				<select class="field-select" bind:value={filterStatus}>
					<option value="all">{$t("All Status")}</option>
					<option value="enabled">{$t("Enabled")}</option>
					<option value="disabled">{$t("Disabled")}</option>
				</select>
			</div>
		</div>
	</section>

	<section class="space-y-4">
		<div class="section-card__header">
			<div class="section-card__title-wrap">
				<h2 class="section-card__title">{activeTab === "nodes" ? $t("Nodes") : $t("Subscriptions")}</h2>
				<p class="section-card__text">
					{activeTab === "nodes"
						? $t("Manage saved node entries, raw URIs, and metadata.")
						: $t("Manage saved subscription sources and inspect included nodes.")}
				</p>
			</div>
			<div class="inline-badge inline-badge--accent">
				{activeTab === "nodes" ? filteredNodes.length : filteredSubscriptions.length}
			</div>
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
			{#if activeTab === "nodes"}
				{#if filteredNodes.length === 0}
					<div class="empty-state md:col-span-2 xl:col-span-3">
						<div class="empty-state__icon">
							<Cpu class="h-6 w-6" />
						</div>
						<p class="empty-state__title">{$t("Nodes")}</p>
						<p class="empty-state__text">{$t("No nodes found matching your criteria.")}</p>
					</div>
				{:else}
					{#each filteredNodes as node (node.id)}
						<div
							transition:fade
							class={cn(
								"surface-card resource-card h-full transition-all duration-300",
								!node.enabled && "grayscale opacity-65"
							)}
						>
							<div class="resource-card__header">
								<div class="resource-card__lead">
									<button
										on:click={() => toggleEnabled(node.id, "node")}
										class={cn("resource-card__toggle", node.enabled && "resource-card__toggle--active")}
										aria-label={$t(node.enabled ? "Enabled" : "Disabled")}
									>
										{#if node.enabled}<Wifi class="h-5 w-5" />{:else}<Shield class="h-5 w-5" />{/if}
									</button>

									<div class="resource-card__body">
										<p class="resource-card__eyebrow">{$t(node.source === "single" ? "Single Entry" : "Subscriptions")}</p>
										<div class="resource-card__title-row">
											<h3 class="resource-card__title truncate">{node.name}</h3>
											<span class={typePillClasses[node.type]}>
												{node.type}
											</span>
										</div>
										<div class="resource-meta">
											<span class="resource-meta__item">
												<span class="resource-meta__label">{$t("Updated")}</span>
												<span class="resource-meta__value">{formatTimestamp(node.updatedAt)}</span>
											</span>
											<span class="resource-meta__item">
												<span class="resource-meta__label">{$t("Details")}</span>
												<span class="resource-meta__value">
													{node.source === "single" ? $t("Single Entry") : $t("Subscriptions")}
												</span>
											</span>
										</div>
										<p class="soft-code line-clamp-2 break-all">{node.raw}</p>
										{#if node.tags.length > 0}
											<div class="flex flex-wrap gap-2">
												{#each node.tags as tag}
													<span class="inline-badge">
														<Tag class="h-3.5 w-3.5" />
														{tag.label}
													</span>
												{/each}
											</div>
										{/if}
									</div>
								</div>

								<div class="resource-card__actions">
									<button
										on:click={() => (expandedId = expandedId === node.id ? null : node.id)}
										class="button-secondary button-secondary--compact"
										aria-label={$t("Edit")}
									>
										<Edit3 class="h-3.5 w-3.5" />
										{$t(expandedId === node.id ? "Hide" : "Edit")}
									</button>
									<button on:click={() => copy(node.raw, node.name)} class="button-icon button-icon--compact" aria-label={$t("Copy")}>
										<Copy class="h-4 w-4" />
									</button>
									<button
										on:click={() => remove(node.id, "node", node.name)}
										class="button-icon button-icon--compact button-icon--danger"
										aria-label={$t("Delete")}
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>

							{#if expandedId === node.id}
								<div transition:slide class="space-y-4">
									<div class="section-divider"></div>
									<div class="grid gap-4 sm:grid-cols-2">
										<div class="space-y-2">
											<p class="field-label">{$t("Name")}</p>
											<input
												class="field-input"
												value={node.name}
												on:input={(e) => upsertNode({ ...node, name: e.currentTarget.value, updatedAt: nowIso() })}
											/>
										</div>
										<div class="space-y-2">
											<p class="field-label">{$t("Type")}</p>
											<select
												class="field-select"
												value={node.type}
												on:change={(e) => upsertNode({ ...node, type: e.currentTarget.value as ProxyType, updatedAt: nowIso() })}
											>
												<option value="vless">VLESS</option>
												<option value="vmess">VMess</option>
												<option value="trojan">Trojan</option>
												<option value="ss">Shadowsocks</option>
												<option value="ssr">SSR</option>
												<option value="hysteria2">Hysteria2</option>
												<option value="tuic">TUIC</option>
												<option value="other">Other</option>
											</select>
										</div>
									</div>
									<div class="space-y-2">
										<p class="field-label">{$t("Raw URI")}</p>
										<textarea
											class="field-textarea field-textarea--mono h-24"
											value={node.raw}
											on:input={(e) => upsertNode({ ...node, raw: e.currentTarget.value, updatedAt: nowIso() })}
										></textarea>
									</div>
									<div class="space-y-2">
										<p class="field-label">{$t("Tags (comma separated)")}</p>
										<input
											class="field-input"
											value={node.tags.map((t) => t.label).join(", ")}
											on:change={(e) => upsertNode({ ...node, tags: parseTags(e.currentTarget.value), updatedAt: nowIso() })}
										/>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			{:else}
				{#if filteredSubscriptions.length === 0}
					<div class="empty-state md:col-span-2 xl:col-span-3">
						<div class="empty-state__icon">
							<LinkIcon class="h-6 w-6" />
						</div>
						<p class="empty-state__title">{$t("Subscriptions")}</p>
						<p class="empty-state__text">{$t("No subscriptions found.")}</p>
					</div>
				{:else}
					{#each filteredSubscriptions as sub (sub.id)}
						{@const preview = subscriptionPreviewCache[sub.id] ?? null}
						{@const previewTypeSummary = preview ? getPreviewTypeSummary(preview.nodes) : []}
						<div
							transition:fade
							class={cn(
								"surface-card resource-card h-full transition-all duration-300",
								!sub.enabled && "grayscale opacity-65"
							)}
						>
							<div class="resource-card__header">
								<div class="resource-card__lead">
									<button
										on:click={() => toggleEnabled(sub.id, "sub")}
										class={cn(
											"resource-card__toggle",
											sub.enabled && "resource-card__toggle--success"
										)}
										aria-label={$t(sub.enabled ? "Enabled" : "Disabled")}
									>
										<LinkIcon class="h-5 w-5" />
									</button>

									<div class="resource-card__body">
										<p class="resource-card__eyebrow">{$t("Subscription")}</p>
										<div class="resource-card__title-row">
											<h3 class="resource-card__title truncate">{sub.name}</h3>
											<span class="inline-badge inline-badge--success">{$t("Subscription")}</span>
										</div>
										<p class="resource-card__subtitle truncate">{getHost(sub.url)}</p>
										<div class="resource-meta">
											<span class="resource-meta__item">
												<span class="resource-meta__label">{$t("Updated")}</span>
												<span class="resource-meta__value">{formatTimestamp(sub.updatedAt)}</span>
											</span>
											<span class="resource-meta__item">
												<span class="resource-meta__label">{$t("Detected nodes")}</span>
												<span class="resource-meta__value">
													{preview?.status === "ready" ? preview.nodes.length : "--"}
												</span>
											</span>
										</div>
										<p class="soft-code line-clamp-2 break-all">{sub.url}</p>
										{#if sub.tags.length > 0}
											<div class="flex flex-wrap gap-2">
												{#each sub.tags as tag}
													<span class="inline-badge">
														<Tag class="h-3.5 w-3.5" />
														{tag.label}
													</span>
												{/each}
											</div>
										{/if}
									</div>
								</div>

								<div class="resource-card__actions">
									<button
										on:click={() => (expandedId = expandedId === sub.id ? null : sub.id)}
										class="button-secondary button-secondary--compact"
										aria-label={$t("Edit")}
									>
										<Edit3 class="h-3.5 w-3.5" />
										{$t(expandedId === sub.id ? "Hide" : "Edit")}
									</button>
									<button on:click={() => copy(sub.url, sub.name)} class="button-icon button-icon--compact" aria-label={$t("Copy")}>
										<Copy class="h-4 w-4" />
									</button>
									<button
										on:click={() => remove(sub.id, "sub", sub.name)}
										class="button-icon button-icon--compact button-icon--danger"
										aria-label={$t("Delete")}
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>

							<div class="resource-panel">
								<div class="resource-panel__header">
									<div class="space-y-1">
										<p class="resource-card__eyebrow">{$t("Subscription Preview")}</p>
										<h4 class="resource-panel__title">{$t("Preview")}</h4>
										<p class="resource-panel__text">{$t("Click preview to inspect included nodes.")}</p>
									</div>
									<button
										type="button"
										on:click={() => openSubscriptionPreview(sub)}
										class="button-primary button-primary--compact"
									>
										{#if preview?.status === "loading"}
											<RefreshCw class="h-4 w-4 animate-spin" />
										{:else}
											<Eye class="h-4 w-4" />
										{/if}
										{$t("Preview")}
									</button>
								</div>

								<div class="resource-meta">
									<span class="resource-meta__item">
										<span class="resource-meta__label">{$t("Detected nodes")}</span>
										<span class="resource-meta__value">{preview?.status === "ready" ? preview.nodes.length : "--"}</span>
									</span>
									<span class="resource-meta__item">
										<span class="resource-meta__label">{$t("Last preview")}</span>
										<span class="resource-meta__value">{preview?.fetchedAt ? formatTimestamp(preview.fetchedAt) : "--"}</span>
									</span>
								</div>

								{#if preview?.status === "ready"}
									{#if preview.nodes.length === 0}
										<div class="empty-state empty-state--compact">
											<div class="empty-state__icon">
												<LinkIcon class="h-5 w-5" />
											</div>
											<p class="empty-state__text">{$t("No detectable nodes found in this subscription.")}</p>
										</div>
									{:else}
										<div class="flex flex-wrap gap-2">
											{#each previewTypeSummary.slice(0, 4) as item}
												<span class={typePillClasses[item.type]}>
													{item.type} · {item.count}
												</span>
											{/each}
										</div>
									{/if}
								{:else if preview?.status === "loading"}
									<div class="inline-badge inline-badge--accent">
										<RefreshCw class="h-3.5 w-3.5 animate-spin" />
										{$t("Loading subscription preview...")}
									</div>
								{:else if preview?.status === "error"}
									<div class="inline-badge inline-badge--danger">
										<AlertCircle class="h-3.5 w-3.5" />
										{$t("Subscription preview failed.")}
									</div>
									<p class="break-all text-sm text-[color:var(--app-danger)]">{preview.error}</p>
								{/if}
							</div>

							{#if expandedId === sub.id}
								<div transition:slide class="space-y-4">
									<div class="section-divider"></div>
									<div class="grid gap-4 sm:grid-cols-2">
										<div class="space-y-2">
											<p class="field-label">{$t("Name")}</p>
											<input
												class="field-input"
												value={sub.name}
												on:input={(e) => upsertSubscription({ ...sub, name: e.currentTarget.value, updatedAt: nowIso() })}
											/>
										</div>
										<div class="space-y-2">
											<p class="field-label">{$t("URL")}</p>
											<input
												class="field-input"
												value={sub.url}
												on:input={(e) => upsertSubscription({ ...sub, url: e.currentTarget.value, updatedAt: nowIso() })}
											/>
										</div>
									</div>
									<div class="space-y-2">
										<p class="field-label">{$t("Tags (comma separated)")}</p>
										<input
											class="field-input"
											value={sub.tags.map((t) => t.label).join(", ")}
											on:change={(e) => upsertSubscription({ ...sub, tags: parseTags(e.currentTarget.value), updatedAt: nowIso() })}
										/>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			{/if}
		</div>
	</section>
</div>

{#if previewSubscription}
	<div class="fixed inset-0 z-[120]">
		<button
			type="button"
			aria-label={$t("Close preview")}
			class="dialog-scrim"
			on:click={closeSubscriptionPreview}
		></button>
		<div class="relative flex min-h-full items-center justify-center p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label={$t("Subscription Preview")}
				class="dialog-card dialog-card--xl"
				in:fly={{ y: 12, duration: 220 }}
				out:fade={{ duration: 140 }}
			>
				<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div class="flex items-start gap-3">
						<div class="dialog-card__icon dialog-card__icon--normal">
							<LinkIcon class="h-5 w-5" />
						</div>
						<div class="space-y-1">
							<h2 class="dialog-card__title">{$t("Subscription Preview")}</h2>
							<p class="text-sm font-semibold text-[var(--app-text)]">{previewSubscription.name}</p>
							<p class="text-sm text-[var(--app-text-soft)]">{getHost(previewSubscription.url)}</p>
						</div>
					</div>

					<div class="flex items-center gap-2">
						<button
							type="button"
							on:click={() => void loadSubscriptionPreview(previewSubscription, true)}
							class="button-secondary button-secondary--compact"
						>
							<RefreshCw class={cn("h-3.5 w-3.5", activeSubscriptionPreview?.status === "loading" && "animate-spin")} />
							{$t("Refresh preview")}
						</button>
						<button
							type="button"
							on:click={closeSubscriptionPreview}
							class="button-icon button-icon--compact"
							aria-label={$t("Close preview")}
						>
							<X class="h-4.5 w-4.5" />
						</button>
					</div>
				</div>

				<div class="mt-6 grid gap-3 sm:grid-cols-3">
					<div class="metric-card">
						<p class="metric-card__label">{$t("Host")}</p>
						<p class="metric-card__meta mt-2 break-all text-sm font-semibold text-[var(--app-text)]">{getHost(previewSubscription.url)}</p>
					</div>
					<div class="metric-card">
						<p class="metric-card__label">{$t("Detected nodes")}</p>
						<p class="metric-card__meta mt-2 text-sm font-semibold text-[var(--app-text)]">{activeSubscriptionPreview?.status === "ready" ? activeSubscriptionPreview.nodes.length : "--"}</p>
					</div>
					<div class="metric-card">
						<p class="metric-card__label">{$t("Last preview")}</p>
						<p class="metric-card__meta mt-2 text-sm font-semibold text-[var(--app-text)]">{formatTimestamp(activeSubscriptionPreview?.fetchedAt ?? null)}</p>
					</div>
				</div>

				<div class="mt-5 flex flex-col gap-3">
					<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
						<input
							class="field-input"
							placeholder={$t("Filter preview by name or detail")}
							bind:value={previewSearchQuery}
						/>
						<div class="filter-pills">
							{#each subscriptionPreviewProtocolOptions as protocol}
								<button
									type="button"
									on:click={() => (previewTypeFilter = protocol)}
									class={cn(
										"filter-pill",
										previewTypeFilter === protocol && "filter-pill--active"
									)}
								>
									{$t(protocol === "all" ? "All protocols" : protocol)}
								</button>
							{/each}
						</div>
					</div>

					{#if activeSubscriptionPreview?.status === "ready" && activeSubscriptionPreview.nodes.length > 0}
						<div class="flex flex-wrap gap-2">
							{#each getPreviewTypeSummary(activeSubscriptionPreview.nodes) as item}
								<span class={typePillClasses[item.type]}>
									{item.type} · {item.count}
								</span>
							{/each}
						</div>
					{/if}
				</div>

				<div class="mt-5 max-h-[55vh] overflow-y-auto pr-1 custom-scrollbar">
					{#if activeSubscriptionPreview?.status === "loading"}
						<div class="empty-state">
							<div class="empty-state__icon">
								<RefreshCw class="h-7 w-7 animate-spin text-[var(--app-accent)]" />
							</div>
							<p class="empty-state__title">{$t("Loading subscription preview...")}</p>
						</div>
					{:else if activeSubscriptionPreview?.status === "error"}
						<div class="surface-card section-card section-card--danger">
							<div class="section-card__header">
								<div class="section-card__header-main">
									<div class="section-card__icon">
										<AlertCircle class="h-4.5 w-4.5 text-[var(--app-danger)]" />
									</div>
									<div class="section-card__title-wrap">
										<h3 class="section-card__title">{$t("Subscription preview failed.")}</h3>
										<p class="section-card__text break-all">{activeSubscriptionPreview.error}</p>
									</div>
								</div>
							</div>
						</div>
					{:else if activeSubscriptionPreview?.status === "ready" && activeSubscriptionPreview.nodes.length === 0}
						<div class="empty-state">
							<div class="empty-state__icon">
								<LinkIcon class="h-6 w-6" />
							</div>
							<p class="empty-state__title">{$t("No detectable nodes found in this subscription.")}</p>
						</div>
					{:else if activeSubscriptionPreview?.status === "ready" && filteredSubscriptionPreviewNodes.length === 0}
						<div class="empty-state">
							<div class="empty-state__icon">
								<Search class="h-6 w-6" />
							</div>
							<p class="empty-state__title">{$t("No preview items match the current filters.")}</p>
						</div>
					{:else if activeSubscriptionPreview?.status === "ready"}
						<div class="grid gap-4 md:grid-cols-2">
							{#each filteredSubscriptionPreviewNodes as node (node.id)}
								<div class="surface-card resource-card resource-card--compact">
									<div class="resource-card__header">
										<div class="resource-card__body min-w-0">
											<p class="resource-card__title truncate text-sm">{node.name}</p>
											<p class="resource-card__eyebrow">
												{$t("Line {line}", { line: node.lineNumber })}
											</p>
										</div>
										<span class={typePillClasses[node.type]}>
											{node.type}
										</span>
									</div>

									<p class="soft-code break-all leading-relaxed">
										{node.raw}
									</p>

									<div class="flex justify-end">
										<button
											type="button"
											on:click={() => copy(node.raw, node.name)}
											class="button-secondary button-secondary--compact"
										>
											<Copy class="h-3.5 w-3.5" />
											{$t("Copy")}
										</button>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="empty-state">
							<div class="empty-state__icon">
								<Eye class="h-6 w-6" />
							</div>
							<p class="empty-state__title">{$t("Click preview to inspect included nodes.")}</p>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Simple Toast -->
{#if toast}
	<div 
		transition:fly={{ y: 50, duration: 400 }}
		class={cn(
			"floating-notice floating-notice--bottom",
			toast.type === 'success' ? "floating-notice--success" :
			toast.type === 'error' ? "floating-notice--error" :
			"floating-notice--info"
		)}
	>
		{#if toast.type === 'success'}<Check class="h-4 w-4" />
		{:else if toast.type === 'error'}<AlertCircle class="h-4 w-4" />
		{:else}<Zap class="h-4 w-4" />{/if}
		<span class="text-sm font-bold text-[var(--app-text)]">{toast.message}</span>
	</div>
{/if}
