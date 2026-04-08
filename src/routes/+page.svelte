<script lang="ts">
import { t } from "$lib/i18n";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { cn } from "$lib/utils/cn";
import Octicon from "$lib/components/Octicon.svelte";
import {
	arrowRight,
	checkCircle,
	code,
	database,
	globe,
	link,
	linkExternal,
	project,
	server,
	shieldCheck,
	sync,
	zap,
} from "$lib/octicons";

$: stats = [
	{
		label: "Nodes",
		count: $appState.nodes.length,
		description: "Single proxy URIs in the workspace.",
		icon: server,
	},
	{
		label: "Subscriptions",
		count: $appState.subscriptions.length,
		description: "Remote feeds available for fetch and merge.",
		icon: sync,
	},
	{
		label: "Rules",
		count: $appState.aggregates.length,
		description: "Selection and rename rules.",
		icon: project,
	},
	{
		label: "Publish Targets",
		count: $appState.publishTargets.length,
		description: "Published output files.",
		icon: zap,
	},
];

$: isConnected = Boolean($authState.token && $appState.activeGistId);
$: publishTargetCount = $appState.publishTargets.filter(
	(target) => target.lastPublishedUrl,
).length;
$: enabledNodeCount = $appState.nodes.filter((node) => node.enabled).length;
$: enabledSubscriptionCount = $appState.subscriptions.filter(
	(subscription) => subscription.enabled,
).length;
</script>

