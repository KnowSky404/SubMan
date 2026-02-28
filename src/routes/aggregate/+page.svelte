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
	import type { AggregatePublishTarget, AggregateRule, ProxyType } from "$lib/models";
	import { buildAggregateOutput } from "$lib/aggregate";
	import { createGist, updateGist } from "$lib/gist";
	import { exportSyncState } from "$lib/serialization";
	import { WORKSPACE_FILE } from "$lib/workspace";
	import { createId } from "$lib/utils/id";
	import { nowIso } from "$lib/utils/time";
	import { requestConfirm } from "$lib/stores/confirm";
	import { cn } from "$lib/utils/cn";
	import { 
		Zap, 
		Plus, 
		Save, 
		Trash2, 
		Play, 
		CloudUpload, 
		Copy, 
		Eye, 
		Settings2, 
		FileText, 
		ShieldCheck, 
		AlertCircle,
		CheckCircle2,
		ChevronRight,
		ExternalLink,
		RefreshCw,
		Filter,
		Settings,
		Search,
		Cpu,
		Globe,
		Database
	} from "lucide-svelte";
	import { fade, slide, fly } from "svelte/transition";

	let ruleName = "";
	let selectedNodeIds: string[] = [];
	let selectedSubscriptionIds: string[] = [];
	let excludeTags = "";
	let renameMap = "";
	let allowedTypes: ProxyType[] = [];
	
	let previewSummary = "";
	let previewContent = "";
	let previewLines = 0;
	let previewWarnings: string[] = [];
	let previewErrors: string[] = [];
	let previewLoading = false;
	let previewExpandedLine: string | null = null;
	let previewEntries: { id: string; line: string; protocol: string; name: string }[] = [];
	
	let status: { message: string, type: 'success' | 'info' | 'error' } | null = null;
	let statusTimer: ReturnType<typeof setTimeout> | null = null;

	function setStatus(message: string, type: 'success' | 'info' | 'error' = 'success') {
		status = { message, type };
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => status = null, 4000);
	}

	let selectedTargetId = "";
	let publishTargetName = "";
	let publishTargetRuleId = "";
	let publishTargetFile = "subman-aggregate.txt";
	let publishTargetDescription = "SubMan aggregate";
	let publishTargetPublic = false;
	
	let publishing = false;
	let outputContent = "";
	let publishUrl: string | null = null;
	let editingRuleId = "";
	let initialized = false;

	const protocolOptions: { id: ProxyType; label: string }[] = [
		{ id: "vless", label: "VLESS" },
		{ id: "vmess", label: "VMess" },
		{ id: "trojan", label: "Trojan" },
		{ id: "ss", label: "Shadowsocks" },
		{ id: "ssr", label: "SSR" },
		{ id: "hysteria2", label: "Hysteria2" },
		{ id: "tuic", label: "TUIC" },
		{ id: "other", label: $t("Other") }
	];

	function parseLineSummary(line: string): { protocol: string; name: string } {
		const trimmed = line.trim();
		const schemeIndex = trimmed.indexOf("://");
		if (schemeIndex <= 0) return { protocol: "unknown", name: "unnamed" };
		const protocol = trimmed.slice(0, schemeIndex).toLowerCase();
		const hashIndex = trimmed.lastIndexOf("#");
		if (hashIndex > schemeIndex) {
			const rawName = trimmed.slice(hashIndex + 1);
			try { return { protocol, name: decodeURIComponent(rawName) || "unnamed" }; }
			catch { return { protocol, name: rawName || "unnamed" }; }
		}
		if (protocol === "vmess") {
			const payload = trimmed.slice(schemeIndex + 3);
			try {
				const decoded = atob(payload);
				const parsed = JSON.parse(decoded) as { ps?: string };
				if (parsed.ps) return { protocol, name: parsed.ps };
			} catch { /* ignore */ }
		}
		return { protocol, name: "unnamed" };
	}

	function buildPreviewEntries(content: string) {
		const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
		previewEntries = lines.map((line, index) => {
			const { protocol, name } = parseLineSummary(line);
			return { id: `${protocol}-${name}-${index}`, line, protocol, name };
		});
	}

	$: if (!initialized) {
		const firstTarget = $appState.publishTargets[0];
		if (firstTarget) loadPublishTarget(firstTarget);
		else publishTargetRuleId = $appState.aggregates[0]?.id ?? "";
		initialized = true;
	}

	function toggleSelection(list: string[], id: string) {
		return list.includes(id) ? list.filter(item => item !== id) : [...list, id];
	}

	function toggleType(type: ProxyType) {
		allowedTypes = allowedTypes.includes(type) ? allowedTypes.filter(t => t !== type) : [...allowedTypes, type];
	}

	function parseRenameMap(value: string): Record<string, string> {
		const entries = value.split("\n").map(l => l.trim()).filter(Boolean).map(l => l.split("=").map(p => p.trim()));
		return Object.fromEntries(entries.filter(e => e.length === 2));
	}

	function loadRule(rule: AggregateRule) {
		editingRuleId = rule.id;
		publishTargetRuleId = rule.id;
		ruleName = rule.name;
		selectedNodeIds = [...rule.nodeIds];
		selectedSubscriptionIds = [...rule.subscriptionIds];
		excludeTags = rule.excludeTagIds.join(", ");
		renameMap = Object.entries(rule.renameMap).map(([k, v]) => `${k}=${v}`).join("\n");
		allowedTypes = rule.allowedTypes ?? [];
		clearPreview();
	}

	function clearPreview() {
		previewSummary = ""; previewContent = ""; previewLines = 0;
		previewWarnings = []; previewErrors = []; previewEntries = [];
	}

	function resetRuleForm() {
		editingRuleId = ""; ruleName = ""; selectedNodeIds = [];
		selectedSubscriptionIds = []; excludeTags = ""; renameMap = "";
		allowedTypes = []; clearPreview();
	}

	function loadPublishTarget(target: AggregatePublishTarget) {
		selectedTargetId = target.id;
		publishTargetName = target.name;
		publishTargetRuleId = target.ruleId;
		publishTargetFile = target.fileName;
		publishTargetDescription = target.description;
		publishTargetPublic = target.isPublic;
		publishUrl = target.lastPublishedUrl;
		outputContent = "";
	}

	function resetTargetForm() {
		const firstRule = $appState.aggregates[0];
		selectedTargetId = ""; publishTargetName = "";
		publishTargetRuleId = firstRule?.id ?? "";
		publishTargetFile = firstRule ? `${firstRule.name.toLowerCase().replace(/\\s+/g, '-')}.txt` : "subman-aggregate.txt";
		publishTargetDescription = "SubMan aggregate";
		publishTargetPublic = false;
		outputContent = ""; publishUrl = null;
	}

	$: if (publishTargetRuleId && !$appState.aggregates.some((rule) => rule.id === publishTargetRuleId)) {
		publishTargetRuleId = $appState.aggregates[0]?.id ?? "";
	}

	async function buildPreview() {
		if (!selectedNodeIds.length && !selectedSubscriptionIds.length) {
			setStatus($t("Select at least one node or subscription."), 'error');
			return;
		}
		previewLoading = true;
		try {
			const rule: AggregateRule = {
				id: "preview", name: ruleName || "Preview",
				nodeIds: selectedNodeIds, subscriptionIds: selectedSubscriptionIds,
				excludeTagIds: excludeTags.split(",").map(t => t.trim()).filter(Boolean),
				renameMap: parseRenameMap(renameMap), allowedTypes, updatedAt: nowIso()
			};
			const result = await buildAggregateOutput(rule, $appState.nodes, $appState.subscriptions);
			previewContent = result.content; previewLines = result.lines;
			previewWarnings = result.warnings; previewErrors = result.errors;
			buildPreviewEntries(result.content);
			previewSummary = `${$t("Nodes")}: ${selectedNodeIds.length}, ${$t("Subscriptions")}: ${selectedSubscriptionIds.length}\n${$t("Output Lines")}: ${result.lines}`;
		} finally { previewLoading = false; }
	}

	async function saveRule() {
		if (!ruleName.trim()) { setStatus($t("Rule name is required."), 'error'); return; }
		const id = editingRuleId || createId("agg");
		upsertAggregate({
			id, name: ruleName.trim(), nodeIds: selectedNodeIds, subscriptionIds: selectedSubscriptionIds,
			excludeTagIds: excludeTags.split(",").map(t => t.trim()).filter(Boolean),
			renameMap: parseRenameMap(renameMap), allowedTypes, updatedAt: nowIso()
		});
		editingRuleId = id;
		setStatus($t("Rule saved."));
	}

	async function deleteRule() {
		if (!editingRuleId) return;

		const rule = $appState.aggregates.find((item) => item.id === editingRuleId);
		if (!rule) {
			setStatus($t("Rule not found."), 'error');
			return;
		}

		const boundTargets = $appState.publishTargets.filter((target) => target.ruleId === editingRuleId);
		const shouldResetTarget = boundTargets.some((target) => target.id === selectedTargetId);
		const confirmed = await requestConfirm({
			title: $t("Confirm Action"),
			message: $t('Delete rule "{name}"?\nThis will remove {count} publish target(s) bound to this rule.', {
				name: rule.name,
				count: boundTargets.length
			}),
			confirmText: $t("Delete"),
			cancelText: $t("Cancel"),
			danger: true
		});
		if (!confirmed) return;

		const allTargetFiles = Array.from(
			new Set(
				boundTargets
					.map((target) => target.fileName.trim())
					.filter((name) => name.length > 0 && name !== WORKSPACE_FILE)
			)
		);
		const sharedFiles = Array.from(
			new Set(
				$appState.publishTargets
					.filter((target) => target.ruleId !== editingRuleId)
					.map((target) => target.fileName.trim())
					.filter((name) => allTargetFiles.includes(name))
			)
		);
		const removableFiles = allTargetFiles.filter((name) => !sharedFiles.includes(name));
		const keptFiles: string[] = [...sharedFiles];
		const deletedFiles: string[] = [];
		let cleanupWarning: string | null = null;

		if (removableFiles.length > 0) {
			const shouldDeleteFiles = await requestConfirm({
				title: $t("Confirm Action"),
				message: $t("Also delete {count} workspace output file(s)?\n{files}", {
					count: removableFiles.length,
					files: removableFiles.join(", ")
				}),
				confirmText: $t("Delete"),
				cancelText: $t("Cancel"),
				danger: true
			});
			if (shouldDeleteFiles) {
				if ($authState.token && $appState.activeGistId) {
					try {
						await updateGist($authState.token, {
							gistId: $appState.activeGistId,
							files: Object.fromEntries(removableFiles.map((name) => [name, null]))
						});
						deletedFiles.push(...removableFiles);
					} catch (err) {
						cleanupWarning = $t("Workspace file cleanup failed: {message} Clean remaining files in /gists.", {
							message: err instanceof Error ? err.message : $t("Failed to delete workspace files.")
						});
						keptFiles.push(...removableFiles);
					}
				} else {
					cleanupWarning = $t("Workspace files were not deleted (missing token or workspace gist): {files}.", {
						files: removableFiles.join(", ")
					});
					keptFiles.push(...removableFiles);
				}
			} else {
				keptFiles.push(...removableFiles);
			}
		}

		removeAggregate(editingRuleId);
		resetRuleForm();
		if (shouldResetTarget) {
			resetTargetForm();
		}

		const summaryParts = [
			$t("Rule deleted. Removed {count} publish target(s).", { count: boundTargets.length })
		];
		if (sharedFiles.length > 0) {
			summaryParts.push($t("{count} shared file(s) kept: {files}.", {
				count: sharedFiles.length,
				files: sharedFiles.join(", ")
			}));
		}
		if (deletedFiles.length > 0) {
			summaryParts.push($t("Deleted {count} workspace file(s): {files}.", {
				count: deletedFiles.length,
				files: deletedFiles.join(", ")
			}));
		}
		if (cleanupWarning) {
			summaryParts.push(cleanupWarning);
		} else if (keptFiles.length > sharedFiles.length) {
			const manuallyKept = keptFiles.filter((name) => !sharedFiles.includes(name));
			if (manuallyKept.length > 0) {
				summaryParts.push($t("Workspace files kept: {files}.", { files: manuallyKept.join(", ") }));
			}
		}

		setStatus(summaryParts.join(" "), cleanupWarning ? 'error' : 'info');
	}

	async function deleteTarget() {
		if (!selectedTargetId) return;
		const target = $appState.publishTargets.find((item) => item.id === selectedTargetId);
		if (!target) {
			setStatus($t("Publish target not found."), 'error');
			return;
		}
		const confirmed = await requestConfirm({
			title: $t("Confirm Action"),
			message: $t("Delete this publish target? This does not delete gist files."),
			confirmText: $t("Delete"),
			cancelText: $t("Cancel"),
			danger: true
		});
		if (!confirmed) return;
		removePublishTarget(target.id);
		resetTargetForm();
		setStatus($t("Publish target deleted."), 'info');
	}

	async function saveTarget() {
		if (!publishTargetRuleId) { setStatus($t("Select a rule first."), 'error'); return; }
		if (!$appState.aggregates.some((rule) => rule.id === publishTargetRuleId)) {
			setStatus($t("Selected target rule no longer exists."), 'error');
			return;
		}
		if (!publishTargetFile.trim()) { setStatus($t("File name is required."), 'error'); return; }
		const id = selectedTargetId || createId("pub");
		const existing = $appState.publishTargets.find((target) => target.id === id);
		upsertPublishTarget({
			id, name: publishTargetName.trim() || publishTargetFile,
			ruleId: publishTargetRuleId, fileName: publishTargetFile.trim(),
			description: publishTargetDescription.trim(), isPublic: publishTargetPublic,
			lastPublishedAt: existing?.lastPublishedAt ?? null,
			lastPublishedUrl: existing?.lastPublishedUrl ?? publishUrl,
			updatedAt: nowIso()
		});
		selectedTargetId = id;
		setStatus($t("Publish target saved."));
	}

	async function publish() {
		if (!$authState.token) { setStatus($t("Connect GitHub first."), 'error'); return; }
		if (!selectedTargetId) { setStatus($t("Save and select a target first."), 'error'); return; }
		const target = $appState.publishTargets.find(t => t.id === selectedTargetId);
		if (!target) return;
		
		publishing = true;
		try {
			const rule = $appState.aggregates.find(r => r.id === target.ruleId);
			if (!rule) throw new Error("Rule not found");
			
			const buildResult = await buildAggregateOutput(rule, $appState.nodes, $appState.subscriptions);
			outputContent = buildResult.content;
			
			const configContent = exportSyncState($appState);
			let workspaceId = $appState.activeGistId || "";
			let response;

			if (workspaceId) {
				response = await updateGist($authState.token, {
					gistId: workspaceId, description: target.description,
					files: { [target.fileName]: { content: outputContent }, [WORKSPACE_FILE]: { content: configContent } }
				});
			} else {
				response = await createGist($authState.token, {
					description: target.description || "SubMan workspace", isPublic: target.isPublic,
					files: { [WORKSPACE_FILE]: { content: configContent }, [target.fileName]: { content: outputContent } }
				});
				workspaceId = response.id;
			}

			const fileMeta = response.files.find(f => f.filename === target.fileName);
			publishUrl = fileMeta?.rawUrl ?? null;
			
			appState.update(s => ({ ...s, activeGistId: workspaceId, lastUpdated: nowIso() }));
			upsertPublishTarget({ ...target, lastPublishedAt: nowIso(), lastPublishedUrl: publishUrl, updatedAt: nowIso() });
			
			setStatus($t("Published to Gist successfully!"), 'success');
		} catch (err) {
			setStatus(err instanceof Error ? err.message : $t("Publish failed."), 'error');
		} finally { publishing = false; }
	}

	async function copyLink() {
		if (!publishUrl) return;
		try {
			await navigator.clipboard.writeText(publishUrl);
			setStatus($t("Link copied."));
		} catch { setStatus($t("Copy failed."), 'error'); }
	}

	async function copyLine(line: string) {
		try {
			await navigator.clipboard.writeText(line);
			setStatus($t("Line copied."));
		} catch {
			setStatus($t("Copy failed."), 'error');
		}
	}

	onDestroy(() => { if (statusTimer) clearTimeout(statusTimer); });
