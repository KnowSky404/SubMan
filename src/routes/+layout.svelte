<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { fade, fly } from "svelte/transition";
	import { locale, t } from "$lib/i18n";
	import { startAutoSync } from "$lib/sync";
	import { authState } from "$lib/stores/auth";
	import { appState } from "$lib/stores/app";
	import { confirmDialog, resolveConfirm } from "$lib/stores/confirm";
	import { cn } from "$lib/utils/cn";
	import { 
		LayoutDashboard, 
		Layers, 
		Network, 
		Zap, 
		Settings, 
		Github, 
		Languages,
		Menu,
		X,
		Cloud,
		CloudOff,
		AlertTriangle
	} from "lucide-svelte";

	const PROJECT_GITHUB_URL = "https://github.com/KnowSky404/SubMan";
	
	const navItems = [
		{ href: "/", label: "Overview", icon: LayoutDashboard },
		{ href: "/gists", label: "Gists", icon: Layers },
		{ href: "/nodes", label: "Nodes", icon: Network },
		{ href: "/aggregate", label: "Aggregate", icon: Zap },
		{ href: "/auth", label: "Workspace", icon: Settings }
	];

	let isMobileMenuOpen = false;

	$: pathname = $page.url.pathname;
	$: isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
	$: isConnected = !!($authState.token && $appState.activeGistId);

	function handleLocaleChange(nextLocale: string) {
		if (nextLocale === "en" || nextLocale === "zh-CN") {
			locale.set(nextLocale);
		}
	}

	function toggleMobileMenu() {
		isMobileMenuOpen = !isMobileMenuOpen;
	}

	function handleDialogKeydown(event: KeyboardEvent) {
		if (!$confirmDialog.open) {
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			resolveConfirm(false);
		}
	}

	onMount(() => startAutoSync());
</script>

<svelte:window on:keydown={handleDialogKeydown} />

