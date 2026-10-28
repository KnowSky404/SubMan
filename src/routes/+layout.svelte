<script lang="ts">
import "../app.css";
import { onMount, tick } from "svelte";
import { get } from "svelte/store";
import { afterNavigate } from "$app/navigation";
import { page } from "$app/state";
import { navigationIndicator } from "$lib/actions/navigation-indicator";
import { tooltip } from "$lib/actions/tooltip";
import Dialog from "$lib/components/Dialog.svelte";
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import {
	alert,
	arrowRight,
	browser,
	check,
	code,
	database,
	fileCode,
	gear,
	home,
	markGithub,
	moon,
	server,
	shieldCheck,
	sun,
	sync,
	workflow,
	xCircleFill,
} from "$lib/octicons";
import { appState, initializeAppStatePersistence } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { confirmDialog, resolveConfirm } from "$lib/stores/confirm";
import { startThemeSync, type ThemeMode, themeMode } from "$lib/stores/theme";
import { dismissToast, toastStore } from "$lib/stores/toast";
import {
	animatePage,
	surfaceMotion,
	veilMotion,
	watchMotionPreference,
} from "$lib/ui-motion";
import { cn } from "$lib/utils/cn";
import {
	cancelCloudWorkspaceLoad,
	refreshCloudWorkspace,
} from "$lib/workspace-cloud-session";
import { workspaceCloudStatus } from "$lib/workspace-cloud-status";
import { subscribeWorkspaceEvents } from "$lib/workspace-events";
import { startWorkspaceMutationSync } from "$lib/workspace-mutation-sync-browser";
import { workspaceSyncStatus } from "$lib/workspace-sync-status";

const PROJECT_GITHUB_URL = "https://github.com/KnowSky404/SubMan";
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

let shellMounted = false;
$: activeThemeOption =
	themeOptions.find(
		(option) => option.value === (shellMounted ? $themeMode : "system"),
	) ?? themeOptions[0];
$: activeThemeLabel = $t(activeThemeOption.label);
$: isWorkspaceConnected = Boolean(
	$authState.token &&
		$appState.activeGistId &&
		$workspaceCloudStatus.phase === "ready" &&
		$workspaceSyncStatus.mode !== "disconnected",
);
$: workspaceNeedsAttention =
	$workspaceCloudStatus.phase === "error" ||
	$workspaceSyncStatus.repairRequired;
$: workspaceBusy =
	$workspaceCloudStatus.phase === "loading" ||
	$workspaceSyncStatus.lifecycle === "syncing";
$: workspacePending =
	$workspaceSyncStatus.queueCount > 0 ||
	$workspaceSyncStatus.lifecycle === "retrying";
$: syncStatusLabel =
	$workspaceCloudStatus.phase === "loading"
		? "Loading cloud data..."
		: $workspaceCloudStatus.phase === "error"
			? "Cloud synchronization needs review"
			: (
					{
						"local-saved": "Cloud confirmation required",
						queued: "Queued",
						syncing: "Syncing",
						committed: "Saved to Workspace",
						retrying: "Cloud save pending; retrying",
						"manual-local-only": "Cloud confirmation required",
						"paused-conflict": "Cloud synchronization needs review",
						"auth-required": "Sign in to resume Workspace sync",
						"permanent-error": "Workspace sync needs repair",
						"invalid-local-state": "Cloud synchronization needs review",
						disconnected: "Not connected",
					} as const
				)[$workspaceSyncStatus.lifecycle];
$: workspaceControlLabel = `${$t(workspaceNeedsAttention ? "Repair" : isWorkspaceConnected ? "Manage Workspace" : "Setup GitHub")}: ${$t(syncStatusLabel)}${$workspaceSyncStatus.queueCount > 0 ? `, ${$t("{count} queued", { count: $workspaceSyncStatus.queueCount })}` : ""}`;
$: workspaceShortLabel = workspaceNeedsAttention
	? "Needs attention"
	: workspaceBusy
		? "Syncing"
		: workspacePending
			? "Awaiting cloud"
			: isWorkspaceConnected
				? "Connected"
				: "Not connected";
let themeMenuOpen = false;
let themeButton: HTMLButtonElement;
let themeMenu: HTMLDivElement;
let navigation: HTMLElement;
let navigationOverflows = false;
let navigationAtEnd = false;