</script>

<svelte:head>
	<title>{$t("Aggregation Builder")} | {$t("SubMan")}</title>
</svelte:head>

<div class="space-y-8 pb-12">
	<!-- Page Header -->
	<header class="flex flex-col gap-2">
		<div class="flex items-center gap-3">
			<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400">
				<Zap class="h-6 w-6" />
			</div>
			<div>
				<h1 class="text-3xl font-extrabold text-white tracking-tight">{$t("Aggregation Builder")}</h1>
				<p class="text-slate-400 text-sm">{$t("Create and publish stable subscription links")}</p>
			</div>
		</div>
	</header>

	<!-- Status Bar -->
	{#if status}
		<div 
			transition:fly={{ y: -20, duration: 300 }}
			class={cn(
				"fixed top-20 right-8 z-[100] flex items-center gap-3 rounded-2xl px-6 py-3 border shadow-2xl backdrop-blur-xl",
				status.type === 'success' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
				status.type === 'error' ? "bg-red-500/10 border-red-500/20 text-red-400" :
				"bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
			)}
		>
			{#if status.type === 'success'}<CheckCircle2 class="h-5 w-5" />
			{:else if status.type === 'error'}<AlertCircle class="h-5 w-5" />
			{:else}<Zap class="h-5 w-5" />{/if}
			<span class="text-sm font-bold tracking-tight">{status.message}</span>
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
		<!-- Left Side: Config (8 cols) -->
		<div class="lg:col-span-8 space-y-8">
			<!-- Rule Definition -->
			<section class="rounded-[2rem] border border-slate-800/60 bg-slate-900/30 p-8 space-y-6">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<Settings2 class="h-5 w-5 text-indigo-400" />
						<h2 class="text-xl font-bold text-white">{$t("Define Aggregate Rule")}</h2>
					</div>
					<select 
						class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-indigo-500/40"
						value={editingRuleId}
						on:change={(e) => {
							const id = e.currentTarget.value;
							if (!id) resetRuleForm();
							else { const r = $appState.aggregates.find(a => a.id === id); if (r) loadRule(r); }
						}}
					>
						<option value="">+ {$t("New Rule")}</option>
						{#each $appState.aggregates as rule}
							<option value={rule.id}>{rule.name}</option>
						{/each}
					</select>
				</div>

					<div class="grid gap-6">
						<div class="space-y-2">
							<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Rule Name")}</p>
							<input 
								class="w-full rounded-2xl border border-slate-800 bg-slate-950 px-5 py-3 text-sm text-white outline-none focus:border-indigo-500/50 transition-all"
								placeholder={$t("Global Proxy Rule...")}
								bind:value={ruleName}
							/>
					</div>

						<!-- Source Picker -->
						<div class="grid gap-6 sm:grid-cols-2">
							<div class="space-y-3">
								<div class="flex items-center justify-between">
									<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Nodes")}</p>
									<span class="text-[10px] text-slate-600 font-bold">{selectedNodeIds.length}</span>
								</div>
							<div class="max-h-48 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/50 p-3 space-y-1 custom-scrollbar">
								{#each $appState.nodes as node}
									<label class="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-800/40 transition-colors cursor-pointer group">
										<input 
											type="checkbox" 
											class="h-4 w-4 rounded-md border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
											checked={selectedNodeIds.includes(node.id)}
											on:change={() => selectedNodeIds = toggleSelection(selectedNodeIds, node.id)}
										/>
										<span class="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">{node.name}</span>
									</label>
								{/each}
								{#if !$appState.nodes.length}
									<p class="text-[10px] text-slate-600 italic p-2 text-center">{$t("No nodes available")}</p>
								{/if}
							</div>
							</div>
							<div class="space-y-3">
								<div class="flex items-center justify-between">
									<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Subscriptions")}</p>
									<span class="text-[10px] text-slate-600 font-bold">{selectedSubscriptionIds.length}</span>
								</div>
							<div class="max-h-48 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/50 p-3 space-y-1 custom-scrollbar">
								{#each $appState.subscriptions as sub}
									<label class="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-800/40 transition-colors cursor-pointer group">
										<input 
											type="checkbox" 
											class="h-4 w-4 rounded-md border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
											checked={selectedSubscriptionIds.includes(sub.id)}
											on:change={() => selectedSubscriptionIds = toggleSelection(selectedSubscriptionIds, sub.id)}
										/>
										<span class="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">{sub.name}</span>
									</label>
								{/each}
								{#if !$appState.subscriptions.length}
									<p class="text-[10px] text-slate-600 italic p-2 text-center">{$t("No subscriptions available")}</p>
								{/if}
							</div>
						</div>
					</div>

						<div class="grid gap-6 sm:grid-cols-2">
							<div class="space-y-2">
								<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Exclude Tags")}</p>
								<input 
									class="w-full rounded-2xl border border-slate-800 bg-slate-950 px-5 py-3 text-sm text-white outline-none focus:border-indigo-500/50"
									placeholder={$t("domestic, gaming...")}
									bind:value={excludeTags}
								/>
							</div>
							<div class="space-y-2">
								<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Allowed Protocols")}</p>
								<div class="flex flex-wrap gap-2">
								{#each protocolOptions as opt}
									<button 
										on:click={() => toggleType(opt.id)}
										class={cn(
											"px-3 py-1 rounded-lg text-[10px] font-bold uppercase border transition-all",
											allowedTypes.includes(opt.id) ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-400" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"
										)}
									>
										{opt.label}
									</button>
								{/each}
							</div>
						</div>
						</div>

						<div class="space-y-2">
							<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{$t("Node Rename Mapping")}</p>
							<textarea 
								class="w-full h-24 rounded-2xl border border-slate-800 bg-slate-950 px-5 py-3 text-xs font-mono text-white outline-none focus:border-indigo-500/50 custom-scrollbar"
								placeholder="Original Name = New Name&#10;HK-01 = Hong Kong Premium"
								bind:value={renameMap}
							></textarea>
						</div>
					</div>

				<div class="flex items-center gap-3 pt-4">
					<button 
						on:click={saveRule}
						class="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white transition-all hover:bg-indigo-500 active:scale-[0.98]"
					>
						<Save class="h-4 w-4" />
						{editingRuleId ? $t("Update Rule") : $t("Save Rule")}
					</button>
					<button 
						on:click={buildPreview}
						class="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-800/50 px-6 py-3 text-sm font-bold text-white transition-all hover:bg-slate-700"
					>
						<Eye class="h-4 w-4" />
						{$t("Preview Output")}
					</button>
					{#if editingRuleId}
						<button 
							on:click={deleteRule}
							class="h-12 w-12 flex items-center justify-center rounded-xl border border-slate-800 text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all"
						>
							<Trash2 class="h-5 w-5" />
						</button>
					{/if}
				</div>
			</section>

			<!-- Preview Section -->
			{#if previewEntries.length > 0 || previewLoading}
				<section class="rounded-[2rem] border border-slate-800/60 bg-slate-900/10 p-8 space-y-6" in:slide>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<FileText class="h-5 w-5 text-indigo-400" />
							<h2 class="text-xl font-bold text-white">{$t("Preview Output")}</h2>
						</div>
						<div class="text-[10px] font-bold uppercase tracking-widest text-slate-500">
							{previewLines} {$t("Lines generated")}
						</div>
					</div>

					{#if previewLoading}
						<div class="py-20 flex flex-col items-center justify-center gap-4">
							<RefreshCw class="h-8 w-8 text-indigo-500 animate-spin" />
							<p class="text-sm font-medium text-slate-500">{$t("Building subscription output...")}</p>
						</div>
					{:else}
						<div class="grid gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
							{#each previewEntries as entry}
								<div class="group flex flex-col rounded-2xl border border-slate-800 bg-slate-950/60 transition-all hover:border-slate-700/60">
									<div class="flex items-center gap-4 p-4">
										<span class="text-[10px] font-black uppercase text-indigo-500/60 w-12">{entry.protocol}</span>
										<span class="flex-1 text-sm font-bold text-slate-200 truncate">{entry.name}</span>
										<button 
											on:click={() => previewExpandedLine = previewExpandedLine === entry.line ? null : entry.line}
											class="text-slate-500 hover:text-white transition-colors"
										>
											<ChevronRight class={cn("h-4 w-4 transition-transform", previewExpandedLine === entry.line && "rotate-90")} />
										</button>
									</div>
									{#if previewExpandedLine === entry.line}
										<div transition:slide class="p-4 pt-0">
											<div class="rounded-xl bg-slate-900 p-3 relative group/line">
												<p class="text-[10px] font-mono text-slate-400 break-all">{entry.line}</p>
												<button 
													on:click={() => copyLine(entry.line)} 
													class="absolute right-2 bottom-2 p-1.5 rounded-lg bg-slate-800 text-slate-400 opacity-0 group-hover/line:opacity-100 transition-opacity hover:text-white"
												>
													<Copy class="h-3 w-3" />
												</button>
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/if}
		</div>

		<!-- Right Side: Publishing (4 cols) -->
		<div class="lg:col-span-4 space-y-8 sticky top-24">
			<section class="rounded-[2rem] border border-indigo-500/20 bg-indigo-500/5 p-8 space-y-6 shadow-2xl shadow-indigo-500/5">
				<div class="flex items-center gap-3">
					<CloudUpload class="h-5 w-5 text-indigo-400" />
					<h2 class="text-xl font-bold text-white">{$t("Publish to Gist")}</h2>
				</div>

				<div class="space-y-4">
					<div class="space-y-2">
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">{$t("Publish Target")}</p>
						<select 
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500/50"
							value={selectedTargetId}
							on:change={(e) => {
								const id = e.currentTarget.value;
								if (!id) resetTargetForm();
								else { const t = $appState.publishTargets.find(x => x.id === id); if (t) loadPublishTarget(t); }
							}}
						>
							<option value="">+ {$t("New Target")}</option>
							{#each $appState.publishTargets as target}
								<option value={target.id}>{target.name}</option>
							{/each}
						</select>
					</div>

					<div class="space-y-2">
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">{$t("Target Name")}</p>
						<input 
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500/50"
							placeholder={$t("Clash Config...")}
							bind:value={publishTargetName}
						/>
					</div>

					<div class="space-y-2">
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">{$t("Select rule")}</p>
						<select
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500/50 disabled:opacity-50"
							bind:value={publishTargetRuleId}
							disabled={!$appState.aggregates.length}
						>
							{#if !$appState.aggregates.length}
								<option value="">{$t("Select a rule first.")}</option>
							{:else}
								{#each $appState.aggregates as rule}
									<option value={rule.id}>{rule.name}</option>
								{/each}
							{/if}
						</select>
					</div>

					<div class="space-y-2">
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">{$t("File Name")}</p>
						<input 
							class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm font-mono text-white outline-none focus:border-indigo-500/50"
							placeholder="config.txt"
							bind:value={publishTargetFile}
						/>
					</div>

					<div class="space-y-2">
						<label class="flex items-center gap-2 cursor-pointer group">
							<input 
								type="checkbox" 
								class="h-4 w-4 rounded-md border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
								bind:checked={publishTargetPublic}
							/>
							<span class="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">{$t("Public Gist")}</span>
						</label>
					</div>
				</div>

				<div class="pt-4 space-y-3">
					<button 
						on:click={saveTarget}
						class="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-800/50 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-all"
					>
						<Save class="h-4 w-4" />
						{$t("Save Target")}
					</button>

					{#if selectedTargetId}
						<button
							on:click={deleteTarget}
							class="w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-3 text-sm font-bold text-red-300 transition-all hover:bg-red-500/20"
						>
							<Trash2 class="h-4 w-4" />
							{$t("Delete Target")}
						</button>
					{/if}

					<button 
						on:click={publish}
						disabled={publishing || !$authState.token}
						class="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 text-sm font-extrabold text-white shadow-xl shadow-indigo-600/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
					>
						{#if publishing}
							<RefreshCw class="h-5 w-5 animate-spin" />
							{$t("Publishing...")}
						{:else}
							<CloudUpload class="h-5 w-5" />
							{$t("Publish Now")}
						{/if}
					</button>
				</div>

				{#if publishUrl}
					<div class="pt-6 border-t border-indigo-500/10 space-y-3" in:fade>
						<p class="text-[10px] font-bold uppercase tracking-widest text-emerald-500 flex items-center gap-1">
							<ShieldCheck class="h-3 w-3" />
							{$t("Live Link")}
						</p>
						<div class="flex items-center gap-2">
							<div class="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-[10px] font-mono text-slate-400 truncate">
								{publishUrl}
							</div>
							<button 
								on:click={copyLink}
								class="h-8 w-8 flex items-center justify-center rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
							>
								<Copy class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
				{/if}

				{#if !$authState.token}
					<div class="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 flex items-start gap-3">
						<AlertCircle class="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
						<p class="text-[11px] text-amber-200/80 leading-relaxed">
							{$t("Connect your GitHub token in Workspace settings to publish this aggregation.")}
						</p>
					</div>
				{/if}
			</section>

			<!-- Quick Info -->
			<div class="px-6 space-y-4">
				<div class="flex items-center gap-2 text-slate-500">
					<Database class="h-4 w-4" />
					<span class="text-[10px] font-bold uppercase tracking-widest">{$t("Workspace Status")}</span>
				</div>
				<p class="text-[11px] text-slate-400 leading-relaxed">
					{$t("Changes to rules and targets are automatically synced to your workspace gist when active.")}
				</p>
			</div>
		</div>
	</div>
</div>

<style>
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: #1e293b;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #334155;
	}
</style>
