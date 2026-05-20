<script lang="ts">
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import {
	arrowRight,
	checkCircle,
	database,
	globe,
	link,
	project,
	server,
	shieldCheck,
	sync,
	zap,
} from "$lib/octicons";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { cn } from "$lib/utils/cn";

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

<div class="repo-overview">
	<div class="repo-overview-layout">
		<div class="repo-overview-main">
			<section class="gh-box">
				<div class="overview-panel-header">
					<div class="overview-panel-title">
						<Octicon icon={server} className="h-4 w-4 text-fg-muted" />
						<span>{$t("Workspace activity")}</span>
					</div>
					<span class="gh-label gh-label-muted">4 {$t("items")}</span>
				</div>
				<div class="repo-metric-grid">
					{#each stats as stat}
						<div class="repo-metric">
							<div class="repo-metric-label">
								<Octicon icon={stat.icon} className="h-4 w-4" />
								<span>{$t(stat.label)}</span>
							</div>
							<div class="repo-metric-value">{stat.count}</div>
							<p class="repo-metric-caption">{stat.description}</p>
						</div>
					{/each}
				</div>
			</section>

			<section class="gh-box">
				<div class="overview-panel-header">
					<div class="overview-panel-title">
						<Octicon icon={project} className="h-4 w-4 text-fg-muted" />
						<span>{$t("Next actions")}</span>
					</div>
					<span class="gh-label gh-label-muted">3 {$t("steps")}</span>
				</div>

				<div class="divide-y divide-border-default">
					<div class="repo-workflow-row">
						<div class="repo-workflow-copy">
							<span class="repo-workflow-index">1</span>
							<div class="min-w-0 space-y-1">
								<h2 class="text-sm font-semibold">{$t("Collect sources")}</h2>
								<p class="text-sm text-fg-muted">
									{$t("Add single URIs or upstream subscription URLs.")}
								</p>
							</div>
						</div>
						<a href="/nodes" class="gh-link inline-flex items-center gap-1 text-sm font-medium">
							{$t("Nodes")}
							<Octicon icon={arrowRight} className="h-4 w-4" />
						</a>
					</div>

					<div class="repo-workflow-row">
						<div class="repo-workflow-copy">
							<span class="repo-workflow-index">2</span>
							<div class="min-w-0 space-y-1">
								<h2 class="text-sm font-semibold">{$t("Compose rules")}</h2>
								<p class="text-sm text-fg-muted">
									{$t("Filter, rename, and preview the output set.")}
								</p>
							</div>
						</div>
						<a href="/aggregate" class="gh-link inline-flex items-center gap-1 text-sm font-medium">
							{$t("Aggregate")}
							<Octicon icon={arrowRight} className="h-4 w-4" />
						</a>
					</div>

					<div class="repo-workflow-row">
						<div class="repo-workflow-copy">
							<span class="repo-workflow-index">3</span>
							<div class="min-w-0 space-y-1">
								<h2 class="text-sm font-semibold">{$t("Publish output")}</h2>
								<p class="text-sm text-fg-muted">
									{$t("Write files to the workspace gist and copy raw URLs.")}
								</p>
							</div>
						</div>
						<a href="/gists" class="gh-link inline-flex items-center gap-1 text-sm font-medium">
							{$t("Gists")}
							<Octicon icon={arrowRight} className="h-4 w-4" />
						</a>
					</div>
				</div>
			</section>

			<section class="gh-box">
				<div class="overview-panel-header">
					<div class="overview-panel-title">
						<Octicon icon={globe} className="h-4 w-4 text-fg-muted" />
						<span>{$t("Publish status")}</span>
					</div>
					<span class="gh-counter">{publishTargetCount}</span>
				</div>
				<div class="divide-y divide-border-default">
					<div class="gh-box-row flex items-start gap-3">
						<div class="flex h-8 w-8 items-center justify-center rounded-md border border-border-default bg-canvas-subtle text-fg-muted">
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
						<div class="flex h-8 w-8 items-center justify-center rounded-md border border-border-default bg-canvas-subtle text-fg-muted">
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

		<aside class="repo-overview-sidebar">
			<section class="gh-box">
				<div class="repo-sidebar-section">
					<h2 class="repo-sidebar-title">{$t("Status")}</h2>
					<div class="repo-sidebar-row">
						<span class="repo-sidebar-row-label">{$t("Workspace mode")}</span>
						<span class={cn("badge", isConnected && "badge-success")}>
							{isConnected ? $t("Connected") : $t("Local-only")}
						</span>
					</div>
					<div class="repo-sidebar-row">
						<span class="repo-sidebar-row-label">{$t("Enabled nodes")}</span>
						<span class="font-medium">{enabledNodeCount}</span>
					</div>
					<div class="repo-sidebar-row">
						<span class="repo-sidebar-row-label">{$t("Enabled subscriptions")}</span>
						<span class="font-medium">{enabledSubscriptionCount}</span>
					</div>
					<div class="repo-sidebar-row">
						<span class="repo-sidebar-row-label">{$t("Live links")}</span>
						<span class="font-medium">{publishTargetCount}</span>
					</div>
				</div>

				<div class="repo-sidebar-section">
					<h2 class="repo-sidebar-title">{$t("Sync readiness")}</h2>
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
				</div>

				<div class="repo-sidebar-section">
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