function updateNavigationOverflow() {
	if (!navigation) return;
	navigationOverflows = navigation.scrollWidth > navigation.clientWidth + 1;
	navigationAtEnd =
		navigation.scrollLeft + navigation.clientWidth >=
		navigation.scrollWidth - 1;
}

function scrollNavigation() {
	const maximum = navigation.scrollWidth - navigation.clientWidth;
	let target =
		navigation.scrollLeft +
		(navigationAtEnd ? -1 : 1) * navigation.clientWidth * 0.8;
	if (!navigationAtEnd && maximum - target < 4) target = maximum;
	navigation.scrollTo({
		left: Math.max(0, Math.min(maximum, target)),
		behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
			? "instant"
			: "smooth",
	});
}

function revealActiveNavigation() {
	const active = navigation?.querySelector<HTMLElement>(
		'[aria-current="page"]',
	);
	if (active) {
		const activeBounds = active.getBoundingClientRect();
		const offset = activeBounds.left - navigation.getBoundingClientRect().left;
		if (offset < 0) navigation.scrollLeft += Math.floor(offset) - 1;
		else if (offset + activeBounds.width > navigation.clientWidth)
			navigation.scrollLeft +=
				Math.ceil(offset + activeBounds.width - navigation.clientWidth) + 1;
	}
	updateNavigationOverflow();
}

afterNavigate(({ from }) => {
	void tick().then(() => {
		revealActiveNavigation();
		if (from && content) animatePage(content);
	});
});

async function toggleThemeMenu() {
	themeMenuOpen = !themeMenuOpen;
	if (themeMenuOpen) {
		await tick();
		themeMenu
			?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
			?.focus();
	}
}

function closeThemeMenu() {
	themeMenuOpen = false;
	themeButton?.focus();
}

function handleThemeKeydown(event: KeyboardEvent) {
	if (!themeMenuOpen) return;
	if (event.key === "Escape") {
		event.preventDefault();
		closeThemeMenu();
	} else if (event.key === "Tab") {
		themeMenuOpen = false;
		themeButton?.focus();
	} else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
		event.preventDefault();
		const items = Array.from(
			themeMenu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
		);
		const current = items.indexOf(document.activeElement as HTMLButtonElement);
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? items.length - 1
					: (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
						items.length;
		items[next]?.focus();
	}
}
let content: HTMLElement;

