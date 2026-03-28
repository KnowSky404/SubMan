<script lang="ts">
	import { onMount } from "svelte";
	import { browser } from "$app/environment";
	import type { AggregatePublishTarget, AppState, GistMeta, PublishTransitionOutcome } from "$lib/models";
	import { t } from "$lib/i18n";
	import { appState } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import { requestConfirm } from "$lib/stores/confirm";
	import { getGist, getGistFileContent, updateGist } from "$lib/gist";
	import { getSyncStateSignature, importState } from "$lib/serialization";
	import { nowIso } from "$lib/utils/time";
	import { WORKSPACE_FILE } from "$lib/workspace";
	import { cn } from "$lib/utils/cn";
	import { 
		FileJson, 
		FileText, 
		ExternalLink, 
		Copy, 
		Trash2, 
		RefreshCw, 
		ShieldCheck, 
		Layers, 
		FileCode,
		Database,
		CheckCircle2,
		AlertCircle,
		HardDrive,
		FileQuestion,
		Settings,
		ArrowRight,
		CircleHelp
	} from "lucide-svelte";
	import { fade, fly } from "svelte/transition";

	let workspace: GistMeta | null = null;
	let workspaceConfig: AppState | null = null;
	let loading = false;
	let deleting = false;
	let workspaceLoadError: string | null = null;
	let workspaceConfigError: string | null = null;
	let publishEventsExpanded = true;
	let publishEventFilter: PublishEventFilter = 'all';
	
	let status: { message: string, type: 'success' | 'info' | 'error' } | null = null;
	let statusTimer: ReturnType<typeof setTimeout> | null = null;

	function setStatus(message: string, type: 'success' | 'info' | 'error' = 'info') {
		status = { message, type };
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => status = null, 4000);
	}

	type PublishTransitionLog = {
		id: string;
		targetName: string;
		fromFileName: string;
		toFileName: string;
		at: string;
		outcome: PublishTransitionOutcome;
	};

	type PublishEventFilter = 'all' | PublishTransitionOutcome;

	const PUBLISH_EVENTS_UI_KEY = "subman:gists:publish-events-ui:v1";
	const defaultPublishEventsUiState = {
		expanded: true,
		filter: 'all' as PublishEventFilter
	};

	const publishEventFilters: PublishEventFilter[] = [
		'all',
		'auto_deleted',
		'kept_shared',
		'kept_external',
		'kept_manual'
	];

	function isPublishEventFilter(value: unknown): value is PublishEventFilter {
		return typeof value === "string" && publishEventFilters.includes(value as PublishEventFilter);
	}

	function loadPublishEventsUiState(): typeof defaultPublishEventsUiState {
		if (!browser) {
			return defaultPublishEventsUiState;
		}

		const raw = localStorage.getItem(PUBLISH_EVENTS_UI_KEY);
		if (!raw) {
			return defaultPublishEventsUiState;
		}

		try {
			const parsed = JSON.parse(raw) as { expanded?: boolean; filter?: unknown };
			return {
				expanded: typeof parsed.expanded === "boolean" ? parsed.expanded : defaultPublishEventsUiState.expanded,
				filter: isPublishEventFilter(parsed.filter) ? parsed.filter : defaultPublishEventsUiState.filter
			};
		} catch {
			return defaultPublishEventsUiState;
		}
	}

	const initialPublishEventsUiState = loadPublishEventsUiState();
	publishEventsExpanded = initialPublishEventsUiState.expanded;
	publishEventFilter = initialPublishEventsUiState.filter;

	function hasPublishTransition(target: AggregatePublishTarget): target is AggregatePublishTarget & {
		lastPublishTransitionAt: string;
		lastPublishTransitionFromFileName: string;
		lastPublishTransitionToFileName: string;
		lastPublishTransitionOutcome: PublishTransitionOutcome;
	} {
		return Boolean(
			target.lastPublishTransitionAt &&
			target.lastPublishTransitionFromFileName &&
			target.lastPublishTransitionToFileName &&
			target.lastPublishTransitionOutcome
		);
	}

	function formatEventTime(iso: string): string {
		return Number.isNaN(Date.parse(iso)) ? iso : new Date(iso).toLocaleString();
	}

	function getTransitionEventBadge(outcome: PublishTransitionOutcome): string {
		switch (outcome) {
			case 'auto_deleted':
				return $t("Auto cleaned");
			case 'kept_shared':
				return $t("Shared old file");
			case 'kept_external':
				return $t("Different workspace");
			default:
				return $t("Manual cleanup");
		}
	}

	function getTransitionEventBadgeClass(outcome: PublishTransitionOutcome): string {
		switch (outcome) {
			case 'auto_deleted':
				return "inline-badge--success";
			case 'kept_shared':
				return "inline-badge--accent";
			case 'kept_external':
				return "inline-badge--warning";
			default:
				return "";
		}
	}

	function getPublishEventFilterLabel(filter: PublishEventFilter): string {
		return filter === 'all' ? $t("All") : getTransitionEventBadge(filter);
	}

	function getTransitionEventMessage(log: PublishTransitionLog): string {
		switch (log.outcome) {
			case 'auto_deleted':
				return $t('Renamed output from {from} to {to}. Old workspace file was removed automatically.', {
					from: log.fromFileName,
					to: log.toFileName
				});
			case 'kept_shared':
				return $t('Renamed output from {from} to {to}. Old file was kept because another publish target still uses it.', {
					from: log.fromFileName,
					to: log.toFileName
				});
			case 'kept_external':
				return $t('Renamed output from {from} to {to}. Old file was kept because it belongs to a different workspace gist.', {
					from: log.fromFileName,
					to: log.toFileName
				});
			default:
				return $t('Renamed output from {from} to {to}. Old file was kept for manual cleanup.', {
					from: log.fromFileName,
					to: log.toFileName
				});
		}
	}

	$: managedFiles = new Set(
		$appState.publishTargets
			.map((target) => target.fileName.trim())
			.filter(Boolean)
	);

	$: localWorkspaceSignature = getSyncStateSignature($appState);
	$: remoteWorkspaceSignature = workspaceConfig ? getSyncStateSignature(workspaceConfig) : null;
	$: workspaceConfigMatchesLocal = Boolean(
		remoteWorkspaceSignature && remoteWorkspaceSignature === localWorkspaceSignature
	);

	$: allPublishLogs = $appState.publishTargets
		.filter(hasPublishTransition)
		.sort((a, b) => Date.parse(b.lastPublishTransitionAt) - Date.parse(a.lastPublishTransitionAt))
		.map((target) => ({
			id: `${target.id}-${target.lastPublishTransitionAt}`,
			targetName: target.name,
			fromFileName: target.lastPublishTransitionFromFileName,
			toFileName: target.lastPublishTransitionToFileName,
			at: target.lastPublishTransitionAt,
			outcome: target.lastPublishTransitionOutcome
		} satisfies PublishTransitionLog));

	$: filteredPublishLogs = allPublishLogs.filter((log) =>
		publishEventFilter === 'all' ? true : log.outcome === publishEventFilter
	);

	$: recentPublishLogs = filteredPublishLogs.slice(0, 6);

	$: if (browser) {
		localStorage.setItem(
			PUBLISH_EVENTS_UI_KEY,
			JSON.stringify({
				expanded: publishEventsExpanded,
				filter: publishEventFilter
			})
		);
	}

	async function refreshWorkspace() {
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId) {
			workspace = null;
			workspaceConfig = null;
			workspaceLoadError = $t("Configure workspace first.");
			workspaceConfigError = null;
			setStatus($t("Configure workspace first."), 'error');
			return;
		}

		loading = true;
		try {
			workspace = await getGist(token, gistId);
			workspaceConfig = null;
			workspaceConfigError = null;

			try {
				const rawConfig = await getGistFileContent(token, gistId, WORKSPACE_FILE);
				workspaceConfig = importState(rawConfig);
			} catch (err) {
				workspaceConfigError = err instanceof Error ? err.message : $t("Workspace data unreadable.");
			}

			workspaceLoadError = null;
			setStatus($t("Workspace gist refreshed."), 'success');
		} catch (err) {
			workspaceConfig = null;
			workspaceConfigError = null;
			workspaceLoadError = err instanceof Error ? err.message : $t("Failed to fetch gist.");
			setStatus(workspaceLoadError, 'error');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if ($authState.token && $appState.activeGistId) {
			void refreshWorkspace();
		}
	});

	async function copyLink(url?: string) {
		if (!url) { setStatus($t("Link unavailable."), 'error'); return; }
		try {
			await navigator.clipboard.writeText(url);
			setStatus($t("Link copied."));
		} catch { setStatus($t("Copy failed."), 'error'); }
	}

	$: workspaceGistUrl = $appState.activeGistId ? `https://gist.github.com/${$appState.activeGistId}` : "";

	const isConfigFile = (filename: string) => filename === WORKSPACE_FILE;
	const isManagedOutput = (filename: string) => managedFiles.has(filename);
	const canDelete = (filename: string) => !isConfigFile(filename);

	async function deleteWorkspaceFile(filename: string) {
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId) return;
		if (!canDelete(filename)) {
			setStatus($t("{file} is protected.", { file: WORKSPACE_FILE }), 'error');
			return;
		}

		const confirmed = await requestConfirm({
			title: $t("Confirm Action"),
			message: $t("Delete {filename} forever?", { filename }),
			confirmText: $t("Delete"),
			cancelText: $t("Cancel"),
			danger: true
		});
		if (!confirmed) return;

		deleting = true;
		try {
			workspace = await updateGist(token, { gistId, files: { [filename]: null } });
			const updatedAt = nowIso();
			appState.update((state) => ({
				...state,
				publishTargets: state.publishTargets.map((target) =>
					target.fileName === filename
						? { ...target, lastPublishedAt: null, lastPublishedUrl: null, updatedAt }
						: target
				),
				lastUpdated: updatedAt
			}));
			setStatus($t("Deleted {filename}."), 'success');
		} catch (err) {
			setStatus(err instanceof Error ? err.message : $t("Delete failed."), 'error');
		} finally {
			deleting = false;
		}
	}

	async function cleanWorkspaceFiles() {
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId || !workspace) return;

		const filesToDelete = workspace.files
			.map((file) => file.filename)
			.filter((name) => !isConfigFile(name));
		
		if (filesToDelete.length === 0) {
			setStatus($t("No removable files."), 'info');
			return;
		}

		const confirmed = await requestConfirm({
			title: $t("Confirm Action"),
			message: $t("Delete all {count} files except config?", { count: filesToDelete.length }),
			confirmText: $t("Delete"),
			cancelText: $t("Cancel"),
			danger: true
		});
		if (!confirmed) return;

		const files = Object.fromEntries(filesToDelete.map((name) => [name, null]));
		deleting = true;
		try {
			workspace = await updateGist(token, { gistId, files });
			const removed = new Set(filesToDelete);
			const updatedAt = nowIso();
			appState.update((state) => ({
				...state,
				publishTargets: state.publishTargets.map((target) =>
					removed.has(target.fileName)
						? { ...target, lastPublishedAt: null, lastPublishedUrl: null, updatedAt }
						: target
				),
				lastUpdated: updatedAt
			}));
			setStatus($t("Workspace cleaned."), 'success');
		} catch (err) {
			setStatus(err instanceof Error ? err.message : $t("Clean failed."), 'error');
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>{$t("Gist Workspace")} | {$t("SubMan")}</title>
</svelte:head>

<div class="page-stack">
	<header class="page-hero surface-card">
		<div class="page-hero__intro">
			<div class="page-hero__icon">
				<Database class="h-6 w-6" />
			</div>
			<div class="page-hero__body">
				<p class="page-hero__eyebrow">{$t("Workspace")}</p>
				<h1 class="page-hero__title">{$t("Gist Workspace")}</h1>
				<p class="page-hero__description">{$t("Manage raw files directly in your GitHub Gist")}</p>
			</div>
		</div>

		<div class="page-hero__actions">
			<button type="button" on:click={refreshWorkspace} disabled={loading} class="button-secondary">
				<RefreshCw class={cn("h-4 w-4", loading && "animate-spin")} />
				{loading ? $t("Refreshing...") : $t("Refresh")}
			</button>
			<a href="/auth" class="button-primary">
				<Settings class="h-4 w-4" />
				{$t("Workspace Settings")}
			</a>
		</div>
	</header>

	{#if status}
		<div
			transition:fly={{ y: -20, duration: 300 }}
			class={cn(
				"floating-notice",
				status.type === "success" ? "floating-notice--success" : status.type === "error" ? "floating-notice--error" : "floating-notice--info"
			)}
		>
			{#if status.type === "success"}<CheckCircle2 class="h-5 w-5 shrink-0" />
			{:else if status.type === "error"}<AlertCircle class="h-5 w-5 shrink-0" />
			{:else}<RefreshCw class="h-5 w-5 shrink-0" />{/if}
			<span class="text-sm font-bold text-[var(--app-text)]">{status.message}</span>
		</div>
	{/if}

	{#if workspaceLoadError}
		<section class="surface-card section-card section-card--danger">
			<div class="section-card__header">
				<div class="section-card__header-main">
					<div class="section-card__icon">
						<AlertCircle class="h-5 w-5 text-[var(--app-danger)]" />
					</div>
					<div class="section-card__title-wrap">
						<h2 class="section-card__title">{$t("Workspace auto-refresh failed.")}</h2>
						<p class="section-card__text">{workspaceLoadError}</p>
					</div>
				</div>
				<div class="section-card__actions">
					<button type="button" on:click={refreshWorkspace} class="button-secondary">
						<RefreshCw class={cn("h-4 w-4", loading && "animate-spin")} />
						{$t("Refresh")}
					</button>
					<a href="/auth" class="button-secondary">
						<Settings class="h-4 w-4" />
						{$t("Workspace Settings")}
					</a>
				</div>
			</div>
		</section>
	{/if}

	<section class="surface-card section-card">
		<div class="section-card__header">
			<div class="section-card__header-main">
				<div class="section-card__icon">
					<HardDrive class="h-5 w-5" />
				</div>
				<div class="section-card__title-wrap">
					<h2 class="section-card__title">{$t("Workspace overview")}</h2>
					<p class="section-card__text">{$t("Review your bound gist, copy stable links, and keep published output files tidy.")}</p>
				</div>
			</div>
			<div class="section-card__actions">
				<button type="button" on:click={cleanWorkspaceFiles} disabled={deleting || !workspace} class="button-danger">
					<Trash2 class="h-4 w-4" />
					{$t("Clean All Output Files")}
				</button>
			</div>
		</div>

		<div class="metric-grid">
			<div class="metric-card">
				<p class="metric-card__label">{$t("Active Gist ID")}</p>
				<p class="metric-card__meta font-mono break-all">{$appState.activeGistId || $t("None")}</p>
			</div>
			<div class="metric-card">
				<p class="metric-card__label">{$t("Files")}</p>
				<p class="metric-card__value">{workspace?.files.length || 0}</p>
				<p class="metric-card__meta">{$t("Workspace file inventory")}</p>
			</div>
			<div class="metric-card">
				<p class="metric-card__label">{$t("Workspace config")}</p>
				<p class="metric-card__meta font-mono">{WORKSPACE_FILE}</p>
			</div>
		</div>

		{#if workspaceGistUrl}
			<div class="section-card__actions">
				<button type="button" on:click={() => copyLink(workspaceGistUrl)} class="button-secondary">
					<Copy class="h-4 w-4" />
					{$t("Copy workspace gist URL")}
				</button>
				<a href={workspaceGistUrl} target="_blank" class="button-secondary">
					<ExternalLink class="h-4 w-4" />
					{$t("Open workspace gist")}
				</a>
			</div>
		{/if}
	</section>

	<section class="surface-card section-card">
		<div class="section-card__header">
			<div class="section-card__header-main">
				<div class="section-card__icon">
					<FileJson class="h-5 w-5" />
				</div>
				<div class="section-card__title-wrap">
					<h2 class="section-card__title">{$t("Workspace config")}</h2>
					<p class="section-card__text">{WORKSPACE_FILE}</p>
				</div>
			</div>

			{#if workspaceConfig}
				<span
					class={cn(
						"inline-badge",
						workspaceConfigMatchesLocal ? "inline-badge--success" : "inline-badge--warning"
					)}
				>
					{workspaceConfigMatchesLocal
						? $t("Remote config matches current local state.")
						: $t("Remote config differs from current local state.")}
				</span>
			{/if}
		</div>

		{#if workspaceConfig}
			<div class="metric-grid">
				<div class="metric-card">
					<p class="metric-card__label">{$t("Nodes")}</p>
					<p class="metric-card__value">{workspaceConfig.nodes.length}</p>
				</div>
				<div class="metric-card">
					<p class="metric-card__label">{$t("Subscriptions")}</p>
					<p class="metric-card__value">{workspaceConfig.subscriptions.length}</p>
				</div>
				<div class="metric-card">
					<p class="metric-card__label">{$t("Rules")}</p>
					<p class="metric-card__value">{workspaceConfig.aggregates.length}</p>
				</div>
				<div class="metric-card">
					<p class="metric-card__label">{$t("Publish Targets")}</p>
					<p class="metric-card__value">{workspaceConfig.publishTargets.length}</p>
				</div>
			</div>

			<p class="section-card__text">{$t("Updated: {time}", { time: formatEventTime(workspaceConfig.lastUpdated) })}</p>
		{:else if workspaceConfigError}
			<div class="surface-card section-card section-card--warning">
				<div class="section-card__header-main">
					<div class="section-card__icon">
						<AlertCircle class="h-4.5 w-4.5 text-[var(--app-warning)]" />
					</div>
					<div class="section-card__title-wrap">
						<h3 class="section-card__title">{$t("Workspace data unreadable.")}</h3>
						<p class="section-card__text">{workspaceConfigError}</p>
					</div>
				</div>
			</div>
		{:else}
			<div class="empty-state empty-state--compact">
				<div class="empty-state__icon">
					<FileJson class="h-6 w-6" />
				</div>
				<p class="empty-state__title">{$t("Refresh to load files.")}</p>
			</div>
		{/if}
	</section>

	{#if allPublishLogs.length > 0}
		<section class="surface-card section-card">
			<div class="section-card__header">
				<div class="section-card__header-main">
					<div class="section-card__icon">
						<Layers class="h-5 w-5" />
					</div>
					<div class="section-card__title-wrap">
						<h2 class="section-card__title">{$t("Recent Publish Events")}</h2>
						<p class="section-card__text">{$t("Latest file replacement activity for workspace outputs.")}</p>
					</div>
				</div>

				<div class="section-card__actions">
					<button type="button" on:click={() => (publishEventsExpanded = !publishEventsExpanded)} class="button-secondary">
						{publishEventsExpanded ? $t("Hide") : $t("Show")}
						<ArrowRight class={cn("h-3.5 w-3.5 transition-transform", publishEventsExpanded && "rotate-90")} />
					</button>
				</div>
			</div>

			{#if publishEventsExpanded}
				<div class="filter-pills">
					{#each publishEventFilters as filter}
						<button
							type="button"
							on:click={() => (publishEventFilter = filter)}
							class={cn("filter-pill", publishEventFilter === filter && "filter-pill--active")}
						>
							{getPublishEventFilterLabel(filter)}
						</button>
					{/each}
				</div>

				{#if recentPublishLogs.length === 0}
					<div class="empty-state empty-state--compact">
						<div class="empty-state__icon">
							<Layers class="h-6 w-6" />
						</div>
						<p class="empty-state__title">{$t("No publish events match this filter.")}</p>
					</div>
				{:else}
					<div class="grid gap-4 lg:grid-cols-2">
						{#each recentPublishLogs as log (log.id)}
							<div class="surface-card section-card section-card--compact">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0 space-y-1">
										<p class="truncate text-sm font-bold text-[var(--app-text)]">{log.targetName}</p>
										<p class="text-[10px] font-mono text-[var(--app-text-faint)] truncate">{log.fromFileName} -&gt; {log.toFileName}</p>
									</div>
									<span class={cn("inline-badge", getTransitionEventBadgeClass(log.outcome))}>
										{getTransitionEventBadge(log.outcome)}
									</span>
								</div>
								<p class="section-card__text">{getTransitionEventMessage(log)}</p>
								<p class="metric-card__meta">{$t("Updated: {time}", { time: formatEventTime(log.at) })}</p>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</section>
	{/if}

	<section class="surface-card section-card">
		<div class="section-card__header">
			<div class="section-card__header-main">
				<div class="section-card__icon">
					<FileText class="h-5 w-5" />
				</div>
				<div class="section-card__title-wrap">
					<h2 class="section-card__title">{$t("Workspace files")}</h2>
					<p class="section-card__text">{$t("Inspect workspace config, managed outputs, and any extra files stored in this gist.")}</p>
				</div>
			</div>
		</div>

		{#if !workspace}
			<div class="empty-state">
				<div class="empty-state__icon">
					<HardDrive class="h-6 w-6" />
				</div>
				<p class="empty-state__title">{$t("Refresh to view your cloud files.")}</p>
				<div class="section-card__actions">
					<button type="button" on:click={refreshWorkspace} class="button-secondary">
						{$t("Load Workspace")}
						<ArrowRight class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		{:else if workspace.files.length === 0}
			<div class="empty-state">
				<div class="empty-state__icon">
					<FileQuestion class="h-6 w-6" />
				</div>
				<p class="empty-state__title">{$t("The Gist is empty.")}</p>
			</div>
		{:else}
			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{#each workspace.files as file (file.filename)}
					<div transition:fade class="surface-card section-card section-card--compact">
						<div class="section-card__header">
							<div class="section-card__header-main">
								<div class={cn(
									"section-card__icon",
									isManagedOutput(file.filename) && "text-[var(--app-success)]",
									isConfigFile(file.filename) && "text-[var(--app-accent)]"
								)}>
									{#if isConfigFile(file.filename)}<ShieldCheck class="h-5 w-5" />
									{:else if isManagedOutput(file.filename)}<Layers class="h-5 w-5" />
									{:else}<FileCode class="h-5 w-5" />{/if}
								</div>
								<div class="section-card__title-wrap min-w-0">
									<div class="flex items-center gap-2 min-w-0">
										<h3 class="section-card__title truncate" title={file.filename}>{file.filename}</h3>
										{#if isManagedOutput(file.filename)}
											<div class="group/tooltip relative inline-flex shrink-0">
												<button
													type="button"
													class="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--app-text-faint)] transition-colors hover:text-[var(--app-text)] focus-visible:text-[var(--app-text)]"
													aria-label={$t("Stable link help")}
													title={$t("Stable link help")}
												>
													<CircleHelp class="h-3.5 w-3.5" />
												</button>
												<div class="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-64 rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg-panel-strong)] px-3 py-2 text-[11px] leading-relaxed text-[var(--app-text-soft)] shadow-[var(--app-shadow-soft)] group-hover/tooltip:block group-focus-within/tooltip:block">
													{$t("Keep the same file name to keep the stable link unchanged across republishes.")}
												</div>
											</div>
										{/if}
									</div>
									<p class="metric-card__meta">{file.size} Bytes</p>
								</div>
							</div>

							<div class="section-card__actions">
								{#if file.rawUrl}
									<a href={file.rawUrl} target="_blank" rel="noreferrer" class="button-icon" title="Open Stable URL">
										<ExternalLink class="h-4 w-4" />
									</a>
									<button type="button" on:click={() => copyLink(file.rawUrl)} class="button-icon" title="Copy Stable URL">
										<Copy class="h-4 w-4" />
									</button>
								{/if}
								{#if canDelete(file.filename)}
									<button type="button" on:click={() => deleteWorkspaceFile(file.filename)} disabled={deleting} class="button-icon button-icon--danger" title="Delete File">
										<Trash2 class="h-4 w-4" />
									</button>
								{/if}
							</div>
						</div>

						<div class="flex items-center justify-between gap-3">
							{#if isConfigFile(file.filename)}
								<span class="inline-badge inline-badge--accent">{$t("Protected Config")}</span>
							{:else if isManagedOutput(file.filename)}
								<span class="inline-badge inline-badge--success">{$t("Managed Output")}</span>
							{:else}
								<span class="inline-badge">{$t("Unmanaged File")}</span>
							{/if}

							<div
								class="h-2.5 w-2.5 rounded-full shadow-[0_0_10px_currentColor]"
								style={isConfigFile(file.filename)
									? "color: var(--app-accent);"
									: isManagedOutput(file.filename)
										? "color: var(--app-success);"
										: "color: var(--app-text-faint);"}
							></div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
