<script lang="ts">
	import { appState, upsertAggregate } from "$lib/stores/app";
	import type { AggregateRule } from "$lib/models";
	import { createId } from "$lib/utils/id";
	import { nowIso } from "$lib/utils/time";

	let ruleName = "";
	let selectedNodeIds: string[] = [];
	let selectedSubscriptionIds: string[] = [];
	let excludeTags = "";
	let renameMap = "";
	let preview = "";

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

	function buildPreview() {
		const selectedNodes = $appState.nodes.filter((node) => selectedNodeIds.includes(node.id));
		const selectedSubs = $appState.subscriptions.filter((sub) =>
			selectedSubscriptionIds.includes(sub.id)
		);

		const lines = [
			`Nodes: ${selectedNodes.map((node) => node.name).join(", ") || "None"}`,
			`Subscriptions: ${selectedSubs.map((sub) => sub.name).join(", ") || "None"}`,
			`Exclude tags: ${excludeTags || "None"}`,
			`Rename map entries: ${Object.keys(parseRenameMap(renameMap)).length}`
		];

		preview = lines.join("\n");
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
			updatedAt: nowIso()
		};

		upsertAggregate(rule);
		ruleName = "";
		selectedNodeIds = [];
		selectedSubscriptionIds = [];
		excludeTags = "";
		renameMap = "";
		preview = "";
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
			<p class="mt-2 text-xs text-slate-400">Quick summary of the current selections.</p>
			<pre class="mt-4 min-h-[200px] whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-200">
				{preview || "Nothing to preview yet."}
			</pre>
		</div>
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
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>
