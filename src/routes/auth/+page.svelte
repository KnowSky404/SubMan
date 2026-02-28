<script lang="ts">
	import { t } from "$lib/i18n";
	import { appState, replaceState } from "$lib/stores/app";
	import { authState, clearAuth, setToken } from "$lib/stores/auth";
	import { exportState, exportSyncState, importState } from "$lib/serialization";
	import { getGistFileContent, updateGist } from "$lib/gist";
	import { ensureWorkspaceGist, WORKSPACE_DESCRIPTION, WORKSPACE_FILE } from "$lib/workspace";
	import { mergeSyncState } from "$lib/merge";
	import { setSyncBaseline } from "$lib/sync";
	import { nowIso } from "$lib/utils/time";
	import { cn } from "$lib/utils/cn";
	import type { AppState } from "$lib/models";
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
		XCircle,
		Trash2,
		Save,
		ArrowRightLeft
	} from "lucide-svelte";
	import { fade, slide, fly } from "svelte/transition";

	type WorkspaceConflict = {
		gistId: string;
		localPayload: string;
		remotePayload: string;
		remoteState: AppState;
		localStats: {
			nodes: number;
			subscriptions: number;
			aggregates: number;
			publishTargets: number;
			updatedAt: string;
		};
		remoteStats: {
			nodes: number;
			subscriptions: number;
			aggregates: number;
			publishTargets: number;
			updatedAt: string;
		};
	};

	let tokenInput = "";
	let status: { type: 'info' | 'success' | 'error', message: string } | null = null;
	let payload = "";
	let workspaceBusy = false;
	let conflict: WorkspaceConflict | null = null;
	let pendingGistId: string | null = null;

	function setStatus(message: string, type: 'info' | 'success' | 'error' = 'info') {
		status = { message, type };
		if (type !== 'error') {
			setTimeout(() => {
				if (status?.message === message) status = null;
			}, 5000);
		}
	}

	function snapshotStats(state: AppState) {
		return {
			nodes: state.nodes.length,
			subscriptions: state.subscriptions.length,
			aggregates: state.aggregates.length,
			publishTargets: state.publishTargets.length,
			updatedAt: state.lastUpdated
		};
	}

	function applyWorkspaceState(next: AppState, gistId: string) {
		replaceState({
			...next,
			gists: $appState.gists,
			activeGistId: gistId,
			activeGistFile: WORKSPACE_FILE
		});
	}

	async function handleTokenSave() {
		status = null;
		conflict = null;
		pendingGistId = null;
		const token = tokenInput.trim();
		if (!token) {
			setStatus($t("Token is required."), 'error');
			return;
		}

		setToken(token);
		tokenInput = "";
		workspaceBusy = true;

		try {
			const localPayload = exportSyncState($appState);
			const { gist, created } = await ensureWorkspaceGist(token, localPayload);

			if (created) {
				appState.update((state) => ({
					...state,
					activeGistId: gist.id,
					activeGistFile: WORKSPACE_FILE,
					lastUpdated: nowIso()
				}));
				setSyncBaseline(localPayload);
				setStatus($t("Workspace gist created."), 'success');
				return;
			}

			let content: string | null = null;
			try {
				content = await getGistFileContent(token, gist.id, WORKSPACE_FILE);
			} catch (err) {
				const message = err instanceof Error ? err.message : "";
				if (message.includes("File not found in gist")) {
					await updateGist(token, {
						gistId: gist.id,
						files: {
							[WORKSPACE_FILE]: { content: localPayload }
						}
					});
					content = localPayload;
					setStatus($t("Workspace file missing. Local data seeded."), 'info');
				} else {
					throw err;
				}
			}

			if (!content) {
				setStatus($t("Workspace data unavailable."), 'error');
				return;
			}

			const remoteState = importState(content);
			const remotePayload = exportSyncState(remoteState);
			const gistMismatch = Boolean($appState.activeGistId && $appState.activeGistId !== gist.id);
			const payloadMismatch = localPayload !== remotePayload;

			pendingGistId = gist.id;
			conflict = {
				gistId: gist.id,
				localPayload,
				remotePayload,
				remoteState,
				localStats: snapshotStats($appState),
				remoteStats: snapshotStats(remoteState)
			};

			if (!gistMismatch && !payloadMismatch) {
				applyWorkspaceState(remoteState, gist.id);
				setSyncBaseline(remotePayload);
				setStatus($t("Workspace linked. No sync needed."), 'success');
				conflict = null;
			} else {
				setStatus($t("Review sync options to finish setup."), 'info');
			}
		} catch (err) {
			setStatus(err instanceof Error ? err.message : $t("Failed to setup workspace."), 'error');
		} finally {
			workspaceBusy = false;
		}
	}

	async function handleResolveConflict(action: "local" | "remote" | "merge") {
		if (!conflict || !$authState.token) return;
		workspaceBusy = true;
		status = null;

		try {
			if (action === "remote") {
				applyWorkspaceState(conflict.remoteState, conflict.gistId);
				setSyncBaseline(conflict.remotePayload);
				setStatus($t("Remote data loaded."), 'success');
				conflict = null;
				return;
			}

			const token = $authState.token;
			if (action === "local") {
				await updateGist(token, {
					gistId: conflict.gistId,
					files: { [WORKSPACE_FILE]: { content: conflict.localPayload } }
				});
				appState.update((state) => ({
					...state,
					activeGistId: conflict.gistId,
					activeGistFile: WORKSPACE_FILE,
					lastUpdated: nowIso()
				}));
				setSyncBaseline(conflict.localPayload);
				setStatus($t("Local data pushed."), 'success');
				conflict = null;
				return;
			}

			const merged = mergeSyncState($appState, conflict.remoteState);
			const mergedState: AppState = { ...$appState, ...merged, lastUpdated: nowIso() };
			const mergedPayload = exportSyncState(mergedState);
			await updateGist(token, {
				gistId: conflict.gistId,
				files: { [WORKSPACE_FILE]: { content: mergedPayload } }
			});

			applyWorkspaceState(mergedState, conflict.gistId);
			setSyncBaseline(mergedPayload);
			setStatus($t("Merged data saved."), 'success');
			conflict = null;
		} catch (err) {
			setStatus(err instanceof Error ? err.message : $t("Conflict resolution failed."), 'error');
		} finally {
			workspaceBusy = false;
		}
	}

	function linkWorkspaceOnly() {
		if (!pendingGistId) return;
		const baseline = exportSyncState($appState);
		appState.update((state) => ({
			...state,
			activeGistId: pendingGistId,
			activeGistFile: WORKSPACE_FILE,
			lastUpdated: nowIso()
		}));
		setSyncBaseline(baseline);
		setStatus($t("Workspace linked (Local only)."), 'info');
		conflict = null;
	}

	function handleTokenClear() {
		clearAuth();
		appState.update((state) => ({
			...state,
			activeGistId: null,
			activeGistFile: WORKSPACE_FILE,
			lastUpdated: nowIso()
		}));
		setStatus($t("Token cleared. Local mode."), 'info');
		conflict = null;
	}

	function handleExport() {
		payload = exportState($appState);
		setStatus($t("Export generated."), 'success');
	}

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(payload);
			setStatus($t("Copied to clipboard."), 'success');
		} catch {
			setStatus($t("Copy failed."), 'error');
		}
	}

	function handleImport() {
		try {
			const next = importState(payload);
			replaceState(next);
			setStatus($t("Import complete."), 'success');
		} catch (err) {
			setStatus(err instanceof Error ? err.message : $t("Import failed."), 'error');
		}
	}
