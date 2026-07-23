<script lang="ts">
import { onMount } from "svelte";
import { slide } from "svelte/transition";
import Octicon from "$lib/components/Octicon.svelte";
import { getGist } from "$lib/gist";
import { t } from "$lib/i18n";
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
import { decideManualPush } from "$lib/sync-guard";
import { cn } from "$lib/utils/cn";
import {
	discoverWorkspaceGist,
	ensureWorkspaceBootstrapGist,
	WORKSPACE_FILE,
	type WorkspaceCandidate,
} from "$lib/workspace";
import {
	type BrowserWorkspaceSnapshot,
	persistBrowserWorkspaceSnapshot,
	readBrowserWorkspaceSnapshot,
	reconcileBrowserWorkspace,
} from "$lib/workspace-browser-session-v2";
import { getWorkspaceBusinessData } from "$lib/workspace-data";
import { exportWorkspaceDiagnostics } from "$lib/workspace-diagnostics";
import type {
	WorkspaceData,
	WorkspaceDocumentV2,
} from "$lib/workspace-document";
import { subscribeWorkspaceEvents } from "$lib/workspace-events";
import {
	requireWorkspaceIdentity,
	withWorkspaceBinding,
} from "$lib/workspace-identity";
import {
	mergeWorkspaceData,
	projectLocalWorkspaceAgainstTombstones,
} from "$lib/workspace-merge";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import {
	bindWorkspaceOnly,
	pullWorkspaceExactly,
} from "$lib/workspace-session";
import {
	dispatchWorkspaceSyncEvent,
	markWorkspaceDisconnected,
} from "$lib/workspace-sync-status";
import { clearLegacyWorkspaceSyncState } from "$lib/workspace-v1-cleanup";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	type WorkspaceV2LocalState,
	WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

let tokenInput = "";
let rememberToken = false;
let payload = "";
let workspaceBusy = false;
let workspaceCandidates: WorkspaceCandidate[] = [];
let pendingConnection: {
	token: string;
	rememberToken: boolean;
	previousState: AppState;
	previousBinding: WorkspaceV2LocalState | null;
} | null = null;

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
	rememberToken = $authState.persistence === "persistent";
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

async function confirmDiscardPendingMutations(
	workspaceId: string,
): Promise<boolean> {
	const count = new WorkspaceMutationQueue().list(workspaceId).length;
	if (count === 0) return true;
	return requestConfirm({
		title: $t("Discard Pending Changes"),
		message: $t(
			"Discard {count} pending Workspace changes? This cannot be undone.",
			{
				count,
			},
		),
		confirmText: $t("Discard {count} Changes", { count }),
		danger: true,
	});
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

function connectionErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : "";
	if (message.includes("migration_backup_conflict")) {
		return $t(
			"The immutable V1 migration backup does not match subman.json. Restore the matching backup before retrying.",
		);
	}
	if (message.includes("invalid_bootstrap_marker")) {
		return $t(
			"The Workspace bootstrap marker is invalid. Repair or remove it in GitHub before resuming.",
		);
	}
	if (message.includes("Workspace identity requires repair")) {
		return $t("Workspace identity requires repair before this action.");
	}
	return message || $t("Connection failed");
}

function candidateKindLabel(kind: WorkspaceCandidate["kind"]): string {
	switch (kind) {
		case "materialized-v2":
			return $t("Workspace V2");
		case "legacy-v1":
			return $t("Legacy V1");
		case "bootstrap-incomplete":
			return $t("Initialization incomplete");
		case "invalid":
			return $t("Invalid Workspace");
	}
}

function candidateUpdatedAt(candidate: WorkspaceCandidate): string {
	return new Intl.DateTimeFormat(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(candidate.gist.updatedAt));
}

