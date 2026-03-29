<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { fade, fly } from "svelte/transition";
	import { locale, t } from "$lib/i18n";
	import { startAutoSync } from "$lib/sync";
	import { confirmDialog, resolveConfirm } from "$lib/stores/confirm";
	import { startThemeSync, themeMode, type ThemeMode } from "$lib/stores/theme";
	import { toastStore, dismissToast } from "$lib/stores/toast";
	import { cn } from "$lib/utils/cn";
	import { 
		LayoutDashboard, 
		Layers, 
		Network, 
		Zap, 
		Settings, 
		Github, 
		Menu,
		X,
		AlertTriangle,
		MonitorCog,
		SunMedium,
		MoonStar,
		Languages,
		Package,
		History,
		ChevronDown,
		Check,
		RefreshCw,
		AlertCircle
	} from "lucide-svelte";

	const PROJECT_GITHUB_URL = "https://github.com/KnowSky404/SubMan";
	
	const navItems = [
		{ href: "/", label: "Overview", icon: LayoutDashboard },
		{ href: "/nodes", label: "Nodes", icon: Network },
		{ href: "/aggregate", label: "Aggregate", icon: Zap },
		{ href: "/gists", label: "Gists", icon: Layers },
		{ href: "/auth", label: "Settings", icon: Settings }
	];

	const themeOptions: { value: ThemeMode; label: string; icon: typeof MonitorCog }[] = [
		{ value: "system", label: "Auto", icon: MonitorCog },
		{ value: "light", label: "Light", icon: SunMedium },
		{ value: "dark", label: "Dark", icon: MoonStar }
	];

	let isMobileMenuOpen = false;

	$: pathname = $page.url.pathname;
	$: isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
	$: activeThemeOption = themeOptions.find((option) => option.value === $themeMode) ?? themeOptions[0];

	function handleThemeChange(nextTheme: ThemeMode) {
		themeMode.set(nextTheme);
	}

	onMount(() => {
		const stopAutoSync = startAutoSync();
		const stopThemeSync = startThemeSync();
		return () => { stopAutoSync(); stopThemeSync(); };
	});
</script>

<div class="flex min-h-screen flex-col relative">
	<header class="app-header sticky top-0 z-[100]">
		<div class="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
			<div class="flex items-center gap-6">
				<a href="/" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
					<div class="flex h-8 w-8 items-center justify-center rounded-md bg-gray-700">
						<Package class="h-5 w-5 text-white" />
					</div>
					<span class="text-base font-bold tracking-tight">SubMan</span>
				</a>

				<nav class="hidden md:flex items-center gap-1">
					{#each navItems as item}
						<a
							href={item.href}
							class={cn(
								"app-nav-link",
								isActive(item.href) && "app-nav-link-active"
							)}
						>
							<svelte:component this={item.icon} class="h-4 w-4" />
							<span>{$t(item.label)}</span>
						</a>
					{/each}
				</nav>
			</div>

			<div class="flex items-center gap-3">
				<!-- Desktop Nav Tools -->
				<div class="hidden items-center gap-2 sm:flex">
					<div class="relative flex items-center">
						<svelte:component this={activeThemeOption.icon} class="absolute left-2.5 h-3 w-3 text-gray-400 pointer-events-none" />
						<select
							class="gh-select-header w-28"
							value={$themeMode}
							on:change={(event) => handleThemeChange(event.currentTarget.value as ThemeMode)}
						>
							{#each themeOptions as option}
								<option value={option.value}>{$t(option.label)}</option>
							{/each}
						</select>
					</div>

					<a
						href={PROJECT_GITHUB_URL}
						target="_blank"
						rel="noreferrer"
						class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-gray-800 text-gray-400"
					>
						<Github class="h-4 w-4" />
					</a>
				</div>

				<!-- Mobile Menu Toggle -->
				<button class="md:hidden flex h-8 w-8 items-center justify-center rounded-md hover:bg-gray-800" on:click={() => (isMobileMenuOpen = !isMobileMenuOpen)}>
					{#if isMobileMenuOpen}<X class="h-5 w-5" />{:else}<Menu class="h-5 w-5" />{/if}
				</button>
			</div>
		</div>
	</header>

	{#if isMobileMenuOpen}
		<div class="fixed inset-0 top-[57px] z-[90] bg-canvas-default md:hidden p-4" transition:fade={{ duration: 150 }}>
			<nav class="flex flex-col gap-2">
				{#each navItems as item}
					<a
						href={item.href}
						on:click={() => (isMobileMenuOpen = false)}
						class={cn(
							"flex items-center gap-3 px-3 py-3 rounded-md text-base font-medium",
							isActive(item.href) ? "bg-canvas-subtle text-accent-fg" : "text-fg-default border border-transparent"
						)}
					>
						<svelte:component this={item.icon} class="h-5 w-5" />
						{$t(item.label)}
					</a>
				{/each}
			</nav>
		</div>
	{/if}

	<main class="app-main-container flex-1">
		<slot />
	</main>

	<!-- Global Toasts Container -->
	<div class="fixed top-20 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 pointer-events-none w-full max-w-sm px-4">
		{#each $toastStore as toast (toast.id)}
			<div 
				in:fly={{ y: -20, duration: 300 }}
				out:fade={{ duration: 200 }}
				class="gh-box bg-canvas-default text-fg-default px-4 py-3 shadow-2xl flex items-center gap-3 pointer-events-auto border-border-default"
			>
				<div class="flex-1 flex items-center gap-3 min-w-0">
					{#if toast.type === 'success'}<Check class="h-4 w-4 text-green-500 shrink-0" />
					{:else if toast.type === 'error'}<AlertCircle class="h-4 w-4 text-red-500 shrink-0" />
					{:else}<RefreshCw class="h-4 w-4 text-blue-500 shrink-0" />{/if}
					<span class="text-sm font-bold truncate">{toast.message}</span>
				</div>
				<button 
					class="p-1 hover:bg-canvas-subtle rounded-md transition-colors text-fg-muted hover:text-fg-default shrink-0"
					on:click={() => dismissToast(toast.id)}
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
		{/each}
	</div>

	{#if $confirmDialog.open}
		<div class="fixed inset-0 z-[150] flex items-center justify-center p-4">
			<div class="fixed inset-0 bg-black/60 backdrop-blur-sm" on:click={() => resolveConfirm(false)}></div>
			<div class="relative w-full max-w-md gh-box shadow-2xl bg-canvas-default border-border-default" in:fly={{ y: 10, duration: 300 }}>
				<div class="gh-box-header bg-canvas-subtle border-border-default text-fg-default">
					<span class="flex items-center gap-2">
						{#if $confirmDialog.danger}<AlertTriangle class="h-4 w-4 text-danger-fg" />{/if}
						{$confirmDialog.title || $t("Confirm Action")}
					</span>
					<button class="text-fg-muted hover:text-accent-fg transition-colors" on:click={() => resolveConfirm(false)}><X class="h-4 w-4" /></button>
				</div>
				<div class="p-4 bg-canvas-default">
					<p class="text-sm text-fg-default leading-relaxed">{$confirmDialog.message}</p>
				</div>
				<div class="p-4 bg-canvas-subtle border-t border-border-default flex justify-end gap-2">
					<button class="gh-btn" on:click={() => resolveConfirm(false)}>{$confirmDialog.cancelText || $t("Cancel")}</button>
					<button class={cn("gh-btn", $confirmDialog.danger ? "gh-btn-danger" : "gh-btn-primary")} on:click={() => resolveConfirm(true)}>
						{$confirmDialog.confirmText || $t("Confirm")}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
