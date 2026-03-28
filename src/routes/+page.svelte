<script>
	import { t } from "$lib/i18n";
	import { appState } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import { cn } from "$lib/utils/cn";
	import { 
		Zap, 
		ShieldCheck, 
		Globe, 
		RefreshCw, 
		Layers, 
		Network,
		ArrowRight,
		ExternalLink,
		Cloud,
		CloudOff
	} from "lucide-svelte";
	import { fade, fly } from "svelte/transition";

	$: stats = [
		{ label: "Nodes", count: $appState.nodes.length, icon: Globe },
		{ label: "Subscriptions", count: $appState.subscriptions.length, icon: RefreshCw },
		{ label: "Rules", count: $appState.aggregates.length, icon: Layers },
		{ label: "Publish Targets", count: $appState.publishTargets.length, icon: Zap }
	];

	$: isConnected = Boolean($authState.token && $appState.activeGistId);

	const features = [
		{
			title: "Workspace Sync",
			desc: "Bind to your fixed Workspace Gist, resolve local and remote conflicts, and keep data in sync.",
			href: "/auth",
			icon: ShieldCheck
		},
		{
			title: "Node Management",
			desc: "Add or edit single nodes and subscription sources with tags, filters, and quick status toggles.",
			href: "/nodes",
			icon: Network
		},
		{
			title: "Publish Targets",
			desc: "Reuse one rule across multiple output files and keep client links stable with overwrite publishing.",
			href: "/aggregate",
			icon: Zap
		}
	];
</script>

<svelte:head>
	<title>{$t("Overview")} | {$t("SubMan")}</title>
</svelte:head>

<div class="page-stack page-stack--home">
	<section class="hero-layout">
		<div class="surface-card hero-copy" in:fly={{ y: 14, duration: 520 }}>
			<div class="hero-eyebrow">
				<Zap class="h-3.5 w-3.5 fill-current" />
				<span>{$t("SubMan v0.1")}</span>
			</div>

			<h1 class="hero-title">
				{$t("Modern Workspace")}
				<span>{$t("Subscription Hub")}</span>
			</h1>

			<p class="hero-description">
				{$t("Manage nodes, build reusable aggregation rules, and publish stable links directly to your private GitHub Gist.")}
			</p>

			<div class="hero-actions">
				<a href="/auth" class="button-primary group">
					{$t("Connect Workspace")}
					<ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
				</a>
				<a href="/nodes" class="button-secondary">
					{$t("Explore Nodes")}
				</a>
			</div>

			<div class="hero-meta">
				<span class={cn("status-chip", isConnected ? "status-chip--online" : "status-chip--local")}>
					{#if isConnected}
						<Cloud class="h-3.5 w-3.5" />
						<span>{$t("Connected")}</span>
					{:else}
						<CloudOff class="h-3.5 w-3.5" />
						<span>{$t("Local Mode")}</span>
					{/if}
				</span>
				<p class="hero-meta__text">
					{$t("Everything you need for seamless proxy subscription management")}
				</p>
			</div>
		</div>

		<div class="surface-card hero-summary" in:fly={{ y: 14, delay: 120, duration: 520 }}>
			<div class="hero-summary__header">
				<div>
					<p class="section-label">{$t("Overview")}</p>
					<h2 class="hero-summary__title">{$t("Workspace Sync")}</h2>
				</div>
				<span class={cn("status-chip", isConnected ? "status-chip--online" : "status-chip--local")}>
					{#if isConnected}
						<Cloud class="h-3.5 w-3.5" />
						<span>{$t("Connected")}</span>
					{:else}
						<CloudOff class="h-3.5 w-3.5" />
						<span>{$t("Local Mode")}</span>
					{/if}
				</span>
			</div>

			<div class="summary-grid">
				{#each stats as stat}
					<div class="summary-card">
						<div class="summary-card__icon">
							<svelte:component this={stat.icon} class="h-5 w-5" />
						</div>
						<p class="summary-card__label">{$t(stat.label)}</p>
						<p class="summary-card__value">{stat.count}</p>
					</div>
				{/each}
			</div>

			<p class="hero-summary__foot">
				{$t("Use a GitHub token to sync with the workspace gist, or keep data locally.")}
			</p>
		</div>
	</section>

	<section class="space-y-5">
		<div class="section-heading">
			<div>
				<p class="section-label">{$t("Overview")}</p>
				<h2 class="section-heading__title">{$t("Powerful Core Features")}</h2>
			</div>
			<p class="section-heading__text">
				{$t("Everything you need for seamless proxy subscription management")}
			</p>
		</div>

		<div class="feature-grid">
			{#each features as feature, i}
				<div class="surface-card feature-card" in:fly={{ y: 16, delay: 180 + i * 100, duration: 520 }}>
					<div class="feature-icon">
						<svelte:component this={feature.icon} class="h-5 w-5" />
					</div>
					<h3 class="feature-title">{$t(feature.title)}</h3>
					<p class="feature-text">{$t(feature.desc)}</p>
					<a href={feature.href} class="feature-link">
						{$t("Open Module")}
						<ArrowRight class="h-3.5 w-3.5" />
					</a>
				</div>
			{/each}
		</div>
	</section>

	<section class="surface-card cta-card" in:fade={{ delay: 520 }}>
		<div>
			<p class="section-label">{$t("Documentation")}</p>
			<h2 class="cta-card__title">{$t("Ready to simplify your workflow?")}</h2>
			<p class="cta-card__text">
				{$t("Connect your GitHub account and start managing your workspace in seconds.")}
			</p>
		</div>
		<a 
			href="https://github.com/KnowSky404/SubMan/blob/main/README.md" 
			target="_blank"
			rel="noreferrer"
			class="button-secondary"
		>
			<ExternalLink class="h-4 w-4" />
			{$t("Documentation")}
		</a>
	</section>
</div>
