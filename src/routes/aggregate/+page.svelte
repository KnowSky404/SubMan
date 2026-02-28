<script lang="ts">
	import { onDestroy } from "svelte";
	import {
		appState,
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
	let previewStatus: string | null = null;
	let ruleSaving = false;
	let ruleStatus: string | null = null;
	let ruleStatusType: "success" | "error" | null = null;
	let ruleStatusTimer: ReturnType<typeof setTimeout> | null = null;

	let selectedTargetId = "";
	let publishTargetName = "";
	let publishTargetRuleId = "";
	let publishTargetFile = "subman-aggregate.txt";
	let publishTargetDescription = "SubMan aggregate";
	let publishTargetPublic = false;
	let targetSaving = false;
	let targetStatus: string | null = null;
	let targetStatusType: "success" | "error" | null = null;
	let targetStatusTimer: ReturnType<typeof setTimeout> | null = null;
	let outputContent = "";
	let publishStatus: string | null = null;
	let publishUrl: string | null = null;
	let buildWarnings: string[] = [];
	let buildErrors: string[] = [];
	let publishing = false;
	let initialized = false;
	let editingRuleId = "";
	const protocolOptions: { id: ProxyType; label: string }[] = [
		{ id: "vless", label: "VLESS" },
		{ id: "vmess", label: "VMess" },
		{ id: "trojan", label: "Trojan" },
		{ id: "ss", label: "Shadowsocks" },
		{ id: "ssr", label: "SSR" },
		{ id: "hysteria2", label: "Hysteria2" },
		{ id: "tuic", label: "TUIC" },
		{ id: "other", label: "Other" }
	];

	function parseLineSummary(line: string): { protocol: string; name: string } {
		const trimmed = line.trim();
		const schemeIndex = trimmed.indexOf("://");
		if (schemeIndex <= 0) {
			return { protocol: "unknown", name: "unnamed" };
		}

		const protocol = trimmed.slice(0, schemeIndex).toLowerCase();
		const hashIndex = trimmed.lastIndexOf("#");
		if (hashIndex > schemeIndex) {
			const rawName = trimmed.slice(hashIndex + 1);
			try {
				const decoded = decodeURIComponent(rawName);
				return { protocol, name: decoded || "unnamed" };
			} catch {
				return { protocol, name: rawName || "unnamed" };
			}
		}

		if (protocol === "vmess") {
			const payload = trimmed.slice(schemeIndex + 3);
			try {
				const decoded = atob(payload);
				const parsed = JSON.parse(decoded) as { ps?: string };
				if (parsed.ps) {
					return { protocol, name: parsed.ps };
				}
			} catch {
				return { protocol, name: "unnamed" };
			}
		}

		return { protocol, name: "unnamed" };
	}

	function buildPreviewEntries(content: string) {
		const lines = content
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		previewEntries = lines.map((line, index) => {
			const { protocol, name } = parseLineSummary(line);
			return {
				id: `${protocol}-${name}-${index}`,
				line,
				protocol,
				name
			};
		});
	}

	$: if (!initialized) {
		const firstTarget = $appState.publishTargets[0];
		if (firstTarget) {
			loadPublishTarget(firstTarget);
		} else {
			publishTargetRuleId = $appState.aggregates[0]?.id ?? "";
		}
		initialized = true;
	}

	function toggleSelection(list: string[], id: string) {
		return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
	}

	function parseRenameMap(value: string): Record<string, string> {
		const entries = value
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => line.split("=").map((part) => part.trim()));

		return Object.fromEntries(entries.filter((entry) => entry.length === 2));
	}

	function setRuleStatus(message: string, type: "success" | "error") {
		ruleStatus = message;
		ruleStatusType = type;
		if (ruleStatusTimer) {
			clearTimeout(ruleStatusTimer);
		}
		ruleStatusTimer = setTimeout(() => {
			ruleStatus = null;
			ruleStatusType = null;
		}, 2200);
	}

	function setTargetStatus(message: string, type: "success" | "error") {
		targetStatus = message;
		targetStatusType = type;
		if (targetStatusTimer) {
			clearTimeout(targetStatusTimer);
		}
		targetStatusTimer = setTimeout(() => {
			targetStatus = null;
			targetStatusType = null;
		}, 2200);
	}

	onDestroy(() => {
		if (ruleStatusTimer) {
			clearTimeout(ruleStatusTimer);
		}
		if (targetStatusTimer) {
			clearTimeout(targetStatusTimer);
		}
	});

	function toggleType(type: ProxyType) {
		allowedTypes = allowedTypes.includes(type)
			? allowedTypes.filter((item) => item !== type)
			: [...allowedTypes, type];
	}

	function toFileSlug(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	function suggestPublishFile(ruleName: string): string {
		const slug = toFileSlug(ruleName);
		return `${slug || "aggregate"}.txt`;
	}

	function clearPublishOutputState() {
		outputContent = "";
		publishStatus = null;
		publishUrl = null;
		buildWarnings = [];
		buildErrors = [];
	}

	function loadRule(rule: AggregateRule) {
		editingRuleId = rule.id;
		if (!selectedTargetId) {
			publishTargetRuleId = rule.id;
			if (!publishTargetFile || publishTargetFile === "subman-aggregate.txt") {
				publishTargetFile = suggestPublishFile(rule.name);
			}
		}
		ruleName = rule.name;
		selectedNodeIds = [...rule.nodeIds];
		selectedSubscriptionIds = [...rule.subscriptionIds];
		excludeTags = rule.excludeTagIds.join(", ");
		renameMap = Object.entries(rule.renameMap)
			.map(([key, value]) => `${key}=${value}`)
			.join("\n");
		allowedTypes = rule.allowedTypes ?? [];
		previewSummary = "";
		previewContent = "";
		previewLines = 0;
		previewWarnings = [];
		previewErrors = [];
		previewEntries = [];
		previewExpandedLine = null;
		previewStatus = null;
	}

	function resetRuleForm() {
		editingRuleId = "";
		ruleName = "";
		selectedNodeIds = [];
		selectedSubscriptionIds = [];
		excludeTags = "";
		renameMap = "";
		allowedTypes = [];
		previewSummary = "";
		previewContent = "";
		previewLines = 0;
		previewWarnings = [];
		previewErrors = [];
		previewEntries = [];
		previewExpandedLine = null;
		previewStatus = null;
		ruleStatus = null;
		ruleStatusType = null;
		if (ruleStatusTimer) {
			clearTimeout(ruleStatusTimer);
			ruleStatusTimer = null;
		}
	}

	function loadPublishTarget(target: AggregatePublishTarget) {
		selectedTargetId = target.id;
		publishTargetName = target.name;
		publishTargetRuleId = target.ruleId;
		publishTargetFile = target.fileName;
		publishTargetDescription = target.description;
		publishTargetPublic = target.isPublic;
		publishUrl = target.lastPublishedUrl;
		publishStatus = target.lastPublishedAt
			? `Last published at ${target.lastPublishedAt}.`
			: null;
		targetStatus = null;
		targetStatusType = null;
		outputContent = "";
		buildWarnings = [];
		buildErrors = [];
	}

	function resetPublishTargetForm() {
		const firstRule = $appState.aggregates[0];
		selectedTargetId = "";
		publishTargetName = "";
		publishTargetRuleId = firstRule?.id ?? "";
		publishTargetFile = firstRule ? suggestPublishFile(firstRule.name) : "subman-aggregate.txt";
		publishTargetDescription = "SubMan aggregate";
		publishTargetPublic = false;
		targetStatus = null;
		targetStatusType = null;
		clearPublishOutputState();
	}

	async function savePublishTarget() {
		if (targetSaving) {
			return;
		}
		if (!publishTargetRuleId) {
			setTargetStatus("Select a rule for this publish target.", "error");
			return;
		}

		const fileName = publishTargetFile.trim();
		if (!fileName) {
			setTargetStatus("File name is required.", "error");
			return;
		}

		targetSaving = true;
		try {
			const existing = selectedTargetId
				? $appState.publishTargets.find((item) => item.id === selectedTargetId)
				: null;
			const rule = $appState.aggregates.find((item) => item.id === publishTargetRuleId);
			const fallbackName = rule ? `${rule.name} target` : fileName;
			const next: AggregatePublishTarget = {
				id: existing?.id ?? createId("pub"),
				name: publishTargetName.trim() || fallbackName,
				ruleId: publishTargetRuleId,
				fileName,
				description: publishTargetDescription.trim() || "SubMan aggregate",
				isPublic: publishTargetPublic,
				lastPublishedAt: existing?.lastPublishedAt ?? null,
				lastPublishedUrl: existing?.lastPublishedUrl ?? null,
				updatedAt: nowIso()
			};

			upsertPublishTarget(next);
			selectedTargetId = next.id;
			publishTargetName = next.name;
			publishUrl = next.lastPublishedUrl;
			setTargetStatus(existing ? "Publish target updated." : "Publish target saved.", "success");
		} catch {
			setTargetStatus("Failed to save publish target.", "error");
		} finally {
			targetSaving = false;
		}
	}

	function deleteSelectedTarget() {
		if (!selectedTargetId) {
			return;
		}
		const ok = confirm("Delete this publish target? This does not delete gist files.");
		if (!ok) {
			return;
		}
		removePublishTarget(selectedTargetId);
		resetPublishTargetForm();
		publishStatus = "Publish target deleted.";
	}

	function isPublishTargetDirty(target: AggregatePublishTarget) {
		const nextName = publishTargetName.trim() || target.name;
		const nextDescription = publishTargetDescription.trim() || "SubMan aggregate";
		return (
			nextName !== target.name ||
			publishTargetRuleId !== target.ruleId ||
			publishTargetFile.trim() !== target.fileName ||
			nextDescription !== target.description ||
			publishTargetPublic !== target.isPublic
		);
	}

	async function buildPreview() {
		previewStatus = null;
		const selectedNodes = $appState.nodes.filter((node) => selectedNodeIds.includes(node.id));
		const selectedSubs = $appState.subscriptions.filter((sub) =>
			selectedSubscriptionIds.includes(sub.id)
		);

		const lines = [
			`Nodes: ${selectedNodes.map((node) => node.name).join(", ") || "None"}`,
			`Subscriptions: ${selectedSubs.map((sub) => sub.name).join(", ") || "None"}`,
			`Exclude tags: ${excludeTags || "None"}`,
			`Rename map entries: ${Object.keys(parseRenameMap(renameMap)).length}`,
			`Protocols: ${allowedTypes.length > 0 ? allowedTypes.join(", ") : "All"}`
		];

		previewSummary = lines.join("\n");

		previewLoading = true;
		previewWarnings = [];
		previewErrors = [];
		try {
			const rule: AggregateRule = {
				id: "preview",
				name: ruleName || "Preview",
				nodeIds: selectedNodeIds,
				subscriptionIds: selectedSubscriptionIds,
				excludeTagIds: excludeTags
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean),
				renameMap: parseRenameMap(renameMap),
				allowedTypes,
				updatedAt: nowIso()
			};

			const result = await buildAggregateOutput(rule, $appState.nodes, $appState.subscriptions);
			previewContent = result.content;
			previewLines = result.lines;
			previewWarnings = result.warnings;
			previewErrors = result.errors;
			buildPreviewEntries(result.content);
		} finally {
			previewLoading = false;
		}
	}

	async function saveRule() {
		if (ruleSaving) {
			return;
		}

		if (!ruleName.trim()) {
			setRuleStatus("Rule name is required.", "error");
			return;
		}

		ruleSaving = true;
		try {
			const wasEditing = Boolean(editingRuleId);
			const ruleId = editingRuleId || createId("agg");
			const rule: AggregateRule = {
				id: ruleId,
				name: ruleName.trim(),
				nodeIds: selectedNodeIds,
				subscriptionIds: selectedSubscriptionIds,
				excludeTagIds: excludeTags
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean),
				renameMap: parseRenameMap(renameMap),
				allowedTypes,
				updatedAt: nowIso()
			};

			upsertAggregate(rule);
			editingRuleId = ruleId;
			if (!selectedTargetId) {
				publishTargetRuleId = ruleId;
				if (!publishTargetFile || publishTargetFile === "subman-aggregate.txt") {
					publishTargetFile = suggestPublishFile(rule.name);
				}
			}

			setRuleStatus(wasEditing ? "Rule updated." : "Rule saved.", "success");
		} catch {
			setRuleStatus("Failed to save rule.", "error");
		} finally {
			ruleSaving = false;
		}
	}

	async function buildOutput() {
		publishStatus = null;
		publishUrl = selectedTargetId
			? $appState.publishTargets.find((item) => item.id === selectedTargetId)?.lastPublishedUrl ?? null
			: null;
		buildWarnings = [];
		buildErrors = [];

		if (!selectedTargetId) {
			publishStatus = "Save and select a publish target first.";
			return;
		}

		const target = $appState.publishTargets.find((item) => item.id === selectedTargetId);
		if (!target) {
			publishStatus = "Publish target not found.";
			return;
		}
		if (isPublishTargetDirty(target)) {
			publishStatus = "Save target changes before building output.";
			return;
		}

		const rule = $appState.aggregates.find((item) => item.id === target.ruleId);
		if (!rule) {
			publishStatus = "Selected target rule no longer exists.";
			return;
		}

		publishing = true;
		try {
			const result = await buildAggregateOutput(rule, $appState.nodes, $appState.subscriptions);
			outputContent = result.content;
			buildWarnings = result.warnings;
			buildErrors = result.errors;
			publishStatus = result.content
				? `Output ready for ${target.fileName}.`
				: "No output generated.";
		} finally {
			publishing = false;
		}
	}

	async function publishOutput() {
		publishStatus = null;
		publishUrl = null;
		const token = $authState.token;
		if (!token) {
			publishStatus = "Missing GitHub token. Connect first.";
			return;
		}

		if (!selectedTargetId) {
			publishStatus = "Save and select a publish target first.";
			return;
		}
		const target = $appState.publishTargets.find((item) => item.id === selectedTargetId);
		if (!target) {
			publishStatus = "Publish target not found.";
			return;
		}
		if (isPublishTargetDirty(target)) {
			publishStatus = "Save target changes before publishing.";
			return;
		}
		if (!outputContent) {
			await buildOutput();
			if (!outputContent) {
				return;
			}
		}

		publishing = true;
		try {
			const configFile = WORKSPACE_FILE;
			const configContent = exportSyncState($appState);
			let workspaceId = $appState.activeGistId || "";
			let response;

			if (workspaceId) {
				response = await updateGist(token, {
					gistId: workspaceId,
					description: target.description || undefined,
					files: {
						[target.fileName]: { content: outputContent },
						[configFile]: { content: configContent }
					}
				});
			} else {
				response = await createGist(token, {
					description: target.description || "SubMan workspace",
					isPublic: target.isPublic,
					files: {
						[configFile]: { content: configContent },
						[target.fileName]: { content: outputContent }
					}
				});
				workspaceId = response.id;
			}

			const fileMeta = response.files.find((file) => file.filename === target.fileName);
			publishUrl = fileMeta?.rawUrl ?? null;
			const publishedAt = nowIso();

			appState.update((state) => ({
				...state,
				activeGistId: workspaceId,
				activeGistFile: configFile,
				lastUpdated: nowIso()
			}));
			upsertPublishTarget({
				...target,
				lastPublishedAt: publishedAt,
				lastPublishedUrl: publishUrl,
				updatedAt: publishedAt
			});

			publishStatus = publishUrl
				? "Aggregation published."
				: "Aggregation published (raw link unavailable).";
		} catch (err) {
			publishStatus = err instanceof Error ? err.message : "Failed to publish aggregation.";
		} finally {
			publishing = false;
		}
	}

	async function copyLink() {
		if (!publishUrl) {
			return;
		}
		try {
			await navigator.clipboard.writeText(publishUrl);
			publishStatus = "Link copied.";
		} catch {
			publishStatus = "Copy failed.";
		}
	}