<div class="relative min-h-screen bg-[#020617] text-slate-200 selection:bg-indigo-500/30 selection:text-indigo-200">
	<!-- Background Effects -->
	<div class="pointer-events-none fixed inset-0 overflow-hidden">
		<div class="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-indigo-500/10 blur-[120px]"></div>
		<div class="absolute top-[20%] -right-[10%] h-[30%] w-[30%] rounded-full bg-blue-500/10 blur-[100px]"></div>
		<div class="absolute -bottom-[10%] left-[20%] h-[40%] w-[40%] rounded-full bg-purple-500/10 blur-[120px]"></div>
	</div>

	<!-- Header -->
	<header class="sticky top-0 z-50 border-b border-slate-800/40 bg-[#020617]/80 backdrop-blur-xl">
		<div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
			<!-- Logo & Status -->
			<div class="flex items-center gap-4">
				<a href="/" class="group flex items-center gap-2.5 transition-opacity hover:opacity-90">
					<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-lg shadow-indigo-500/20">
						<Zap class="h-5 w-5 text-white fill-white/20" />
					</div>
					<div class="hidden flex-col leading-tight sm:flex">
						<span class="text-sm font-bold tracking-tight text-white">SubMan</span>
						<span class="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{$t("Manager")}</span>
					</div>
				</a>

				<div class={cn(
					"flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
					isConnected ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
				)}>
					{#if isConnected}
						<Cloud class="h-3 w-3" />
						<span class="hidden sm:inline">{$t("Connected")}</span>
					{:else}
						<CloudOff class="h-3 w-3" />
						<span class="hidden sm:inline">{$t("Local Mode")}</span>
					{/if}
				</div>
			</div>

			<!-- Desktop Nav -->
			<nav class="hidden items-center gap-1 md:flex">
				{#each navItems as item}
					<a
						href={item.href}
						class={cn(
							"group relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
							isActive(item.href) 
								? "text-white" 
								: "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
						)}
					>
						<svelte:component this={item.icon} class={cn("h-4 w-4", isActive(item.href) ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-400")} />
						{$t(item.label)}
						{#if isActive(item.href)}
							<div class="absolute bottom-0 left-3 right-3 h-0.5 bg-indigo-500/50 rounded-full" in:fade></div>
						{/if}
					</a>
				{/each}

				<div class="mx-2 h-4 w-px bg-slate-800"></div>

				<div class="flex items-center gap-2">
					<!-- Language Selector -->
					<div class="relative group">
						<button class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 transition-colors">
							<Languages class="h-4.5 w-4.5" />
						</button>
						<div class="absolute right-0 mt-1 hidden w-32 origin-top-right flex-col rounded-xl border border-slate-800 bg-[#0f172a] p-1 shadow-2xl group-focus-within:flex group-hover:flex">
							<button 
								class={cn("flex w-full items-center px-3 py-2 text-xs font-medium rounded-lg transition-colors", $locale === 'en' ? "bg-indigo-500/10 text-indigo-400" : "text-slate-400 hover:bg-slate-800/50")}
								on:click={() => handleLocaleChange('en')}
							>
								English
							</button>
							<button 
								class={cn("flex w-full items-center px-3 py-2 text-xs font-medium rounded-lg transition-colors", $locale === 'zh-CN' ? "bg-indigo-500/10 text-indigo-400" : "text-slate-400 hover:bg-slate-800/50")}
								on:click={() => handleLocaleChange('zh-CN')}
							>
								简体中文
							</button>
						</div>
					</div>

					<!-- GitHub -->
					<a
						href={PROJECT_GITHUB_URL}
						target="_blank"
						rel="noreferrer"
						class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 transition-colors"
						title="GitHub"
					>
						<Github class="h-4.5 w-4.5" />
					</a>
				</div>
			</nav>

			<!-- Mobile Menu Button -->
			<button 
				class="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 md:hidden"
				on:click={toggleMobileMenu}
			>
				{#if isMobileMenuOpen}
					<X class="h-5 w-5" />
				{:else}
					<Menu class="h-5 w-5" />
				{/if}
			</button>
		</div>
	</header>

	<!-- Mobile Nav -->
	{#if isMobileMenuOpen}
		<button
			type="button"
			aria-label="Close menu"
			class="fixed inset-0 z-40 bg-[#020617]/60 backdrop-blur-md md:hidden"
			on:click={toggleMobileMenu}
			transition:fade={{ duration: 200 }}
		></button>
		<nav 
			class="fixed inset-y-0 right-0 z-50 w-64 border-l border-slate-800 bg-[#0f172a] p-6 shadow-2xl md:hidden"
			transition:fly={{ x: 300, duration: 300 }}
		>
			<div class="flex flex-col gap-6">
				<div class="flex items-center justify-between">
					<span class="text-sm font-bold uppercase tracking-widest text-slate-500">Menu</span>
					<button on:click={toggleMobileMenu} class="text-slate-400"><X class="h-5 w-5" /></button>
				</div>
				<div class="flex flex-col gap-2">
					{#each navItems as item}
						<a
							href={item.href}
							on:click={toggleMobileMenu}
							class={cn(
								"flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all",
								isActive(item.href) 
									? "bg-indigo-500/10 text-indigo-400" 
									: "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
							)}
						>
							<svelte:component this={item.icon} class="h-5 w-5" />
							{$t(item.label)}
						</a>
					{/each}
				</div>
				
				<div class="h-px bg-slate-800"></div>
				
				<div class="flex flex-col gap-4">
					<span class="text-[10px] font-bold uppercase tracking-widest text-slate-500">Language</span>
					<div class="grid grid-cols-2 gap-2">
						<button 
							class={cn("rounded-lg py-2 text-xs font-medium transition-all", $locale === 'en' ? "bg-indigo-500/10 text-indigo-400" : "bg-slate-800/50 text-slate-400")}
							on:click={() => { handleLocaleChange('en'); toggleMobileMenu(); }}
						>
							English
						</button>
						<button 
							class={cn("rounded-lg py-2 text-xs font-medium transition-all", $locale === 'zh-CN' ? "bg-indigo-500/10 text-indigo-400" : "bg-slate-800/50 text-slate-400")}
							on:click={() => { handleLocaleChange('zh-CN'); toggleMobileMenu(); }}
						>
							中文
						</button>
					</div>
				</div>
			</div>
		</nav>
	{/if}

	{#if $confirmDialog.open}
		<div class="fixed inset-0 z-[120]">
			<button
				type="button"
				aria-label={$t("Cancel")}
				class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
				on:click={() => resolveConfirm(false)}
			></button>
			<div class="relative flex min-h-full items-center justify-center p-4">
				<div
					role="dialog"
					aria-modal="true"
					aria-label={$confirmDialog.title || $t("Confirm Action")}
					tabindex="-1"
					class="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-indigo-500/10"
					in:fly={{ y: 12, duration: 220 }}
					out:fade={{ duration: 140 }}
				>
					<div class="flex items-start gap-3">
						<div class={cn(
							"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
							$confirmDialog.danger ? "bg-red-500/15 text-red-400" : "bg-indigo-500/15 text-indigo-400"
						)}>
							<AlertTriangle class="h-4.5 w-4.5" />
						</div>
						<div class="min-w-0 space-y-2">
							<h2 class="text-sm font-bold tracking-wide text-white">
								{$confirmDialog.title || $t("Confirm Action")}
							</h2>
							<p class="whitespace-pre-line text-sm leading-relaxed text-slate-300">
								{$confirmDialog.message}
							</p>
						</div>
					</div>
					<div class="mt-6 flex items-center justify-end gap-3">
						<button
							type="button"
							class="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700"
							on:click={() => resolveConfirm(false)}
						>
							{$confirmDialog.cancelText || $t("Cancel")}
						</button>
						<button
							type="button"
							class={cn(
								"rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors",
								$confirmDialog.danger
									? "bg-red-600 hover:bg-red-500"
									: "bg-indigo-600 hover:bg-indigo-500"
							)}
							on:click={() => resolveConfirm(true)}
						>
							{$confirmDialog.confirmText || $t("Confirm")}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Main Content -->
	<main class="relative mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
		{#key pathname}
			<div in:fly={{ y: 10, duration: 400, delay: 100 }} out:fade={{ duration: 150 }}>
				<slot />
			</div>
		{/key}
	</main>
</div>

<style>
	:global(html) {
		scroll-behavior: smooth;
	}
	
	/* Custom Scrollbar */
	:global(::-webkit-scrollbar) {
		width: 8px;
		height: 8px;
	}
	:global(::-webkit-scrollbar-track) {
		background: transparent;
	}
	:global(::-webkit-scrollbar-thumb) {
		background: #1e293b;
		border-radius: 10px;
	}
	:global(::-webkit-scrollbar-thumb:hover) {
		background: #334155;
	}
</style>
