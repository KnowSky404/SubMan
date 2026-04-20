<script lang="ts">
import "../app.css";
import { onMount } from "svelte";
import { page } from "$app/state";
import { fade, fly } from "svelte/transition";
import { t } from "$lib/i18n";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { startAutoSync } from "$lib/sync";
import { confirmDialog, resolveConfirm } from "$lib/stores/confirm";
import { startThemeSync, themeMode, type ThemeMode } from "$lib/stores/theme";
import { toastStore, dismissToast } from "$lib/stores/toast";
import { cn } from "$lib/utils/cn";
import Octicon from "$lib/components/Octicon.svelte";
import {
	alert,
	browser,
	check,
	code,
	database,
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

const PROJECT_GITHUB_URL = "https://github.com/KnowSky404/SubMan";
const PROJECT_OWNER = "KnowSky404";
const PROJECT_NAME = "SubMan";

const navItems = [
	{ href: "/", label: "Overview", icon: home },
	{ href: "/nodes", label: "Nodes", icon: server },
	{ href: "/aggregate", label: "Aggregate", icon: workflow },
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
$: isWorkspaceConnected = Boolean($authState.token && $appState.activeGistId);
$: workspaceMetaText = isWorkspaceConnected
	? $appState.activeGistId
	: $t("Browser storage only");
$: livePublishCount = $appState.publishTargets.filter(
	(target) => target.lastPublishedUrl,
).length;

function isActive(pathname: string, href: string) {
	return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function handleThemeChange(nextTheme: ThemeMode) {
	themeMode.set(nextTheme);
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
	<header class="app-header sticky top-0 z-[100]">
		<div class="app-header-inner">
			<a href="/" class="app-brand">
				<span class="app-brand-mark">
					<Octicon icon={packageIcon} className="h-4 w-4" />
				</span>
				<span>{PROJECT_NAME}</span>
			</a>

			<div class="app-header-tools">
				<div class="hidden md:flex items-center">
					<span class="app-header-chip">
						{#if isWorkspaceConnected}
							<Octicon icon={shieldCheck} className="h-3.5 w-3.5" />
							{$t("Workspace connected")}
						{:else}
							<Octicon icon={database} className="h-3.5 w-3.5" />
							{$t("Local mode")}
						{/if}
					</span>
				</div>

				<div class="gh-select-header-shell shrink-0">
					<span class="gh-select-header-icon" aria-hidden="true">
						<Octicon icon={activeThemeOption.icon} className="h-3.5 w-3.5" />
					</span>
					<select
						class="gh-select gh-select-header"
						value={$themeMode}
						on:change={(event) => handleThemeChange(event.currentTarget.value as ThemeMode)}
						aria-label={$t("Theme")}
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
					class="app-header-link"
					aria-label={$t("Open project on GitHub")}
				>
					<Octicon icon={markGithub} className="h-4 w-4" />
				</a>
			</div>
		</div>
	</header>

	<div class="app-repo-shell">
		<div class="app-repo-inner">
			<div class="app-repo-meta">
				<div class="app-repo-main">
					<div class="app-repo-title">
						<Octicon icon={packageIcon} className="h-5 w-5 text-fg-muted" />
						<a href={PROJECT_GITHUB_URL} target="_blank" rel="noreferrer" class="app-repo-title-owner">
							{PROJECT_OWNER}
						</a>
						<span class="text-fg-muted">/</span>
						<span>{PROJECT_NAME}</span>
						<span class="badge">Public</span>
					</div>

					<div class="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
						<span class={cn("badge", isWorkspaceConnected ? "badge-success" : "")}>
							{#if isWorkspaceConnected}
								<Octicon icon={shieldCheck} className="h-3 w-3" />
								{$t("Workspace")}
							{:else}
								<Octicon icon={database} className="h-3 w-3" />
								{$t("Local")}
							{/if}
						</span>
						<span class="truncate font-mono text-xs">{workspaceMetaText}</span>
					</div>
				</div>

				<div class="app-repo-side">
					<div class="app-repo-side-meta">
						<div class="gh-page-meta">
							<span class="gh-page-meta-item">
								<Octicon icon={server} className="h-3.5 w-3.5" />
								{$t("{count} nodes", { count: $appState.nodes.length })}
							</span>
							<span class="gh-page-meta-item">
								<Octicon icon={workflow} className="h-3.5 w-3.5" />
								{$t("{count} rules", { count: $appState.aggregates.length })}
							</span>
							<span class="gh-page-meta-item">
								<Octicon icon={code} className="h-3.5 w-3.5" />
								{$t("{count} live links", { count: livePublishCount })}
							</span>
						</div>
					</div>

					<div class="app-repo-tools app-repo-tools-stack">
						<a href="/auth" class={cn("gh-btn", !isWorkspaceConnected && "gh-btn-primary")}>
							{isWorkspaceConnected ? $t("Manage Workspace") : $t("Setup GitHub")}
						</a>
					</div>
				</div>
			</div>

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
