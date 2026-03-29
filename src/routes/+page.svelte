<script>
	import { t } from "$lib/i18n";
	import { appState } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import { cn } from "$lib/utils/cn";
	import { 
		Zap, 
		Globe, 
		RefreshCw, 
		Layers, 
		Network,
		ArrowRight,
		ExternalLink,
		Package,
		Star,
		GitFork,
		Info,
		CheckCircle2,
		ShieldCheck,
		Database
	} from "lucide-svelte";
	import { fade } from "svelte/transition";

	$: stats = [
		{ label: "Nodes", count: $appState.nodes.length, icon: Globe, color: "text-blue-500" },
		{ label: "Subscriptions", count: $appState.subscriptions.length, icon: RefreshCw, color: "text-green-500" },
		{ label: "Rules", count: $appState.aggregates.length, icon: Layers, color: "text-purple-500" },
		{ label: "Publish Targets", count: $appState.publishTargets.length, icon: Zap, color: "text-orange-500" }
	];

	$: isConnected = Boolean($authState.token && $appState.activeGistId);
</script>

<div class="flex flex-col gap-8 pb-10">
	<!-- Repository Header Style -->
	<div class="flex flex-col gap-4">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex items-center gap-2 text-xl">
				<Package class="h-5 w-5 text-fg-muted" />
				<span class="text-accent-fg hover:underline cursor-pointer">KnowSky404</span>
				<span class="text-fg-muted">/</span>
				<span class="font-bold">SubMan</span>
				<span class="badge ml-2">Public</span>
			</div>
			<div class="flex items-center gap-2">
				<button class="gh-btn gh-btn-sm"><Star class="h-3.5 w-3.5 mr-1" />Star<span class="ml-2 px-1.5 py-0.5 rounded-full bg-canvas-subtle border border-border-default text-[10px]">12</span></button>
				<button class="gh-btn gh-btn-sm"><GitFork class="h-3.5 w-3.5 mr-1" />Fork</button>
			</div>
		</div>
		
		<p class="text-base text-fg-default">
			{$t("Gist-first proxy subscription manager. Manage nodes, build aggregation rules, and publish stable links.")}
		</p>

		<div class="flex flex-wrap gap-4 text-xs text-fg-muted">
			<div class="flex items-center gap-1"><div class="h-3 w-3 rounded-full bg-orange-500"></div> Svelte</div>
			<div class="flex items-center gap-1"><Star class="h-3.5 w-3.5" /> AGPL v3 License</div>
			<div class="flex items-center gap-1"><Info class="h-3.5 w-3.5" /> Last updated: {new Date($appState.lastUpdated || Date.now()).toLocaleDateString()}</div>
		</div>
	</div>

	<!-- Connection Status Box -->
	<div class={cn("gh-box p-4 flex flex-col sm:flex-row items-center justify-between gap-4", isConnected ? "bg-green-50/30 border-green-200 dark:bg-green-900/10" : "bg-canvas-subtle")}>
		<div class="flex items-center gap-3 text-sm">
			{#if isConnected}
				<div class="h-8 w-8 flex items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"><ShieldCheck class="h-5 w-5" /></div>
				<div>
					<p class="font-bold">{$t("Workspace Connected")}</p>
					<p class="text-xs text-fg-muted">{$appState.activeGistId}</p>
				</div>
			{:else}
				<div class="h-8 w-8 flex items-center justify-center rounded-full bg-gray-200 text-fg-muted dark:bg-gray-800"><Database class="h-5 w-5" /></div>
				<div>
					<p class="font-bold">{$t("Local-only Mode")}</p>
					<p class="text-xs text-fg-muted">{$t("Connect GitHub to enable cloud sync and stable links.")}</p>
				</div>
			{/if}
		</div>
		<a href="/auth" class={cn("gh-btn", !isConnected && "gh-btn-primary")}>
			{isConnected ? $t("Manage Workspace") : $t("Setup GitHub")}
		</a>
	</div>

	<!-- Stats Grid -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
		{#each stats as stat}
			<div class="gh-box p-4 flex flex-col gap-1 hover:border-accent-emphasis transition-colors cursor-default">
				<div class="flex items-center justify-between">
					<span class="text-xs font-bold text-fg-muted uppercase tracking-wider">{$t(stat.label)}</span>
					<svelte:component this={stat.icon} class={cn("h-4 w-4", stat.color)} />
				</div>
				<span class="text-2xl font-bold">{stat.count}</span>
			</div>
		{/each}
	</div>

	<!-- Getting Started -->
	<div class="flex flex-col gap-4">
		<h2 class="text-lg font-bold">{$t("Quick Start Guide")}</h2>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div class="gh-box p-4 flex flex-col gap-3">
				<div class="flex items-center gap-2 font-bold text-sm"><Network class="h-4 w-4" /> 1. {$t("Add Nodes")}</div>
				<p class="text-xs text-fg-muted leading-relaxed">{$t("Import single nodes or subscription links in the Nodes module.")}</p>
				<a href="/nodes" class="text-xs text-accent-fg font-semibold hover:underline flex items-center gap-1">{$t("Go to Nodes")} <ArrowRight class="h-3 w-3" /></a>
			</div>
			<div class="gh-box p-4 flex flex-col gap-3">
				<div class="flex items-center gap-2 font-bold text-sm"><Layers class="h-4 w-4" /> 2. {$t("Create Rules")}</div>
				<p class="text-xs text-fg-muted leading-relaxed">{$t("Compose rules to filter and rename nodes from multiple sources.")}</p>
				<a href="/aggregate" class="text-xs text-accent-fg font-semibold hover:underline flex items-center gap-1">{$t("Go to Aggregate")} <ArrowRight class="h-3 w-3" /></a>
			</div>
			<div class="gh-box p-4 flex flex-col gap-3">
				<div class="flex items-center gap-2 font-bold text-sm"><Zap class="h-4 w-4" /> 3. {$t("Publish Link")}</div>
				<p class="text-xs text-fg-muted leading-relaxed">{$t("Bind rules to a Gist file to generate a permanent subscription URL.")}</p>
				<a href="/aggregate" class="text-xs text-accent-fg font-semibold hover:underline flex items-center gap-1">{$t("View Targets")} <ArrowRight class="h-3 w-3" /></a>
			</div>
		</div>
	</div>

	<!-- Community & Docs -->
	<div class="gh-box bg-canvas-subtle p-6 flex flex-col md:flex-row items-center justify-between gap-6 border-dashed">
		<div>
			<h3 class="font-bold text-lg">{$t("Documentation & Support")}</h3>
			<p class="text-sm text-fg-muted">{$t("Learn more about SubMan's features and how to host it yourself.")}</p>
		</div>
		<div class="flex gap-3">
			<a href="https://github.com/KnowSky404/SubMan" target="_blank" class="gh-btn"><ExternalLink class="h-4 w-4 mr-2" /> {$t("View on GitHub")}</a>
		</div>
	</div>
</div>
