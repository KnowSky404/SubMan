<script lang="ts">
	import type { GistMeta } from "$lib/models";
	import { t } from "$lib/i18n";
	import { appState } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
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
		ArrowRight
	} from "lucide-svelte";
	import { fade, fly } from "svelte/transition";

	let workspace: GistMeta | null = null;
	let loading = false;
	let deleting = false;
	
	let status: { message: string, type: 'success' | 'info' | 'error' } | null = null;
	let statusTimer: ReturnType<typeof setTimeout> | null = null;

	function setStatus(message: string, type: 'success' | 'info' | 'error' = 'info') {
		status = { message, type };
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => status = null, 4000);
	}

	$: managedFiles = new Set(
		$appState.publishTargets
			.map((target) => target.fileName.trim())
			.filter(Boolean)
	);

	async function refreshWorkspace() {
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId) {
			setStatus($t("Configure workspace first."), 'error');
			return;
		}

		loading = true;
		try {
			workspace = await getGist(token, gistId);
			setStatus($t("Workspace refreshed."), 'success');
		} catch (err) {
			setStatus(err instanceof Error ? err.message : $t("Failed to fetch gist."), 'error');
		} finally {
			loading = false;
		}
	}

	async function copyLink(url?: string) {
		if (!url) { setStatus($t("Link unavailable."), 'error'); return; }
		try {
			await navigator.clipboard.writeText(url);
			setStatus($t("Link copied."));
		} catch { setStatus($t("Copy failed."), 'error'); }
	}

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

		if (!confirm($t("Delete {filename} forever?", { filename }))) return;

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

		if (!confirm($t("Delete all {count} files except config?", { count: filesToDelete.length }))) return;

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

	<!-- Stats & Clean Action -->
	<section class="flex flex-col gap-6 md:flex-row md:items-center md:justify-between p-8 rounded-[2rem] border border-slate-800/60 bg-slate-900/30 overflow-hidden relative group">
		<div class="relative z-10 flex items-center gap-6">
			<div class="flex flex-col">
				<span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{$t("Active Gist ID")}</span>
				<span class="text-sm font-mono text-slate-300">{$appState.activeGistId || $t("None")}</span>
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
									title="View Raw"
								>
									<ExternalLink class="h-4 w-4" />
								</a>
								<button 
									on:click={() => copyLink(file.rawUrl)}
									class="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-all"
									title="Copy Raw URL"
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
						<h3 class="font-bold text-white truncate" title={file.filename}>{file.filename}</h3>
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
