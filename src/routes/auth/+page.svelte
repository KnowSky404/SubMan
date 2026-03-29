<script lang="ts">
	import { browser } from "$app/environment";
	import { onDestroy, onMount } from "svelte";
	import { t } from "$lib/i18n";
	import { appState, replaceState } from "$lib/stores/app";
	import { authState, clearAuth, setToken } from "$lib/stores/auth";
	import { exportState, exportSyncState, getSyncStateSignature, importState } from "$lib/serialization";
	import { getGistFileContent, updateGist } from "$lib/gist";
	import { ensureWorkspaceGist, WORKSPACE_FILE } from "$lib/workspace";
	import { setSyncBaseline } from "$lib/sync";
	import { requestConfirm } from "$lib/stores/confirm";
	import { toastStore } from "$lib/stores/toast";
	import { cn } from "$lib/utils/cn";
	import { 
		KeyRound, 
		ShieldCheck, 
		Database, 
		RefreshCw, 
		Download, 
		Upload, 
		Copy, 
		CheckCircle2, 
		AlertTriangle,
		History,
		ExternalLink,
		X,
		Trash2,
		Save,
		ArrowRightLeft,
		Info,
		Settings,
		Github,
		FileJson,
		ArrowDown,
		ArrowUp
	} from "lucide-svelte";
	import { fade, slide, fly } from "svelte/transition";
	import type { AppState } from "$lib/models";

	let tokenInput = "";
	let payload = "";
	let workspaceBusy = false;

	// Conflict State
	let conflict: {
		gistId: string;
		remoteState: AppState;
		remoteSignature: string;
		localSignature: string;
	} | null = null;

	function setStatus(message: string, type: 'success' | 'info' | 'error' = 'success') {
		toastStore.show(message, type);
	}

	async function handleTokenSave() {
		const token = tokenInput.trim();
		if (!token) return;
		workspaceBusy = true;
		conflict = null;
		try {
			setToken(token);
			const localPayload = exportSyncState($appState);
			const localSignature = getSyncStateSignature($appState);
			const { gist, created } = await ensureWorkspaceGist(token, localPayload);

			if (created) {
				appState.update(s => ({ ...s, activeGistId: gist.id, lastUpdated: new Date().toISOString() }));
				setSyncBaseline(localSignature);
				setStatus($t("Workspace created and connected"), 'success');
				tokenInput = "";
				return;
			}

			// Existing Gist - Check for content
			const remoteContent = await getGistFileContent(token, gist.id, WORKSPACE_FILE);
			const remoteState = importState(remoteContent);
			const remoteSignature = getSyncStateSignature(remoteState);

			if (remoteSignature === localSignature) {
				appState.update(s => ({ ...s, activeGistId: gist.id }));
				setSyncBaseline(remoteSignature);
				setStatus($t("Workspace connected (In Sync)"), 'success');
				tokenInput = "";
			} else {
				// Conflict!
				conflict = {
					gistId: gist.id,
					remoteState,
					remoteSignature,
					localSignature
				};
				setStatus($t("Sync conflict detected"), 'info');
			}
		} catch (err) {
			setStatus(err instanceof Error ? err.message : $t("Connection failed"), 'error');
		} finally { workspaceBusy = false; }
	}

	async function handleResolveConflict(action: 'local' | 'remote') {
		if (!conflict || !$authState.token) return;
		workspaceBusy = true;
		try {
			if (action === 'remote') {
				replaceState(conflict.remoteState);
				appState.update(s => ({ ...s, activeGistId: conflict!.gistId }));
				setSyncBaseline(conflict.remoteSignature);
				setStatus($t("Remote data loaded"), 'success');
			} else {
				const localPayload = exportSyncState($appState);
				await updateGist($authState.token, {
					gistId: conflict.gistId,
					files: { [WORKSPACE_FILE]: { content: localPayload } }
				});
				appState.update(s => ({ ...s, activeGistId: conflict!.gistId }));
				setSyncBaseline(conflict.localSignature);
				setStatus($t("Local data pushed to Gist"), 'success');
			}
			conflict = null;
			tokenInput = "";
		} catch (err) {
			setStatus($t("Resolution failed"), 'error');
		} finally { workspaceBusy = false; }
	}

	async function handleManualPull() {
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId) return;
		
		workspaceBusy = true;
		try {
			const remoteContent = await getGistFileContent(token, gistId, WORKSPACE_FILE);
			const remoteState = importState(remoteContent);
			const remoteSignature = getSyncStateSignature(remoteState);
			const localSignature = getSyncStateSignature($appState);

			if (remoteSignature === localSignature) {
				setStatus($t("Already in sync"), 'info');
			} else {
				const confirmed = await requestConfirm({
					title: $t("Sync Update"),
					message: $t("Remote data is different. Overwrite local with remote?"),
					confirmText: $t("Pull Remote")
				});
				if (confirmed) {
					replaceState(remoteState);
					appState.update(s => ({ ...s, activeGistId: gistId }));
					setSyncBaseline(remoteSignature);
					setStatus($t("Pulled successfully"), 'success');
				}
			}
		} catch (err) {
			setStatus($t("Pull failed"), 'error');
		} finally { workspaceBusy = false; }
	}

	function handleTokenClear() {
		clearAuth();
		appState.update(s => ({ ...s, activeGistId: null }));
		setStatus($t("Logged out"), 'info');
		conflict = null;
	}

	function handleExport() {
		payload = exportState($appState);
		setStatus($t("Config exported"), 'success');
	}

	function handleImport() {
		try {
			replaceState(importState(payload));
			setStatus($t("Config imported"), 'success');
		} catch (err) { setStatus($t("Import failed"), 'error'); }
	}
