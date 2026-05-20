<script lang="ts">
import "../app.css";
import { onMount } from "svelte";
import { fade, fly, slide } from "svelte/transition";
import { page } from "$app/state";
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import {
	alert,
	browser,
	check,
	code,
	database,
	fileCode,
	gear,
	home,
	markGithub,
	moon,
	packageIcon,
	server,
	shieldCheck,
	sun,
	sync,
	workflow,
	xCircleFill,
} from "$lib/octicons";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { confirmDialog, resolveConfirm } from "$lib/stores/confirm";
import { startThemeSync, type ThemeMode, themeMode } from "$lib/stores/theme";
import { dismissToast, toastStore } from "$lib/stores/toast";
import { startAutoSync } from "$lib/sync";
import { cn } from "$lib/utils/cn";

const PROJECT_GITHUB_URL = "https://github.com/KnowSky404/SubMan";
const PROJECT_OWNER = "KnowSky404";
const PROJECT_NAME = "SubMan";

const navItems = [
	{ href: "/", label: "Overview", icon: home },
	{ href: "/nodes", label: "Nodes", icon: server },
	{ href: "/aggregate", label: "Aggregate", icon: workflow },
	{ href: "/exports", label: "Exports", icon: fileCode },
	{ href: "/gists", label: "Gists", icon: code },
	{ href: "/auth", label: "Settings", icon: gear },
];

const themeOptions: {
	value: ThemeMode;
	label: string;
	icon: typeof browser;
}[] = [
	{ value: "system", label: "Auto", icon: browser },
	{ value: "light", label: "Light", icon: sun },
	{ value: "dark", label: "Dark", icon: moon },
];

$: activeThemeOption =
	themeOptions.find((option) => option.value === $themeMode) ?? themeOptions[0];
$: activeThemeLabel = $t(activeThemeOption.label);
$: isWorkspaceConnected = Boolean($authState.token && $appState.activeGistId);
$: workspaceMetaText = isWorkspaceConnected
	? $appState.activeGistId
	: $t("Browser storage only");
let themeMenuOpen = false;