async function completeWorkspaceConnection(
	token: string,
	gist: WorkspaceCandidate["gist"],
	created: boolean,
	previousBinding: WorkspaceV2LocalState | null,
	remember: boolean,
) {
	const stateStore = new WorkspaceV2StateStore();
	const localSignature = getSyncStateSignature($appState);
	const snapshot = await readBrowserWorkspaceSnapshot(token, gist, $appState);

	if (created || snapshot.origin === "bootstrap") {
		await reconcileSnapshot(
			token,
			gist.id,
			snapshot.document,
			$appState,
			"automatic",
		);
		clearLegacyWorkspaceSyncState();
		setToken(token, { remember });
		setStatus($t("Workspace created and connected"), "success");
		tokenInput = "";
		workspaceCandidates = [];
		pendingConnection = null;
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
		clearLegacyWorkspaceSyncState();
		setToken(token, { remember });
		setStatus($t("Workspace connected (In Sync)"), "success");
		tokenInput = "";
	} else {
		conflict = {
			gistId: gist.id,
			remoteDocument: snapshot.document,
			remoteState,
			remoteSignature,
			localSignature,
		};
		const paused = createWorkspaceV2LocalState(gist.id, {
			baseline: snapshot.document,
			conflictBaseline:
				previousBinding?.workspaceId === `gist:${gist.id}`
					? (previousBinding.conflictBaseline ?? previousBinding.baseline)
					: null,
			syncMode: "paused-conflict",
		});
		stateStore.write(paused);
		appState.set(withWorkspaceBinding($appState, paused));
		clearLegacyWorkspaceSyncState();
		setToken(token, { remember });
		setStatus($t("Sync conflict detected"), "info");
	}
	workspaceCandidates = [];
	pendingConnection = null;
}

async function connectCandidate(candidate: WorkspaceCandidate) {
	if (!pendingConnection || candidate.kind === "invalid") return;
	workspaceBusy = true;
	conflict = null;
	manualPushReview = null;
	const attempt = pendingConnection;
	try {
		await completeWorkspaceConnection(
			attempt.token,
			candidate.gist,
			false,
			attempt.previousBinding,
			attempt.rememberToken,
		);
	} catch (error) {
		const stateStore = new WorkspaceV2StateStore();
		if (attempt.previousBinding) stateStore.write(attempt.previousBinding);
		else stateStore.clear();
		appState.set(attempt.previousState);
		setStatus(connectionErrorMessage(error), "error");
	} finally {
		workspaceBusy = false;
	}
}

