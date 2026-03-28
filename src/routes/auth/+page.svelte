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

<div class="page-stack page-stack--narrow">
	<header class="page-hero surface-card">
		<div class="page-hero__intro">
			<div class="page-hero__icon">
				<ShieldCheck class="h-6 w-6" />
			</div>
			<div class="page-hero__body">
				<p class="page-hero__eyebrow">{$t("Workspace")}</p>
				<h1 class="page-hero__title">{$t("Workspace Settings")}</h1>
				<p class="page-hero__description">{$t("Configure your cloud sync and data persistence")}</p>
			</div>
		</div>

		<div class="page-hero__actions">
			<a href="/gists" class="button-secondary">
				<Database class="h-4 w-4" />
				{$t("Gists")}
			</a>
			<a href="/aggregate" class="button-primary">
				<ArrowRightLeft class="h-4 w-4" />
				{$t("Aggregate")}
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
			{:else if status.type === "error"}<XCircle class="h-5 w-5 shrink-0" />
			{:else}<AlertTriangle class="h-5 w-5 shrink-0" />{/if}
			<span class="text-sm font-bold text-[var(--app-text)]">{status.message}</span>
		</div>
	{/if}

	<section class="surface-card section-card section-card--accent">
		<div class="section-card__header">
			<div class="section-card__header-main">
				<div class="section-card__icon">
					<KeyRound class="h-5 w-5" />
				</div>
				<div class="section-card__title-wrap">
					<h2 class="section-card__title">{$t("GitHub Personal Access Token")}</h2>
					<p class="section-card__text">
						{$t("SubMan uses a dedicated Gist ({desc}) to store your configuration. Enter your token with 'gist' scope to enable auto-sync.", { desc: WORKSPACE_DESCRIPTION })}
					</p>
				</div>
			</div>

			<span class={cn("inline-badge", $authState.token ? "inline-badge--success" : "")}>
				{$authState.token ? $t("Sync Active") : $t("Offline Mode")}
			</span>
		</div>

		<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
			<div class="space-y-2">
				<label class="field-label" for="workspace-token">{$t("GitHub Personal Access Token")}</label>
				<input
					id="workspace-token"
					type="password"
					class="field-input field-input--mono"
					placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
					bind:value={tokenInput}
				/>
			</div>

			<div class="section-card__actions">
				<button type="button" class="button-primary" on:click={handleTokenSave} disabled={workspaceBusy}>
					{#if workspaceBusy}
						<RefreshCw class="h-4 w-4 animate-spin" />
						{$t("Verifying...")}
					{:else}
						<Save class="h-4 w-4" />
						{$t("Connect Workspace")}
					{/if}
				</button>

				{#if $authState.token}
					<button type="button" class="button-secondary" on:click={handleManualSyncNow} disabled={workspaceBusy}>
						<Upload class="h-4 w-4" />
						{$t("Sync Local State Now")}
					</button>
					<button type="button" class="button-danger" on:click={handleTokenClear}>
						<Trash2 class="h-4 w-4" />
						{$t("Disconnect")}
					</button>
				{/if}
			</div>
		</div>

		<div class="section-card__actions">
			<a
				href="https://github.com/settings/tokens/new?description=SubMan&scopes=gist"
				target="_blank"
				class="button-secondary"
			>
				<ExternalLink class="h-4 w-4" />
				{$t("Get Token")}
			</a>
		</div>

		<div class="metric-grid">
			<div class="metric-card">
				<p class="metric-card__label">{$t("Mode")}</p>
				<p class="metric-card__value">{$authState.token ? $t("Connected") : $t("Local Mode")}</p>
				<p class="metric-card__meta">{$t("Workspace Sync")}</p>
			</div>
			<div class="metric-card">
				<p class="metric-card__label">{$t("Active Gist ID")}</p>
				<p class="metric-card__meta font-mono break-all">{$appState.activeGistId || $t("None")}</p>
			</div>
			<div class="metric-card">
				<p class="metric-card__label">{$t("Workspace config")}</p>
				<p class="metric-card__meta font-mono">{WORKSPACE_FILE}</p>
			</div>
		</div>

		{#if $appState.activeGistId}
			<div class="soft-code">{$appState.activeGistId}</div>
			<div class="section-card__actions">
				<button type="button" on:click={copyWorkspaceGistUrl} class="button-secondary">
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
					<ShieldCheck class="h-5 w-5" />
				</div>
				<div class="section-card__title-wrap">
					<h2 class="section-card__title">{$t("Workspace Health")}</h2>
					<p class="section-card__text">{$t("Run a quick check for token access, gist binding, workspace config, and readable sync data.")}</p>
				</div>
			</div>

			<div class="section-card__actions">
				{#if healthSummary}
					<span
						class={cn(
							"inline-badge",
							healthSummary === "healthy"
								? "inline-badge--success"
								: healthSummary === "warning"
									? "inline-badge--warning"
									: "inline-badge--danger"
						)}
					>
						{$t(healthSummary === "healthy" ? "Healthy" : healthSummary === "warning" ? "Needs attention" : "Action needed")}
					</span>
				{/if}

				<button type="button" on:click={runWorkspaceHealthCheck} disabled={healthCheckBusy} class="button-secondary">
					<RefreshCw class={cn("h-4 w-4", healthCheckBusy && "animate-spin")} />
					{healthCheckBusy ? $t("Checking...") : $t("Run Health Check")}
				</button>
				{#if workspaceConfigRepairNeeded}
					<button type="button" on:click={handleRepairWorkspaceConfig} disabled={repairBusy} class="button-secondary">
						<ShieldCheck class={cn("h-4 w-4", repairBusy && "animate-pulse")} />
						{repairBusy ? $t("Repairing...") : $t("Repair Workspace Config")}
					</button>
				{/if}
			</div>
		</div>

		{#if healthReport}
			<p class="metric-card__meta">{$t("Last checked: {time}", { time: new Date(healthReport.checkedAt).toLocaleString() })}</p>
			<div class="grid gap-4 md:grid-cols-2">
				{#each healthReport.items as item (item.id)}
					<div class="surface-card section-card section-card--compact">
						<div class="flex items-start justify-between gap-3">
							<p class="text-sm font-bold text-[var(--app-text)]">{item.label}</p>
							<span
								class={cn(
									"inline-badge",
									item.status === "healthy"
										? "inline-badge--success"
										: item.status === "warning"
											? "inline-badge--warning"
											: "inline-badge--danger"
								)}
							>
								{$t(item.status === "healthy" ? "Healthy" : item.status === "warning" ? "Warning" : "Error")}
							</span>
						</div>
						<p class="section-card__text">{item.detail}</p>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="surface-card section-card">
		<div class="section-card__header">
			<div class="section-card__header-main">
				<div class="section-card__icon">
					<RefreshCw class={cn("h-5 w-5", autoSyncStatus.status === "syncing" && "animate-spin")} />
				</div>
				<div class="section-card__title-wrap">
					<h2 class="section-card__title">{$t("Last Auto Sync")}</h2>
					<p class="section-card__text">{$t("See the latest background sync status from this browser session and the most recent saved result.")}</p>
				</div>
			</div>

			{#if autoSyncSummary}
				<span
					class={cn(
						"inline-badge",
						autoSyncSummary === "success"
							? "inline-badge--success"
							: autoSyncSummary === "error"
								? "inline-badge--danger"
								: "inline-badge--accent"
					)}
				>
					{$t(autoSyncStatus.status === "success" ? "Last sync succeeded" : autoSyncStatus.status === "error" ? "Last sync failed" : "Sync in progress")}
				</span>
			{/if}
		</div>

		<div class="metric-grid">
			<div class="metric-card">
				<p class="metric-card__label">{$t("Latest attempt")}</p>
				<p class="metric-card__meta">
					{autoSyncStatus.lastAttemptAt ? new Date(autoSyncStatus.lastAttemptAt).toLocaleString() : $t("No auto sync attempt yet.")}
				</p>
				<p class="metric-card__meta">{$t("Sync target file: {file}", { file: autoSyncStatus.lastSyncedFile ?? WORKSPACE_FILE })}</p>
			</div>
			<div class="metric-card">
				<p class="metric-card__label">{$t("Latest result")}</p>
				<p class="metric-card__meta">
					{#if autoSyncStatus.status === "success" && autoSyncStatus.lastSuccessAt}
						{$t("Last sync succeeded at {time}", { time: new Date(autoSyncStatus.lastSuccessAt).toLocaleString() })}
					{:else if autoSyncStatus.status === "error" && autoSyncStatus.lastErrorAt}
						{$t("Last sync failed at {time}", { time: new Date(autoSyncStatus.lastErrorAt).toLocaleString() })}
					{:else if autoSyncStatus.status === "syncing"}
						{$t("Sync in progress")}
					{:else}
						{$t("No sync result yet.")}
					{/if}
				</p>
				<p class="metric-card__meta">
					{#if autoSyncStatus.lastErrorMessage}
						{$t("Failure reason: {message}", { message: autoSyncStatus.lastErrorMessage })}
					{:else}
						{$t("Background sync updates this status automatically when local changes are pushed to the workspace gist.")}
					{/if}
				</p>
			</div>
		</div>
	</section>

	<section class="surface-card section-card">
		<div class="section-card__header">
			<div class="section-card__header-main">
				<div class="section-card__icon">
					<History class="h-5 w-5" />
				</div>
				<div class="section-card__title-wrap">
					<h2 class="section-card__title">{$t("Recent Workspace Activity")}</h2>
					<p class="section-card__text">{$t("Track recent workspace setup, sync, and repair actions on this device.")}</p>
				</div>
			</div>

			{#if workspaceActivity.length > 0}
				<div class="section-card__actions">
					<div class="filter-pills">
						{#each ["all", "errors", "sync", "repairs"] as filter}
							<button
								type="button"
								on:click={() => (workspaceActivityFilter = filter as WorkspaceActivityFilter)}
								class={cn("filter-pill", workspaceActivityFilter === filter && "filter-pill--active")}
							>
								{getWorkspaceActivityFilterLabel(filter as WorkspaceActivityFilter)}
							</button>
						{/each}
					</div>
					<button type="button" on:click={clearWorkspaceActivityLog} class="button-secondary">
						<Trash2 class="h-4 w-4" />
						{$t("Clear history")}
					</button>
				</div>
			{/if}
		</div>

		{#if filteredWorkspaceActivity.length === 0}
			<div class="empty-state">
				<div class="empty-state__icon">
					<History class="h-6 w-6" />
				</div>
				<p class="empty-state__title">{$t("No recent workspace activity yet.")}</p>
			</div>
		{:else}
			<div class="grid gap-4">
				{#each filteredWorkspaceActivity as activity (activity.id)}
					<div class="surface-card section-card section-card--compact">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 space-y-1">
								<p class="text-sm font-bold text-[var(--app-text)]">{activity.title}</p>
								<p class="metric-card__meta">{$t("Updated: {time}", { time: new Date(activity.at).toLocaleString() })}</p>
							</div>
							<span
								class={cn(
									"inline-badge",
									activity.type === "success"
										? "inline-badge--success"
										: activity.type === "warning"
											? "inline-badge--warning"
											: activity.type === "error"
												? "inline-badge--danger"
												: "inline-badge--accent"
								)}
							>
								{$t(activity.type === "success" ? "Healthy" : activity.type === "warning" ? "Warning" : activity.type === "error" ? "Error" : "Info")}
							</span>
						</div>
						<p class="section-card__text">{activity.detail}</p>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if conflict}
		<section class="surface-card section-card section-card--warning" in:slide>
			<div class="section-card__header">
				<div class="section-card__header-main">
					<div class="section-card__icon">
						<AlertTriangle class="h-5 w-5 text-[var(--app-warning)]" />
					</div>
					<div class="section-card__title-wrap">
						<h2 class="section-card__title">{$t("Sync Conflict Detected")}</h2>
						<p class="section-card__text">{$t("Your local data and the cloud workspace don't match. Please choose how to resolve this.")}</p>
					</div>
				</div>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				<div class="surface-card section-card section-card--compact">
					<div class="flex items-center justify-between gap-3">
						<h3 class="section-card__title">{$t("Local State")}</h3>
						<span class="inline-badge inline-badge--warning">{$t("Local")}</span>
					</div>
					<div class="metric-grid">
						<div class="metric-card">
							<p class="metric-card__label">{$t("Nodes")}</p>
							<p class="metric-card__value">{conflict.localStats.nodes}</p>
						</div>
						<div class="metric-card">
							<p class="metric-card__label">{$t("Subscriptions")}</p>
							<p class="metric-card__value">{conflict.localStats.subscriptions}</p>
						</div>
						<div class="metric-card">
							<p class="metric-card__label">{$t("Aggregates")}</p>
							<p class="metric-card__value">{conflict.localStats.aggregates}</p>
						</div>
						<div class="metric-card">
							<p class="metric-card__label">{$t("Publish Targets")}</p>
							<p class="metric-card__value">{conflict.localStats.publishTargets}</p>
						</div>
					</div>
					<p class="metric-card__meta">{$t("Updated: {time}", { time: new Date(conflict.localStats.updatedAt).toLocaleString() })}</p>
				</div>

				<div class="surface-card section-card section-card--compact">
					<div class="flex items-center justify-between gap-3">
						<h3 class="section-card__title">{$t("Remote Workspace")}</h3>
						<span class="inline-badge inline-badge--accent">{$t("Remote")}</span>
					</div>
					<div class="metric-grid">
						<div class="metric-card">
							<p class="metric-card__label">{$t("Nodes")}</p>
							<p class="metric-card__value">{conflict.remoteStats.nodes}</p>
						</div>
						<div class="metric-card">
							<p class="metric-card__label">{$t("Subscriptions")}</p>
							<p class="metric-card__value">{conflict.remoteStats.subscriptions}</p>
						</div>
						<div class="metric-card">
							<p class="metric-card__label">{$t("Aggregates")}</p>
							<p class="metric-card__value">{conflict.remoteStats.aggregates}</p>
						</div>
						<div class="metric-card">
							<p class="metric-card__label">{$t("Publish Targets")}</p>
							<p class="metric-card__value">{conflict.remoteStats.publishTargets}</p>
						</div>
					</div>
					<p class="metric-card__meta">{$t("Updated: {time}", { time: new Date(conflict.remoteStats.updatedAt).toLocaleString() })}</p>
				</div>
			</div>

			<div class="section-card__actions">
				<button type="button" class="button-secondary" on:click={() => handleResolveConflict("local")} disabled={workspaceBusy}>
					<Upload class="h-4 w-4" />
					{$t("Use Local")}
				</button>
				<button type="button" class="button-secondary" on:click={() => handleResolveConflict("remote")} disabled={workspaceBusy}>
					<Download class="h-4 w-4" />
					{$t("Use Remote")}
				</button>
				<button type="button" class="button-primary" on:click={() => handleResolveConflict("merge")} disabled={workspaceBusy}>
					<ArrowRightLeft class="h-4 w-4" />
					{$t("Merge Both States")}
				</button>
				<button type="button" class="button-secondary" on:click={linkWorkspaceOnly}>
					{$t("Keep Local & Skip Sync")}
				</button>
			</div>
		</section>
	{/if}

	<section class="surface-card section-card">
		<div class="section-card__header">
			<div class="section-card__header-main">
				<div class="section-card__icon">
					<Database class="h-5 w-5" />
				</div>
				<div class="section-card__title-wrap">
					<h2 class="section-card__title">{$t("Backup & Migration")}</h2>
					<p class="section-card__text">{$t("Use this for backups or moving data without GitHub.")}</p>
				</div>
			</div>
			<div class="section-card__actions">
				<button type="button" class="button-secondary" on:click={handleExport}>
					<Upload class="h-4 w-4" />
					{$t("Export Config")}
				</button>
				<button type="button" class="button-secondary" on:click={handleImport}>
					<Download class="h-4 w-4" />
					{$t("Import Config")}
				</button>
				<button type="button" class="button-secondary" on:click={handleCopy} disabled={!payload}>
					<Copy class="h-4 w-4" />
					{$t("Copy JSON")}
				</button>
			</div>
		</div>

		<textarea
			class="field-textarea field-textarea--mono"
			style="min-height: 15rem;"
			placeholder={$t("Exported JSON will appear here. Paste JSON to import.")}
			bind:value={payload}
		></textarea>
	</section>
</div>
