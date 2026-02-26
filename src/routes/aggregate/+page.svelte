<script lang="ts">
	import { appState, upsertAggregate } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import type { AggregateRule, ProxyType } from "$lib/models";
	import { buildAggregateOutput } from "$lib/aggregate";
	import { createGist, updateGist } from "$lib/gist";
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

	let publishRuleId = "";
	let publishGistId = "";
	let publishFile = "subman-aggregate.txt";
	let publishDescription = "SubMan aggregate";
	let publishPublic = false;
	let outputContent = "";
	let outputPreview = "";
	let outputLines = 0;
	let publishStatus: string | null = null;
	let publishUrl: string | null = null;
	let buildWarnings: string[] = [];
	let buildErrors: string[] = [];
	let publishing = false;
	let initialized = false;
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

	$: if (!initialized) {
		publishRuleId = $appState.aggregates[0]?.id ?? "";
		publishGistId = $appState.activeGistId ?? "";
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

	function toggleType(type: ProxyType) {
		allowedTypes = allowedTypes.includes(type)
			? allowedTypes.filter((item) => item !== type)
			: [...allowedTypes, type];
	}

	async function buildPreview() {
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
		} finally {
			previewLoading = false;
		}
	}

	function saveRule() {
		if (!ruleName) {
			return;
		}

		const rule: AggregateRule = {
			id: createId("agg"),
			name: ruleName,
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
	}

	function selectPublishRule(id: string) {
		publishRuleId = id;
		const rule = $appState.aggregates.find((item) => item.id === id);
		if (rule && outputContent === "") {
			const slug = rule.name.trim().toLowerCase().replace(/\s+/g, "-");
			if (slug) {
				publishFile = `${slug || "aggregate"}.txt`;
			}
		}
	}

	async function buildOutput() {
		publishStatus = null;
		publishUrl = null;
		buildWarnings = [];
		buildErrors = [];

		const rule = $appState.aggregates.find((item) => item.id === publishRuleId);
		if (!rule) {
			publishStatus = "Select an aggregation rule first.";
			return;
		}

		publishing = true;
		try {
			const result = await buildAggregateOutput(rule, $appState.nodes, $appState.subscriptions);
			outputContent = result.content;
			outputLines = result.lines;
			buildWarnings = result.warnings;
			buildErrors = result.errors;
			outputPreview = result.content.split("\n").slice(0, 24).join("\n");
			publishStatus = result.content ? "Output ready." : "No output generated.";
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
		if (!publishFile) {
			publishStatus = "File name is required.";
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
			let targetId = publishGistId;
			let response;

			if (targetId) {
				response = await updateGist(token, {
					gistId: targetId,
					description: publishDescription || undefined,
					files: {
						[publishFile]: { content: outputContent }
					}
				});
			} else {
				response = await createGist(token, {
					description: publishDescription || "SubMan aggregate",
					isPublic: publishPublic,
					files: {
						[publishFile]: { content: outputContent }
					}
				});
				targetId = response.id;
				publishGistId = response.id;
			}

			const fileMeta = response.files.find((file) => file.filename === publishFile);
			publishUrl = fileMeta?.rawUrl ?? null;

			appState.update((state) => ({
				...state,
				activeGistId: targetId,
				lastUpdated: nowIso()
			}));

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
						class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950"
						on:click={saveRule}
					>
						Save Rule
					</button>
				</div>
			</div>
		</div>

		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Preview</h2>
			<p class="mt-2 text-xs text-slate-400">Processed output for the current selections.</p>
			<pre class="mt-3 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
{previewSummary || "Summary will appear here."}
			</pre>
			<pre class="mt-3 min-h-[200px] whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-200">
{previewLoading ? "Building preview..." : previewContent || "No output generated."}
			</pre>
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
		</div>
	</div>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<h2 class="text-lg font-semibold">Publish Aggregation</h2>
		<p class="mt-2 text-xs text-slate-400">
			Generate output from a saved rule and write it to a gist file.
		</p>
		<div class="mt-4 grid gap-3 text-sm md:grid-cols-2">
			<select
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				value={publishRuleId}
				on:change={(event) => selectPublishRule(event.currentTarget.value)}
			>
				<option value="">Select rule</option>
				{#each $appState.aggregates as rule}
					<option value={rule.id}>{rule.name}</option>
				{/each}
			</select>
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="Gist ID (leave empty to create)"
				bind:value={publishGistId}
			/>
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="File name (e.g. aggregate.txt)"
				bind:value={publishFile}
			/>
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="Gist description"
				bind:value={publishDescription}
			/>
			<label class="inline-flex items-center gap-2 text-xs text-slate-300">
				<input type="checkbox" class="h-4 w-4" bind:checked={publishPublic} />
				Public gist
			</label>
		</div>
		<div class="mt-4 flex flex-wrap gap-3">
			<button
				class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold"
				on:click={buildOutput}
				disabled={publishing}
			>
				{publishing ? "Working..." : "Generate Output"}
			</button>
			<button
				class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950"
				on:click={publishOutput}
				disabled={publishing}
			>
				{publishing ? "Publishing..." : "Publish to Gist"}
			</button>
			{#if publishUrl}
				<button class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold" on:click={copyLink}>
					Copy Link
				</button>
			{/if}
		</div>
		{#if publishStatus}
			<p class="mt-3 text-xs text-slate-300">{publishStatus}</p>
		{/if}
		{#if buildWarnings.length > 0}
			<div class="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
				{#each buildWarnings as warning}
					<p>{warning}</p>
				{/each}
			</div>
		{/if}
		{#if buildErrors.length > 0}
			<div class="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
				{#each buildErrors as err}
					<p>{err}</p>
				{/each}
			</div>
		{/if}
		<div class="mt-4 grid gap-3 md:grid-cols-2">
			<div class="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
				<p>Lines: {outputLines}</p>
				<p>Preview:</p>
				<pre class="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap">{outputPreview || "No output"}</pre>
			</div>
			<textarea
				class="min-h-[220px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs"
				placeholder="Generated content"
				bind:value={outputContent}
			/>
		</div>
		{#if publishUrl}
			<p class="mt-3 text-xs text-slate-300">Subscription link: {publishUrl}</p>
		{/if}
	</div>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold">Saved Aggregations</h2>
			<span class="text-xs text-slate-400">{$appState.aggregates.length} rules</span>
		</div>
		<div class="mt-4 grid gap-3">
			{#if $appState.aggregates.length === 0}
				<p class="text-sm text-slate-400">No saved rules yet.</p>
			{:else}
				{#each $appState.aggregates as rule}
					<div class="rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
						<p class="text-sm font-semibold">{rule.name}</p>
						<p class="mt-2 text-xs text-slate-400">
							{rule.nodeIds.length} nodes, {rule.subscriptionIds.length} subscriptions
						</p>
						<p class="mt-1 text-xs text-slate-500">
							Protocols: {rule.allowedTypes?.length ? rule.allowedTypes.join(", ") : "All"}
						</p>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>