async function handleTokenSave() {
	const token = tokenInput.trim();
	if (!token) return;
	workspaceBusy = true;
	conflict = null;
	manualPushReview = null;
	workspaceCandidates = [];
	pendingConnection = null;
	const previousState = $appState;
	const stateStore = new WorkspaceV2StateStore();
	const previousBinding = stateStore.read();
	try {
		const savedGistId = previousBinding?.gistId ?? $appState.activeGistId;
		const discovery = await discoverWorkspaceGist(token, savedGistId);
		if (discovery.status === "chooser") {
			workspaceCandidates = discovery.candidates;
			pendingConnection = {
				token,
				rememberToken,
				previousState,
				previousBinding,
			};
			setStatus($t("Choose a Workspace to continue."), "info");
			return;
		}
		const ensured =
			discovery.status === "found"
				? { gist: discovery.gist, created: false }
				: await ensureWorkspaceBootstrapGist(token, {
						activeGistId: savedGistId,
					});
		await completeWorkspaceConnection(
			token,
			ensured.gist,
			ensured.created,
			previousBinding,
			rememberToken,
		);
	} catch (error) {
		if (previousBinding) stateStore.write(previousBinding);
		else stateStore.clear();
		appState.set(previousState);
		setStatus(connectionErrorMessage(error), "error");
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

function appStateWithWorkspaceData(
	data: WorkspaceData,
	gistId: string,
): AppState {
	return {
		...$appState,
		...data,
		activeGistId: gistId,
		activeGistFile: WORKSPACE_FILE,
	};
}

async function handleBindOnly() {
	if (!conflict) return;
	const bound = bindWorkspaceOnly($appState, conflict.gistId, WORKSPACE_FILE);
	new WorkspaceV2StateStore().write(
		createWorkspaceV2LocalState(conflict.gistId, {
			baseline: conflict.remoteDocument,
			syncMode: "manual",
		}),
	);
	appState.set(bound);
	clearLegacyWorkspaceSyncState();
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
	const workspaceId = `gist:${conflict.gistId}`;
	if (!(await confirmDiscardPendingMutations(workspaceId))) return;

	workspaceBusy = true;
	try {
		const currentConflict = conflict;
		if (action === "remote") {
			await discardPendingMutations(workspaceId);
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
			const projected = projectLocalWorkspaceAgainstTombstones(
				getWorkspaceBusinessData($appState),
				currentConflict.remoteDocument,
			);
			await reconcileSnapshot(
				$authState.token,
				currentConflict.gistId,
				currentConflict.remoteDocument,
				appStateWithWorkspaceData(projected.data, currentConflict.gistId),
				"automatic",
				true,
			);
			setStatus(
				projected.notices.length > 0
					? $t("Local data pushed; remote deletions were preserved")
					: $t("Local data pushed to Gist"),
				"success",
			);
		} else {
			const localBinding = new WorkspaceV2StateStore().read();
			const merged = mergeWorkspaceData({
				local: getWorkspaceBusinessData($appState),
				remote: currentConflict.remoteDocument,
				baseline: localBinding?.conflictBaseline ?? null,
			});
			if (merged.status === "needs-choice") {
				setStatus(
					$t(
						"Entity conflicts require choosing Use Local or Use Remote before saving",
					),
					"info",
				);
				return;
			}
			const mergedState = appStateWithWorkspaceData(
				merged.data,
				currentConflict.gistId,
			);
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
	} catch (error) {
		setStatus(connectionErrorMessage(error), "error");
	} finally {
		workspaceBusy = false;
	}
}

async function handleManualPull() {
	const token = $authState.token;
	if (!token) return;

	workspaceBusy = true;
	try {
		const { gistId } = requireWorkspaceIdentity(
			$appState,
			new WorkspaceV2StateStore().read(),
		);
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
				if (!(await confirmDiscardPendingMutations(`gist:${gistId}`))) return;
				await discardPendingMutations(`gist:${gistId}`);
				persistSnapshot(snapshot, gistId, currentSyncMode());
				setStatus($t("Pulled successfully"), "success");
			}
		}
	} catch (error) {
		setStatus(connectionErrorMessage(error), "error");
	} finally {
		workspaceBusy = false;
	}
}

async function handleManualPush() {
	const token = $authState.token;
	if (!token) return;

	workspaceBusy = true;
	try {
		const { gistId } = requireWorkspaceIdentity(
			$appState,
			new WorkspaceV2StateStore().read(),
		);
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
	} catch (error) {
		setStatus(connectionErrorMessage(error), "error");
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
		if (
			!(await confirmDiscardPendingMutations(`gist:${manualPushReview.gistId}`))
		)
			return;
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
	if (
		!(await confirmDiscardPendingMutations(`gist:${manualPushReview.gistId}`))
	)
		return;

	workspaceBusy = true;
	try {
		const localBinding = new WorkspaceV2StateStore().read();
		const merged = mergeWorkspaceData({
			local: getWorkspaceBusinessData($appState),
			remote: manualPushReview.remoteDocument,
			baseline: localBinding?.baseline ?? null,
		});
		if (merged.status === "needs-choice") {
			setStatus(
				$t(
					"Entity conflicts require choosing Force Push or Pull Remote before saving",
				),
				"info",
			);
			return;
		}
		const mergedState = appStateWithWorkspaceData(
			merged.data,
			manualPushReview.gistId,
		);
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
	} catch (error) {
		setStatus(connectionErrorMessage(error), "error");
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
	if (
		!(await confirmDiscardPendingMutations(`gist:${manualPushReview.gistId}`))
	)
		return;

	workspaceBusy = true;
	try {
		const projected = projectLocalWorkspaceAgainstTombstones(
			getWorkspaceBusinessData($appState),
			manualPushReview.remoteDocument,
		);
		await reconcileSnapshot(
			$authState.token,
			manualPushReview.gistId,
			manualPushReview.remoteDocument,
			appStateWithWorkspaceData(projected.data, manualPushReview.gistId),
			currentSyncMode(),
			true,
		);
		manualPushReview = null;
		setStatus(
			projected.notices.length > 0
				? $t("Pushed successfully; remote deletions were preserved")
				: $t("Pushed successfully"),
			"success",
		);
	} catch (err) {
		setStatus($t("Push failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

function handleTokenClear() {
	clearAuth();
	const queueCount = new WorkspaceMutationQueue().list().length;
	markWorkspaceDisconnected(queueCount);
	setStatus($t("Logged out"), "info");
	conflict = null;
	manualPushReview = null;
}

function handleExport() {
	payload = exportState($appState);
	setStatus($t("Config exported"), "success");
}

function handleDiagnosticsExport() {
	payload = exportWorkspaceDiagnostics($appState);
	setStatus($t("Diagnostics exported"), "success");
}

async function handleRepairSyncState() {
	const token = $authState.token;
	const stateStore = new WorkspaceV2StateStore();
	const binding = stateStore.read();
	const gistId = binding?.gistId ?? $appState.activeGistId;
	if (!token || !gistId) {
		setStatus($t("Reconnect GitHub before repairing Workspace sync."), "error");
		return;
	}
	workspaceBusy = true;
	try {
		const snapshot = await loadWorkspaceSnapshot(token, gistId);
		const remoteSignature = getSyncStateSignature(snapshot.state);
		const localSignature = getSyncStateSignature($appState);
		if (remoteSignature === localSignature) {
			persistSnapshot(snapshot, gistId, currentSyncMode());
			setStatus($t("Workspace sync state repaired"), "success");
			return;
		}
		conflict = {
			gistId,
			remoteDocument: snapshot.document,
			remoteState: snapshot.state,
			remoteSignature,
			localSignature,
		};
		const paused = createWorkspaceV2LocalState(gistId, {
			baseline: snapshot.document,
			conflictBaseline:
				binding?.workspaceId === `gist:${gistId}`
					? (binding.conflictBaseline ?? binding.baseline)
					: null,
			syncMode: "paused-conflict",
		});
		stateStore.write(paused);
		appState.set(withWorkspaceBinding($appState, paused));
		const queuedMutations = new WorkspaceMutationQueue().list();
		dispatchWorkspaceSyncEvent({
			type: "SYNC_CONTEXT_LOADED",
			mode: "paused-conflict",
			authenticated: true,
			revision: paused.revision,
			queue: {
				activeQueueCount: queuedMutations.filter(
					(item) => item.workspaceId === paused.workspaceId,
				).length,
				totalQueueCount: queuedMutations.length,
				orphanedWorkspaceCount: new Set(
					queuedMutations
						.filter((item) => item.workspaceId !== paused.workspaceId)
						.map((item) => item.workspaceId),
				).size,
				blockedMutationCount: 0,
			},
			blockedMutation: null,
		});
		setStatus(
			$t("Choose Pull, Merge, or Push to repair synchronization."),
			"info",
		);
	} catch {
		setStatus($t("Workspace sync repair failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

function handleImport() {
	try {
		if (!replaceState(importState(payload)).accepted) return;
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

	{#if workspaceCandidates.length > 0}
		<section class="gh-section" transition:slide>
			<div class="gh-section-header">
				<div>
					<h2 class="gh-section-title"><Octicon icon={database} className="h-5 w-5" />{$t("Choose Workspace")}</h2>
					<p class="gh-section-description">{$t("Multiple Workspace candidates were found. Select the one this device should use.")}</p>
				</div>
			</div>
			<div class="divide-y divide-border-muted">
				{#each workspaceCandidates as candidate}
					<div class="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
						<div class="min-w-0 space-y-2">
							<div class="flex flex-wrap items-center gap-2">
								<code class="text-xs font-semibold">{candidate.gist.id}</code>
								<span class={cn("gh-label", candidate.kind === "invalid" ? "gh-label-danger" : "gh-label-muted")}>{candidateKindLabel(candidate.kind)}</span>
								{#if candidate.currentBinding}<span class="gh-label badge-success">{$t("Current binding")}</span>{/if}
							</div>
							<p class="text-xs text-fg-muted">{$t("Updated {time}", { time: candidateUpdatedAt(candidate) })}</p>
							<p class="break-words text-xs text-fg-subtle">{$t("Files")}: {candidate.gist.files.map((file) => file.filename).join(", ") || $t("None")}</p>
							{#if candidate.reason === "invalid_bootstrap_marker"}
								<p class="text-xs text-[color:var(--danger-fg)]">{$t("The Workspace bootstrap marker is invalid.")}</p>
							{:else if candidate.reason === "invalid_workspace_document"}
								<p class="text-xs text-[color:var(--danger-fg)]">{$t("The Workspace configuration is invalid.")}</p>
							{:else if candidate.reason === "bootstrap_has_extra_files"}
								<p class="text-xs text-[color:var(--danger-fg)]">{$t("Bootstrap initialization requires the marker to be the only file.")}</p>
							{/if}
						</div>
						<div class="gh-btn-group shrink-0">
							<a class="gh-btn gh-btn-sm" href={candidate.gist.url} target="_blank"><Octicon icon={linkExternal} className="h-3.5 w-3.5" />{$t(candidate.kind === "bootstrap-incomplete" ? "Review cleanup" : "Open")}</a>
							{#if candidate.kind !== "invalid"}
								<button type="button" class="gh-btn gh-btn-primary gh-btn-sm" on:click={() => connectCandidate(candidate)} disabled={workspaceBusy}>
									{candidate.kind === "bootstrap-incomplete" ? $t("Resume") : $t("Select")}
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
			<div class="gh-section-footer text-xs text-fg-muted">{$t("SubMan never deletes an entire Gist automatically. Review unused bootstrap Gists in GitHub before removing them.")}</div>
		</section>
	{/if}

	<!-- GitHub Connection -->
		<section id="workspace-repair" class="gh-section">
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
					<label class="flex items-start gap-2 text-sm text-fg-muted" for="remember-token">
						<input id="remember-token" type="checkbox" class="mt-0.5 rounded border-border-default" aria-describedby="remember-token-risk" bind:checked={rememberToken} />
						<span>
							<span class="block font-medium text-fg-default">{$t("Remember token on this device")}</span>
							<span class="block text-xs">{$t("Off by default. The token otherwise stays in this browser session only.")}</span>
						</span>
					</label>
					<p id="remember-token-risk" class="flex items-start gap-1.5 text-xs text-attention-fg">
						<Octicon icon={alert} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>{$t("Persistent storage keeps the token on this device where same-origin JavaScript can read it. Active XSS can steal it; browser-side encryption would not prevent that.")}</span>
					</p>
				</div>
				<a href="https://github.com/settings/tokens/new?description=SubMan&scopes=gist" target="_blank" class="gh-link flex items-center gap-1 text-xs">
					<Octicon icon={linkExternal} className="h-3 w-3" /> {$t("Generate a new token on GitHub")}
				</a>
			{:else}
				<div class="flex flex-col gap-3">
					{#if $authState.migratedLegacyToken}
						<div class="flex items-start gap-2 rounded-md border border-attention-muted bg-attention-subtle p-3 text-sm text-attention-fg">
							<Octicon icon={alert} className="mt-0.5 h-4 w-4 shrink-0" />
							<span>{$t("A previously saved token was moved to this browser session. Choose Remember token to keep it on this device after the session ends.")}</span>
						</div>
					{/if}
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
							<button type="button" class="gh-btn gh-btn-sm" on:click={handleRepairSyncState} disabled={workspaceBusy}>
								<Octicon icon={shieldCheck} className="h-3.5 w-3.5" />
								{$t("Repair Sync State")}
							</button>
							<button type="button" class="gh-btn gh-btn-danger gh-btn-sm" on:click={handleTokenClear}><Octicon icon={trash} className="h-3.5 w-3.5" />{$t("Disconnect")}</button>
						</div>
					</div>
					<label class="flex items-center gap-2 text-sm text-fg-muted" for="remember-connected-token">
						<input
							id="remember-connected-token"
							type="checkbox"
							class="rounded border-border-default"
							aria-describedby="remember-connected-token-risk"
							checked={$authState.persistence === "persistent"}
							on:change={(event) =>
								setToken($authState.token, {
									remember: event.currentTarget.checked,
								})}
						/>
						<span>{$t("Remember token on this device")}</span>
					</label>
					<p id="remember-connected-token-risk" class="flex items-start gap-1.5 text-xs text-attention-fg">
						<Octicon icon={alert} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>{$t("Persistent storage keeps the token on this device where same-origin JavaScript can read it. Active XSS can steal it; browser-side encryption would not prevent that.")}</span>
					</p>
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
				<button type="button" class="gh-btn" on:click={handleDiagnosticsExport}><Octicon icon={database} className="h-4 w-4" />{$t("Export Diagnostics")}</button>
				<button type="button" class="gh-btn" on:click={handleImport}><Octicon icon={download} className="h-4 w-4" />{$t("Import")}</button>
				<button type="button" class="gh-btn" on:click={() => { navigator.clipboard.writeText(payload); setStatus($t("Copied to clipboard")); }} disabled={!payload} aria-label={$t("Copy")}><Octicon icon={copy} className="h-4 w-4" /></button>
			</div>
		</div>
	</section>

</div>
