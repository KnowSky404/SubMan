<script lang="ts">
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import { arrowRight, project, server, sync, zap } from "$lib/octicons";
import { appState } from "$lib/stores/app";

$: stats = [
	{
		label: "Nodes",
		href: "/nodes",
		count: $appState.nodes.length,
		icon: server,
	},
	{
		label: "Subscriptions",
		href: "/nodes",
		count: $appState.subscriptions.length,
		icon: sync,
	},
	{
		label: "Rules",
		href: "/aggregate",
		count: $appState.aggregates.length,
		icon: project,
	},
	{
		label: "Publish Targets",
		href: "/aggregate",
		count: $appState.publishTargets.length,
		icon: zap,
	},
];
</script>

<div class="gh-page">
	<header class="gh-page-header">
		<div class="gh-page-heading">
			<h1 class="gh-page-title">{$t("Overview")}</h1>
		</div>
		<div class="gh-page-actions">
			<a href="/nodes" class="gh-btn gh-btn-primary">
				<Octicon icon={server} className="h-4 w-4" />
				{$t("Manage Sources")}
			</a>
		</div>
	</header>

	<div class="gh-layout-main">
		<section class="gh-box">
			<div class="repo-metric-grid">
				{#each stats as stat}
					<a href={stat.href} class="repo-metric">
						<div class="repo-metric-label">
							<Octicon icon={stat.icon} className="h-4 w-4" />
							<span>{$t(stat.label)}</span>
						</div>
						<div class="repo-metric-value">{stat.count}</div>
					</a>
				{/each}
			</div>
		</section>

		<section class="gh-box">
			<div class="gh-box-header">
				<div class="gh-section-title">
					<Octicon icon={project} className="h-4 w-4 text-fg-muted" />
					<span>{$t("Next actions")}</span>
				</div>
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
	</div>
</div>