function isActive(pathname: string, href: string) {
	return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

let themeAnimationTimer: ReturnType<typeof setTimeout>;
function handleThemeChange(nextTheme: ThemeMode) {
	clearTimeout(themeAnimationTimer);
	document.documentElement.dataset.themeChanging = "true";
	themeMode.set(nextTheme);
	themeAnimationTimer = setTimeout(() => {
		delete document.documentElement.dataset.themeChanging;
	}, 180);
	closeThemeMenu();
}

onMount(() => {
	shellMounted = true;
	const navigationObserver = new ResizeObserver(revealActiveNavigation);
	navigationObserver.observe(navigation);
	let cancelled = false;
	let stopAutoSync = () => {};
	let stopAuth = () => {};
	let currentToken: string | null | undefined;
	const stopThemeSync = startThemeSync();
	const stopUiMotion = watchMotionPreference();
	const stopWorkspaceEvents = subscribeWorkspaceEvents((event) => {
		if (event.type !== "workspace-v2-committed" || !currentToken) return;
		if (get(workspaceCloudStatus).phase === "error") {
			void refreshCloudWorkspace(currentToken);
		}
	});
	void initializeAppStatePersistence()
		.then(() => {
			if (cancelled) return;
			stopAutoSync = startWorkspaceMutationSync();
			stopAuth = authState.subscribe(({ token }) => {
				if (token === currentToken) return;
				currentToken = token;
				if (token) void refreshCloudWorkspace(token);
				else cancelCloudWorkspaceLoad();
			});
		})
		.catch(() => {
			workspaceCloudStatus.set({
				phase: "error",
				message:
					"Cloud data could not be loaded. Check your connection and retry.",
			});
		});

	return () => {
		navigationObserver.disconnect();
		stopUiMotion();
		clearTimeout(themeAnimationTimer);
		delete document.documentElement.dataset.themeChanging;
		cancelled = true;
		stopAuth();
		stopAutoSync();
		stopThemeSync();
		stopWorkspaceEvents();
		cancelCloudWorkspaceLoad();
	};
});
</script>

<svelte:head>
	<title>SubMan</title>
	<link rel="icon" href="/favicon.ico" sizes="any" />
	<link rel="icon" type="image/png" href="/favicon-32.png" sizes="32x32" />
	<link rel="icon" type="image/png" href="/favicon-192.png" sizes="192x192" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
</svelte:head>

<svelte:window on:keydown={handleThemeKeydown} />

<div class="flex min-h-screen flex-col">
	<div class="app-repo-shell">
		<div class="app-repo-masthead">
			<div class="app-repo-meta">
				<div class="app-repo-main">
					<div class="app-repo-title-line">
						<a href="/" class="app-repo-title" aria-label={$t("SubMan home")}>
							<img src="/brand/subman-logo.png" alt="" class="app-brand-mark" width="32" height="32" />
							<span>{PROJECT_NAME}</span>
						</a>
					</div>
				</div>

				<div class="app-repo-actions">
					<a
						href={workspaceNeedsAttention ? "/auth#workspace-repair" : "/auth"}
						class={cn("app-header-link app-workspace-control", workspaceNeedsAttention ? "app-header-link-danger" : workspaceBusy || workspacePending ? "app-header-link-pending" : isWorkspaceConnected && "app-header-link-connected")}
						aria-label={workspaceControlLabel}
						title={workspaceControlLabel}
						use:tooltip={workspaceControlLabel}
					>
						<Octicon icon={workspaceNeedsAttention ? alert : workspaceBusy || workspacePending ? sync : isWorkspaceConnected ? shieldCheck : database} className={cn("h-4 w-4", workspaceBusy && "animate-spin motion-reduce:animate-none")} />
						<span>{$t(workspaceShortLabel)}</span>
					</a>
					<span class="sr-only" role="status">{workspaceControlLabel}</span>

					<div class="theme-menu relative shrink-0">
						<button type="button" class="theme-menu-button" bind:this={themeButton} on:click={toggleThemeMenu} aria-haspopup="menu" aria-expanded={themeMenuOpen} aria-label={`${$t("Theme")}: ${activeThemeLabel}`} title={`${$t("Theme")}: ${activeThemeLabel}`} use:tooltip={`${$t("Theme")}: ${activeThemeLabel}`}>
							<Octicon icon={activeThemeOption.icon} className="h-4 w-4" />
							<span class="sr-only">{$t("Theme")}: {activeThemeLabel}</span>
						</button>
						{#if themeMenuOpen}
							<button type="button" class="fixed inset-0 z-[140]" tabindex="-1" on:click={closeThemeMenu} aria-label={$t("Close menu")}></button>
							<div class="gh-dropdown-menu theme-menu-dropdown right-0 top-full w-40" bind:this={themeMenu} role="menu" aria-label={$t("Theme")} in:surfaceMotion={{ duration: 120, y: 4 }} out:surfaceMotion={{ duration: 140, y: 4 }} data-ui-motion>
								<div class="gh-dropdown-body flex flex-col gap-0.5">
									{#each themeOptions as option (option.value)}
										<button type="button" role="menuitemradio" tabindex="-1" class={cn("gh-dropdown-item", $themeMode === option.value ? "font-semibold text-fg-default" : "text-fg-default")} on:click={() => handleThemeChange(option.value)} aria-checked={$themeMode === option.value}>
											<Octicon icon={option.icon} className="h-4 w-4 shrink-0 text-fg-muted" />
											<span class="min-w-0 flex-1 truncate">{$t(option.label)}</span>
											{#if $themeMode === option.value}
												<Octicon icon={check} className="h-4 w-4 text-accent-fg" />
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
						class="app-header-link app-project-link"
						aria-label={$t("Open project on GitHub")}
						title={$t("Open project on GitHub")}
						use:tooltip={$t("Open project on GitHub")}
					>
						<Octicon icon={markGithub} className="h-4 w-4" />
					</a>
				</div>
			</div>
		</div>

			<div class="app-repo-tabs">
				<div class="app-repo-tabs-track">
					<nav use:navigationIndicator data-ui-motion class="gh-underlinenav" bind:this={navigation} on:scroll={updateNavigationOverflow} aria-label={$t("Primary")}>
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
					{#if navigationOverflows}
						<button type="button" class="app-nav-scroll" aria-label={$t(navigationAtEnd ? "Previous navigation items" : "More navigation items")} use:tooltip={$t(navigationAtEnd ? "Previous navigation items" : "More navigation items")} on:click={scrollNavigation}>
							<Octicon icon={arrowRight} className={cn("h-4 w-4", navigationAtEnd && "rotate-180")} />
						</button>
					{/if}
 <a class="app-header-link app-project-link-narrow" href={PROJECT_GITHUB_URL} target="_blank" rel="noreferrer" aria-label={$t("Open project on GitHub")} use:tooltip={$t("Open project on GitHub")}><Octicon icon={markGithub} className="h-4 w-4" /></a>
				</div>
			</div>
	</div>

	<main class="app-main-container" bind:this={content} data-ui-motion>
		{#if $workspaceCloudStatus.phase === "ready" && (workspaceNeedsAttention || workspacePending)}
			<div class="app-sync-notice" role="status">
				<span class="inline-flex items-center gap-2"><Octicon icon={workspaceNeedsAttention ? alert : sync} className="h-4 w-4 shrink-0" />{$t(syncStatusLabel)}{#if $workspaceSyncStatus.queueCount > 0} · {$t("{count} queued", { count: $workspaceSyncStatus.queueCount })}{/if}</span>
				<a href={workspaceNeedsAttention ? "/auth#workspace-repair" : "/auth"} class="gh-link">{$t(workspaceNeedsAttention ? "Review connection" : "View sync status")}</a>
			</div>
		{/if}
		{#if page.url.pathname === "/auth" || ($authState.token && $workspaceCloudStatus.phase === "ready")}
			<slot />
		{:else}
			<section class="gh-page" data-testid="cloud-connection-required">
				<div class="gh-section"><div class="gh-section-body space-y-4">
					<h1 class="gh-page-title">{$t("Cloud Workspace")}</h1>
					<p role="status">{$workspaceCloudStatus.phase === "loading" ? $t("Loading cloud data...") : $workspaceCloudStatus.phase === "error" ? $t("Cloud data could not be loaded. Check your connection and retry.") : $t("Connect GitHub to load your cloud data.")}</p>
					{#if $workspaceCloudStatus.phase === "error"}<p class="text-sm text-fg-muted">{$t($workspaceCloudStatus.message ?? "Cloud synchronization needs review")}</p>{/if}
					{#if $workspaceCloudStatus.phase === "loading"}<div class="gh-skeleton-list" aria-hidden="true"><span></span><span></span><span></span></div>{/if}
     <a href="/auth" class="gh-btn gh-btn-primary">{$t("Setup GitHub")}</a>
				</div></div>
			</section>
		{/if}
	</main>

	<div class="pointer-events-none fixed left-1/2 top-20 z-[200] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
		{#each $toastStore as toast (toast.id)}
			<div
				in:surfaceMotion={{ y: -8, scale: 1 }}
				out:veilMotion={{ duration: 140 }}
    data-ui-motion
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
  <Dialog labelledby="confirm-dialog-title" closeLabel={$t("Close dialog")} onclose={() => resolveConfirm(false)} initialFocus="[data-confirm]" className="max-w-md" mobileSheet={false}>
				<div class="gh-box-header">
					<span id="confirm-dialog-title" class="flex items-center gap-2">
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
				<div class="gh-section-body">
					<p class="text-sm text-fg-default">{$confirmDialog.message}</p>
				</div>
				<div class="gh-section-footer">
					<button type="button" class="gh-btn" on:click={() => resolveConfirm(false)}>
						{$confirmDialog.cancelText || $t("Cancel")}
					</button>
					<button
						data-confirm
						type="button"
						class={cn("gh-btn", $confirmDialog.danger ? "gh-btn-danger" : "gh-btn-primary")}
						on:click={() => resolveConfirm(true)}
					>
						{$confirmDialog.confirmText || $t("Confirm")}
					</button>
				</div>
  </Dialog>
 {/if}
</div>
