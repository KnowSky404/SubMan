<script>
	import { t } from "$lib/i18n";
	import { appState } from "$lib/stores/app";
	import { 
		Zap, 
		ShieldCheck, 
		Globe, 
		RefreshCw, 
		Layers, 
		Network,
		ArrowRight,
		ExternalLink
	} from "lucide-svelte";
	import { fade, fly } from "svelte/transition";

	$: stats = [
		{ label: "Nodes", count: $appState.nodes.length, icon: Globe, color: "text-blue-400" },
		{ label: "Subscriptions", count: $appState.subscriptions.length, icon: RefreshCw, color: "text-emerald-400" },
		{ label: "Aggregates", count: $appState.aggregates.length, icon: Layers, color: "text-purple-400" }
	];

	const features = [
		{
			title: "Workspace Sync",
			desc: "Bind to your fixed Workspace Gist, resolve local and remote conflicts, and keep data in sync across devices.",
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

<div class="space-y-16 pb-20">
	<!-- Hero Section -->
	<section class="relative flex flex-col items-center text-center">
		<div class="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-indigo-400">
			<Zap class="h-3.5 w-3.5 fill-current" />
			<span class="uppercase tracking-widest">{$t("SubMan v0.1")}</span>
		</div>
		
		<h1 class="max-w-4xl text-5xl font-extrabold tracking-tight text-white md:text-7xl">
			{$t("Modern Workspace")}
			<span class="block bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
				{$t("Subscription Hub")}
			</span>
		</h1>
		
		<p class="mt-8 max-w-2xl text-lg text-slate-400 md:text-xl leading-relaxed">
			{$t("Manage nodes, build reusable aggregation rules, and publish stable links directly to your private GitHub Gist.")}
		</p>
		
		<div class="mt-10 flex flex-wrap justify-center gap-4">
			<a 
				href="/auth" 
				class="group flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-4 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-500 hover:shadow-indigo-600/40 active:scale-[0.98]"
			>
				{$t("Connect Workspace")}
				<ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
			</a>
			<a 
				href="/nodes" 
				class="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-8 py-4 text-sm font-bold text-white transition-all hover:bg-slate-800 active:scale-[0.98]"
			>
				{$t("Explore Nodes")}
			</a>
		</div>
	</section>

	<!-- Stats Glace -->
	<section class="grid grid-cols-1 gap-6 sm:grid-cols-3">
		{#each stats as stat, i}
			<div 
				class="group relative overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-900/30 p-8 transition-all hover:border-indigo-500/40"
				in:fly={{ y: 20, delay: 300 + (i * 100), duration: 600 }}
			>
				<div class="absolute -right-4 -top-4 opacity-[0.03] transition-transform group-hover:scale-110">
					<svelte:component this={stat.icon} size={120} />
				</div>
				<div class="flex items-center gap-4">
					<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800/80 group-hover:bg-indigo-500/10 transition-colors">
						<svelte:component this={stat.icon} class={stat.color} />
					</div>
					<div>
						<p class="text-sm font-medium text-slate-500 uppercase tracking-widest">{$t(stat.label)}</p>
						<p class="text-3xl font-bold text-white">{stat.count}</p>
					</div>
				</div>
			</div>
		{/each}
	</section>

	<!-- Features Grid -->
	<section class="space-y-8">
		<div class="text-center">
			<h2 class="text-3xl font-bold text-white">{$t("Powerful Core Features")}</h2>
			<p class="mt-2 text-slate-400">{$t("Everything you need for seamless proxy subscription management")}</p>
		</div>
		
		<div class="grid gap-6 md:grid-cols-3">
			{#each features as feature, i}
				<div 
					class="group flex flex-col rounded-3xl border border-slate-800/60 bg-slate-900/40 p-8 transition-all hover:bg-slate-900/60 hover:shadow-2xl hover:shadow-indigo-500/5"
					in:fly={{ y: 20, delay: 600 + (i * 100), duration: 600 }}
				>
					<div class="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 text-indigo-400 shadow-inner group-hover:from-indigo-500 group-hover:to-violet-600 group-hover:text-white transition-all duration-300">
						<svelte:component this={feature.icon} class="h-6 w-6" />
					</div>
					<h3 class="text-xl font-bold text-white">{$t(feature.title)}</h3>
					<p class="mt-3 flex-grow text-sm leading-relaxed text-slate-400 group-hover:text-slate-300 transition-colors">
						{$t(feature.desc)}
					</p>
					<a 
						href={feature.href} 
						class="mt-8 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-400 transition-all hover:gap-3 hover:text-indigo-300"
					>
						{$t("Open Module")}
						<ArrowRight class="h-3 w-3" />
					</a>
				</div>
			{/each}
		</div>
	</section>

	<!-- Quick Help / Footer-like -->
	<section 
		class="rounded-[2.5rem] border border-indigo-500/10 bg-indigo-500/5 p-12 text-center"
		in:fade={{ delay: 1000 }}
	>
		<h2 class="text-2xl font-bold text-white">{$t("Ready to simplify your workflow?")}</h2>
		<p class="mt-3 text-slate-400">{$t("Connect your GitHub account and start managing your workspace in seconds.")}</p>
		<div class="mt-8">
			<a 
				href="https://github.com/KnowSky404/SubMan/blob/main/README.md" 
				target="_blank"
				class="inline-flex items-center gap-2 rounded-full border border-slate-800 px-6 py-2.5 text-sm font-medium text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
			>
				<ExternalLink class="h-4 w-4" />
				{$t("Documentation")}
			</a>
		</div>
	</section>
</div>
