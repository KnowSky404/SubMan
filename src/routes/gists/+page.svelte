<script lang="ts">
	import { onMount } from "svelte";
	import { browser } from "$app/environment";
	import type { AggregatePublishTarget, GistMeta, PublishTransitionOutcome } from "$lib/models";
	import { t } from "$lib/i18n";
	import { appState } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import { requestConfirm } from "$lib/stores/confirm";
	import { getGist, updateGist } from "$lib/gist";
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
	let loading = false;
	let deleting = false;
	let workspaceLoadError: string | null = null;
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
				return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
			case 'kept_shared':
				return "border-indigo-500/20 bg-indigo-500/10 text-indigo-400";
			case 'kept_external':
				return "border-amber-500/20 bg-amber-500/10 text-amber-400";
			default:
				return "border-slate-700 bg-slate-800/80 text-slate-300";
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
			workspaceLoadError = $t("Configure workspace first.");
			setStatus($t("Configure workspace first."), 'error');
			return;
		}

		loading = true;
		try {
			workspace = await getGist(token, gistId);
			workspaceLoadError = null;
			setStatus($t("Workspace refreshed."), 'success');
		} catch (err) {
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

<div class="space-y-8 pb-12">
	<!-- Page Header -->
	<header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400">
				<Database class="h-6 w-6" />
			</div>
			<div>
				<h1 class="text-3xl font-extrabold text-white tracking-tight">{$t("Gist Workspace")}</h1>
				<p class="text-slate-400 text-sm">{$t("Manage raw files directly in your GitHub Gist")}</p>
			</div>
		</div>
		
		<div class="flex items-center gap-2">
			<button 
				on:click={refreshWorkspace}
				disabled={loading}
				class="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-800/50 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-slate-700 active:scale-[0.98]"
			>
				<RefreshCw class={cn("h-4 w-4", loading && "animate-spin")} />
				{loading ? $t("Refreshing...") : $t("Refresh")}
			</button>
			<a 
				href="/auth" 
				class="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-500 active:scale-[0.98]"
			>
				<Settings class="h-4 w-4" />
				{$t("Workspace Settings")}
			</a>
		</div>
	</header>

	<!-- Status Toast -->
	{#if status}
		<div 
			transition:fly={{ y: -20, duration: 300 }}
			class={cn(
				"fixed top-20 right-8 z-[100] flex items-center gap-3 rounded-2xl px-6 py-3 border shadow-2xl backdrop-blur-xl",
				status.type === 'success' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
				status.type === 'error' ? "bg-red-500/10 border-red-500/20 text-red-400" :
				"bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
			)}
		>
			{#if status.type === 'success'}<CheckCircle2 class="h-5 w-5" />
			{:else if status.type === 'error'}<AlertCircle class="h-5 w-5" />
			{:else}<RefreshCw class="h-5 w-5" />{/if}
			<span class="text-sm font-bold tracking-tight">{status.message}</span>
		</div>
	{/if}

	{#if workspaceLoadError}
		<section class="rounded-[2rem] border border-red-500/20 bg-red-500/10 p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-start gap-3">
				<AlertCircle class="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
				<div class="space-y-1">
					<p class="text-sm font-bold text-red-200">{$t("Workspace auto-refresh failed.")}</p>
					<p class="text-sm leading-relaxed text-red-100/80">{workspaceLoadError}</p>
				</div>
			</div>
			<div class="flex items-center gap-3">
				<button
					type="button"
					on:click={refreshWorkspace}
					class="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-red-100 transition-all hover:bg-red-500/20"
				>
					<RefreshCw class={cn("h-3.5 w-3.5", loading && "animate-spin")} />
					{$t("Refresh")}
				</button>
				<a
					href="/auth"
					class="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-200 transition-all hover:bg-slate-800"
				>
					<Settings class="h-3.5 w-3.5" />
					{$t("Workspace Settings")}
				</a>
			</div>
		</section>
	{/if}

	<!-- Stats & Clean Action -->
	<section class="flex flex-col gap-6 md:flex-row md:items-center md:justify-between p-8 rounded-[2rem] border border-slate-800/60 bg-slate-900/30 overflow-hidden relative group">
		<div class="relative z-10 flex items-center gap-6">
			<div class="flex flex-col">
				<span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{$t("Active Gist ID")}</span>
				<span class="text-sm font-mono text-slate-300">{$appState.activeGistId || $t("None")}</span>
				{#if workspaceGistUrl}
					<div class="mt-3 flex items-center gap-2">
						<button
							type="button"
							on:click={() => copyLink(workspaceGistUrl)}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
						>
							<Copy class="h-3.5 w-3.5" />
							{$t("Copy workspace gist URL")}
						</button>
						<a
							href={workspaceGistUrl}
							target="_blank"
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
						>
							<ExternalLink class="h-3.5 w-3.5" />
							{$t("Open workspace gist")}
						</a>
					</div>
				{/if}
			</div>
			<div class="h-10 w-px bg-slate-800"></div>
			<div class="flex flex-col">
				<span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{$t("Files")}</span>
				<span class="text-sm font-bold text-white">{workspace?.files.length || 0}</span>
			</div>
		</div>

		<button 
			on:click={cleanWorkspaceFiles}
			disabled={deleting || !workspace}
			class="relative z-10 flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-6 py-2.5 text-xs font-bold text-red-400 transition-all hover:bg-red-500/10 hover:border-red-500/40 active:scale-[0.98] disabled:opacity-30"
		>
			<Trash2 class="h-4 w-4" />
			{$t("Clean All Output Files")}
		</button>
		
		<!-- Background Glow -->
		<div class="absolute -right-20 -top-20 h-64 w-64 bg-indigo-500/5 blur-[80px] group-hover:bg-indigo-500/10 transition-colors"></div>
	</section>

	{#if allPublishLogs.length > 0}
		<section class="rounded-[2rem] border border-slate-800/60 bg-slate-900/30 p-8 space-y-5">
			<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div class="flex items-center gap-3">
					<div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400">
						<Layers class="h-5 w-5" />
					</div>
					<div>
						<h2 class="text-lg font-bold text-white tracking-tight">{$t("Recent Publish Events")}</h2>
						<p class="text-sm text-slate-400">{$t("Latest file replacement activity for workspace outputs.")}</p>
					</div>
				</div>

				<button
					type="button"
					on:click={() => (publishEventsExpanded = !publishEventsExpanded)}
					class="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
				>
					{publishEventsExpanded ? $t("Hide") : $t("Show")}
					<ArrowRight class={cn("h-3.5 w-3.5 transition-transform", publishEventsExpanded && "rotate-90")} />
				</button>
			</div>

			{#if publishEventsExpanded}
				<div class="flex flex-wrap gap-2">
					{#each publishEventFilters as filter}
						<button
							type="button"
							on:click={() => (publishEventFilter = filter)}
							class={cn(
								"inline-flex items-center rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] transition-all",
								publishEventFilter === filter
									? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
									: "border-slate-800 bg-slate-950/60 text-slate-500 hover:border-slate-700 hover:text-slate-200"
							)}
						>
							{getPublishEventFilterLabel(filter)}
						</button>
					{/each}
				</div>

				{#if recentPublishLogs.length === 0}
					<div class="rounded-3xl border border-slate-800/60 border-dashed bg-slate-950/30 px-6 py-8 text-center">
						<p class="text-sm font-medium text-slate-400">{$t("No publish events match this filter.")}</p>
					</div>
				{:else}
					<div class="grid gap-4 lg:grid-cols-2">
						{#each recentPublishLogs as log (log.id)}
							<div class="rounded-3xl border border-slate-800/60 bg-slate-950/40 p-5 space-y-3">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0 space-y-1">
										<p class="text-sm font-bold text-white truncate">{log.targetName}</p>
										<p class="text-[10px] font-mono text-slate-500 truncate">{log.fromFileName} -&gt; {log.toFileName}</p>
									</div>
									<span class={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]", getTransitionEventBadgeClass(log.outcome))}>
										{getTransitionEventBadge(log.outcome)}
									</span>
								</div>
								<p class="text-[11px] leading-relaxed text-slate-300">{getTransitionEventMessage(log)}</p>
								<p class="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
									{$t("Updated: {time}", { time: formatEventTime(log.at) })}
								</p>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</section>
	{/if}

	<!-- File Grid -->
	<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
		{#if !workspace}
			<div class="col-span-full py-20 text-center rounded-[2.5rem] border border-slate-800/40 border-dashed">
				<HardDrive class="h-12 w-12 text-slate-700 mx-auto mb-4" />
				<p class="text-slate-500 font-medium">{$t("Refresh to view your cloud files.")}</p>
				<button on:click={refreshWorkspace} class="mt-6 text-indigo-400 hover:text-indigo-300 text-sm font-bold uppercase tracking-widest flex items-center gap-2 mx-auto">
					{$t("Load Workspace")}
					<ArrowRight class="h-3 w-3" />
				</button>
			</div>
		{:else if workspace.files.length === 0}
			<div class="col-span-full py-20 text-center">
				<FileQuestion class="h-12 w-12 text-slate-700 mx-auto mb-4" />
				<p class="text-slate-500 font-medium">{$t("The Gist is empty.")}</p>
			</div>
		{:else}
			{#each workspace.files as file (file.filename)}
				<div 
					transition:fade
					class="group flex flex-col rounded-3xl border border-slate-800/60 bg-slate-900/40 p-6 transition-all hover:bg-slate-900/60 hover:border-slate-700/60"
				>
					<div class="flex items-start justify-between gap-4 mb-4">
						<div class={cn(
							"flex h-12 w-12 items-center justify-center rounded-2xl shadow-inner transition-colors",
							isConfigFile(file.filename) ? "bg-indigo-500/10 text-indigo-400" :
							isManagedOutput(file.filename) ? "bg-emerald-500/10 text-emerald-400" :
							"bg-slate-800 text-slate-500"
						)}>
							{#if isConfigFile(file.filename)}<ShieldCheck class="h-6 w-6" />
							{:else if isManagedOutput(file.filename)}<Layers class="h-6 w-6" />
							{:else}<FileCode class="h-6 w-6" />{/if}
						</div>
						
						<div class="flex items-center gap-1">
							{#if file.rawUrl}
								<a 
									href={file.rawUrl} 
									target="_blank" 
									rel="noreferrer"
									class="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-all"
									title="Open Stable URL"
								>
									<ExternalLink class="h-4 w-4" />
								</a>
								<button 
									on:click={() => copyLink(file.rawUrl)}
									class="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-all"
									title="Copy Stable URL"
								>
									<Copy class="h-4 w-4" />
								</button>
							{/if}
							{#if canDelete(file.filename)}
								<button 
									on:click={() => deleteWorkspaceFile(file.filename)}
									disabled={deleting}
									class="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all"
									title="Delete File"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							{/if}
						</div>
					</div>

					<div class="space-y-1 min-w-0">
						<div class="flex items-center gap-2 min-w-0">
							<h3 class="font-bold text-white truncate" title={file.filename}>{file.filename}</h3>
							{#if isManagedOutput(file.filename)}
								<div class="group/tooltip relative inline-flex shrink-0">
									<button
										type="button"
										class="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-500 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none"
										aria-label={$t("Stable link help")}
										title={$t("Stable link help")}
									>
										<CircleHelp class="h-3.5 w-3.5" />
									</button>
									<div class="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-64 rounded-2xl border border-slate-800 bg-slate-950/95 px-3 py-2 text-[11px] leading-relaxed text-slate-300 shadow-2xl group-hover/tooltip:block group-focus-within/tooltip:block">
										{$t("Keep the same file name to keep the stable link unchanged across republishes.")}
									</div>
								</div>
							{/if}
						</div>
						<p class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{file.size} Bytes</p>
					</div>

					<div class="mt-6 pt-4 border-t border-slate-800/60 flex items-center justify-between">
						{#if isConfigFile(file.filename)}
							<span class="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">{$t("Protected Config")}</span>
						{:else if isManagedOutput(file.filename)}
							<span class="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">{$t("Managed Output")}</span>
						{:else}
							<span class="text-[10px] font-bold text-slate-600 uppercase tracking-widest">{$t("Unmanaged File")}</span>
						{/if}
						
						<div class="flex h-2 w-2 rounded-full shadow-[0_0_8px] transition-shadow" 
							class:bg-indigo-500={isConfigFile(file.filename)}
							class:shadow-indigo-500={isConfigFile(file.filename)}
							class:bg-emerald-500={isManagedOutput(file.filename)}
							class:shadow-emerald-500={isManagedOutput(file.filename)}
							class:bg-slate-700={!isConfigFile(file.filename) && !isManagedOutput(file.filename)}
						></div>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