function isActive(pathname: string, href: string) {
	return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function handleThemeChange(nextTheme: ThemeMode) {
	themeMode.set(nextTheme);
	themeMenuOpen = false;
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

<div class="flex min-h-screen flex-col">
	<div class="app-repo-shell">
		<div class="app-repo-masthead">
			<div class="app-repo-meta">
				<div class="app-repo-main">
					<div class="app-repo-title-line">
						<div class="app-repo-title">
							<Octicon icon={markGithub} className="h-5 w-5 shrink-0 text-fg-muted" />
							<a href={PROJECT_GITHUB_URL} target="_blank" rel="noreferrer" class="app-repo-title-owner">
								{PROJECT_OWNER}
							</a>
							<span class="app-repo-title-separator">/</span>
							<span>{PROJECT_NAME}</span>
							<span class="app-repo-visibility">Public</span>
						</div>
					</div>
				</div>

				<div class="app-repo-actions">
					<div class="app-repo-status-line">
						<span class={cn("app-repo-status", isWorkspaceConnected ? "app-repo-status-connected" : "")}>
							{#if isWorkspaceConnected}
								<Octicon icon={shieldCheck} className="h-3.5 w-3.5" />
								{$t("Workspace")}
							{:else}
								<Octicon icon={database} className="h-3.5 w-3.5" />
								{$t("Local")}
							{/if}
						</span>
						<span class="app-repo-workspace-id">{workspaceMetaText}</span>
					</div>

					<a href="/auth" class={cn("app-repo-action-button", !isWorkspaceConnected && "app-repo-action-button-primary")}>
						{isWorkspaceConnected ? $t("Manage Workspace") : $t("Setup GitHub")}
					</a>

					<div class="theme-menu relative shrink-0">
						<button type="button" class="theme-menu-button" on:click={() => (themeMenuOpen = !themeMenuOpen)} aria-haspopup="menu" aria-expanded={themeMenuOpen} aria-label={`${$t("Theme")}: ${activeThemeLabel}`}>
							<Octicon icon={activeThemeOption.icon} className="h-4 w-4" />
							<span class="sr-only">{$t("Theme")}: {activeThemeLabel}</span>
						</button>
						{#if themeMenuOpen}
							<button type="button" class="fixed inset-0 z-[140]" on:click={() => (themeMenuOpen = false)} aria-label="Close menu"></button>
							<div class="gh-dropdown-menu theme-menu-dropdown right-0 top-full w-40" transition:slide={{ duration: 150 }}>
								<div class="gh-dropdown-body flex flex-col gap-0.5">
									{#each themeOptions as option (option.value)}
										<button type="button" class={cn("gh-dropdown-item", $themeMode === option.value ? "font-semibold text-fg-default" : "text-fg-default")} on:click={() => handleThemeChange(option.value)}>
											<Octicon icon={option.icon} className="h-4 w-4 shrink-0 text-fg-muted" />
											<span class="min-w-0 flex-1 truncate">{$t(option.label)}</span>
											{#if $themeMode === option.value}
												<span class="gh-label">{$t("Active")}</span>
											{/if}
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>

					<a
						href={PROJECT_GITHUB_URL}
						target="_blank"
						rel="noreferrer"
						class="app-header-link"
						aria-label={$t("Open project on GitHub")}
					>
						<Octicon icon={packageIcon} className="h-4 w-4" />
					</a>
				</div>
			</div>

			<div class="app-repo-tabs">
				<div class="app-repo-tabs-track">
					<nav class="gh-underlinenav" aria-label={$t("Primary")}>
						{#each navItems as item}
							<a
								href={item.href}
								class={cn("gh-underlinenav-item", isActive(page.url.pathname, item.href) && "gh-underlinenav-item-active")}
								aria-current={isActive(page.url.pathname, item.href) ? "page" : undefined}
							>
								<Octicon icon={item.icon} className="h-4 w-4" />
								<span>{$t(item.label)}</span>
							</a>
						{/each}
					</nav>
				</div>
			</div>
		</div>
	</div>

	<main class="app-main-container">
		<slot />
	</main>

	<div class="pointer-events-none fixed left-1/2 top-20 z-[200] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
		{#each $toastStore as toast (toast.id)}
			<div
				in:fly={{ y: -20, duration: 300 }}
				out:fade={{ duration: 200 }}
				class="gh-box pointer-events-auto flex items-center gap-3 px-4 py-3 shadow-[var(--shadow-medium)]"
				role="status"
			>
				<div class="flex min-w-0 flex-1 items-center gap-3">
					{#if toast.type === "success"}
						<Octicon icon={check} className="h-4 w-4 shrink-0 text-[color:var(--success-emphasis)]" />
					{:else if toast.type === "error"}
						<Octicon icon={xCircleFill} className="h-4 w-4 shrink-0 text-[color:var(--danger-emphasis)]" />
					{:else}
						<Octicon icon={sync} className="h-4 w-4 shrink-0 text-[color:var(--accent-emphasis)]" />
					{/if}
					<span class="truncate text-sm font-medium">{toast.message}</span>
				</div>
				<button
					type="button"
					class="gh-icon-button h-7 w-7"
					on:click={() => dismissToast(toast.id)}
					aria-label={$t("Dismiss notification")}
				>
					<span class="sr-only">{$t("Dismiss notification")}</span>
					<span aria-hidden="true">×</span>
				</button>
			</div>
		{/each}
	</div>

	{#if $confirmDialog.open}
		<div class="fixed inset-0 z-[150] flex items-center justify-center p-4">
			<button
				type="button"
				class="fixed inset-0 bg-black/55 backdrop-blur-sm"
				on:click={() => resolveConfirm(false)}
				aria-label={$t("Close dialog")}
			></button>
			<div class="gh-box relative w-full max-w-md shadow-[var(--shadow-medium)]" in:fly={{ y: 10, duration: 300 }}>
				<div class="gh-box-header">
					<span class="flex items-center gap-2">
						{#if $confirmDialog.danger}
							<Octicon icon={alert} className="h-4 w-4 text-[color:var(--danger-emphasis)]" />
						{/if}
						{$confirmDialog.title || $t("Confirm Action")}
					</span>
					<button
						type="button"
						class="gh-icon-button h-7 w-7"
						on:click={() => resolveConfirm(false)}
						aria-label={$t("Close dialog")}
					>
						<span aria-hidden="true">×</span>
					</button>
				</div>
				<div class="p-4">
					<p class="text-sm text-fg-default">{$confirmDialog.message}</p>
				</div>
				<div class="flex justify-end gap-2 border-t border-border-default bg-canvas-subtle p-4">
					<button type="button" class="gh-btn" on:click={() => resolveConfirm(false)}>
						{$confirmDialog.cancelText || $t("Cancel")}
					</button>
					<button
						type="button"
						class={cn("gh-btn", $confirmDialog.danger ? "gh-btn-danger" : "gh-btn-primary")}
						on:click={() => resolveConfirm(true)}
					>
						{$confirmDialog.confirmText || $t("Confirm")}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
