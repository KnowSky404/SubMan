<script lang="ts">
import { t } from "$lib/i18n";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { cn } from "$lib/utils/cn";
import {
	Zap,
	RefreshCw,
	Layers,
	Network,
	ArrowRight,
	ExternalLink,
	CheckCircle2,
	ShieldCheck,
	Database,
	FileCode2,
	Link2,
	Globe2,
} from "lucide-svelte";

$: stats = [
	{
		label: "Nodes",
		count: $appState.nodes.length,
		description: "Single proxy URIs stored in the current workspace.",
		icon: Network,
	},
	{
		label: "Subscriptions",
		count: $appState.subscriptions.length,
		description: "Remote feeds that can be fetched and merged.",
		icon: RefreshCw,
	},
	{
		label: "Rules",
		count: $appState.aggregates.length,
		description: "Selection and rewrite rules used for aggregation.",
		icon: Layers,
	},
	{
		label: "Publish Targets",
		count: $appState.publishTargets.length,
		description: "Output files published back into the workspace gist.",
		icon: Zap,
	},
];

$: isConnected = Boolean($authState.token && $appState.activeGistId);
$: publishTargetCount = $appState.publishTargets.filter(
	(target) => target.lastPublishedUrl,
).length;
</script>

<div class="flex flex-col gap-6 pb-10">
	<section class="gh-page-header">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
			<div class="space-y-2">
				<h1 class="gh-page-title">{$t("Repository overview")}</h1>
				<p class="gh-page-subtitle">
					{$t("Manage nodes, compose aggregation rules, and publish stable subscription links from one GitHub-backed workspace.")}
				</p>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<a href="/gists" class="gh-btn">
					<FileCode2 class="h-4 w-4" />
					{$t("Browse Gist Files")}
				</a>
				<a href="https://github.com/KnowSky404/SubMan" target="_blank" rel="noreferrer" class="gh-btn">
					<ExternalLink class="h-4 w-4" />
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
				</div>
				<div class="grid grid-cols-1 divide-y divide-border-default md:grid-cols-2 md:divide-x md:divide-y-0">
					{#each stats as stat}
						<div class="flex gap-3 p-4">
							<div class="mt-0.5 rounded-md border border-border-default bg-canvas-subtle p-2 text-fg-muted">
								<svelte:component this={stat.icon} class="h-4 w-4" />
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
					<span>{$t("Recommended workflow")}</span>
				</div>

				<div class="divide-y divide-border-default">
					<div class="gh-box-row flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<span class="badge">1</span>
								<h2 class="text-sm font-semibold">{$t("Add nodes and subscriptions")}</h2>
							</div>
							<p class="text-sm text-fg-muted">
								{$t("Capture individual proxy URIs or remote subscription URLs before building aggregation rules.")}
							</p>
						</div>
						<a href="/nodes" class="gh-link inline-flex items-center gap-1 text-sm font-medium">
							{$t("Open Nodes")}
							<ArrowRight class="h-4 w-4" />
						</a>
					</div>

					<div class="gh-box-row flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<span class="badge">2</span>
								<h2 class="text-sm font-semibold">{$t("Build aggregation rules")}</h2>
							</div>
							<p class="text-sm text-fg-muted">
								{$t("Choose source sets, exclude tags, and rename nodes to generate a stable output shape.")}
							</p>
						</div>
						<a href="/aggregate" class="gh-link inline-flex items-center gap-1 text-sm font-medium">
							{$t("Open Aggregate")}
							<ArrowRight class="h-4 w-4" />
						</a>
					</div>

					<div class="gh-box-row flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<span class="badge">3</span>
								<h2 class="text-sm font-semibold">{$t("Publish and inspect raw files")}</h2>
							</div>
							<p class="text-sm text-fg-muted">
								{$t("Push outputs into the workspace gist, then inspect or copy the generated raw URLs from the Gists tab.")}
							</p>
						</div>
						<a href="/gists" class="gh-link inline-flex items-center gap-1 text-sm font-medium">
							{$t("Open Gists")}
							<ArrowRight class="h-4 w-4" />
						</a>
					</div>
				</div>
			</section>

			<section class="gh-box">
				<div class="gh-box-header">
					<span>{$t("Workspace snapshot")}</span>
				</div>
				<div class="divide-y divide-border-default">
					<div class="gh-box-row flex items-start gap-3">
						<div class="rounded-md border border-border-default bg-canvas-subtle p-2 text-fg-muted">
							<Link2 class="h-4 w-4" />
						</div>
						<div class="space-y-1">
							<p class="text-sm font-semibold">{$t("Published links")}</p>
							<p class="text-sm text-fg-muted">
								{$t("{count} publish target(s) already have a live raw URL.", { count: publishTargetCount })}
							</p>
						</div>
					</div>

					<div class="gh-box-row flex items-start gap-3">
						<div class="rounded-md border border-border-default bg-canvas-subtle p-2 text-fg-muted">
							<Globe2 class="h-4 w-4" />
						</div>
						<div class="space-y-1">
							<p class="text-sm font-semibold">{$t("Last local update")}</p>
							<p class="text-sm text-fg-muted">
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
				<div class="space-y-4 p-4">
					<p class="text-sm text-fg-muted">
						{$t("Gist-first proxy subscription manager with local fallback storage and direct publishing from the browser.")}
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
				<div class="space-y-4 p-4">
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
								<ShieldCheck class="h-4 w-4" />
							{:else}
								<Database class="h-4 w-4" />
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
							<p class="text-sm text-fg-muted">
								{#if isConnected}
									{$t("Local changes are eligible for automatic sync into the active gist.")}
								{:else}
									{$t("Connect GitHub to sync config and publish stable links from a shared workspace gist.")}
								{/if}
							</p>
						</div>
					</div>

					<div class="space-y-2">
						<a href="/auth" class={cn("gh-btn w-full", !isConnected && "gh-btn-primary")}>
							{isConnected ? $t("Manage Workspace") : $t("Connect GitHub")}
						</a>
						<a href="/aggregate" class="gh-btn w-full">
							<CheckCircle2 class="h-4 w-4" />
							{$t("Go to Publish")}
						</a>
					</div>
				</div>
			</section>
		</aside>
	</div>
</div>
