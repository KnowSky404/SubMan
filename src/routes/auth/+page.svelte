<script lang="ts">
import { slide } from "svelte/transition";
import Octicon from "$lib/components/Octicon.svelte";
import { getGistFileContent, updateGist } from "$lib/gist";
import { t } from "$lib/i18n";
import { mergeSyncState } from "$lib/merge";
import type { AppState } from "$lib/models";
import {
	alert,
	arrowDown,
	arrowUp,
	checkCircle,
	copy,
	database,
	download,
	linkExternal,
	markGithub,
	save,
	shieldCheck,
	sync,
	trash,
	upload,
} from "$lib/octicons";
import {
	exportState,
	exportSyncState,
	getSyncStateSignature,
	importState,
} from "$lib/serialization";
import { appState, replaceState } from "$lib/stores/app";
import { authState, clearAuth, setToken } from "$lib/stores/auth";
import { requestConfirm } from "$lib/stores/confirm";
import { showToast } from "$lib/stores/toast";
import {
	readSyncBaseline,
	readSyncBaselineState,
	setSyncBaseline,
} from "$lib/sync";
import {
	decideManualPush,
	mergeSyncStateFromBaseline,
	selectTrustedSyncBaseline,
} from "$lib/sync-guard";
import { cn } from "$lib/utils/cn";
import { ensureWorkspaceGist, WORKSPACE_FILE } from "$lib/workspace";

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
let manualPushReview: {
	gistId: string;
	remoteState: AppState;
	remoteSignature: string;
	localSignature: string;
} | null = null;

function setStatus(
	message: string,
	type: "success" | "info" | "error" = "success",
) {
	showToast(message, type);
}

async function handleTokenSave() {
	const token = tokenInput.trim();
	if (!token) return;
	workspaceBusy = true;
	conflict = null;
	manualPushReview = null;
	try {
		setToken(token);
		const localPayload = exportSyncState($appState);
		const localSignature = getSyncStateSignature($appState);
		const { gist, created } = await ensureWorkspaceGist(token, localPayload);

		if (created) {
			const nextState = {
				...$appState,
				activeGistId: gist.id,
				lastUpdated: new Date().toISOString(),
			};
			appState.set(nextState);
			setSyncBaseline(getSyncStateSignature(nextState), nextState);
			setStatus($t("Workspace created and connected"), "success");
			tokenInput = "";
			return;
		}

		// Existing Gist - Check for content
		const remoteContent = await getGistFileContent(
			token,
			gist.id,
			WORKSPACE_FILE,
		);
		const remoteState = importState(remoteContent);
		const remoteSignature = getSyncStateSignature(remoteState);

		if (remoteSignature === localSignature) {
			appState.update((s) => ({ ...s, activeGistId: gist.id }));
			setSyncBaseline(remoteSignature, remoteState);
			setStatus($t("Workspace connected (In Sync)"), "success");
			tokenInput = "";
		} else {
			// Conflict!
			conflict = {
				gistId: gist.id,
				remoteState,
				remoteSignature,
				localSignature,
			};
			setStatus($t("Sync conflict detected"), "info");
		}
	} catch (err) {
		setStatus(
			err instanceof Error ? err.message : $t("Connection failed"),
			"error",
		);
	} finally {
		workspaceBusy = false;
	}
}

function getConflictConfirmation(action: "local" | "remote" | "merge") {
	if (action === "remote") {
		return {
			message: $t("Remote data is different. Overwrite local with remote?"),
			confirmText: $t("Pull Remote"),
		};
	}
	if (action === "local") {
		return {
			message: $t("Overwrite remote workspace data with current local state?"),
			confirmText: $t("Push Local"),
		};
	}
	return {
		message: $t("Merge local and remote data, then save the merged state?"),
		confirmText: $t("Merge & Save"),
	};
}

