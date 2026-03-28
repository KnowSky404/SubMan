<script lang="ts">
	import { browser } from "$app/environment";
	import { onDestroy, onMount } from "svelte";
	import { t } from "$lib/i18n";
	import { appState, replaceState } from "$lib/stores/app";
	import { authState, clearAuth, setToken } from "$lib/stores/auth";
	import {
		exportState,
		exportSyncState,
		getSyncStateSignature,
		importState
	} from "$lib/serialization";
	import { getGist, getGistFileContent, updateGist } from "$lib/gist";
	import { ensureWorkspaceGist, WORKSPACE_DESCRIPTION, WORKSPACE_FILE } from "$lib/workspace";
	import { mergeSyncState } from "$lib/merge";
	import { requestConfirm } from "$lib/stores/confirm";
	import { getAutoSyncStatusEventName, readAutoSyncStatus, setSyncBaseline, type AutoSyncStatus } from "$lib/sync";
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
		localSignature: string;
		remotePayload: string;
		remoteSignature: string;
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

	type WorkspaceHealthItem = {
		id: string;
		label: string;
		status: "healthy" | "warning" | "error";
		detail: string;
	};

	type WorkspaceHealthReport = {
		checkedAt: string;
		items: WorkspaceHealthItem[];
	};

	type WorkspaceActivity = {
		id: string;
		at: string;
		type: 'success' | 'info' | 'warning' | 'error';
		title: string;
		detail: string;
	};

	type WorkspaceActivityFilter = "all" | "errors" | "sync" | "repairs";

	const WORKSPACE_ACTIVITY_KEY = "subman:auth:activity:v1";

	function loadWorkspaceActivity(): WorkspaceActivity[] {
		if (!browser) {
			return [];
		}

		const raw = localStorage.getItem(WORKSPACE_ACTIVITY_KEY);
		if (!raw) {
			return [];
		}

		try {
			const parsed = JSON.parse(raw) as WorkspaceActivity[];
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	let tokenInput = "";
	let status: { type: 'info' | 'success' | 'error', message: string } | null = null;
	let payload = "";
	let workspaceBusy = false;
	let healthCheckBusy = false;
	let repairBusy = false;
	let healthReport: WorkspaceHealthReport | null = null;
	let autoSyncStatus: AutoSyncStatus = readAutoSyncStatus();
	let workspaceActivity = loadWorkspaceActivity();
	let workspaceActivityFilter: WorkspaceActivityFilter = "all";
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

	$: if (browser) {
		localStorage.setItem(WORKSPACE_ACTIVITY_KEY, JSON.stringify(workspaceActivity));
	}

	function pushWorkspaceActivity(
		type: 'success' | 'info' | 'warning' | 'error',
		title: string,
		detail: string
	) {
		workspaceActivity = [
			{
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				at: nowIso(),
				type,
				title,
				detail
			},
			...workspaceActivity
		].slice(0, 12);
	}

	function matchesWorkspaceActivityFilter(activity: WorkspaceActivity, filter: WorkspaceActivityFilter): boolean {
		if (filter === "all") {
			return true;
		}
		if (filter === "errors") {
			return activity.type === "error";
		}
		if (filter === "repairs") {
			return /repair/i.test(activity.title);
		}
		return /sync|workspace linked|workspace gist created|merged data saved|local data pushed|remote data loaded/i.test(activity.title);
	}

	function getWorkspaceActivityFilterLabel(filter: WorkspaceActivityFilter): string {
		switch (filter) {
			case "errors":
				return $t("Errors");
			case "sync":
				return $t("Sync Events");
			case "repairs":
				return $t("Repairs");
			default:
				return $t("All");
		}
	}

	$: filteredWorkspaceActivity = workspaceActivity.filter((activity) =>
		matchesWorkspaceActivityFilter(activity, workspaceActivityFilter)
	);

	async function clearWorkspaceActivityLog() {
		if (workspaceActivity.length === 0) {
			return;
		}

		const confirmed = await requestConfirm({
			title: $t("Confirm Action"),
			message: $t("Clear recent workspace activity log?"),
			confirmText: $t("Clear"),
			cancelText: $t("Cancel")
		});
		if (!confirmed) {
			return;
		}

		workspaceActivity = [];
		setStatus($t("Workspace activity log cleared."), 'success');
	}

	$: autoSyncSummary = autoSyncStatus.status === "error"
		? "error"
		: autoSyncStatus.status === "success"
			? "success"
			: autoSyncStatus.status === "syncing"
				? "info"
				: null;

	onMount(() => {
		if (!browser) {
			return;
		}

		const eventName = getAutoSyncStatusEventName();
		const handleSyncStatus = (event: Event) => {
			const next = (event as CustomEvent<AutoSyncStatus>).detail;
			autoSyncStatus = next;
		};

		window.addEventListener(eventName, handleSyncStatus as EventListener);
		return () => window.removeEventListener(eventName, handleSyncStatus as EventListener);
	});

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

	$: workspaceGistUrl = $appState.activeGistId ? `https://gist.github.com/${$appState.activeGistId}` : "";

	async function copyWorkspaceGistUrl() {
		if (!workspaceGistUrl) {
			setStatus($t("Workspace gist URL unavailable."), 'error');
			return;
		}

		try {
			await navigator.clipboard.writeText(workspaceGistUrl);
			setStatus($t("Workspace gist URL copied."), 'success');
		} catch {
			setStatus($t("Clipboard copy failed."), 'error');
		}
	}

	$: healthSummary = !healthReport
		? null
		: healthReport.items.some((item) => item.status === "error")
			? "error"
			: healthReport.items.some((item) => item.status === "warning")
				? "warning"
				: "healthy";

	$: workspaceConfigRepairNeeded = Boolean(
		$authState.token &&
		$appState.activeGistId &&
		healthReport?.items.some((item) =>
			(item.id === "config-file" && item.status !== "healthy") ||
			(item.id === "config-data" && item.status === "error")
		)
	);

	async function handleRepairWorkspaceConfig() {
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId) {
			setStatus($t("Workspace repair unavailable."), 'error');
			return;
		}

		repairBusy = true;
		try {
			const localPayload = exportSyncState($appState);
			const localSignature = getSyncStateSignature($appState);
			await updateGist(token, {
				gistId,
				files: { [WORKSPACE_FILE]: { content: localPayload } }
			});
			appState.update((state) => ({
				...state,
				activeGistId: gistId,
				activeGistFile: WORKSPACE_FILE,
				lastUpdated: nowIso()
			}));
			setSyncBaseline(localSignature);
			pushWorkspaceActivity(
				"success",
				$t("Workspace config repaired."),
				$t("Workspace config file was restored from the current local state.")
			);
			setStatus($t("Workspace config repaired."), 'success');
			await runWorkspaceHealthCheck();
		} catch (err) {
			pushWorkspaceActivity(
				"error",
				$t("Workspace config repair failed."),
				err instanceof Error ? err.message : $t("Workspace config repair failed.")
			);
			setStatus(err instanceof Error ? err.message : $t("Workspace config repair failed."), 'error');
		} finally {
			repairBusy = false;
		}
	}

	async function handleManualSyncNow() {
		const token = $authState.token;
		if (!token) {
			setStatus($t("Token is required."), 'error');
			return;
		}

		workspaceBusy = true;
		try {
			const localPayload = exportSyncState($appState);
			const localSignature = getSyncStateSignature($appState);
			let gistId = $appState.activeGistId;

			if (!gistId) {
				const { gist } = await ensureWorkspaceGist(token, localPayload);
				gistId = gist.id;
				appState.update((state) => ({
					...state,
					activeGistId: gistId,
					activeGistFile: WORKSPACE_FILE,
					lastUpdated: nowIso()
				}));
			}

			await updateGist(token, {
				gistId,
				files: { [WORKSPACE_FILE]: { content: localPayload } }
			});

			setSyncBaseline(localSignature);
			conflict = null;
			pendingGistId = null;
			pushWorkspaceActivity(
				"success",
				$t("Manual workspace sync complete."),
				$t("Current local state was pushed to workspace gist {id}.", { id: gistId })
			);
			setStatus($t("Manual workspace sync complete."), 'success');
		} catch (err) {
			pushWorkspaceActivity(
				"error",
				$t("Manual workspace sync failed."),
				err instanceof Error ? err.message : $t("Manual workspace sync failed.")
			);
			setStatus(err instanceof Error ? err.message : $t("Manual workspace sync failed."), 'error');
		} finally {
			workspaceBusy = false;
		}
	}

	async function runWorkspaceHealthCheck() {
		healthCheckBusy = true;
		try {
			const items: WorkspaceHealthItem[] = [];
			const token = $authState.token;
			const gistId = $appState.activeGistId;

			items.push({
				id: "token",
				label: $t("GitHub token"),
				status: token ? "healthy" : "error",
				detail: token ? $t("GitHub token is connected.") : $t("GitHub token is missing.")
			});

			items.push({
				id: "binding",
				label: $t("Workspace binding"),
				status: gistId ? "healthy" : "warning",
				detail: gistId
					? $t("Workspace gist is bound to {id}.", { id: gistId })
					: $t("Workspace gist is not bound yet.")
			});

			if (token && gistId) {
				try {
					const gist = await getGist(token, gistId);
					items.push({
						id: "gist",
						label: $t("Workspace gist access"),
						status: "healthy",
						detail: $t("Workspace gist is reachable with {count} file(s).", { count: gist.files.length })
					});

					const configFile = gist.files.find((file) => file.filename === WORKSPACE_FILE);
					items.push({
						id: "config-file",
						label: $t("Workspace config file"),
						status: configFile ? "healthy" : "warning",
						detail: configFile
							? $t("Workspace config file {file} exists.", { file: WORKSPACE_FILE })
							: $t("Workspace config file {file} is missing.", { file: WORKSPACE_FILE })
					});

					if (configFile) {
						try {
							const content = await getGistFileContent(token, gistId, WORKSPACE_FILE);
							importState(content);
							items.push({
								id: "config-data",
								label: $t("Workspace data format"),
								status: "healthy",
								detail: $t("Workspace config data is readable.")
							});
						} catch (err) {
							items.push({
								id: "config-data",
								label: $t("Workspace data format"),
								status: "error",
								detail: err instanceof Error ? err.message : $t("Workspace data unreadable.")
							});
						}
					}
				} catch (err) {
					items.push({
						id: "gist",
						label: $t("Workspace gist access"),
						status: "error",
						detail: err instanceof Error ? err.message : $t("Workspace gist check failed.")
					});
				}
			}

			const checkedAt = nowIso();
			const summary = items.some((item) => item.status === "error")
				? "error"
				: items.some((item) => item.status === "warning")
					? "warning"
					: "healthy";
			healthReport = { checkedAt, items };
			pushWorkspaceActivity(
				summary === "error" ? "error" : summary === "warning" ? "warning" : "success",
				$t("Workspace health check complete."),
				items.map((item) => `${item.label}: ${item.detail}`).join(" | ")
			);
			setStatus($t("Workspace health check complete."), "success");
		} finally {
			healthCheckBusy = false;
		}
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
			const localSignature = getSyncStateSignature($appState);
			const { gist, created } = await ensureWorkspaceGist(token, localPayload);

			if (created) {
				appState.update((state) => ({
					...state,
					activeGistId: gist.id,
					activeGistFile: WORKSPACE_FILE,
					lastUpdated: nowIso()
				}));
				setSyncBaseline(localSignature);
				pushWorkspaceActivity("success", $t("Workspace gist created."), $t("Workspace gist is bound to {id}.", { id: gist.id }));
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
					pushWorkspaceActivity("warning", $t("Workspace file missing. Local data seeded."), $t("Workspace config file {file} is missing.", { file: WORKSPACE_FILE }));
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
			const remoteSignature = getSyncStateSignature(remoteState);
			const gistMismatch = Boolean($appState.activeGistId && $appState.activeGistId !== gist.id);
			const payloadMismatch = localSignature !== remoteSignature;

			pendingGistId = gist.id;
			conflict = {
				gistId: gist.id,
				localPayload,
				localSignature,
				remotePayload,
				remoteSignature,
				remoteState,
				localStats: snapshotStats($appState),
				remoteStats: snapshotStats(remoteState)
			};

			if (!gistMismatch && !payloadMismatch) {
				applyWorkspaceState(remoteState, gist.id);
				setSyncBaseline(remoteSignature);
				pushWorkspaceActivity("success", $t("Workspace linked. No sync needed."), $t("Workspace gist is bound to {id}.", { id: gist.id }));
				setStatus($t("Workspace linked. No sync needed."), 'success');
				conflict = null;
			} else {
				pushWorkspaceActivity("warning", $t("Review sync options to finish setup."), $t("Workspace gist is bound to {id}.", { id: gist.id }));
				setStatus($t("Review sync options to finish setup."), 'info');
			}
		} catch (err) {
			pushWorkspaceActivity("error", $t("Failed to setup workspace."), err instanceof Error ? err.message : $t("Failed to setup workspace."));
			setStatus(err instanceof Error ? err.message : $t("Failed to setup workspace."), 'error');
		} finally {
			workspaceBusy = false;
		}
	}

	async function handleResolveConflict(action: "local" | "remote" | "merge") {
		const activeConflict = conflict;
		if (!activeConflict || !$authState.token) return;
		workspaceBusy = true;
		status = null;

		try {
			if (action === "remote") {
				applyWorkspaceState(activeConflict.remoteState, activeConflict.gistId);
				setSyncBaseline(activeConflict.remoteSignature);
				pushWorkspaceActivity("success", $t("Remote data loaded."), $t("Remote workspace state replaced the local view."));
				setStatus($t("Remote data loaded."), 'success');
				conflict = null;
				return;
			}

			const token = $authState.token;
			if (!token) return;
			if (action === "local") {
				await updateGist(token, {
					gistId: activeConflict.gistId,
					files: { [WORKSPACE_FILE]: { content: activeConflict.localPayload } }
				});
				appState.update((state) => ({
					...state,
					activeGistId: activeConflict.gistId,
					activeGistFile: WORKSPACE_FILE,
					lastUpdated: nowIso()
				}));
				setSyncBaseline(activeConflict.localSignature);
				pushWorkspaceActivity("success", $t("Local data pushed."), $t("Local state was uploaded to the workspace gist."));
				setStatus($t("Local data pushed."), 'success');
				conflict = null;
				return;
			}

			const merged = mergeSyncState($appState, activeConflict.remoteState);
			const mergedState: AppState = { ...$appState, ...merged, lastUpdated: nowIso() };
			const mergedPayload = exportSyncState(mergedState);
			const mergedSignature = getSyncStateSignature(mergedState);
			await updateGist(token, {
				gistId: activeConflict.gistId,
				files: { [WORKSPACE_FILE]: { content: mergedPayload } }
			});

			applyWorkspaceState(mergedState, activeConflict.gistId);
			setSyncBaseline(mergedSignature);
			pushWorkspaceActivity("success", $t("Merged data saved."), $t("Local and remote workspace states were merged and saved."));
			setStatus($t("Merged data saved."), 'success');
			conflict = null;
		} catch (err) {
			pushWorkspaceActivity("error", $t("Conflict resolution failed."), err instanceof Error ? err.message : $t("Conflict resolution failed."));
			setStatus(err instanceof Error ? err.message : $t("Conflict resolution failed."), 'error');
		} finally {
			workspaceBusy = false;
		}
	}

	function linkWorkspaceOnly() {
		if (!pendingGistId) return;
		const baseline = getSyncStateSignature($appState);
		appState.update((state) => ({
			...state,
			activeGistId: pendingGistId,
			activeGistFile: WORKSPACE_FILE,
			lastUpdated: nowIso()
		}));
		setSyncBaseline(baseline);
		pushWorkspaceActivity("info", $t("Workspace linked (Local only)."), $t("Workspace gist is bound to {id}.", { id: pendingGistId }));
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
		pushWorkspaceActivity("info", $t("Token cleared. Local mode."), $t("Workspace sync is disabled until a token is connected again."));
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
							class="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-6 py-3 text-sm font-bold text-slate-300 transition-all hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50"
							on:click={handleManualSyncNow}
							disabled={workspaceBusy}
						>
							<Upload class="h-4 w-4" />
							{$t("Sync Local State Now")}
						</button>
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
					<button
						type="button"
						on:click={copyWorkspaceGistUrl}
						class="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-500 hover:text-white transition-colors"
						title={$t("Copy workspace gist URL")}
					>
						<Copy class="h-4 w-4" />
					</button>
					<a 
						href={workspaceGistUrl} 
						target="_blank"
						class="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-500 hover:text-white transition-colors"
						title={$t("Open workspace gist")}
					>
						<ExternalLink class="h-4 w-4" />
					</a>
				</div>
			{/if}
		</div>
	</section>

	<section class="rounded-[2rem] border border-slate-800/60 bg-slate-900/10 p-8 space-y-6">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div class="flex items-start gap-3">
				<ShieldCheck class="h-5 w-5 text-emerald-400" />
				<div>
					<h2 class="text-xl font-bold text-white">{$t("Workspace Health")}</h2>
					<p class="text-sm leading-relaxed text-slate-400">{$t("Run a quick check for token access, gist binding, workspace config, and readable sync data.")}</p>
				</div>
			</div>

			<div class="flex items-center gap-3">
				{#if healthSummary}
					<div class={cn(
						"rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
						healthSummary === "healthy"
							? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
							: healthSummary === "warning"
								? "border-amber-500/20 bg-amber-500/10 text-amber-300"
								: "border-red-500/20 bg-red-500/10 text-red-300"
					)}>
						{$t(healthSummary === "healthy" ? "Healthy" : healthSummary === "warning" ? "Needs attention" : "Action needed")}
					</div>
				{/if}

				<button
					type="button"
					on:click={runWorkspaceHealthCheck}
					disabled={healthCheckBusy}
					class="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50"
				>
					<RefreshCw class={cn("h-4 w-4", healthCheckBusy && "animate-spin")} />
					{healthCheckBusy ? $t("Checking...") : $t("Run Health Check")}
				</button>
				{#if workspaceConfigRepairNeeded}
					<button
						type="button"
						on:click={handleRepairWorkspaceConfig}
						disabled={repairBusy}
						class="inline-flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-5 py-3 text-sm font-bold text-amber-200 transition-all hover:bg-amber-500/15 active:scale-[0.98] disabled:opacity-50"
					>
						<ShieldCheck class={cn("h-4 w-4", repairBusy && "animate-pulse")} />
						{repairBusy ? $t("Repairing...") : $t("Repair Workspace Config")}
					</button>
				{/if}
			</div>
		</div>

		{#if healthReport}
			<div class="space-y-4">
				<p class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{$t("Last checked: {time}", { time: new Date(healthReport.checkedAt).toLocaleString() })}</p>
				<div class="grid gap-4 md:grid-cols-2">
					{#each healthReport.items as item (item.id)}
						<div class="rounded-2xl border border-slate-800/60 bg-slate-950/40 p-5 space-y-2">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="text-sm font-bold text-white">{item.label}</p>
								</div>
								<div class={cn(
									"rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
									item.status === "healthy"
										? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
										: item.status === "warning"
											? "border-amber-500/20 bg-amber-500/10 text-amber-300"
											: "border-red-500/20 bg-red-500/10 text-red-300"
								)}>
									{$t(item.status === "healthy" ? "Healthy" : item.status === "warning" ? "Warning" : "Error")}
								</div>
							</div>
							<p class="text-sm leading-relaxed text-slate-400">{item.detail}</p>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</section>

	<section class="rounded-[2rem] border border-slate-800/60 bg-slate-900/10 p-8 space-y-6">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div class="flex items-start gap-3">
				<RefreshCw class={cn("h-5 w-5", autoSyncStatus.status === "syncing" ? "animate-spin text-indigo-400" : autoSyncStatus.status === "error" ? "text-red-400" : "text-emerald-400")} />
				<div>
					<h2 class="text-xl font-bold text-white">{$t("Last Auto Sync")}</h2>
					<p class="text-sm leading-relaxed text-slate-400">{$t("See the latest background sync status from this browser session and the most recent saved result.")}</p>
				</div>
			</div>

			{#if autoSyncSummary}
				<div class={cn(
					"rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
					autoSyncSummary === "success"
						? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
						: autoSyncSummary === "error"
							? "border-red-500/20 bg-red-500/10 text-red-300"
							: "border-indigo-500/20 bg-indigo-500/10 text-indigo-300"
				)}>
					{$t(autoSyncStatus.status === "success" ? "Last sync succeeded" : autoSyncStatus.status === "error" ? "Last sync failed" : "Sync in progress") }
				</div>
			{/if}
		</div>

		<div class="grid gap-4 md:grid-cols-2">
			<div class="rounded-2xl border border-slate-800/60 bg-slate-950/40 p-5 space-y-2">
				<p class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{$t("Latest attempt")}</p>
				<p class="text-sm font-semibold text-white">{autoSyncStatus.lastAttemptAt ? new Date(autoSyncStatus.lastAttemptAt).toLocaleString() : $t("No auto sync attempt yet.")}</p>
				<p class="text-sm leading-relaxed text-slate-400">{$t("Sync target file: {file}", { file: autoSyncStatus.lastSyncedFile ?? WORKSPACE_FILE })}</p>
			</div>
			<div class="rounded-2xl border border-slate-800/60 bg-slate-950/40 p-5 space-y-2">
				<p class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{$t("Latest result")}</p>
				<p class="text-sm font-semibold text-white">
					{#if autoSyncStatus.status === "success" && autoSyncStatus.lastSuccessAt}
						{$t("Last sync succeeded at {time}", { time: new Date(autoSyncStatus.lastSuccessAt).toLocaleString() })}
					{:else if autoSyncStatus.status === "error" && autoSyncStatus.lastErrorAt}
						{$t("Last sync failed at {time}", { time: new Date(autoSyncStatus.lastErrorAt).toLocaleString() })}
					{:else if autoSyncStatus.status === "syncing"}
						{$t("Sync in progress") }
					{:else}
						{$t("No sync result yet.")}
					{/if}
				</p>
				<p class="text-sm leading-relaxed text-slate-400">
					{#if autoSyncStatus.lastErrorMessage}
						{$t("Failure reason: {message}", { message: autoSyncStatus.lastErrorMessage })}
					{:else}
						{$t("Background sync updates this status automatically when local changes are pushed to the workspace gist.")}
					{/if}
				</p>
			</div>
		</div>
	</section>

	<section class="rounded-[2rem] border border-slate-800/60 bg-slate-900/10 p-8 space-y-6">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div class="flex items-start gap-3">
				<History class="h-5 w-5 text-indigo-400" />
				<div>
					<h2 class="text-xl font-bold text-white">{$t("Recent Workspace Activity")}</h2>
					<p class="text-sm leading-relaxed text-slate-400">{$t("Track recent workspace setup, sync, and repair actions on this device.")}</p>
				</div>
			</div>

			{#if workspaceActivity.length > 0}
				<div class="flex flex-wrap items-center justify-end gap-2">
					{#each ["all", "errors", "sync", "repairs"] as filter}
						<button
							type="button"
							on:click={() => (workspaceActivityFilter = filter as WorkspaceActivityFilter)}
							class={cn(
								"inline-flex items-center rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-all",
								workspaceActivityFilter === filter
									? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
									: "border-slate-800 bg-slate-900/50 text-slate-400 hover:bg-slate-800 hover:text-white"
							)}
						>
							{getWorkspaceActivityFilterLabel(filter as WorkspaceActivityFilter)}
						</button>
					{/each}
					<button
						type="button"
						on:click={clearWorkspaceActivityLog}
						class="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
					>
						<Trash2 class="h-3.5 w-3.5" />
						{$t("Clear history")}
					</button>
				</div>
			{/if}
		</div>

		{#if filteredWorkspaceActivity.length === 0}
			<div class="rounded-3xl border border-slate-800/60 border-dashed bg-slate-950/40 px-6 py-10 text-center">
				<p class="text-sm font-medium text-slate-400">{$t("No recent workspace activity yet.")}</p>
			</div>
		{:else}
			<div class="space-y-4">
				{#each filteredWorkspaceActivity as activity (activity.id)}
					<div class="rounded-2xl border border-slate-800/60 bg-slate-950/40 p-5 space-y-2">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="text-sm font-bold text-white">{activity.title}</p>
								<p class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{$t("Updated: {time}", { time: new Date(activity.at).toLocaleString() })}</p>
							</div>
							<div class={cn(
								"rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
								activity.type === "success"
									? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
									: activity.type === "warning"
										? "border-amber-500/20 bg-amber-500/10 text-amber-300"
										: activity.type === "error"
											? "border-red-500/20 bg-red-500/10 text-red-300"
											: "border-indigo-500/20 bg-indigo-500/10 text-indigo-300"
							)}>{$t(activity.type === "success" ? "Healthy" : activity.type === "warning" ? "Warning" : activity.type === "error" ? "Error" : "Info")}</div>
						</div>
						<p class="text-sm leading-relaxed text-slate-400">{activity.detail}</p>
					</div>
				{/each}
			</div>
		{/if}
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
			></textarea>
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
