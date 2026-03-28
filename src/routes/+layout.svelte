<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { fade, fly } from "svelte/transition";
	import { locale, t } from "$lib/i18n";
	import { startAutoSync } from "$lib/sync";
	import { confirmDialog, resolveConfirm } from "$lib/stores/confirm";
	import { startThemeSync, themeMode, type ThemeMode } from "$lib/stores/theme";
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
		ChevronDown,
		Languages
	} from "lucide-svelte";

	const PROJECT_GITHUB_URL = "https://github.com/KnowSky404/SubMan";
	
	const navItems = [
		{ href: "/", label: "Overview", icon: LayoutDashboard },
		{ href: "/gists", label: "Gists", icon: Layers },
		{ href: "/nodes", label: "Nodes", icon: Network },
		{ href: "/aggregate", label: "Aggregate", icon: Zap },
		{ href: "/auth", label: "Workspace", icon: Settings }
	];

	const localeOptions = [
		{ value: "en", label: "English" },
		{ value: "zh-CN", label: "简体中文" }
	] as const;

	const themeOptions: { value: ThemeMode; label: string; icon: typeof MonitorCog }[] = [
		{ value: "system", label: "System", icon: MonitorCog },
		{ value: "light", label: "Light", icon: SunMedium },
		{ value: "dark", label: "Dark", icon: MoonStar }
	];

	let isMobileMenuOpen = false;

	$: pathname = $page.url.pathname;
	$: isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
	$: activeThemeOption = themeOptions.find((option) => option.value === $themeMode) ?? themeOptions[0];
	$: activeLocaleOption = localeOptions.find((option) => option.value === $locale) ?? localeOptions[0];

	function handleLocaleChange(nextLocale: string) {
		if (nextLocale === "en" || nextLocale === "zh-CN") {
			locale.set(nextLocale);
		}
	}

	function handleThemeChange(nextTheme: ThemeMode) {
		themeMode.set(nextTheme);
	}

	function closeMobileMenu() {
		isMobileMenuOpen = false;
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

	onMount(() => {
		const stopAutoSync = startAutoSync();
		const stopThemeSync = startThemeSync();

		return () => {
			stopAutoSync();
			stopThemeSync();
		};
	});
</script>

<svelte:window on:keydown={handleDialogKeydown} />

<div class="app-shell">
	<header class="app-header">
		<div class="app-header__inner">
			<div class="flex min-w-0 items-center gap-3">
				<a href="/" class="brand transition-opacity hover:opacity-90">
					<span class="brand__mark">
						<Zap class="h-5 w-5 fill-white/20 text-white" />
					</span>
					<span class="brand__content">
						<span class="brand__title">SubMan</span>
						<span class="brand__subtitle">{$t("Manager")}</span>
					</span>
				</a>
			</div>

			<nav class="app-nav hidden xl:flex">
				{#each navItems as item}
					<a href={item.href} class:nav-link--active={isActive(item.href)} class="nav-link">
						<svelte:component this={item.icon} class="nav-link__icon h-4 w-4" />
						<span>{$t(item.label)}</span>
					</a>
				{/each}
			</nav>

			<div class="header-controls hidden md:flex">
				<label class="toolbar-select" title={$t("Appearance")} aria-label={$t("Appearance")}>
					<svelte:component this={activeThemeOption.icon} class="h-4.5 w-4.5" />
					<ChevronDown class="toolbar-select__chevron h-3 w-3" />
					<select
						class="toolbar-select__native"
						aria-label={$t("Appearance")}
						value={$themeMode}
						on:change={(event) => handleThemeChange(event.currentTarget.value as ThemeMode)}
					>
						{#each themeOptions as option}
							<option value={option.value}>{$t(option.label)}</option>
						{/each}
					</select>
				</label>

				<label class="toolbar-select" title={$t("Language")} aria-label={$t("Language")}>
					<Languages class="h-4.5 w-4.5" />
					<ChevronDown class="toolbar-select__chevron h-3 w-3" />
					<select
						class="toolbar-select__native"
						aria-label={$t("Language")}
						value={$locale}
						on:change={(event) => handleLocaleChange(event.currentTarget.value)}
					>
						{#each localeOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</label>

				<a
					href={PROJECT_GITHUB_URL}
					target="_blank"
					rel="noreferrer"
					class="icon-action"
					title="GitHub"
				>
					<Github class="h-4.5 w-4.5" />
				</a>
			</div>

			<button class="menu-toggle md:hidden" type="button" on:click={toggleMobileMenu}>
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
			class="mobile-overlay md:hidden"
			on:click={closeMobileMenu}
			transition:fade={{ duration: 200 }}
		></button>
		<nav 
			class="mobile-panel md:hidden"
			transition:fly={{ x: 300, duration: 300 }}
		>
			<div class="flex flex-col gap-6">
				<div class="mobile-panel__header">
					<div class="flex items-center gap-3">
						<span class="brand__mark h-10 w-10 rounded-2xl">
							<Zap class="h-4.5 w-4.5 fill-white/20 text-white" />
						</span>
						<div class="flex flex-col">
							<span class="brand__title">SubMan</span>
							<span class="brand__subtitle">{$t("Menu")}</span>
						</div>
					</div>
					<button type="button" on:click={closeMobileMenu} class="icon-action h-10 w-10">
						<X class="h-4.5 w-4.5" />
					</button>
				</div>

				<div class="mobile-panel__section">
					{#each navItems as item}
						<a
							href={item.href}
							on:click={closeMobileMenu}
							class={cn(
								"nav-link w-full justify-start",
								isActive(item.href) && "nav-link--active"
							)}
						>
							<svelte:component this={item.icon} class="h-5 w-5" />
							{$t(item.label)}
						</a>
					{/each}
				</div>
				
				<div class="h-px bg-slate-800"></div>
				
				<div class="mobile-panel__section">
					<span class="mobile-panel__label">{$t("Appearance")}</span>
					<label class="panel-select">
						<span class="panel-select__icon">
							<svelte:component this={activeThemeOption.icon} class="h-4.5 w-4.5" />
						</span>
						<span class="panel-select__value">{$t(activeThemeOption.label)}</span>
						<ChevronDown class="panel-select__chevron h-4 w-4" />
						<select
							class="panel-select__native"
							aria-label={$t("Appearance")}
							value={$themeMode}
							on:change={(event) => handleThemeChange(event.currentTarget.value as ThemeMode)}
						>
							{#each themeOptions as option}
								<option value={option.value}>{$t(option.label)}</option>
							{/each}
						</select>
					</label>
				</div>

				<div class="mobile-panel__section">
					<span class="mobile-panel__label">{$t("Language")}</span>
					<label class="panel-select">
						<span class="panel-select__icon">
							<Languages class="h-4.5 w-4.5" />
						</span>
						<span class="panel-select__value">{activeLocaleOption.label}</span>
						<ChevronDown class="panel-select__chevron h-4 w-4" />
						<select
							class="panel-select__native"
							aria-label={$t("Language")}
							value={$locale}
							on:change={(event) => handleLocaleChange(event.currentTarget.value)}
						>
							{#each localeOptions as option}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</label>
				</div>

				<a href={PROJECT_GITHUB_URL} target="_blank" rel="noreferrer" class="button-secondary w-full">
					<Github class="h-4 w-4" />
					GitHub
				</a>
			</div>
		</nav>
	{/if}

	{#if $confirmDialog.open}
		<div class="fixed inset-0 z-[120]">
			<button
				type="button"
				aria-label={$t("Cancel")}
				class="dialog-scrim"
				on:click={() => resolveConfirm(false)}
			></button>
			<div class="relative flex min-h-full items-center justify-center p-4">
				<div
					role="dialog"
					aria-modal="true"
					aria-label={$confirmDialog.title || $t("Confirm Action")}
					tabindex="-1"
					class="dialog-card"
					in:fly={{ y: 12, duration: 220 }}
					out:fade={{ duration: 140 }}
				>
					<div class="flex items-start gap-3">
						<div class={cn(
							"dialog-card__icon mt-0.5 shrink-0",
							$confirmDialog.danger ? "dialog-card__icon--danger" : "dialog-card__icon--normal"
						)}>
							<AlertTriangle class="h-4.5 w-4.5" />
						</div>
						<div class="min-w-0 space-y-2">
							<h2 class="dialog-card__title">
								{$confirmDialog.title || $t("Confirm Action")}
							</h2>
							<p class="dialog-card__message whitespace-pre-line">
								{$confirmDialog.message}
							</p>
						</div>
					</div>
					<div class="dialog-card__actions">
						<button
							type="button"
							class="button-secondary"
							on:click={() => resolveConfirm(false)}
						>
							{$confirmDialog.cancelText || $t("Cancel")}
						</button>
						<button
							type="button"
							class={$confirmDialog.danger ? "button-danger" : "button-primary"}
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
	<main class="app-main">
		{#key pathname}
			<div in:fly={{ y: 10, duration: 400, delay: 100 }} out:fade={{ duration: 150 }}>
				<slot />
			</div>
		{/key}
	</main>
</div>
