<script lang="ts">
	import { onMount } from "svelte";
	import { browser } from "$app/environment";
	import type { GistMeta } from "$lib/models";
	import { t } from "$lib/i18n";
	import { appState } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import { requestConfirm } from "$lib/stores/confirm";
	import { showToast } from "$lib/stores/toast";
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
		Search,
		X,
		Info,
		ChevronDown
	} from "lucide-svelte";
	import { fade, fly, slide } from "svelte/transition";

	let workspace: GistMeta | null = null;
	let loading = false;
	let deleting = false;
	
	function setStatus(message: string, type: 'success' | 'info' | 'error' = 'success') {
		showToast(message, type);
	}

	async function refreshWorkspace() {
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId) return;

		loading = true;
		try {
			workspace = await getGist(token, gistId);
			setStatus($t("Refreshed"), 'success');
		} catch (err) {
			setStatus($t("Failed to fetch"), 'error');
		} finally { loading = false; }
	}

	onMount(() => { if ($authState.token && $appState.activeGistId) void refreshWorkspace(); });

	async function copyLink(url?: string) {
		if (!url) return;
		try { 
			await navigator.clipboard.writeText(url); 
			setStatus($t("Copied to clipboard")); 
		} catch { 
			setStatus($t("Copy failed"), 'error'); 
		}
	}

	async function deleteFile(filename: string) {
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId || filename === WORKSPACE_FILE) return;

		const confirmed = await requestConfirm({
			title: $t("Delete File"),
			message: $t("Delete {filename} forever?", { filename }),
			confirmText: $t("Delete"),
			danger: true
		});
		if (!confirmed) return;

		deleting = true;
		try {
			workspace = await updateGist(token, { gistId, files: { [filename]: null } });
			setStatus($t("Deleted file successfully"), 'success');
		} catch (err) { setStatus($t("Delete failed"), 'error'); } 
		finally { deleting = false; }
	}
</script>

<div class="flex flex-col gap-6">
	<div class="gh-page-header">
		<div class="flex items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<Layers class="h-6 w-6 text-fg-muted" />
				<div>
					<h1 class="text-[2rem] font-semibold leading-tight">{$t("Gist Files")}</h1>
					<p class="gh-page-subtitle">{$t("Inspect the active workspace gist, copy raw URLs, and remove generated files when needed.")}</p>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<button type="button" class="gh-btn" on:click={refreshWorkspace} disabled={loading}>
					<RefreshCw class={cn("h-4 w-4", loading && "animate-spin")} />
					{$t("Refresh")}
				</button>
			</div>
		</div>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
		<!-- Workspace Info -->
		<div class="lg:col-span-1 flex flex-col gap-6">
			<div class="gh-box">
				<div class="gh-box-header text-xs">{$t("Active Gist")}</div>
				<div class="p-4 bg-canvas-default flex flex-col gap-3">
					{#if $appState.activeGistId}
						<code class="text-[10px] font-mono break-all bg-canvas-subtle p-2 rounded border border-border-default">{$appState.activeGistId}</code>
						<a href={`https://gist.github.com/${$appState.activeGistId}`} target="_blank" class="gh-btn gh-btn-sm w-full"><ExternalLink class="h-3 w-3" />{$t("View on GitHub")}</a>
					{:else}
						<p class="text-xs text-fg-muted italic">{$t("No active gist")}</p>
					{/if}
				</div>
			</div>

			<div class="blankslate p-4 py-6">
				<Database class="h-8 w-8 text-fg-subtle mb-2" />
				<p class="text-xs text-fg-muted">{$t("Managed files are automatically updated during publication.")}</p>
			</div>
		</div>

		<!-- File List -->
		<div class="lg:col-span-3 flex flex-col gap-4">
			<div class="gh-box shadow-sm">
				<div class="gh-box-header">
					<div class="flex items-center gap-2">
						<FileCode class="h-4 w-4" />
						<span>{$t("Repository Files")}</span>
					</div>
					{#if workspace}
						<span class="badge">{workspace.files.length}</span>
					{/if}
				</div>

				{#if !workspace}
					<div class="blankslate border-none">
						<RefreshCw class="h-10 w-10 text-fg-subtle mb-3 opacity-20" />
						<p class="text-fg-muted">{$t("Click refresh to load workspace files.")}</p>
					</div>
				{:else}
					{#each workspace.files as file}
						<div class="gh-box-row flex items-center justify-between gap-4 group">
							<div class="flex items-center gap-3 min-w-0">
								{#if file.filename === WORKSPACE_FILE}
									<ShieldCheck class="h-4 w-4 text-accent-fg" />
								{:else}
									<FileText class="h-4 w-4 text-fg-muted" />
								{/if}
								<div class="flex flex-col min-w-0">
									<span class="text-sm font-bold text-accent-fg hover:underline cursor-pointer truncate">{file.filename}</span>
									<span class="text-[10px] text-fg-subtle">{file.size} Bytes</span>
								</div>
								{#if file.filename === WORKSPACE_FILE}
									<span class="badge badge-success text-[9px] scale-90">Config</span>
								{/if}
							</div>
							
							<div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								{#if file.rawUrl}
									<button class="gh-btn gh-btn-sm" on:click={() => copyLink(file.rawUrl)} title={$t("Copy Raw URL")}><Copy class="h-3.5 w-3.5" /></button>
									<a href={file.rawUrl} target="_blank" class="gh-btn gh-btn-sm" title={$t("Open Raw")}><ExternalLink class="h-3.5 w-3.5" /></a>
								{/if}
								{#if file.filename !== WORKSPACE_FILE}
									<button class="gh-btn gh-btn-sm text-danger-fg" on:click={() => deleteFile(file.filename)} disabled={deleting} title={$t("Delete")}><Trash2 class="h-3.5 w-3.5" /></button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>
