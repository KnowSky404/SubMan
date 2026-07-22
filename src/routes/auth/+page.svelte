<script lang="ts">
import { onMount } from "svelte";
import { slide } from "svelte/transition";
import Octicon from "$lib/components/Octicon.svelte";
import { getGist } from "$lib/gist";
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
import { decideManualPush, mergeSyncStateFromBaseline } from "$lib/sync-guard";
import { cn } from "$lib/utils/cn";
import { ensureWorkspaceBootstrapGist, WORKSPACE_FILE } from "$lib/workspace";
import {
	type BrowserWorkspaceSnapshot,
	persistBrowserWorkspaceSnapshot,
	readBrowserWorkspaceSnapshot,
	reconcileBrowserWorkspace,
} from "$lib/workspace-browser-session-v2";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import { subscribeWorkspaceEvents } from "$lib/workspace-events";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import {
	bindWorkspaceOnly,
	pullWorkspaceExactly,
} from "$lib/workspace-session";
import { clearLegacyWorkspaceSyncState } from "$lib/workspace-v1-cleanup";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	type WorkspaceV2LocalState,
	WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

let tokenInput = "";
let payload = "";
let workspaceBusy = false;

// Conflict State
let conflict: {
	gistId: string;
	remoteDocument: WorkspaceDocumentV2;
	remoteState: AppState;
	remoteSignature: string;
	localSignature: string;
} | null = null;

function restoreConflict(document: WorkspaceDocumentV2, gistId: string) {
	const remoteState = hydrateAppStateFromWorkspaceDocument(
		$appState,
		document,
		gistId,
	);
	conflict = {
		gistId,
		remoteDocument: document,
		remoteState,
		remoteSignature: getSyncStateSignature(remoteState),
		localSignature: getSyncStateSignature($appState),
	};
}

onMount(() => {
	try {
		const binding = new WorkspaceV2StateStore().read();
		if (binding?.syncMode === "paused-conflict" && binding.baseline) {
			restoreConflict(binding.baseline, binding.gistId);
		}
	} catch {
		// Invalid local metadata is surfaced by connection actions.
	}
	return subscribeWorkspaceEvents((event) => {
		if (event.type === "paused-conflict" && event.document && event.gistId) {
			restoreConflict(event.document, event.gistId);
		}
	});
});
let manualPushReview: {
	gistId: string;
	remoteDocument: WorkspaceDocumentV2;
	remoteState: AppState;
	remoteSignature: string;
	localSignature: string;
} | null = null;

function workspaceDependencies() {
	return {
		queue: new WorkspaceMutationQueue(),
		stateStore: new WorkspaceV2StateStore(),
		getState: () => $appState,
		setState: (state: AppState) => appState.set(state),
	};
}

function currentSyncMode(): "automatic" | "manual" {
	try {
		return new WorkspaceV2StateStore().read()?.syncMode === "manual"
			? "manual"
			: "automatic";
	} catch {
		return "automatic";
	}
}

async function loadWorkspaceSnapshot(token: string, gistId: string) {
	const gist = await getGist(token, gistId);
	return readBrowserWorkspaceSnapshot(token, gist, $appState);
}

async function discardPendingMutations(workspaceId: string) {
	const queue = new WorkspaceMutationQueue();
	for (const mutation of queue.list(workspaceId)) {
		await queue.remove(mutation.mutationId);
	}
}

function persistSnapshot(
	snapshot: BrowserWorkspaceSnapshot,
	gistId: string,
	syncMode: "automatic" | "manual",
) {
	persistBrowserWorkspaceSnapshot(
		snapshot,
		gistId,
		syncMode,
		workspaceDependencies(),
	);
}