</script>

<svelte:head>
	<title>{$t("Workspace Settings")} | {$t("SubMan")}</title>
</svelte:head>

<div class="max-w-4xl mx-auto space-y-8 pb-12">
	<!-- Page Header -->
	<header class="flex flex-col gap-2">
		<div class="flex items-center gap-3">
			<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400">
				<ShieldCheck class="h-6 w-6" />
			</div>
			<div>
				<h1 class="text-3xl font-extrabold text-white tracking-tight">{$t("Workspace Settings")}</h1>
				<p class="text-slate-400 text-sm">{$t("Configure your cloud sync and data persistence")}</p>
			</div>
		</div>
	</header>

	<!-- Status Toast -->
	{#if status}
		<div 
			transition:fly={{ y: -20, duration: 300 }}
			class={cn(
				"flex items-center gap-3 rounded-2xl p-4 border shadow-lg",
				status.type === 'success' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
				status.type === 'error' ? "bg-red-500/10 border-red-500/20 text-red-400" :
				"bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
			)}
		>
			{#if status.type === 'success'}<CheckCircle2 class="h-5 w-5 shrink-0" />
			{:else if status.type === 'error'}<XCircle class="h-5 w-5 shrink-0" />
			{:else}<AlertTriangle class="h-5 w-5 shrink-0" />{/if}
			<p class="text-sm font-medium">{status.message}</p>
			<button class="ml-auto hover:opacity-70 transition-opacity" on:click={() => status = null}>
				<Trash2 class="h-4 w-4" />
			</button>
		</div>
	{/if}

	<!-- GitHub Token Section -->
	<section class="glow-card group relative overflow-hidden rounded-[2rem] border border-slate-800/60 bg-slate-900/30 p-8 transition-all hover:border-slate-700/60">
		<div class="flex flex-col gap-6">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<KeyRound class="h-5 w-5 text-indigo-400" />
					<h2 class="text-xl font-bold text-white">{$t("GitHub Personal Access Token")}</h2>
				</div>
				<div class={cn(
					"px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border",
					$authState.token ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-slate-800 border-slate-700 text-slate-500"
				)}>
					{$authState.token ? $t("Sync Active") : $t("Offline Mode")}
				</div>
			</div>
			
			<p class="text-sm text-slate-400 leading-relaxed">
				{$t("SubMan uses a dedicated Gist ({desc}) to store your configuration. Enter your token with 'gist' scope to enable auto-sync.", { desc: WORKSPACE_DESCRIPTION })}
			</p>

			<div class="space-y-4">
				<div class="relative">
					<input
						type="password"
						class="w-full rounded-2xl border border-slate-800 bg-slate-950/50 px-5 py-4 text-sm font-mono text-white placeholder:text-slate-600 outline-none ring-offset-0 focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all"
						placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
						bind:value={tokenInput}
					/>
				</div>
				
				<div class="flex flex-wrap items-center gap-3">
					<button
						class="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-50"
						on:click={handleTokenSave}
						disabled={workspaceBusy}
					>
						{#if workspaceBusy}
							<RefreshCw class="h-4 w-4 animate-spin" />
							{$t("Verifying...")}
						{:else}
							<Save class="h-4 w-4" />
							{$t("Connect Workspace")}
						{/if}
					</button>
					
					{#if $authState.token}
						<button
							class="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-6 py-3 text-sm font-bold text-slate-300 transition-all hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 active:scale-[0.98]"
							on:click={handleTokenClear}
						>
							<Trash2 class="h-4 w-4" />
							{$t("Disconnect")}
						</button>
					{/if}

					<a 
						href="https://github.com/settings/tokens/new?description=SubMan&scopes=gist" 
						target="_blank"
						class="ml-auto flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-400 transition-colors"
					>
						{$t("Get Token")}
						<ExternalLink class="h-3 w-3" />
					</a>
				</div>
			</div>

			{#if $appState.activeGistId}
				<div class="flex items-center gap-2 rounded-xl bg-indigo-500/5 border border-indigo-500/10 p-4">
					<Database class="h-4 w-4 text-indigo-400 shrink-0" />
					<div class="min-w-0 flex-1">
						<p class="text-[10px] uppercase font-bold text-indigo-400/60 tracking-wider">{$t("Active Gist ID")}</p>
						<p class="text-xs font-mono text-slate-300 truncate">{$appState.activeGistId}</p>
					</div>
					<a 
						href="https://gist.github.com/{$appState.activeGistId}" 
						target="_blank"
						class="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-500 hover:text-white transition-colors"
					>
						<ExternalLink class="h-4 w-4" />
					</a>
				</div>
			{/if}
		</div>
	</section>

	<!-- Conflict Resolution -->
	{#if conflict}
		<section 
			class="rounded-[2rem] border border-amber-500/30 bg-amber-500/5 p-8 space-y-6"
			in:slide
		>
			<div class="flex items-center gap-3">
				<AlertTriangle class="h-6 w-6 text-amber-500" />
				<div>
					<h2 class="text-xl font-bold text-white">{$t("Sync Conflict Detected")}</h2>
					<p class="text-sm text-amber-200/60">{$t("Your local data and the cloud workspace don't match. Please choose how to resolve this.")}</p>
				</div>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<!-- Local Stats -->
				<div class="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-4 transition-all hover:bg-amber-500/10">
					<div class="flex items-center justify-between">
						<span class="text-xs font-bold uppercase tracking-widest text-amber-500">{$t("Local State")}</span>
						<History class="h-4 w-4 text-amber-500/40" />
					</div>
					<div class="space-y-2">
						{#each [
							{ label: "Nodes", val: conflict.localStats.nodes },
							{ label: "Subscriptions", val: conflict.localStats.subscriptions },
							{ label: "Aggregates", val: conflict.localStats.aggregates }
						] as item}
							<div class="flex justify-between text-sm">
								<span class="text-slate-400">{$t(item.label)}</span>
								<span class="font-bold text-white">{item.val}</span>
							</div>
						{/each}
					</div>
					<div class="pt-2 border-t border-amber-500/10">
						<p class="text-[10px] uppercase text-slate-500 font-bold tracking-widest">{$t("Last Updated")}</p>
						<p class="text-xs text-amber-200/60 font-medium">
							{new Date(conflict.localStats.updatedAt).toLocaleString()}
						</p>
					</div>
				</div>

				<!-- Remote Stats -->
				<div class="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-6 space-y-4 transition-all hover:bg-indigo-500/10">
					<div class="flex items-center justify-between">
						<span class="text-xs font-bold uppercase tracking-widest text-indigo-400">{$t("Remote Workspace")}</span>
						<RefreshCw class="h-4 w-4 text-indigo-400/40" />
					</div>
					<div class="space-y-2">
						{#each [
							{ label: "Nodes", val: conflict.remoteStats.nodes },
							{ label: "Subscriptions", val: conflict.remoteStats.subscriptions },
							{ label: "Aggregates", val: conflict.remoteStats.aggregates }
						] as item}
							<div class="flex justify-between text-sm">
								<span class="text-slate-400">{$t(item.label)}</span>
								<span class="font-bold text-white">{item.val}</span>
							</div>
						{/each}
					</div>
					<div class="pt-2 border-t border-indigo-500/10">
						<p class="text-[10px] uppercase text-slate-500 font-bold tracking-widest">{$t("Last Updated")}</p>
						<p class="text-xs text-indigo-200/60 font-medium">
							{new Date(conflict.remoteStats.updatedAt).toLocaleString()}
						</p>
					</div>
				</div>
			</div>

			<div class="flex flex-wrap gap-3 pt-4">
				<button
					class="flex-1 flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-6 py-4 text-sm font-bold text-amber-200 transition-all hover:bg-amber-500/20 active:scale-[0.98]"
					on:click={() => handleResolveConflict("local")}
					disabled={workspaceBusy}
				>
					<Upload class="h-4 w-4" />
					{$t("Use Local")}
				</button>
				<button
					class="flex-1 flex items-center justify-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-6 py-4 text-sm font-bold text-indigo-200 transition-all hover:bg-indigo-500/20 active:scale-[0.98]"
					on:click={() => handleResolveConflict("remote")}
					disabled={workspaceBusy}
				>
					<Download class="h-4 w-4" />
					{$t("Use Remote")}
				</button>
				<button
					class="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 text-sm font-extrabold text-white shadow-xl shadow-indigo-600/20 transition-all hover:opacity-90 active:scale-[0.98]"
					on:click={() => handleResolveConflict("merge")}
					disabled={workspaceBusy}
				>
					<ArrowRightLeft class="h-4 w-4" />
					{$t("Merge Both States")}
				</button>
			</div>
			
			<div class="text-center pt-2">
				<button 
					class="text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
					on:click={linkWorkspaceOnly}
				>
					{$t("Keep Local & Skip Sync")}
				</button>
			</div>
		</section>
	{/if}

	<!-- Manual Backup Section -->
	<section class="rounded-[2rem] border border-slate-800/60 bg-slate-900/10 p-8 space-y-6">
		<div class="flex items-center gap-3">
			<Database class="h-5 w-5 text-slate-500" />
			<h2 class="text-xl font-bold text-white">{$t("Backup & Migration")}</h2>
		</div>

		<div class="flex flex-wrap gap-3">
			<button
				class="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-800/50 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-slate-700 active:scale-[0.98]"
				on:click={handleExport}
			>
				<Upload class="h-4 w-4" />
				{$t("Export Config")}
			</button>
			<button
				class="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-800/50 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-slate-700 active:scale-[0.98]"
				on:click={handleImport}
			>
				<Download class="h-4 w-4" />
				{$t("Import Config")}
			</button>
			<button
				class="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-800/50 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-slate-700 active:scale-[0.98] disabled:opacity-50"
				on:click={handleCopy}
				disabled={!payload}
			>
				<Copy class="h-4 w-4" />
				{$t("Copy JSON")}
			</button>
		</div>

		<div class="relative group">
			<textarea
				class="min-h-[200px] w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-5 py-4 text-xs font-mono text-slate-400 placeholder:text-slate-700 outline-none focus:border-slate-600 transition-all"
				placeholder={$t("Exported JSON will appear here. Paste JSON to import.")}
				bind:value={payload}
			/>
			<div class="absolute inset-0 rounded-2xl pointer-events-none border border-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
		</div>
	</section>
</div>

<style>
	/* Subtle shine effect for the token card */
	.glow-card::before {
		content: '';
		position: absolute;
		top: -50%;
		left: -50%;
		width: 200%;
		height: 200%;
		background: radial-gradient(circle, rgba(99, 102, 241, 0.03) 0%, transparent 70%);
		pointer-events: none;
	}
</style>
