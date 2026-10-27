<script lang="ts">
import Octicon from "$lib/components/Octicon.svelte";
import { locale, t } from "$lib/i18n";
import type { AppState } from "$lib/models";
import {
	arrowRight,
	fileCode,
	project,
	server,
	sync,
	zap,
} from "$lib/octicons";
import { appState } from "$lib/stores/app";
import { getBrowserWorkspaceBinding } from "$lib/workspace-persistence-browser";
import { workspaceSyncStatus } from "$lib/workspace-sync-status";

$: hasResources =
	$appState.nodes.length +
		$appState.subscriptions.length +
		$appState.aggregates.length +
		$appState.publishTargets.length +
		$appState.clientExports.length >
	0;
$: nextAction =
	!$appState.nodes.length && !$appState.subscriptions.length
		? {
				href: "/nodes",
				label: "Collect sources",
				description: "Add sources to start composing rules.",
			}
		: !$appState.aggregates.length
			? {
					href: "/aggregate",
					label: "Compose rules",
					description:
						"Your sources are ready. Compose a rule to filter and organize them.",
				}
			: {
					href: "/aggregate",
					label: "Aggregate",
					description:
						"Preview your rules, then publish the output when it is ready.",
				};
$: recentResources = [
	...$appState.nodes.map((item) => ({
		...item,
		kind: "Nodes",
		href: "/nodes",
		icon: server,
	})),
	...$appState.subscriptions.map((item) => ({
		...item,
		kind: "Subscriptions",
		href: "/nodes",
		icon: sync,
	})),
	...$appState.aggregates.map((item) => ({
		...item,
		kind: "Rules",
		href: "/aggregate",
		icon: project,
	})),
]
	.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
	.slice(0, 5);

function confirmedOutputs(state: AppState, _revision: number | null) {
	const binding = getBrowserWorkspaceBinding();
	if (!binding || binding.gistId !== state.activeGistId || !binding.baseline)
		return [];
	return [
		...binding.baseline.data.publishTargets.map((item) => ({
			...item,
			href: "/aggregate",
			kind: "Aggregate",
		})),
		...binding.baseline.data.clientExports.map((item) => ({
			...item,
			href: "/exports",
			kind: "Exports",
		})),
	]
		.sort((a, b) =>
			(b.lastPublishedAt ?? "").localeCompare(a.lastPublishedAt ?? ""),
		)
		.slice(0, 5);
}

$: outputs = confirmedOutputs(
	$appState,
	$workspaceSyncStatus.lastCommittedRevision,
);

function formatDate(value: string, language: string) {
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? "—"
		: new Intl.DateTimeFormat(language, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			}).format(date);
}

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

		{#if hasResources}
		<div class="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
			<section class="gh-box" aria-labelledby="recent-resources-heading">
				<div class="gh-box-header"><h2 id="recent-resources-heading">{$t("Recently updated")}</h2><a href="/nodes" class="gh-link text-xs font-normal">{$t("Manage Sources")}</a></div>
				{#each recentResources as resource (`${resource.kind}:${resource.id}`)}
					<a href={resource.href} class="gh-box-row flex items-start gap-3">
						<Octicon icon={resource.icon} className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
						<div class="min-w-0 flex-1"><div class="truncate font-semibold text-accent-fg">{resource.name}</div><div class="gh-list-meta"><span>{$t(resource.kind)}</span><time datetime={resource.updatedAt}>{formatDate(resource.updatedAt, $locale)}</time></div></div>
						<Octicon icon={arrowRight} className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
					</a>
				{:else}
					<p class="p-4 text-sm text-fg-muted">{$t("Add sources to start composing rules.")}</p>
				{/each}
			</section>
			<section class="gh-box" aria-labelledby="publication-heading">
				<div class="gh-box-header"><h2 id="publication-heading">{$t("Publication targets")}</h2><a href="/gists" class="gh-link text-xs font-normal">{$t("View files")}</a></div>
				{#each outputs as output (`${output.kind}:${output.id}`)}
					<a href={output.href} class="gh-box-row flex items-start gap-3">
						<Octicon icon={fileCode} className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
						<div class="min-w-0 flex-1"><div class="truncate font-semibold text-accent-fg">{output.name}</div><div class="truncate font-mono text-xs text-fg-muted">{output.fileName}</div><div class="gh-list-meta">{#if output.lastPublishedAt && output.lastPublishedUrl}<span>{$t("Last published")}</span><time datetime={output.lastPublishedAt}>{formatDate(output.lastPublishedAt, $locale)}</time>{:else}<span>{$t("Not published")}</span>{/if}</div></div>
						<Octicon icon={arrowRight} className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
					</a>
				{:else}
					<div class="space-y-3 p-4"><p class="text-sm text-fg-muted">{$t("Create a publish target or client export to keep a stable output file.")}</p><a href={$appState.aggregates.length ? "/exports" : "/aggregate"} class="gh-link text-sm">{$t($appState.aggregates.length ? "Create client export" : "Compose rules")} →</a></div>
				{/each}
			</section>
		</div>
		<div class="gh-section flex flex-wrap items-center justify-between gap-3 p-4">
			<div><h2 class="text-sm font-semibold">{$t("Continue your workflow")}</h2><p class="mt-1 text-xs text-fg-muted">{$t(nextAction.description)}</p></div>
			<a href={nextAction.href} class="gh-btn">{$t(nextAction.label)}<Octicon icon={arrowRight} className="h-4 w-4" /></a>
		</div>
		{:else}


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
		{/if}
	</div>
</div>