async function reconcileSnapshot(
	token: string,
	gistId: string,
	baseline: WorkspaceDocumentV2,
	resolvedState: AppState,
	syncMode: "automatic" | "manual",
	replacePending = false,
) {
	return reconcileBrowserWorkspace(
		{ token, gistId, baseline, resolvedState, syncMode, replacePending },
		workspaceDependencies(),
	);
}

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
		clearLegacyWorkspaceSyncState();
		setToken(token);
		const localSignature = getSyncStateSignature($appState);
		let savedGistId = $appState.activeGistId;
		try {
			savedGistId = new WorkspaceV2StateStore().read()?.gistId ?? savedGistId;
		} catch {
			// Discovery can recover a workspace even when local V2 metadata is corrupt.
		}
		const { gist, created } = await ensureWorkspaceBootstrapGist(token, {
			activeGistId: savedGistId,
		});
		const snapshot = await readBrowserWorkspaceSnapshot(token, gist, $appState);

		if (created || snapshot.origin === "bootstrap") {
			await reconcileSnapshot(
				token,
				gist.id,
				snapshot.document,
				$appState,
				"automatic",
			);
			setStatus($t("Workspace created and connected"), "success");
			tokenInput = "";
			return;
		}

		const remoteState = snapshot.state;
		const remoteSignature = getSyncStateSignature(remoteState);

		if (remoteSignature === localSignature) {
			if (snapshot.origin === "v2") {
				persistSnapshot(snapshot, gist.id, "automatic");
			} else {
				await reconcileSnapshot(
					token,
					gist.id,
					snapshot.document,
					remoteState,
					"automatic",
				);
			}
			setStatus($t("Workspace connected (In Sync)"), "success");
			tokenInput = "";
		} else {
			// Conflict!
			conflict = {
				gistId: gist.id,
				remoteDocument: snapshot.document,
				remoteState,
				remoteSignature,
				localSignature,
			};
			const stateStore = new WorkspaceV2StateStore();
			let previousBinding: WorkspaceV2LocalState | null = null;
			try {
				previousBinding = stateStore.read();
			} catch {
				// The validated remote snapshot replaces corrupt local metadata.
			}
			stateStore.write(
				createWorkspaceV2LocalState(gist.id, {
					baseline: snapshot.document,
					conflictBaseline:
						previousBinding?.workspaceId === `gist:${gist.id}`
							? (previousBinding.conflictBaseline ?? previousBinding.baseline)
							: null,
					syncMode: "paused-conflict",
				}),
			);
			appState.update((state) => ({ ...state, activeGistId: gist.id }));
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

async function handleBindOnly() {
	if (!conflict) return;
	const bound = bindWorkspaceOnly($appState, conflict.gistId, WORKSPACE_FILE);
	clearLegacyWorkspaceSyncState();
	await discardPendingMutations(`gist:${conflict.gistId}`);
	new WorkspaceV2StateStore().write(
		createWorkspaceV2LocalState(conflict.gistId, {
			baseline: conflict.remoteDocument,
			syncMode: "manual",
		}),
	);
	appState.set(bound);
	conflict = null;
	manualPushReview = null;
	tokenInput = "";
	setStatus($t("Workspace bound without syncing"), "info");
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
			await discardPendingMutations(`gist:${currentConflict.gistId}`);
			persistSnapshot(
				{
					origin: "v2",
					document: currentConflict.remoteDocument,
					state: currentConflict.remoteState,
				},
				currentConflict.gistId,
				"automatic",
			);
			setStatus($t("Remote data loaded"), "success");
		} else if (action === "local") {
			await reconcileSnapshot(
				$authState.token,
				currentConflict.gistId,
				currentConflict.remoteDocument,
				$appState,
				"automatic",
				true,
			);
			setStatus($t("Local data pushed to Gist"), "success");
		} else {
			const localBinding = new WorkspaceV2StateStore().read();
			const trustedBaseline = localBinding?.conflictBaseline
				? pullWorkspaceExactly(
						{
							...$appState,
							...localBinding.conflictBaseline.data,
							lastUpdated: localBinding.conflictBaseline.updatedAt,
						},
						currentConflict.gistId,
						WORKSPACE_FILE,
					)
				: null;
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
				activeGistFile: WORKSPACE_FILE,
			};
			await reconcileSnapshot(
				$authState.token,
				currentConflict.gistId,
				currentConflict.remoteDocument,
				mergedState,
				"automatic",
				true,
			);
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
		const snapshot = await loadWorkspaceSnapshot(token, gistId);
		const remoteState = snapshot.state;
		const remoteSignature = getSyncStateSignature(remoteState);
		const localSignature = getSyncStateSignature($appState);

		if (remoteSignature === localSignature) {
			persistSnapshot(snapshot, gistId, currentSyncMode());
			setStatus($t("Already in sync"), "info");
		} else {
			const confirmed = await requestConfirm({
				title: $t("Sync Update"),
				message: $t("Remote data is different. Overwrite local with remote?"),
				confirmText: $t("Pull Remote"),
			});
			if (confirmed) {
				await discardPendingMutations(`gist:${gistId}`);
				persistSnapshot(snapshot, gistId, currentSyncMode());
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
	if (!token || !gistId) return;

	workspaceBusy = true;
	try {
		const snapshot = await loadWorkspaceSnapshot(token, gistId);
		const remoteState = snapshot.state;
		const localSignature = getSyncStateSignature($appState);
		const remoteSignature = getSyncStateSignature(remoteState);
		const binding = new WorkspaceV2StateStore().read();

		if (remoteSignature === localSignature) {
			persistSnapshot(snapshot, gistId, currentSyncMode());
			manualPushReview = null;
			setStatus($t("Already in sync"), "info");
			return;
		}

		if (
			!binding ||
			binding.workspaceId !== `gist:${gistId}` ||
			binding.revision !== snapshot.document.revision
		) {
			manualPushReview = {
				gistId,
				remoteDocument: snapshot.document,
				remoteState,
				remoteSignature,
				localSignature,
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

		await reconcileSnapshot(
			token,
			gistId,
			snapshot.document,
			$appState,
			currentSyncMode(),
		);
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
		await discardPendingMutations(`gist:${manualPushReview.gistId}`);
		persistSnapshot(
			{
				origin: "v2",
				document: manualPushReview.remoteDocument,
				state: manualPushReview.remoteState,
			},
			manualPushReview.gistId,
			currentSyncMode(),
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
		const localBinding = new WorkspaceV2StateStore().read();
		const trustedBaseline = localBinding?.baseline
			? {
					...$appState,
					...localBinding.baseline.data,
					activeGistId: manualPushReview.gistId,
					activeGistFile: WORKSPACE_FILE,
					lastUpdated: localBinding.baseline.updatedAt,
				}
			: null;
		const mergedState = {
			...mergeSyncStateFromBaseline(
				$appState,
				manualPushReview.remoteState,
				trustedBaseline,
			),
			activeGistId: manualPushReview.gistId,
			activeGistFile: WORKSPACE_FILE,
		};
		await reconcileSnapshot(
			$authState.token,
			manualPushReview.gistId,
			manualPushReview.remoteDocument,
			mergedState,
			currentSyncMode(),
			true,
		);
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
		await reconcileSnapshot(
			$authState.token,
			manualPushReview.gistId,
			manualPushReview.remoteDocument,
			$appState,
			currentSyncMode(),
			true,
		);
		manualPushReview = null;
		setStatus($t("Pushed successfully"), "success");
	} catch (err) {
		setStatus($t("Push failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

function handleTokenClear() {
	clearLegacyWorkspaceSyncState();
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
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={handleBindOnly}>
						<Octicon icon={database} className="h-5 w-5 text-fg-muted" />
						<span class="font-semibold">{$t("Bind only")}</span>
						<span class="gh-form-caption">{$t("Pause before choosing a sync direction")}</span>
					</button>
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