</script>

<section class="flex flex-col gap-8">
	<header>
		<h1 class="text-2xl font-semibold">Aggregation Builder</h1>
		<p class="mt-2 text-sm text-slate-300">
			Select nodes and subscriptions, apply filters, and generate a single subscription output.
		</p>
	</header>

	<div class="grid gap-6 lg:grid-cols-3">
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Pick Sources</h2>
			<p class="mt-2 text-xs text-slate-400">Choose individual nodes and subscriptions.</p>
			<div class="mt-4 grid gap-4">
				<div>
					<p class="text-xs uppercase text-slate-400">Nodes</p>
					<div class="mt-2 grid gap-2">
						{#if $appState.nodes.length === 0}
							<p class="text-xs text-slate-500">No nodes available.</p>
						{:else}
							{#each $appState.nodes as node}
								<label class="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={selectedNodeIds.includes(node.id)}
										on:change={() => (selectedNodeIds = toggleSelection(selectedNodeIds, node.id))}
									/>
									{node.name}
								</label>
							{/each}
						{/if}
					</div>
				</div>
				<div>
					<p class="text-xs uppercase text-slate-400">Subscriptions</p>
					<div class="mt-2 grid gap-2">
						{#if $appState.subscriptions.length === 0}
							<p class="text-xs text-slate-500">No subscriptions available.</p>
						{:else}
							{#each $appState.subscriptions as sub}
								<label class="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={selectedSubscriptionIds.includes(sub.id)}
										on:change={() =>
											(selectedSubscriptionIds = toggleSelection(selectedSubscriptionIds, sub.id))}
									/>
									{sub.name}
								</label>
							{/each}
						{/if}
					</div>
				</div>
			</div>
		</div>

		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Rules</h2>
			<p class="mt-2 text-xs text-slate-400">
				Edit names, remove tags, and prepare rename mappings.
			</p>
			<div class="mt-4 grid gap-3">
				<select
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
					value={editingRuleId}
					on:change={(event) => {
						const nextId = event.currentTarget.value;
						if (!nextId) {
							resetRuleForm();
							return;
						}
						const rule = $appState.aggregates.find((item) => item.id === nextId);
						if (rule) {
							loadRule(rule);
						}
					}}
				>
					<option value="">New rule</option>
					{#each $appState.aggregates as rule}
						<option value={rule.id}>{rule.name}</option>
					{/each}
				</select>
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
					placeholder="Rule name"
					bind:value={ruleName}
				/>
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
					placeholder="Exclude tags (comma separated)"
					bind:value={excludeTags}
				/>
				<textarea
					class="min-h-[120px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
					placeholder="Rename map: old=new per line"
					bind:value={renameMap}
				/>
				<div>
					<p class="text-xs uppercase text-slate-400">Protocols</p>
					<div class="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
						{#each protocolOptions as option}
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									checked={allowedTypes.includes(option.id)}
									on:change={() => toggleType(option.id)}
								/>
								{option.label}
							</label>
						{/each}
					</div>
					<p class="mt-2 text-[11px] text-slate-500">
						Leave empty to include all protocols.
					</p>
				</div>
				<div class="flex flex-wrap gap-3">
					<button
						class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold"
						on:click={buildPreview}
					>
						Preview
					</button>
					<button
						class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
						on:click={saveRule}
						disabled={ruleSaving}
					>
						{ruleSaving ? "Saving..." : editingRuleId ? "Update Rule" : "Save Rule"}
					</button>
				</div>
				{#if ruleStatus}
					<p class={ruleStatusType === "error" ? "text-xs text-rose-300" : "text-xs text-emerald-300"}>
						{ruleStatus}
					</p>
				{/if}
			</div>
		</div>

		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Preview</h2>
			<p class="mt-2 text-xs text-slate-400">Processed output for the current selections.</p>
			<pre class="mt-3 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
{previewSummary || "Summary will appear here."}
			</pre>
			<div class="mt-3 min-h-[200px] rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-200">
				{#if previewLoading}
					<p>Building preview...</p>
				{:else if previewEntries.length === 0}
					<p>No output generated.</p>
				{:else}
					<div class="grid gap-2">
						{#each previewEntries as entry}
							<div class="rounded-lg border border-slate-800/80 bg-slate-950/70 px-3 py-2">
								<button
									class="flex w-full items-center justify-between gap-4 text-left text-xs"
									on:click={() => {
										previewExpandedLine =
											previewExpandedLine === entry.line ? null : entry.line;
									}}
								>
									<span class="text-slate-400">{entry.protocol}</span>
									<span class="flex-1 truncate font-semibold text-slate-100">{entry.name}</span>
									<span class="text-slate-500">View</span>
								</button>
								{#if previewExpandedLine === entry.line}
									<div class="mt-2 rounded-md border border-slate-800 bg-slate-900/60 p-2 text-[11px] text-slate-200">
										<p class="break-all">{entry.line}</p>
										<button
											class="mt-2 rounded-full border border-slate-700 px-3 py-1 text-[11px]"
											on:click={async () => {
												try {
													await navigator.clipboard.writeText(entry.line);
													previewStatus = "Line copied.";
												} catch {
													previewStatus = "Copy failed.";
												}
											}}
										>
											Copy Line
										</button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
			<p class="mt-3 text-xs text-slate-400">Lines: {previewLines}</p>
			{#if previewWarnings.length > 0}
				<div class="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
					{#each previewWarnings as warning}
						<p>{warning}</p>
					{/each}
				</div>
			{/if}
			{#if previewErrors.length > 0}
				<div class="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
					{#each previewErrors as err}
						<p>{err}</p>
					{/each}
				</div>
			{/if}
			{#if previewStatus}
				<p class="mt-3 text-xs text-slate-400">{previewStatus}</p>
			{/if}
		</div>
	</div>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<h2 class="text-lg font-semibold">Publish Aggregation</h2>
		<p class="mt-2 text-xs text-slate-400">
			Bind rules to stable output files. Reuse one rule across multiple publish targets.
		</p>
		<div class="mt-4 grid gap-3 text-sm md:grid-cols-2">
			<select
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				value={selectedTargetId}
				on:change={(event) => {
					const nextId = event.currentTarget.value;
					if (!nextId) {
						resetPublishTargetForm();
						return;
					}
					const target = $appState.publishTargets.find((item) => item.id === nextId);
					if (target) {
						loadPublishTarget(target);
					}
				}}
			>
				<option value="">New publish target</option>
				{#each $appState.publishTargets as target}
					<option value={target.id}>{target.name} -> {target.fileName}</option>
				{/each}
			</select>
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="Target name"
				bind:value={publishTargetName}
			/>
			<select
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				value={publishTargetRuleId}
				on:change={(event) => {
					publishTargetRuleId = event.currentTarget.value;
					if (!selectedTargetId) {
						const selectedRule = $appState.aggregates.find(
							(item) => item.id === publishTargetRuleId
						);
						if (selectedRule && publishTargetFile === "subman-aggregate.txt") {
							publishTargetFile = suggestPublishFile(selectedRule.name);
						}
					}
				}}
			>
				<option value="">Select rule</option>
				{#each $appState.aggregates as rule}
					<option value={rule.id}>{rule.name}</option>
				{/each}
			</select>
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="File name (e.g. aggregate.txt)"
				bind:value={publishTargetFile}
			/>
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="Gist description"
				bind:value={publishTargetDescription}
			/>
			<label class="inline-flex items-center gap-2 text-xs text-slate-300">
				<input type="checkbox" class="h-4 w-4" bind:checked={publishTargetPublic} />
				Public gist
			</label>
		</div>
		<div class="mt-4 flex flex-wrap gap-3">
			<button
				class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold disabled:opacity-60"
				on:click={savePublishTarget}
				disabled={targetSaving}
			>
				{targetSaving ? "Saving..." : selectedTargetId ? "Update Target" : "Save Target"}
			</button>
			<button
				class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold disabled:opacity-60"
				on:click={resetPublishTargetForm}
				disabled={targetSaving}
			>
				New Target
			</button>
			<button
				class="rounded-full border border-rose-700 px-4 py-2 text-sm font-semibold text-rose-200 disabled:opacity-40"
				on:click={deleteSelectedTarget}
				disabled={!selectedTargetId || targetSaving}
			>
				Delete Target
			</button>
		</div>
		{#if targetStatus}
			<p class={targetStatusType === "error" ? "mt-3 text-xs text-rose-300" : "mt-3 text-xs text-emerald-300"}>
				{targetStatus}
			</p>
		{/if}
		{#if $appState.activeGistId}
			<p class="mt-3 text-xs text-slate-400">
				Using workspace gist: {$appState.activeGistId} (config file: {$appState.activeGistFile || "subman.json"})
			</p>
		{:else}
			<p class="mt-3 text-xs text-slate-400">
				No workspace gist selected. Publishing will create a new gist containing config and output files.
			</p>
		{/if}
		<div class="mt-4 flex flex-wrap gap-3">
			<button
				class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold"
				on:click={buildOutput}
				disabled={publishing}
			>
				{publishing ? "Building..." : "Build Output"}
			</button>
			<button
				class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950"
				on:click={publishOutput}
				disabled={publishing}
			>
				{publishing ? "Publishing..." : "Publish to Gist"}
			</button>
		</div>
		{#if publishStatus || publishUrl || buildErrors.length > 0 || buildWarnings.length > 0}
			<div class="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-200">
				{#if publishStatus}
					<p class="text-sm font-semibold">{publishStatus}</p>
				{/if}
				{#if buildErrors.length > 0}
					<div class="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
						{#each buildErrors as err}
							<p>{err}</p>
						{/each}
					</div>
				{/if}
				{#if buildWarnings.length > 0}
					<div class="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
						{#each buildWarnings as warning}
							<p>{warning}</p>
						{/each}
					</div>
				{/if}
				{#if publishUrl}
					<div class="mt-3 grid gap-2 text-xs text-slate-300">
						<p>Subscription link</p>
						<div class="flex flex-wrap items-center gap-2">
							<input
								class="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
								readonly
								value={publishUrl}
							/>
							<button
								class="rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold"
								on:click={copyLink}
							>
								Copy Link
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

</section>