<div class="flex flex-col gap-6 pb-10">
	<section class="gh-page-header">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
			<div class="space-y-2">
				<h1 class="gh-page-title">{$t("Repository overview")}</h1>
				<p class="gh-page-subtitle">
					{$t("GitHub-backed nodes, rules, and published subscription files.")}
				</p>
				<div class="gh-page-meta">
					<span class={cn("gh-page-meta-item", isConnected && "badge-success")}>
						{#if isConnected}
							<Octicon icon={shieldCheck} className="h-3.5 w-3.5" />
							{$t("Workspace connected")}
						{:else}
							<Octicon icon={database} className="h-3.5 w-3.5" />
							{$t("Local-only")}
						{/if}
					</span>
					<span class="gh-page-meta-item">
						<Octicon icon={server} className="h-3.5 w-3.5" />
						{$t("{count} enabled nodes", { count: enabledNodeCount })}
					</span>
					<span class="gh-page-meta-item">
						<Octicon icon={sync} className="h-3.5 w-3.5" />
						{$t("{count} enabled subscriptions", { count: enabledSubscriptionCount })}
					</span>
					<span class="gh-page-meta-item">
						<Octicon icon={link} className="h-3.5 w-3.5" />
						{$t("{count} live links", { count: publishTargetCount })}
					</span>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<a href="/gists" class="gh-btn">
					<Octicon icon={code} className="h-4 w-4" />
					{$t("Browse Gist Files")}
				</a>
				<a href="https://github.com/KnowSky404/SubMan" target="_blank" rel="noreferrer" class="gh-btn">
					<Octicon icon={linkExternal} className="h-4 w-4" />
					{$t("View on GitHub")}
				</a>
			</div>
		</div>
	</section>

	<div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_320px]">
		<div class="flex flex-col gap-6">
			<section class="gh-box">
				<div class="gh-box-header">
					<span>{$t("At a glance")}</span>
					<span class="badge">4</span>
				</div>
				<div class="grid grid-cols-1 divide-y divide-border-default md:grid-cols-2 md:divide-x md:divide-y-0">
					{#each stats as stat}
						<div class="flex gap-3 p-3.5">
							<div class="mt-0.5 rounded-md border border-border-default bg-canvas-subtle p-2 text-fg-muted">
								<Octicon icon={stat.icon} className="h-4 w-4" />
							</div>
							<div class="min-w-0 space-y-1">
								<div class="flex items-center gap-2">
									<span class="text-sm font-semibold">{$t(stat.label)}</span>
									<span class="badge">{stat.count}</span>
								</div>
								<p class="text-sm text-fg-muted">{stat.description}</p>
							</div>
						</div>
					{/each}
				</div>
			</section>

			<section class="gh-box">
				<div class="gh-box-header">
					<span>{$t("Workflow")}</span>
					<span class="badge">3 {$t("steps")}</span>
				</div>

				<div class="divide-y divide-border-default">
					<div class="gh-box-row flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<span class="badge">1</span>
								<h2 class="text-sm font-semibold">{$t("Collect sources")}</h2>
							</div>
							<p class="text-sm text-fg-muted">
								{$t("Add single URIs or upstream subscription URLs.")}
							</p>
						</div>
						<a href="/nodes" class="gh-link inline-flex items-center gap-1 text-sm font-medium">
							{$t("Nodes")}
							<Octicon icon={arrowRight} className="h-4 w-4" />
						</a>
					</div>

					<div class="gh-box-row flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<span class="badge">2</span>
								<h2 class="text-sm font-semibold">{$t("Compose rules")}</h2>
							</div>
							<p class="text-sm text-fg-muted">
								{$t("Filter, rename, and preview the output set.")}
							</p>
						</div>
						<a href="/aggregate" class="gh-link inline-flex items-center gap-1 text-sm font-medium">
							{$t("Aggregate")}
							<Octicon icon={arrowRight} className="h-4 w-4" />
						</a>
					</div>

					<div class="gh-box-row flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<span class="badge">3</span>
								<h2 class="text-sm font-semibold">{$t("Publish output")}</h2>
							</div>
							<p class="text-sm text-fg-muted">
								{$t("Write files to the workspace gist and copy raw URLs.")}
							</p>
						</div>
						<a href="/gists" class="gh-link inline-flex items-center gap-1 text-sm font-medium">
							{$t("Gists")}
							<Octicon icon={arrowRight} className="h-4 w-4" />
						</a>
					</div>
				</div>
			</section>

			<section class="gh-box">
				<div class="gh-box-header">
					<span>{$t("Current state")}</span>
					<span class="badge">{publishTargetCount}</span>
				</div>
				<div class="divide-y divide-border-default">
					<div class="gh-box-row flex items-start gap-3">
						<div class="rounded-md border border-border-default bg-canvas-subtle p-2 text-fg-muted">
							<Octicon icon={link} className="h-4 w-4" />
						</div>
						<div class="space-y-1">
							<p class="text-sm font-semibold">{$t("Published links")}</p>
							<p class="text-[13px] text-fg-muted">
								{$t("{count} publish target(s) already have a live raw URL.", { count: publishTargetCount })}
							</p>
						</div>
					</div>

					<div class="gh-box-row flex items-start gap-3">
						<div class="rounded-md border border-border-default bg-canvas-subtle p-2 text-fg-muted">
							<Octicon icon={globe} className="h-4 w-4" />
						</div>
						<div class="space-y-1">
							<p class="text-sm font-semibold">{$t("Last local update")}</p>
							<p class="text-[13px] text-fg-muted">
								{new Date($appState.lastUpdated || Date.now()).toLocaleString()}
							</p>
						</div>
					</div>
				</div>
			</section>
		</div>

		<aside class="flex flex-col gap-6">
			<section class="gh-box">
				<div class="gh-box-header">
					<span>{$t("About")}</span>
				</div>
				<div class="space-y-3 p-4">
					<p class="text-[13px] text-fg-muted">
						{$t("Browser-first subscription manager with gist-backed sync and publish.")}
					</p>

					<div class="space-y-2 text-sm">
						<div class="flex items-center justify-between gap-3">
							<span class="text-fg-muted">{$t("Workspace mode")}</span>
							<span class={cn("badge", isConnected && "badge-success")}>
								{isConnected ? $t("Connected") : $t("Local-only")}
							</span>
						</div>
						<div class="flex items-center justify-between gap-3">
							<span class="text-fg-muted">{$t("Output files")}</span>
							<span class="font-medium">{$appState.publishTargets.length}</span>
						</div>
						<div class="flex items-center justify-between gap-3">
							<span class="text-fg-muted">{$t("Rules ready")}</span>
							<span class="font-medium">{$appState.aggregates.length}</span>
						</div>
					</div>
				</div>
			</section>

			<section
				class={cn(
					"gh-box",
					isConnected ? "border-[color:color-mix(in_srgb,var(--success-emphasis)_24%,var(--border-default))]" : ""
				)}
			>
				<div class="gh-box-header">
					<span>{$t("Workspace status")}</span>
				</div>
				<div class="space-y-3 p-4">
					<div class="flex items-start gap-3">
						<div
							class={cn(
								"rounded-md border p-2",
								isConnected
									? "border-[color:color-mix(in_srgb,var(--success-emphasis)_25%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--success-emphasis)_8%,var(--canvas-default))] text-[color:var(--success-emphasis)]"
									: "border-border-default bg-canvas-subtle text-fg-muted"
							)}
						>
							{#if isConnected}
								<Octicon icon={shieldCheck} className="h-4 w-4" />
							{:else}
								<Octicon icon={database} className="h-4 w-4" />
							{/if}
						</div>
						<div class="space-y-1">
							<p class="text-sm font-semibold">
								{#if isConnected}
									{$t("Workspace connected")}
								{:else}
									{$t("Running in local-only mode")}
								{/if}
							</p>
							<p class="text-[13px] text-fg-muted">
								{#if isConnected}
									{$t("Local changes can sync to the active gist.")}
								{:else}
									{$t("Connect GitHub to sync config and publish shared raw links.")}
								{/if}
							</p>
						</div>
					</div>

					<div class="space-y-2">
						<a href="/auth" class={cn("gh-btn w-full", !isConnected && "gh-btn-primary")}>
							{isConnected ? $t("Manage Workspace") : $t("Connect GitHub")}
						</a>
						<a href="/aggregate" class="gh-btn w-full">
							<Octicon icon={checkCircle} className="h-4 w-4" />
							{$t("Go to Publish")}
						</a>
					</div>
				</div>
			</section>
		</aside>
	</div>
</div>