</script>

<div class="flex flex-col gap-8">
	<!-- Settings Header -->
	<div class="flex items-center gap-3 border-b border-border-default pb-4">
		<Settings class="h-6 w-6 text-fg-muted" />
		<h1 class="text-2xl font-bold">{$t("Settings")}</h1>
	</div>

	<!-- Conflict Resolution UI -->
	{#if conflict}
		<section transition:slide>
			<div class="gh-box border-orange-300 bg-orange-50 dark:bg-orange-900/10 dark:border-orange-800">
				<div class="gh-box-header border-orange-200 bg-orange-100 dark:bg-orange-900/30 flex items-center gap-2">
					<AlertTriangle class="h-4 w-4 text-orange-600" />
					<span>{$t("Sync Conflict")}</span>
				</div>
				<div class="p-4 flex flex-col gap-4">
					<p class="text-sm text-orange-800 dark:text-orange-300">
						{$t("The remote Gist contains data that differs from your local browser state. How would you like to proceed?")}
					</p>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<button class="gh-btn flex flex-col items-center py-4 gap-2" on:click={() => handleResolveConflict('remote')}>
							<ArrowDown class="h-5 w-5 text-accent-fg" />
							<span class="font-bold">{$t("Use Remote Data")}</span>
							<span class="text-[10px] text-fg-muted">{$t("Overwrite local with Gist data")}</span>
						</button>
						<button class="gh-btn flex flex-col items-center py-4 gap-2" on:click={() => handleResolveConflict('local')}>
							<ArrowUp class="h-5 w-5 text-green-600" />
							<span class="font-bold">{$t("Use Local Data")}</span>
							<span class="text-[10px] text-fg-muted">{$t("Overwrite Gist with local browser data")}</span>
						</button>
					</div>
				</div>
			</div>
		</section>
	{/if}

	<!-- GitHub Connection -->
	<section>
		<div class="flex items-center justify-between mb-2">
			<h2 class="text-lg font-bold flex items-center gap-2"><Github class="h-5 w-5" />{$t("GitHub Workspace")}</h2>
			{#if $authState.token}
				<span class="State State--success"><CheckCircle2 class="h-3 w-3" />{$t("Connected")}</span>
			{:else}
				<span class="State State--muted">{$t("Local Mode")}</span>
			{/if}
		</div>
		
		<div class="gh-box">
			<div class="gh-box-header">{$t("Authentication")}</div>
			<div class="p-4 bg-canvas-default flex flex-col gap-4">
				<p class="text-sm text-fg-muted">
					{$t("SubMan stores your data in a private GitHub Gist. You'll need a Personal Access Token (classic) with 'gist' scope.")}
				</p>
				
				{#if !$authState.token}
					<div class="flex flex-col sm:flex-row gap-2">
						<input type="password" class="gh-input flex-1 font-mono" placeholder="ghp_xxxxxxxxxxxx" bind:value={tokenInput} />
						<button class="gh-btn gh-btn-primary" on:click={handleTokenSave} disabled={workspaceBusy}>
							{#if workspaceBusy}<RefreshCw class="h-4 w-4 animate-spin" />{:else}<Save class="h-4 w-4" />{/if}
							{$t("Connect")}
						</button>
					</div>
					<a href="https://github.com/settings/tokens/new?description=SubMan&scopes=gist" target="_blank" class="text-xs text-accent-fg hover:underline flex items-center gap-1">
						<ExternalLink class="h-3 w-3" /> {$t("Generate a new token on GitHub")}
					</a>
				{:else}
					<div class="flex flex-col gap-3">
						<div class="flex items-center justify-between p-3 rounded-md border border-border-default bg-canvas-subtle">
							<div class="flex items-center gap-3">
								<div class="h-8 w-8 flex items-center justify-center rounded-full bg-canvas-default border border-border-default"><ShieldCheck class="h-4 w-4 text-green-600" /></div>
								<div>
									<p class="text-sm font-bold">{$t("Token Active")}</p>
									<p class="text-xs text-fg-muted font-mono">{$appState.activeGistId || 'Searching...'}</p>
								</div>
							</div>
							<div class="flex gap-2">
								<button class="gh-btn gh-btn-sm" on:click={handleManualPull} disabled={workspaceBusy}>
									<RefreshCw class={cn("h-3.5 w-3.5 mr-1", workspaceBusy && "animate-spin")} />
									{$t("Pull Now")}
								</button>
								<button class="gh-btn gh-btn-danger gh-btn-sm" on:click={handleTokenClear}><Trash2 class="h-3.5 w-3.5" />{$t("Disconnect")}</button>
							</div>
						</div>
						<p class="text-[10px] text-fg-muted">
							{$t("Automatic sync is enabled. Every change will be pushed to GitHub automatically.")}
						</p>
					</div>
				{/if}
			</div>
		</div>
	</section>

	<!-- Local Data Management -->
	<section>
		<div class="mb-2"><h2 class="text-lg font-bold flex items-center gap-2"><Database class="h-5 w-5" />{$t("Data Management")}</h2></div>
		<div class="gh-box">
			<div class="gh-box-header">{$t("Import / Export")}</div>
			<div class="p-4 bg-canvas-default flex flex-col gap-4">
				<p class="text-sm text-fg-muted">{$t("Manually backup or restore your local configuration as a JSON payload.")}</p>
				<textarea class="gh-input gh-textarea font-mono text-xs h-32" placeholder="JSON data..." bind:value={payload}></textarea>
				<div class="flex flex-wrap gap-2">
					<button class="gh-btn flex-1" on:click={handleExport}><Upload class="h-4 w-4" />{$t("Export to JSON")}</button>
					<button class="gh-btn flex-1" on:click={handleImport}><Download class="h-4 w-4" />{$t("Import from JSON")}</button>
					<button class="gh-btn" on:click={() => { navigator.clipboard.writeText(payload); setStatus($t("Copied to clipboard")); }} disabled={!payload}><Copy class="h-4 w-4" /></button>
				</div>
			</div>
		</div>
	</section>

	<!-- About / Info -->
	<section class="blankslate">
		<FileJson class="h-10 w-10 text-fg-subtle mb-3" />
		<h3 class="text-lg font-bold">SubMan v0.1</h3>
		<p class="text-fg-muted text-sm max-w-md">
			{$t("All data is stored locally in your browser and synced to your private Gist. No third-party servers are involved.")}
		</p>
		<div class="mt-4 flex gap-4">
			<a href="https://github.com/KnowSky404/SubMan" target="_blank" class="gh-btn"><Github class="h-4 w-4" />GitHub</a>
		</div>
	</section>
</div>
