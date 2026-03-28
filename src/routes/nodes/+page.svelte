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

	const typeColors: Record<ProxyType, string> = {
		vless: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
		vmess: "bg-purple-500/10 text-purple-400 border-purple-500/20",
		trojan: "bg-rose-500/10 text-rose-400 border-rose-500/20",
		ss: "bg-amber-500/10 text-amber-400 border-amber-500/20",
		ssr: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20",
		hysteria2: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
		tuic: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
		other: "bg-slate-500/10 text-slate-400 border-slate-500/20"
	};

	onDestroy(() => {
		if (toastTimer) clearTimeout(toastTimer);
	});
</script>

<svelte:window on:keydown={handlePreviewDialogKeydown} />

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
			on:click={openAddModal}
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
				<button on:click={closeAddModal} class="text-slate-500 hover:text-white transition-colors">
					<ChevronUp class="h-5 w-5" />
				</button>
			</div>

			<div class="mb-6 inline-flex rounded-2xl border border-slate-800 bg-slate-950/60 p-1">
				<button
					type="button"
					on:click={() => (addMode = 'single')}
					class={cn(
						"rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-all",
						addMode === 'single' ? "bg-indigo-500/15 text-indigo-300" : "text-slate-500 hover:text-slate-200"
					)}
				>
					{$t("Single Entry")}
				</button>
				<button
					type="button"
					on:click={() => (addMode = 'batch')}
					class={cn(
						"rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-all",
						addMode === 'batch' ? "bg-indigo-500/15 text-indigo-300" : "text-slate-500 hover:text-slate-200"
					)}
				>
					{$t("Batch Import")}
				</button>
			</div>

			{#if addMode === 'single'}
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
								<option value="ssr">SSR</option>
								<option value="hysteria2">Hysteria2</option>
								<option value="tuic">TUIC</option>
								<option value="other">Other</option>
							</select>
						</div>
						<div class="space-y-4">
							<textarea
								class={cn(
									"w-full h-[104px] rounded-xl border bg-slate-950 px-4 py-3 text-xs font-mono text-white placeholder:text-slate-600 outline-none transition-all",
									duplicateNode ? "border-red-500/50 focus:border-red-500/60" : "border-slate-800 focus:border-indigo-500/50"
								)}
								placeholder={$t("Raw node URI (vless://...)")}
								bind:value={nodeRaw}
							></textarea>
							{#if duplicateNode}
								<p class="text-[11px] leading-relaxed text-red-300">{$t("A node with the same raw URI already exists: {name}", { name: duplicateNode.name })}</p>
								<p class="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">{$t("The existing item has been expanded for quick review.")}</p>
							{/if}
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
								class={cn(
									"w-full rounded-xl border bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none transition-all",
									duplicateSubscription ? "border-red-500/50 focus:border-red-500/60" : "border-slate-800 focus:border-indigo-500/50"
								)}
								placeholder={$t("Subscription URL")}
								bind:value={subUrl}
							/>
							{#if duplicateSubscription}
								<p class="text-[11px] leading-relaxed text-red-300">{$t("A subscription with the same URL already exists: {name}", { name: duplicateSubscription.name })}</p>
								<p class="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">{$t("The existing item has been expanded for quick review.")}</p>
							{/if}
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
			{:else}
				<div class="space-y-4">
					<textarea
						class="w-full min-h-[180px] rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs font-mono text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
						placeholder={activeTab === 'nodes' ? $t("Raw node URI (one per line)") : $t("Subscription URL or Name = URL (one per line)")}
						bind:value={batchContent}
					></textarea>
					<input
						class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
						placeholder={$t("Tags applied to all imported items (comma separated)")}
						bind:value={batchTags}
					/>
				</div>
				<div class="space-y-4 rounded-2xl border border-slate-800/60 bg-slate-950/40 p-5">
					<p class="text-sm font-bold text-white">{activeTab === 'nodes' ? $t("Batch import nodes") : $t("Batch import subscriptions")}</p>
					<p class="text-sm leading-relaxed text-slate-400">
						{activeTab === 'nodes'
							? $t("One node URI per line. Names and protocol types are inferred automatically.") + " " + $t("Pasted base64 subscription content is expanded into individual nodes automatically.")
							: $t("One subscription per line. Use either a raw URL or Name = URL.")}
					</p>
					<div class="grid gap-3 sm:grid-cols-3">
						<div class="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3">
							<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Lines detected: {count}", { count: batchLineCount })}</p>
							<p class="mt-2 text-sm font-bold text-white">{batchImportPreview.totalLines}</p>
						</div>
						<div class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
							<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">{$t("Importable")}</p>
							<p class="mt-2 text-sm font-bold text-white">{batchImportPreview.importableCount}</p>
						</div>
						<div class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
							<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">{$t("Duplicates")}: {batchImportPreview.duplicateCount} · {$t("Invalid")}: {batchImportPreview.invalidCount}</p>
							<p class="mt-2 text-sm font-bold text-white">{batchImportPreview.items.length}</p>
						</div>
					</div>
					<p class="text-[11px] leading-relaxed text-slate-500">
						{activeTab === 'nodes'
							? $t("Existing or repeated raw URIs are skipped automatically during import.")
							: $t("Existing or repeated subscription URLs are skipped automatically during import.")}
					</p>
					<div class="rounded-2xl border border-slate-800/60 bg-slate-950/50 p-4 space-y-3">
						<div class="flex items-center justify-between gap-3">
							<p class="text-sm font-bold text-white">{$t("Import Preview")}</p>
							<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Preview import results before saving.")}</p>
						</div>
						<div class="grid gap-3 sm:grid-cols-2">
							<input
								class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
								placeholder={$t("Filter preview by name or detail") }
								bind:value={batchPreviewSearch}
							/>
							<div class="flex flex-wrap gap-2">
								{#each ["all", "import", "duplicate", "invalid"] as filter}
									<button
										type="button"
										on:click={() => (batchPreviewStatusFilter = filter as typeof batchPreviewStatusFilter)}
										class={cn(
											"rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-all",
											batchPreviewStatusFilter === filter
												? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
												: "border-slate-800 bg-slate-950/60 text-slate-500 hover:text-slate-300"
										)}
									>
										{$t(filter === "all" ? "All" : filter === "import" ? "Importable" : filter === "duplicate" ? "Duplicate" : "Invalid")}
									</button>
								{/each}
							</div>
						</div>
						{#if activeTab === 'nodes'}
							<div class="flex flex-wrap gap-2">
								{#each batchPreviewProtocolOptions as protocol}
									<button
										type="button"
										on:click={() => (batchPreviewProtocolFilter = protocol)}
										class={cn(
											"rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-all",
											batchPreviewProtocolFilter === protocol
												? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
												: "border-slate-800 bg-slate-950/60 text-slate-500 hover:text-slate-300"
										)}
									>
										{$t(protocol === "all" ? "All protocols" : protocol)}
									</button>
								{/each}
							</div>
						{/if}
						<div class="flex flex-wrap items-center justify-between gap-3">
							<p class="text-[11px] leading-relaxed text-slate-500">{$t("Only visible selected importable items will be imported.")}</p>
							<div class="flex flex-wrap gap-2">
								<button type="button" on:click={selectAllVisibleBatchImportItems} class="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300 transition-all hover:bg-slate-800 hover:text-white">{$t("Select visible")}</button>
								<button type="button" on:click={clearVisibleBatchImportItemsSelection} class="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300 transition-all hover:bg-slate-800 hover:text-white">{$t("Clear visible selection")}</button>
							</div>
						</div>
						<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Selected importable items: {count}", { count: visibleSelectedImportableCount })}</p>
						{#if filteredBatchImportPreviewItems.length === 0}
							<p class="text-sm text-slate-500">{$t("No preview items match the current filters.")}</p>
						{:else}
							<div class="max-h-72 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
								{#each filteredBatchImportPreviewItems as item (item.id)}
									<div class={cn(
										"rounded-xl border px-4 py-3 space-y-1",
										item.status === "import" && selectedBatchImportIds.includes(item.id) ? "ring-1 ring-emerald-400/40" : "",
										item.status === "import"
											? "border-emerald-500/20 bg-emerald-500/10"
											: item.status === "duplicate"
												? "border-amber-500/20 bg-amber-500/10"
												: "border-red-500/20 bg-red-500/10"
									)}>
										<div class="flex items-start justify-between gap-3">
											{#if item.status === "import"}
												<label class="mt-0.5 flex items-center gap-2 text-emerald-200">
													<input type="checkbox" class="h-4 w-4 rounded border-emerald-500/40 bg-slate-950 text-emerald-500 focus:ring-emerald-500" checked={selectedBatchImportIds.includes(item.id)} on:change={() => toggleBatchImportSelection(item.id)} />
												</label>
											{/if}
											<div class="min-w-0">
												<p class="text-sm font-bold text-white">{item.label}</p>
												<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Line {line}", { line: item.lineNumber })}</p>
											</div>
											<div class={cn(
												"rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
												item.status === "import"
													? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
													: item.status === "duplicate"
														? "border-amber-500/20 bg-amber-500/10 text-amber-300"
														: "border-red-500/20 bg-red-500/10 text-red-300"
											)}>
												{$t(item.status === "import" ? "Importable" : item.status === "duplicate" ? "Duplicate" : "Invalid")}
											</div>
										</div>
										<p class="text-xs text-slate-300 break-all">{item.detail}</p>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<div class="mt-6 flex justify-end gap-3">
				<button 
					on:click={closeAddModal}
					class="px-5 py-2.5 text-sm font-bold text-slate-400 hover:text-white transition-colors"
				>
					{$t("Cancel")}
				</button>
				<button 
					on:click={addMode === 'single' ? handleAdd : handleBatchImport}
					disabled={addMode === 'single' ? !canSaveDraft : !canImportBatch}
					class="rounded-xl bg-indigo-600 px-8 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-indigo-600"
				>
					{addMode === 'single' ? $t("Save") : $t("Import")}
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
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
		{#if activeTab === 'nodes'}
			{#if filteredNodes.length === 0}
				<div class="rounded-[2.5rem] border border-slate-800/40 border-dashed py-20 text-center md:col-span-2 xl:col-span-3">
					<Cpu class="h-12 w-12 text-slate-700 mx-auto mb-4" />
					<p class="text-slate-500 font-medium">{$t("No nodes found matching your criteria.")}</p>
				</div>
			{:else}
				{#each filteredNodes as node (node.id)}
					<div 
						transition:fade
						class={cn(
							"group relative flex h-full flex-col overflow-hidden rounded-3xl border transition-all duration-300",
							node.enabled ? "border-slate-800/60 bg-slate-900/30" : "border-slate-900/40 bg-slate-950/20 grayscale opacity-60"
						)}
					>
						<div class="flex items-start justify-between gap-4 p-5">
							<div class="flex min-w-0 flex-1 items-start gap-4">
								<button 
									on:click={() => toggleEnabled(node.id, 'node')}
									class={cn(
										"h-11 w-11 shrink-0 flex items-center justify-center rounded-2xl transition-all",
										node.enabled ? "bg-indigo-500/10 text-indigo-400" : "bg-slate-800 text-slate-600"
									)}
								>
									{#if node.enabled}<Wifi class="h-5 w-5" />{:else}<Shield class="h-5 w-5" />{/if}
								</button>

								<div class="min-w-0 flex-1 space-y-3">
									<div class="flex items-center gap-2 flex-wrap">
										<h3 class="font-bold text-white truncate">{node.name}</h3>
										<span class={cn("px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border", typeColors[node.type])}>
											{node.type}
										</span>
									</div>
									<p class="line-clamp-2 break-all text-[11px] font-mono text-slate-500">{node.raw}</p>
									<div class="flex flex-wrap gap-2">
										{#each node.tags as tag}
											<span class="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-[10px] font-medium text-slate-400">
												<Tag class="h-3 w-3" />
												{tag.label}
											</span>
										{/each}
									</div>
								</div>
							</div>

							<div class="flex items-center gap-1 self-start">
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

						<div class="mt-auto border-t border-slate-800/60 bg-slate-950/30 px-5 py-4">
							<div class="grid gap-3 sm:grid-cols-2">
								<div>
									<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Updated")}</p>
									<p class="mt-1 text-sm font-medium text-slate-300">{formatTimestamp(node.updatedAt)}</p>
								</div>
								<div>
									<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Details")}</p>
									<p class="mt-1 text-sm font-medium text-slate-300">{node.source === "single" ? $t("Single Entry") : $t("Subscriptions")}</p>
								</div>
							</div>
						</div>

						{#if expandedId === node.id}
								<div transition:slide class="border-t border-slate-800/60 p-5 bg-slate-950/40 space-y-4">
									<div class="grid gap-4 sm:grid-cols-2">
										<div class="space-y-1.5">
											<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Name")}</p>
											<input 
												class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
												value={node.name}
												on:input={(e) => upsertNode({...node, name: e.currentTarget.value, updatedAt: nowIso()})}
											/>
										</div>
										<div class="space-y-1.5">
											<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Type")}</p>
											<select 
												class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
												value={node.type}
												on:change={(e) => upsertNode({...node, type: e.currentTarget.value as ProxyType, updatedAt: nowIso()})}
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
									<div class="space-y-1.5">
										<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Raw URI")}</p>
										<textarea 
											class="w-full h-24 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-mono text-white outline-none focus:border-indigo-500/40 transition-all"
											value={node.raw}
											on:input={(e) => upsertNode({...node, raw: e.currentTarget.value, updatedAt: nowIso()})}
										></textarea>
									</div>
									<div class="space-y-1.5">
										<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Tags (comma separated)")}</p>
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
				<div class="rounded-[2.5rem] border border-slate-800/40 border-dashed py-20 text-center md:col-span-2 xl:col-span-3">
					<LinkIcon class="h-12 w-12 text-slate-700 mx-auto mb-4" />
					<p class="text-slate-500 font-medium">{$t("No subscriptions found.")}</p>
				</div>
			{:else}
				{#each filteredSubscriptions as sub (sub.id)}
					{@const preview = subscriptionPreviewCache[sub.id] ?? null}
					{@const previewTypeSummary = preview ? getPreviewTypeSummary(preview.nodes) : []}
					<div 
						transition:fade
						class={cn(
							"group relative flex h-full flex-col overflow-hidden rounded-3xl border transition-all duration-300",
							sub.enabled ? "border-slate-800/60 bg-slate-900/30" : "border-slate-900/40 bg-slate-950/20 grayscale opacity-60"
						)}
					>
						<div class="flex items-start justify-between gap-4 p-5">
							<div class="flex min-w-0 flex-1 items-start gap-4">
								<button 
									on:click={() => toggleEnabled(sub.id, 'sub')}
									class={cn(
										"h-11 w-11 shrink-0 flex items-center justify-center rounded-2xl transition-all",
										sub.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800 text-slate-600"
									)}
								>
									<LinkIcon class="h-5 w-5" />
								</button>

								<div class="min-w-0 flex-1 space-y-3">
									<div class="flex items-center gap-2 flex-wrap">
										<h3 class="font-bold text-white truncate">{sub.name}</h3>
										<span class="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
											{$t("Subscription")}
										</span>
									</div>
									<p class="text-[11px] text-slate-500 font-mono truncate">{getHost(sub.url)}</p>
									<p class="line-clamp-2 break-all text-[11px] text-slate-400">{sub.url}</p>
									<div class="flex flex-wrap gap-2">
										{#each sub.tags as tag}
											<span class="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-[10px] font-medium text-slate-400">
												<Tag class="h-3 w-3" />
												{tag.label}
											</span>
										{/each}
									</div>
								</div>
							</div>

							<div class="flex items-center gap-1 self-start">
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

						<div class="border-t border-slate-800/60 bg-slate-950/30 p-5 space-y-4">
							<div class="flex items-center justify-between gap-3">
								<div>
									<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Detected nodes")}</p>
									<p class="mt-1 text-sm font-bold text-white">
										{#if preview?.status === "ready"}
											{preview.nodes.length}
										{:else}
											--
										{/if}
									</p>
								</div>
								<button
									type="button"
									on:click={() => openSubscriptionPreview(sub)}
									class="inline-flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-indigo-200 transition-all hover:bg-indigo-500/20"
								>
									{#if preview?.status === "loading"}
										<RefreshCw class="h-3.5 w-3.5 animate-spin" />
									{:else}
										<Eye class="h-3.5 w-3.5" />
									{/if}
									{$t("Preview")}
								</button>
							</div>

							{#if preview?.status === "ready"}
								{#if preview.nodes.length === 0}
									<p class="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">
										{$t("No detectable nodes found in this subscription.")}
									</p>
								{:else}
									<div class="flex flex-wrap gap-2">
										{#each previewTypeSummary.slice(0, 4) as item}
											<span class={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]", typeColors[item.type])}>
												{item.type} · {item.count}
											</span>
										{/each}
									</div>
								{/if}
								{#if preview.fetchedAt}
									<p class="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
										{$t("Last preview: {time}", { time: formatTimestamp(preview.fetchedAt) })}
									</p>
								{/if}
							{:else if preview?.status === "loading"}
								<p class="inline-flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
									<RefreshCw class="h-4 w-4 animate-spin text-indigo-400" />
									{$t("Loading subscription preview...")}
								</p>
							{:else if preview?.status === "error"}
								<div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
									<p class="font-bold">{$t("Subscription preview failed.")}</p>
									<p class="mt-1 break-all text-red-100/80">{preview.error}</p>
								</div>
							{:else}
								<p class="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">
									{$t("Click preview to inspect included nodes.")}
								</p>
							{/if}
						</div>

						{#if expandedId === sub.id}
								<div transition:slide class="border-t border-slate-800/60 p-5 bg-slate-950/40 space-y-4">
									<div class="grid gap-4 sm:grid-cols-2">
										<div class="space-y-1.5">
											<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Name")}</p>
											<input 
												class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
												value={sub.name}
												on:input={(e) => upsertSubscription({...sub, name: e.currentTarget.value, updatedAt: nowIso()})}
											/>
										</div>
										<div class="space-y-1.5">
											<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("URL")}</p>
											<input 
												class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/40 transition-all"
												value={sub.url}
												on:input={(e) => upsertSubscription({...sub, url: e.currentTarget.value, updatedAt: nowIso()})}
											/>
										</div>
									</div>
									<div class="space-y-1.5">
										<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Tags (comma separated)")}</p>
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

{#if previewSubscription}
	<div class="fixed inset-0 z-[120]">
		<button
			type="button"
			aria-label={$t("Close preview")}
			class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
			on:click={closeSubscriptionPreview}
		></button>
		<div class="relative flex min-h-full items-center justify-center p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label={$t("Subscription Preview")}
				class="w-full max-w-5xl rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-indigo-500/10"
				in:fly={{ y: 12, duration: 220 }}
				out:fade={{ duration: 140 }}
			>
				<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div class="flex items-start gap-3">
						<div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400">
							<LinkIcon class="h-5 w-5" />
						</div>
						<div class="space-y-1">
							<h2 class="text-lg font-bold text-white tracking-tight">{$t("Subscription Preview")}</h2>
							<p class="text-sm font-medium text-slate-300">{previewSubscription.name}</p>
							<p class="text-sm text-slate-400">{getHost(previewSubscription.url)}</p>
						</div>
					</div>

					<div class="flex items-center gap-2">
						<button
							type="button"
							on:click={() => void loadSubscriptionPreview(previewSubscription, true)}
							class="inline-flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
						>
							<RefreshCw class={cn("h-3.5 w-3.5", activeSubscriptionPreview?.status === "loading" && "animate-spin")} />
							{$t("Refresh preview")}
						</button>
						<button
							type="button"
							on:click={closeSubscriptionPreview}
							class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/70 text-slate-400 transition-all hover:bg-slate-800 hover:text-white"
							aria-label={$t("Close preview")}
						>
							<X class="h-4.5 w-4.5" />
						</button>
					</div>
				</div>

				<div class="mt-6 grid gap-3 sm:grid-cols-3">
					<div class="rounded-2xl border border-slate-800/60 bg-slate-950/50 px-4 py-3">
						<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Host")}</p>
						<p class="mt-2 break-all text-sm font-medium text-white">{getHost(previewSubscription.url)}</p>
					</div>
					<div class="rounded-2xl border border-slate-800/60 bg-slate-950/50 px-4 py-3">
						<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Detected nodes")}</p>
						<p class="mt-2 text-sm font-medium text-white">{activeSubscriptionPreview?.status === "ready" ? activeSubscriptionPreview.nodes.length : "--"}</p>
					</div>
					<div class="rounded-2xl border border-slate-800/60 bg-slate-950/50 px-4 py-3">
						<p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{$t("Last preview")}</p>
						<p class="mt-2 text-sm font-medium text-white">{formatTimestamp(activeSubscriptionPreview?.fetchedAt ?? null)}</p>
					</div>
				</div>

				<div class="mt-5 flex flex-col gap-3">
					<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
						<input
							class="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
							placeholder={$t("Filter preview by name or detail")}
							bind:value={previewSearchQuery}
						/>
						<div class="flex flex-wrap gap-2">
							{#each subscriptionPreviewProtocolOptions as protocol}
								<button
									type="button"
									on:click={() => (previewTypeFilter = protocol)}
									class={cn(
										"rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-all",
										previewTypeFilter === protocol
											? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
											: "border-slate-800 bg-slate-950/60 text-slate-500 hover:text-slate-300"
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
								<span class={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]", typeColors[item.type])}>
									{item.type} · {item.count}
								</span>
							{/each}
						</div>
					{/if}
				</div>

				<div class="mt-5 max-h-[55vh] overflow-y-auto pr-1 custom-scrollbar">
					{#if activeSubscriptionPreview?.status === "loading"}
						<div class="rounded-3xl border border-slate-800/60 bg-slate-950/40 px-6 py-14 text-center">
							<RefreshCw class="mx-auto h-8 w-8 animate-spin text-indigo-400" />
							<p class="mt-4 text-sm font-medium text-slate-300">{$t("Loading subscription preview...")}</p>
						</div>
					{:else if activeSubscriptionPreview?.status === "error"}
						<div class="rounded-3xl border border-red-500/20 bg-red-500/10 px-6 py-8 text-center">
							<p class="text-sm font-bold text-red-200">{$t("Subscription preview failed.")}</p>
							<p class="mt-2 break-all text-sm text-red-100/80">{activeSubscriptionPreview.error}</p>
						</div>
					{:else if activeSubscriptionPreview?.status === "ready" && activeSubscriptionPreview.nodes.length === 0}
						<div class="rounded-3xl border border-slate-800/60 border-dashed bg-slate-950/40 px-6 py-12 text-center">
							<p class="text-sm font-medium text-slate-400">{$t("No detectable nodes found in this subscription.")}</p>
						</div>
					{:else if activeSubscriptionPreview?.status === "ready" && filteredSubscriptionPreviewNodes.length === 0}
						<div class="rounded-3xl border border-slate-800/60 border-dashed bg-slate-950/40 px-6 py-12 text-center">
							<p class="text-sm font-medium text-slate-400">{$t("No preview items match the current filters.")}</p>
						</div>
					{:else if activeSubscriptionPreview?.status === "ready"}
						<div class="grid gap-4 md:grid-cols-2">
							{#each filteredSubscriptionPreviewNodes as node (node.id)}
								<div class="rounded-3xl border border-slate-800/60 bg-slate-950/40 p-5 space-y-4">
									<div class="flex items-start justify-between gap-3">
										<div class="min-w-0">
											<p class="truncate text-sm font-bold text-white">{node.name}</p>
											<p class="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
												{$t("Line {line}", { line: node.lineNumber })}
											</p>
										</div>
										<span class={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]", typeColors[node.type])}>
											{node.type}
										</span>
									</div>

									<p class="break-all rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-[11px] font-mono leading-relaxed text-slate-300">
										{node.raw}
									</p>

									<div class="flex justify-end">
										<button
											type="button"
											on:click={() => copy(node.raw, node.name)}
											class="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
										>
											<Copy class="h-3.5 w-3.5" />
											{$t("Copy")}
										</button>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="rounded-3xl border border-slate-800/60 border-dashed bg-slate-950/40 px-6 py-12 text-center">
							<p class="text-sm font-medium text-slate-400">{$t("Click preview to inspect included nodes.")}</p>
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