function setLocalStateAndBaseline(nextState: AppState, gistId: string) {
	const nextLocalState = { ...nextState, activeGistId: gistId };
	replaceState(nextLocalState);
	appState.update((state) => {
		setSyncBaseline(getSyncStateSignature(state), state);
		return state;
	});
}

async function handleResolveConflict(action: "local" | "remote" | "merge") {
	if (!conflict || !$authState.token) return;
	const confirmation = getConflictConfirmation(action);
	const confirmed = await requestConfirm({
		title: $t("Sync Update"),
		message: confirmation.message,
		confirmText: confirmation.confirmText,
	});
	if (!confirmed) return;

	workspaceBusy = true;
	try {
		const currentConflict = conflict;
		if (action === "remote") {
			setLocalStateAndBaseline(
				currentConflict.remoteState,
				currentConflict.gistId,
			);
			setStatus($t("Remote data loaded"), "success");
		} else if (action === "local") {
			const localPayload = exportSyncState($appState);
			await updateGist($authState.token, {
				gistId: currentConflict.gistId,
				files: { [WORKSPACE_FILE]: { content: localPayload } },
			});
			appState.update((s) => ({ ...s, activeGistId: currentConflict.gistId }));
			setSyncBaseline(currentConflict.localSignature, $appState);
			setStatus($t("Local data pushed to Gist"), "success");
		} else {
			const syncedFile = $appState.activeGistFile || WORKSPACE_FILE;
			const trustedBaseline = selectTrustedSyncBaseline(
				readSyncBaselineState(),
				currentConflict.gistId,
				syncedFile,
			);
			const mergedData = trustedBaseline
				? mergeSyncStateFromBaseline(
						$appState,
						currentConflict.remoteState,
						trustedBaseline,
					)
				: mergeSyncState($appState, currentConflict.remoteState);
			const mergedState = {
				...$appState,
				...mergedData,
				activeGistId: currentConflict.gistId,
				activeGistFile: syncedFile,
			};
			const mergedPayload = exportSyncState(mergedState);
			await updateGist($authState.token, {
				gistId: currentConflict.gistId,
				files: { [WORKSPACE_FILE]: { content: mergedPayload } },
			});
			setLocalStateAndBaseline(mergedState, currentConflict.gistId);
			setStatus($t("Merged data saved."), "success");
		}
		conflict = null;
		manualPushReview = null;
		tokenInput = "";
	} catch (err) {
		setStatus($t("Resolution failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

async function handleManualPull() {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	if (!token || !gistId) return;

	workspaceBusy = true;
	try {
		const remoteContent = await getGistFileContent(
			token,
			gistId,
			WORKSPACE_FILE,
		);
		const remoteState = importState(remoteContent);
		const remoteSignature = getSyncStateSignature(remoteState);
		const localSignature = getSyncStateSignature($appState);

		if (remoteSignature === localSignature) {
			setStatus($t("Already in sync"), "info");
		} else {
			const confirmed = await requestConfirm({
				title: $t("Sync Update"),
				message: $t("Remote data is different. Overwrite local with remote?"),
				confirmText: $t("Pull Remote"),
			});
			if (confirmed) {
				setLocalStateAndBaseline(remoteState, gistId);
				setStatus($t("Pulled successfully"), "success");
			}
		}
	} catch (err) {
		setStatus($t("Pull failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

async function handleManualPush() {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	const syncedFile = $appState.activeGistFile || WORKSPACE_FILE;
	if (!token || !gistId) return;

	workspaceBusy = true;
	try {
		const remoteContent = await getGistFileContent(token, gistId, syncedFile);
		const remoteState = importState(remoteContent);
		const decision = decideManualPush({
			local: $appState,
			remote: remoteState,
			baselineSignature: readSyncBaseline(),
		});

		if (decision.action === "already-synced") {
			setSyncBaseline(decision.remoteSignature, remoteState);
			manualPushReview = null;
			setStatus($t("Already in sync"), "info");
			return;
		}

		if (decision.action === "remote-changed") {
			manualPushReview = {
				gistId,
				remoteState,
				remoteSignature: decision.remoteSignature,
				localSignature: decision.localSignature,
			};
			setStatus($t("Remote workspace changed since your last sync."), "info");
			return;
		}

		const confirmed = await requestConfirm({
			title: $t("Sync Update"),
			message: $t("Overwrite remote workspace data with current local state?"),
			confirmText: $t("Push Local"),
		});
		if (!confirmed) return;

		await updateGist(token, {
			gistId,
			files: { [syncedFile]: { content: exportSyncState($appState) } },
		});
		setSyncBaseline(decision.localSignature, $appState);
		manualPushReview = null;
		setStatus($t("Pushed successfully"), "success");
	} catch (err) {
		setStatus($t("Push failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

async function handleManualPushReview(action: "remote" | "merge" | "force") {
	if (!manualPushReview || !$authState.token) return;

	if (action === "remote") {
		const confirmed = await requestConfirm({
			title: $t("Sync Update"),
			message: $t("Remote data is different. Overwrite local with remote?"),
			confirmText: $t("Pull Remote"),
		});
		if (!confirmed) return;
		setLocalStateAndBaseline(
			manualPushReview.remoteState,
			manualPushReview.gistId,
		);
		manualPushReview = null;
		setStatus($t("Pulled successfully"), "success");
		return;
	}

	if (action === "force") {
		await handleManualForcePush();
		return;
	}

	const confirmed = await requestConfirm({
		title: $t("Sync Update"),
		message: $t("Merge local and remote data, then save the merged state?"),
		confirmText: $t("Merge & Save"),
	});
	if (!confirmed) return;

	workspaceBusy = true;
	try {
		const syncedFile = $appState.activeGistFile || WORKSPACE_FILE;
		const mergedState = {
			...mergeSyncStateFromBaseline(
				$appState,
				manualPushReview.remoteState,
				readSyncBaselineState(),
			),
			activeGistId: manualPushReview.gistId,
			activeGistFile: syncedFile,
		};
		await updateGist($authState.token, {
			gistId: manualPushReview.gistId,
			files: { [syncedFile]: { content: exportSyncState(mergedState) } },
		});
		setLocalStateAndBaseline(mergedState, manualPushReview.gistId);
		manualPushReview = null;
		setStatus($t("Merged data saved."), "success");
	} catch (err) {
		setStatus($t("Resolution failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

async function handleManualForcePush() {
	if (!manualPushReview || !$authState.token) return;
	const confirmed = await requestConfirm({
		title: $t("Sync Update"),
		message: $t(
			"Force push will overwrite remote workspace changes. Continue?",
		),
		confirmText: $t("Force Push"),
	});
	if (!confirmed) return;

	workspaceBusy = true;
	try {
		const syncedFile = $appState.activeGistFile || WORKSPACE_FILE;
		const localSignature = getSyncStateSignature($appState);
		await updateGist($authState.token, {
			gistId: manualPushReview.gistId,
			files: { [syncedFile]: { content: exportSyncState($appState) } },
		});
		setSyncBaseline(localSignature, $appState);
		manualPushReview = null;
		setStatus($t("Pushed successfully"), "success");
	} catch (err) {
		setStatus($t("Push failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

function handleTokenClear() {
	clearAuth();
	appState.update((s) => ({ ...s, activeGistId: null }));
	setStatus($t("Logged out"), "info");
	conflict = null;
	manualPushReview = null;
}

function handleExport() {
	payload = exportState($appState);
	setStatus($t("Config exported"), "success");
}

function handleImport() {
	try {
		replaceState(importState(payload));
		setStatus($t("Config imported"), "success");
	} catch (err) {
		setStatus($t("Import failed"), "error");
	}
}
</script>

<div class="gh-page">
	<header class="gh-page-header">
		<div class="gh-page-heading">
			<h1 class="gh-page-title">{$t("Settings")}</h1>
			<p class="gh-page-subtitle">
				{$t("Connect a GitHub Gist workspace, resolve sync conflicts, and import or export local JSON state.")}
			</p>
			<div class="gh-page-meta">
				<span class={cn("gh-page-meta-item", $authState.token && "badge-success")}>
					{$authState.token ? $t("Token active") : $t("Local mode")}
				</span>
				{#if $appState.activeGistId}
					<span class="gh-page-meta-item font-mono">{$appState.activeGistId}</span>
				{/if}
			</div>
		</div>
	</header>

	<!-- Conflict Resolution UI -->
	{#if conflict}
		<section class="gh-alert gh-alert-attention" transition:slide>
			<Octicon icon={alert} className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--attention-emphasis)]" />
			<div class="min-w-0 flex-1 space-y-3">
				<div>
					<h2 class="text-sm font-semibold">{$t("Sync Conflict")}</h2>
					<p class="text-sm text-fg-muted">
						{$t("Remote and local data differ. Choose which side becomes the source of truth.")}
					</p>
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={() => handleResolveConflict('remote')}>
						<Octicon icon={arrowDown} className="h-5 w-5 text-accent-fg" />
						<span class="font-semibold">{$t("Use Remote")}</span>
						<span class="gh-form-caption">{$t("Replace local state")}</span>
					</button>
					<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={() => handleResolveConflict('merge')}>
						<Octicon icon={sync} className="h-5 w-5 text-fg-muted" />
						<span class="font-semibold">{$t("Merge & Save")}</span>
						<span class="gh-form-caption">{$t("Merge Both States")}</span>
					</button>
					<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={() => handleResolveConflict('local')}>
						<Octicon icon={arrowUp} className="h-5 w-5 text-[color:var(--success-emphasis)]" />
						<span class="font-semibold">{$t("Use Local")}</span>
						<span class="gh-form-caption">{$t("Replace gist state")}</span>
					</button>
				</div>
			</div>
		</section>
	{/if}

	{#if manualPushReview}
		<section class="gh-alert gh-alert-attention" transition:slide>
			<Octicon icon={alert} className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--attention-emphasis)]" />
			<div class="min-w-0 flex-1 space-y-3">
				<div>
					<h2 class="text-sm font-semibold">{$t("Remote Change Detected")}</h2>
					<p class="text-sm text-fg-muted">
						{$t("Remote workspace changed since your last sync. Choose how to continue.")}
					</p>
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={() => handleManualPushReview('remote')}>
						<Octicon icon={arrowDown} className="h-5 w-5 text-accent-fg" />
						<span class="font-semibold">{$t("Pull Remote")}</span>
						<span class="gh-form-caption">{$t("Replace local state")}</span>
					</button>
					<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={() => handleManualPushReview('merge')}>
						<Octicon icon={sync} className="h-5 w-5 text-fg-muted" />
						<span class="font-semibold">{$t("Merge & Save")}</span>
						<span class="gh-form-caption">{$t("Merge Both States")}</span>
					</button>
					<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={() => handleManualPushReview('force')}>
						<Octicon icon={arrowUp} className="h-5 w-5 text-[color:var(--danger-emphasis)]" />
						<span class="font-semibold">{$t("Force Push")}</span>
						<span class="gh-form-caption">{$t("Overwrite remote changes")}</span>
					</button>
				</div>
			</div>
		</section>
	{/if}

	<!-- GitHub Connection -->
	<section class="gh-section">
		<div class="gh-section-header">
			<div>
				<h2 class="gh-section-title"><Octicon icon={markGithub} className="h-5 w-5" />{$t("GitHub Workspace")}</h2>
				<p class="gh-section-description">{$t("Stores workspace data in a private gist. Requires a classic token with gist scope.")}</p>
			</div>
			{#if $authState.token}
				<span class="State State--success"><Octicon icon={checkCircle} className="h-3 w-3" />{$t("Connected")}</span>
			{:else}
				<span class="State State--muted State--inline">{$t("Local Mode")}</span>
			{/if}
		</div>
		<div class="gh-section-body">
			{#if !$authState.token}
				<div class="flex flex-col gap-2">
					<label class="gh-form-label" for="github-token">{$t("Personal access token")}</label>
					<div class="flex flex-col gap-2 sm:flex-row">
						<input id="github-token" type="password" class="gh-input flex-1 font-mono" placeholder="ghp_xxxxxxxxxxxx" bind:value={tokenInput} />
						<button type="button" class="gh-btn gh-btn-primary" on:click={handleTokenSave} disabled={workspaceBusy}>
							{#if workspaceBusy}<Octicon icon={sync} className="h-4 w-4 animate-spin" />{:else}<Octicon icon={save} className="h-4 w-4" />{/if}
							{$t("Connect")}
						</button>
					</div>
				</div>
				<a href="https://github.com/settings/tokens/new?description=SubMan&scopes=gist" target="_blank" class="gh-link flex items-center gap-1 text-xs">
					<Octicon icon={linkExternal} className="h-3 w-3" /> {$t("Generate a new token on GitHub")}
				</a>
			{:else}
				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-3 rounded-md border border-border-default bg-canvas-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
						<div class="flex min-w-0 items-center gap-3">
							<div class="flex h-8 w-8 items-center justify-center rounded-md border border-border-default bg-canvas-default"><Octicon icon={shieldCheck} className="h-4 w-4 text-[color:var(--success-emphasis)]" /></div>
							<div class="min-w-0">
								<p class="text-sm font-semibold">{$t("Token Active")}</p>
								<p class="truncate font-mono text-xs text-fg-muted">{$appState.activeGistId || 'Searching...'}</p>
							</div>
						</div>
						<div class="gh-btn-group">
							<button type="button" class="gh-btn gh-btn-sm" on:click={handleManualPull} disabled={workspaceBusy}>
								<Octicon icon={sync} className={cn("h-3.5 w-3.5", workspaceBusy && "animate-spin")} />
								{$t("Pull Now")}
							</button>
							<button type="button" class="gh-btn gh-btn-sm" on:click={handleManualPush} disabled={workspaceBusy}>
								<Octicon icon={upload} className="h-3.5 w-3.5" />
								{$t("Push Now")}
							</button>
							<button type="button" class="gh-btn gh-btn-danger gh-btn-sm" on:click={handleTokenClear}><Octicon icon={trash} className="h-3.5 w-3.5" />{$t("Disconnect")}</button>
						</div>
					</div>
					<p class="gh-form-caption">
						{$t("Auto-sync is enabled for local changes.")}
					</p>
				</div>
			{/if}
		</div>
	</section>

	<!-- Local Data Management -->
	<section class="gh-section">
		<div class="gh-section-header">
			<div>
				<h2 class="gh-section-title"><Octicon icon={database} className="h-5 w-5" />{$t("Data Management")}</h2>
				<p class="gh-section-description">{$t("Backup or restore local state as JSON.")}</p>
			</div>
		</div>
		<div class="gh-section-body">
			<label class="gh-form-label" for="settings-payload">{$t("JSON payload")}</label>
			<textarea id="settings-payload" class="gh-input gh-textarea h-32 font-mono text-xs" placeholder="JSON data..." bind:value={payload}></textarea>
		</div>
		<div class="gh-section-footer">
			<div class="gh-btn-group">
				<button type="button" class="gh-btn" on:click={handleExport}><Octicon icon={upload} className="h-4 w-4" />{$t("Export")}</button>
				<button type="button" class="gh-btn" on:click={handleImport}><Octicon icon={download} className="h-4 w-4" />{$t("Import")}</button>
				<button type="button" class="gh-btn" on:click={() => { navigator.clipboard.writeText(payload); setStatus($t("Copied to clipboard")); }} disabled={!payload} aria-label={$t("Copy")}><Octicon icon={copy} className="h-4 w-4" /></button>
			</div>
		</div>
	</section>

</div>
