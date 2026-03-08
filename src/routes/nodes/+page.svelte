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

	let searchQuery = "";
	let filterStatus: "all" | "enabled" | "disabled" = "all";
	let expandedId: string | null = null;

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

	function decodeBase64Utf8(value: string): string | null {
		try {
			const compact = value.trim().replace(/\s+/g, "");
			const binary = atob(compact);
			const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
			return new TextDecoder().decode(bytes);
		} catch {
			return null;
		}
	}

	function inferNodeTypeFromRaw(raw: string): ProxyType {
		const index = raw.indexOf("://");
		if (index <= 0) return "other";
		const scheme = raw.slice(0, index).toLowerCase();
		if (scheme === "hy2") return "hysteria2";
		if (["vless", "vmess", "trojan", "ss", "ssr", "hysteria2", "tuic"].includes(scheme)) {
			return scheme as ProxyType;
		}
		return "other";
	}

	function inferNodeNameFromRaw(raw: string, index: number): string {
		const hashIndex = raw.lastIndexOf("#");
		if (hashIndex > -1) {
			const encoded = raw.slice(hashIndex + 1);
			if (encoded) {
				try {
					const decoded = decodeURIComponent(encoded);
					if (decoded) return decoded;
				} catch {
					if (encoded) return encoded;
				}
			}
		}

		if (raw.startsWith("vmess://")) {
			const payload = raw.slice("vmess://".length);
			const decoded = decodeBase64Utf8(payload);
			if (decoded) {
				try {
					const parsed = JSON.parse(decoded) as { ps?: string };
					if (parsed.ps) return parsed.ps;
				} catch {
					// ignore invalid vmess payloads
				}
			}
		}

		return $t("Imported Node {index}", { index });
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
	}

	function closeAddModal() {
		isAddModalOpen = false;
	}

	function openAddModal() {
		addMode = "single";
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

	function buildBatchImportPreview(): {
		items: BatchImportPreviewItem[];
		importableCount: number;
		duplicateCount: number;
		invalidCount: number;
		firstDuplicateId: string | null;
		totalLines: number;
	} {
		const lines = batchContent
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);

		const items: BatchImportPreviewItem[] = [];
		let importableCount = 0;
		let duplicateCount = 0;
		let invalidCount = 0;
		let firstDuplicateId: string | null = null;

		if (activeTab === "nodes") {
			const existingMap = new Map($appState.nodes.map((node) => [normalizeSourceValue(node.raw), node]));
			const seen = new Set<string>();
			for (const [index, rawLine] of lines.entries()) {
				const raw = normalizeSourceValue(rawLine);
				if (!raw || !raw.includes("://")) {
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
				const existingNode = existingMap.get(raw) ?? null;
				if (existingNode || seen.has(raw)) {
					duplicateCount += 1;
					if (!firstDuplicateId && existingNode) firstDuplicateId = existingNode.id;
					items.push({
						id: `batch-node-duplicate-${index}`,
						kind: "node",
						status: "duplicate",
						lineNumber: index + 1,
						label: inferNodeNameFromRaw(raw, index + 1),
						detail: existingNode
							? $t("Duplicate of existing node: {name}", { name: existingNode.name })
							: $t("Duplicate line in this batch."),
						existingId: existingNode?.id ?? null
					});
					continue;
				}
				seen.add(raw);
				const name = inferNodeNameFromRaw(raw, index + 1);
				const type = inferNodeTypeFromRaw(raw);
				importableCount += 1;
				items.push({
					id: `batch-node-import-${index}`,
					kind: "node",
					status: "import",
					lineNumber: index + 1,
					label: name,
					detail: `${type.toUpperCase()} · ${raw}`,
					existingId: null,
					importData: { name, raw, type }
				});
			}
		} else {
			const existingMap = new Map($appState.subscriptions.map((sub) => [normalizeSourceValue(sub.url), sub]));
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

	$: batchImportPreview = buildBatchImportPreview();
	$: batchLineCount = batchImportPreview.totalLines;
	$: canImportBatch = batchImportPreview.importableCount > 0;

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

		for (const item of batchImportPreview.items) {
			if (item.status !== "import" || !item.importData) {
				continue;
			}

			if (item.kind === "node" && item.importData.raw && item.importData.type) {
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

			if (item.kind === "sub" && item.importData.url) {
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

		if (batchImportPreview.importableCount === 0) {
			showToast(
				$t("No valid lines were imported."),
				batchImportPreview.duplicateCount > 0 || batchImportPreview.invalidCount > 0 ? "error" : "info"
			);
			return;
		}

		resetBatchForm();
		closeAddModal();
		showToast(
			$t("Batch import complete: {imported} imported, {duplicates} duplicate, {invalid} invalid.", {
				imported: batchImportPreview.importableCount,
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
							? $t("One node URI per line. Names and protocol types are inferred automatically.")
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
						{#if batchImportPreview.items.length === 0}
							<p class="text-sm text-slate-500">{$t("No batch preview yet. Paste lines to preview them here.")}</p>
						{:else}
							<div class="max-h-72 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
								{#each batchImportPreview.items as item (item.id)}
									<div class={cn(
										"rounded-xl border px-4 py-3 space-y-1",
										item.status === "import"
											? "border-emerald-500/20 bg-emerald-500/10"
											: item.status === "duplicate"
												? "border-amber-500/20 bg-amber-500/10"
												: "border-red-500/20 bg-red-500/10"
									)}>
										<div class="flex items-start justify-between gap-3">
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
