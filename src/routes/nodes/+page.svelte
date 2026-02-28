<script lang="ts">
	import { onDestroy } from "svelte";
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

	let nodeName = "";
	let nodeType: ProxyType = "vless";
	let nodeRaw = "";
	let nodeTags = "";

	let subName = "";
	let subUrl = "";
	let subTags = "";
	let subscriptionQuery = "";
	let subscriptionFilter: "all" | "enabled" | "disabled" = "all";
	let expandedSubscriptionId: string | null = null;
	let subscriptionStatus: string | null = null;
	let subscriptionStatusTimer: ReturnType<typeof setTimeout> | null = null;

	$: filteredSubscriptions = [...$appState.subscriptions]
		.filter((subscription) =>
			subscriptionFilter === "all"
				? true
				: subscriptionFilter === "enabled"
					? subscription.enabled
					: !subscription.enabled
		)
		.filter((subscription) => {
			const query = subscriptionQuery.trim().toLowerCase();
			if (!query) {
				return true;
			}
			const tags = subscription.tags.map((tag) => tag.label.toLowerCase()).join(" ");
			return (
				subscription.name.toLowerCase().includes(query) ||
				subscription.url.toLowerCase().includes(query) ||
				tags.includes(query)
			);
		})
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	function parseTags(value: string): NodeTag[] {
		return value
			.split(",")
			.map((tag) => tag.trim())
			.filter(Boolean)
			.map((label) => ({ id: createId("tag"), label }));
	}

	function handleAddNode() {
		if (!nodeName || !nodeRaw) {
			return;
		}

		upsertNode({
			id: createId("node"),
			name: nodeName,
			type: nodeType,
			raw: nodeRaw,
			tags: parseTags(nodeTags),
			enabled: true,
			updatedAt: nowIso(),
			source: "single"
		});

		nodeName = "";
		nodeRaw = "";
		nodeTags = "";
	}

	function handleAddSubscription() {
		if (!subName || !subUrl) {
			return;
		}

		upsertSubscription({
			id: createId("sub"),
			name: subName,
			url: subUrl,
			enabled: true,
			tags: parseTags(subTags),
			updatedAt: nowIso()
		});

		subName = "";
		subUrl = "";
		subTags = "";
	}

	function updateNodeField<K extends keyof NodeItem>(nodeId: string, field: K, value: NodeItem[K]) {
		const node = $appState.nodes.find((item) => item.id === nodeId);
		if (!node) {
			return;
		}

		upsertNode({
			...node,
			[field]: value,
			updatedAt: nowIso()
		});
	}

	function updateNodeTags(nodeId: string, value: string) {
		const node = $appState.nodes.find((item) => item.id === nodeId);
		if (!node) {
			return;
		}

		upsertNode({
			...node,
			tags: parseTags(value),
			updatedAt: nowIso()
		});
	}

	function updateSubscriptionField<K extends keyof SubscriptionItem>(
		subscriptionId: string,
		field: K,
		value: SubscriptionItem[K]
	) {
		const subscription = $appState.subscriptions.find((item) => item.id === subscriptionId);
		if (!subscription) {
			return;
		}

		upsertSubscription({
			...subscription,
			[field]: value,
			updatedAt: nowIso()
		});
	}

	function updateSubscriptionTags(subscriptionId: string, value: string) {
		const subscription = $appState.subscriptions.find((item) => item.id === subscriptionId);
		if (!subscription) {
			return;
		}

		upsertSubscription({
			...subscription,
			tags: parseTags(value),
			updatedAt: nowIso()
		});
	}

	function setSubscriptionStatus(message: string) {
		subscriptionStatus = message;
		if (subscriptionStatusTimer) {
			clearTimeout(subscriptionStatusTimer);
		}
		subscriptionStatusTimer = setTimeout(() => {
			subscriptionStatus = null;
		}, 2200);
	}

	function getSubscriptionHost(url: string): string {
		try {
			return new URL(url).host;
		} catch {
			const stripped = url.replace(/^[a-z]+:\/\//i, "");
			return stripped.split(/[/?#]/)[0] || "invalid-url";
		}
	}

	function getVisibleTagLabels(tags: NodeTag[], max: number = 2): string[] {
		return tags.slice(0, max).map((tag) => tag.label);
	}

	function toggleSubscriptionDetails(subscriptionId: string) {
		expandedSubscriptionId =
			expandedSubscriptionId === subscriptionId ? null : subscriptionId;
	}

	async function copySubscriptionUrl(subscription: SubscriptionItem) {
		try {
			await navigator.clipboard.writeText(subscription.url);
			setSubscriptionStatus(`Copied URL for ${subscription.name}.`);
		} catch {
			setSubscriptionStatus("Copy failed.");
		}
	}

	function confirmRemoveSubscription(subscription: SubscriptionItem) {
		const ok = confirm(`Remove subscription "${subscription.name}"?`);
		if (!ok) {
			return;
		}
		if (expandedSubscriptionId === subscription.id) {
			expandedSubscriptionId = null;
		}
		removeSubscription(subscription.id);
		setSubscriptionStatus(`Removed ${subscription.name}.`);
	}

	onDestroy(() => {
		if (subscriptionStatusTimer) {
			clearTimeout(subscriptionStatusTimer);
		}
	});
</script>

<section class="flex flex-col gap-8">
	<header>
		<h1 class="text-2xl font-semibold">Nodes & Subscriptions</h1>
		<p class="mt-2 text-sm text-slate-300">
			Add single nodes or subscription URLs, tag them, and toggle availability.
		</p>
	</header>

	<div class="grid gap-6 lg:grid-cols-2">
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Add Node</h2>
			<div class="mt-4 grid gap-3 text-sm">
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					placeholder="Node name"
					bind:value={nodeName}
				/>
				<select
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					bind:value={nodeType}
				>
					<option value="vless">VLESS</option>
					<option value="vmess">VMess</option>
					<option value="trojan">Trojan</option>
					<option value="ss">Shadowsocks</option>
					<option value="hysteria2">Hysteria2</option>
					<option value="tuic">TUIC</option>
					<option value="other">Other</option>
				</select>
				<textarea
					class="min-h-[90px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					placeholder="Raw node URI"
					bind:value={nodeRaw}
				/>
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					placeholder="Tags (comma separated)"
					bind:value={nodeTags}
				/>
				<button
					class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950"
					on:click={handleAddNode}
				>
					Add Node
				</button>
			</div>
		</div>

		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Add Subscription</h2>
			<div class="mt-4 grid gap-3 text-sm">
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					placeholder="Subscription name"
					bind:value={subName}
				/>
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					placeholder="Subscription URL"
					bind:value={subUrl}
				/>
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					placeholder="Tags (comma separated)"
					bind:value={subTags}
				/>
				<button
					class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950"
					on:click={handleAddSubscription}
				>
					Add Subscription
				</button>
			</div>
		</div>
	</div>

	<div class="grid gap-6 lg:grid-cols-2">
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold">Nodes</h2>
				<span class="text-xs text-slate-400">{$appState.nodes.length} items</span>
			</div>
			<div class="mt-4 grid gap-4">
				{#if $appState.nodes.length === 0}
					<p class="text-sm text-slate-400">No nodes yet.</p>
				{:else}
					{#each $appState.nodes as node}
						<div class="rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
							<div class="flex flex-wrap items-center justify-between gap-3">
								<input
									class="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-sm md:w-1/2"
									value={node.name}
									on:input={(event) => updateNodeField(node.id, "name", event.currentTarget.value)}
								/>
								<select
									class="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs"
									value={node.type}
									on:change={(event) =>
										updateNodeField(node.id, "type", event.currentTarget.value as ProxyType)}
								>
									<option value="vless">VLESS</option>
									<option value="vmess">VMess</option>
									<option value="trojan">Trojan</option>
									<option value="ss">Shadowsocks</option>
									<option value="hysteria2">Hysteria2</option>
									<option value="tuic">TUIC</option>
									<option value="other">Other</option>
								</select>
								<label class="inline-flex items-center gap-2 text-xs text-slate-300">
									<input
										type="checkbox"
										class="h-4 w-4"
										checked={node.enabled}
										on:change={(event) => updateNodeField(node.id, "enabled", event.currentTarget.checked)}
									/>
									Enabled
								</label>
								<button
									class="text-xs text-rose-300 hover:text-rose-200"
									on:click={() => removeNode(node.id)}
								>
									Remove
								</button>
							</div>
							<textarea
								class="mt-3 min-h-[70px] w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs"
								value={node.raw}
								on:input={(event) => updateNodeField(node.id, "raw", event.currentTarget.value)}
							/>
							<input
								class="mt-3 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs"
								value={node.tags.map((tag) => tag.label).join(", ")}
								on:change={(event) => updateNodeTags(node.id, event.currentTarget.value)}
								placeholder="Tags"
							/>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold">Subscriptions</h2>
				<span class="text-xs text-slate-400">{$appState.subscriptions.length} items</span>
			</div>
			<div class="mt-4 grid gap-3">
				<div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
					<input
						class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
						placeholder="Search by name, URL, or tag"
						bind:value={subscriptionQuery}
					/>
					<select
						class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
						bind:value={subscriptionFilter}
					>
						<option value="all">All</option>
						<option value="enabled">Enabled only</option>
						<option value="disabled">Disabled only</option>
					</select>
				</div>
				<div class="flex items-center justify-between text-xs text-slate-400">
					<p>
						Showing {filteredSubscriptions.length} of {$appState.subscriptions.length}
					</p>
					{#if subscriptionStatus}
						<p class="text-sky-300">{subscriptionStatus}</p>
					{/if}
				</div>
				{#if $appState.subscriptions.length === 0}
					<p class="text-sm text-slate-400">No subscriptions yet.</p>
				{:else if filteredSubscriptions.length === 0}
					<p class="text-sm text-slate-400">No subscriptions match current filters.</p>
				{:else}
					{#each filteredSubscriptions as subscription}
						<div class="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-3">
							<div class="flex flex-wrap items-center gap-2">
								<label class="inline-flex items-center gap-2 text-xs text-slate-300">
									<input
										type="checkbox"
										class="h-4 w-4"
										checked={subscription.enabled}
										on:change={(event) =>
											updateSubscriptionField(subscription.id, "enabled", event.currentTarget.checked)}
									/>
									Enabled
								</label>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-semibold text-slate-100">{subscription.name}</p>
									<p class="truncate text-[11px] text-slate-400" title={subscription.url}>
										{getSubscriptionHost(subscription.url)}
									</p>
								</div>
								{#if subscription.tags.length > 0}
									<div class="hidden items-center gap-1 text-[11px] text-slate-300 md:flex">
										{#each getVisibleTagLabels(subscription.tags) as label}
											<span class="rounded-full border border-slate-700 px-2 py-0.5">{label}</span>
										{/each}
										{#if subscription.tags.length > 2}
											<span class="rounded-full border border-slate-700 px-2 py-0.5">
												+{subscription.tags.length - 2}
											</span>
										{/if}
									</div>
								{/if}
								<div class="flex items-center gap-2">
									<button
										class="rounded-full border border-slate-700 px-3 py-1 text-xs"
										on:click={() => copySubscriptionUrl(subscription)}
									>
										Copy
									</button>
									<button
										class="rounded-full border border-slate-700 px-3 py-1 text-xs"
										on:click={() => toggleSubscriptionDetails(subscription.id)}
									>
										{expandedSubscriptionId === subscription.id ? "Hide" : "Details"}
									</button>
									<button
										class="rounded-full border border-rose-700 px-3 py-1 text-xs text-rose-300"
										on:click={() => confirmRemoveSubscription(subscription)}
									>
										Delete
									</button>
								</div>
							</div>
							{#if expandedSubscriptionId === subscription.id}
								<div class="mt-3 grid gap-2 border-t border-slate-800/80 pt-3">
									<input
										class="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-sm"
										value={subscription.name}
										on:input={(event) =>
											updateSubscriptionField(subscription.id, "name", event.currentTarget.value)}
										placeholder="Subscription name"
									/>
									<input
										class="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs"
										value={subscription.url}
										on:input={(event) =>
											updateSubscriptionField(subscription.id, "url", event.currentTarget.value)}
										placeholder="Subscription URL"
									/>
									<input
										class="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs"
										value={subscription.tags.map((tag) => tag.label).join(", ")}
										on:change={(event) =>
											updateSubscriptionTags(subscription.id, event.currentTarget.value)}
										placeholder="Tags (comma separated)"
									/>
									<p class="text-[11px] text-slate-500">Updated: {subscription.updatedAt}</p>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</section>
