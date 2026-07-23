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
import { exportWorkspaceDiagnosticsFromPersistence } from "$lib/workspace-diagnostics";
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
import type {
	WorkspacePersistenceRecord,
	WorkspaceQueueInspection,
} from "$lib/workspace-persistence";
import {
	getBrowserWorkspaceBinding,
	getBrowserWorkspacePersistence,
	getBrowserWorkspaceQueueMetrics,
	initializeBrowserWorkspacePersistence,
	refreshBrowserWorkspacePersistence,
} from "$lib/workspace-persistence-browser";
import {
	discardInspectedWorkspaceQueue,
	rebindInspectedWorkspace,
	refreshWorkspaceQueueInspection,
} from "$lib/workspace-queue-inspector";
import { bindWorkspaceOnly } from "$lib/workspace-session";
import { dispatchWorkspaceSyncEvent } from "$lib/workspace-sync-status";
import { clearLegacyWorkspaceSyncState } from "$lib/workspace-v1-cleanup";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	type WorkspaceV2LocalState,
} from "$lib/workspace-v2-state";

let tokenInput = "";
let rememberToken = false;
let payload = "";
let workspaceBusy = false;
let persistenceRecord: WorkspacePersistenceRecord | null = null;
let queueInspection: WorkspaceQueueInspection | null = null;
let queueActionWorkspaceId: string | null = null;
let queueResult: { type: "success" | "error"; message: string } | null = null;
let tombstoneNotice: string | null = null;
let workspaceCandidates: WorkspaceCandidate[] = [];
let pendingConnection: {
	token: string;
	rememberToken: boolean;
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

async function refreshPersistenceView() {
	persistenceRecord = await refreshBrowserWorkspacePersistence();
	queueInspection = await refreshWorkspaceQueueInspection(
		getBrowserWorkspacePersistence(),
	);
	return persistenceRecord;
}

function restorePersistedConflict(record: WorkspacePersistenceRecord) {
	const binding = record.binding;
	const activeQueue = binding
		? record.workspaces[binding.workspaceId]
		: undefined;
	if (
		binding?.syncMode === "paused-conflict" &&
		binding.baseline &&
		activeQueue?.delivery.blocked?.disposition === "state-conflict"
	) {
		restoreConflict(binding.baseline, binding.gistId);
	}
}

onMount(() => {
	rememberToken = $authState.persistence === "persistent";
	void initializeBrowserWorkspacePersistence({
		hydrate: (state) => appState.set(state),
	})
		.then(refreshPersistenceView)
		.then(restorePersistedConflict)
		.catch((error) => {
			queueResult = {
				type: "error",
				message: connectionErrorMessage(error),
			};
		});
	const unsubscribe = subscribeWorkspaceEvents((event) => {
		if (event.type === "paused-conflict" && event.document && event.gistId) {
			restoreConflict(event.document, event.gistId);
		}
		void refreshPersistenceView().catch(() => undefined);
	});
	return unsubscribe;
});
let manualPushReview: {
	gistId: string;
	remoteDocument: WorkspaceDocumentV2;
	remoteState: AppState;
	remoteSignature: string;
	localSignature: string;
} | null = null;

function currentSyncMode(): "automatic" | "manual" {
	return getBrowserWorkspaceBinding()?.syncMode === "manual"
		? "manual"
		: "automatic";
}

async function loadWorkspaceSnapshot(token: string, gistId: string) {
	const gist = await getGist(token, gistId);
	return readBrowserWorkspaceSnapshot(token, gist, $appState);
}

async function confirmDiscardPendingMutations(
	workspaceId: string,
): Promise<boolean> {
	const inspection = await refreshWorkspaceQueueInspection(
		getBrowserWorkspacePersistence(),
	);
	const count =
		inspection.workspaces.find((item) => item.workspaceId === workspaceId)
			?.mutations.length ?? 0;
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

async function persistSnapshot(
	snapshot: BrowserWorkspaceSnapshot,
	gistId: string,
	syncMode: "automatic" | "manual",
) {
	const state = await persistBrowserWorkspaceSnapshot(
		snapshot,
		gistId,
		syncMode,
	);
	await refreshPersistenceView();
	return state;
}

async function reconcileSnapshot(
	token: string,
	gistId: string,
	baseline: WorkspaceDocumentV2,
	resolvedState: AppState,
	syncMode: "automatic" | "manual",
	replacePending = false,
) {
	const state = await reconcileBrowserWorkspace({
		token,
		gistId,
		baseline,
		resolvedState,
		syncMode,
		replacePending,
	});
	await refreshPersistenceView();
	return state;
}

async function commitBindingSnapshot(
	snapshot: AppState,
	binding: WorkspaceV2LocalState,
) {
	await getBrowserWorkspacePersistence().rebindWorkspace({ snapshot, binding });
	appState.set(snapshot);
	await refreshPersistenceView();
}

function dispatchPersistedWorkspaceState(
	type: "WORKSPACE_BOUND" | "REPAIR_SUCCEEDED",
) {
	const binding = getBrowserWorkspaceBinding();
	if (!binding) return;
	dispatchWorkspaceSyncEvent({
		type,
		mode: binding.syncMode === "manual" ? "manual" : "automatic",
		revision: binding.revision,
		queue: getBrowserWorkspaceQueueMetrics(),
	});
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
		dispatchPersistedWorkspaceState("WORKSPACE_BOUND");
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
			await persistSnapshot(snapshot, gist.id, "automatic");
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
		dispatchPersistedWorkspaceState("WORKSPACE_BOUND");
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
		await commitBindingSnapshot(
			withWorkspaceBinding($appState, paused),
			paused,
		);
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
	const previousBinding = getBrowserWorkspaceBinding();
	try {
		const savedGistId = previousBinding?.gistId ?? $appState.activeGistId;
		const discovery = await discoverWorkspaceGist(token, savedGistId);
		if (discovery.status === "chooser") {
			workspaceCandidates = discovery.candidates;
			pendingConnection = {
				token,
				rememberToken,
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
	const binding = createWorkspaceV2LocalState(conflict.gistId, {
		baseline: conflict.remoteDocument,
		syncMode: "manual",
	});
	await commitBindingSnapshot(bound, binding);
	clearLegacyWorkspaceSyncState();
	dispatchPersistedWorkspaceState("WORKSPACE_BOUND");
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
			await persistSnapshot(
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
			tombstoneNotice =
				projected.notices.length > 0
					? $t(
							"Remote tombstones were preserved; deleted items were not restored.",
						)
					: null;
		} else {
			const localBinding = getBrowserWorkspaceBinding();
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
			tombstoneNotice =
				merged.notices.length > 0
					? $t(
							"Remote tombstones were preserved; deleted items were not restored.",
						)
					: null;
			setStatus($t("Merged data saved."), "success");
		}
		conflict = null;
		manualPushReview = null;
		tokenInput = "";
		dispatchPersistedWorkspaceState("REPAIR_SUCCEEDED");
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
			getBrowserWorkspaceBinding(),
		);
		const snapshot = await loadWorkspaceSnapshot(token, gistId);
		const remoteState = snapshot.state;
		const remoteSignature = getSyncStateSignature(remoteState);
		const localSignature = getSyncStateSignature($appState);

		if (remoteSignature === localSignature) {
			await persistSnapshot(snapshot, gistId, currentSyncMode());
			setStatus($t("Already in sync"), "info");
		} else {
			const confirmed = await requestConfirm({
				title: $t("Sync Update"),
				message: $t("Remote data is different. Overwrite local with remote?"),
				confirmText: $t("Pull Remote"),
			});
			if (confirmed) {
				if (!(await confirmDiscardPendingMutations(`gist:${gistId}`))) return;
				await persistSnapshot(snapshot, gistId, currentSyncMode());
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
			getBrowserWorkspaceBinding(),
		);
		const snapshot = await loadWorkspaceSnapshot(token, gistId);
		const remoteState = snapshot.state;
		const localSignature = getSyncStateSignature($appState);
		const remoteSignature = getSyncStateSignature(remoteState);
		const binding = getBrowserWorkspaceBinding();

		if (remoteSignature === localSignature) {
			await persistSnapshot(snapshot, gistId, currentSyncMode());
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
		await persistSnapshot(
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
		const localBinding = getBrowserWorkspaceBinding();
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
		tombstoneNotice =
			projected.notices.length > 0
				? $t(
						"Remote tombstones were preserved; deleted items were not restored.",
					)
				: null;
	} catch (err) {
		setStatus($t("Push failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

function handleTokenClear() {
	const queue = getBrowserWorkspaceQueueMetrics();
	clearAuth();
	dispatchWorkspaceSyncEvent(
		queue.totalQueueCount > 0
			? { type: "AUTH_LOST", queue }
			: { type: "WORKSPACE_DISCONNECTED", queue },
	);
	setStatus($t("Logged out"), "info");
	conflict = null;
	manualPushReview = null;
}

function handleExport() {
	payload = exportState($appState);
	setStatus($t("Config exported"), "success");
}

async function handleDiagnosticsExport() {
	try {
		payload = await exportWorkspaceDiagnosticsFromPersistence(
			getBrowserWorkspacePersistence(),
		);
		setStatus($t("Diagnostics exported"), "success");
	} catch (error) {
		setStatus(connectionErrorMessage(error), "error");
	}
}

async function handleRepairSyncState() {
	const token = $authState.token;
	const binding = getBrowserWorkspaceBinding();
	const gistId = binding?.gistId ?? $appState.activeGistId;
	if (!token || !gistId) {
		setStatus($t("Reconnect GitHub before repairing Workspace sync."), "error");
		return;
	}
	workspaceBusy = true;
	try {
		const inspection = await refreshWorkspaceQueueInspection(
			getBrowserWorkspacePersistence(),
		);
		const blocked = inspection.workspaces.find(
			(item) => item.workspaceId === `gist:${gistId}`,
		);
		const blockedMetadata = blocked?.blocked;
		if (blockedMetadata?.disposition === "domain-conflict") {
			queueResult = {
				type: "error",
				message: $t(
					"This is a domain conflict. Edit the affected item or discard and realign the complete Workspace queue.",
				),
			};
			return;
		}
		const snapshot = await loadWorkspaceSnapshot(token, gistId);
		const remoteSignature = getSyncStateSignature(snapshot.state);
		const localSignature = getSyncStateSignature($appState);
		if (remoteSignature === localSignature) {
			if (
				blocked &&
				(blocked.mutations.length > 0 ||
					blocked.deadLetters.length > 0 ||
					blocked.blocked !== null)
			) {
				const confirmed = await requestConfirm({
					title: $t("Repair Sync State"),
					message: $t(
						"Remote and local state match. Clear the complete active queue repair metadata?",
					),
					confirmText: $t("Repair / Reconcile"),
				});
				if (!confirmed) return;
			}
			await persistSnapshot(snapshot, gistId, currentSyncMode());
			dispatchPersistedWorkspaceState("REPAIR_SUCCEEDED");
			queueResult = {
				type: "success",
				message: $t("Workspace sync state repaired"),
			};
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
		await commitBindingSnapshot(
			withWorkspaceBinding($appState, paused),
			paused,
		);
		const queue = getBrowserWorkspaceQueueMetrics();
		dispatchWorkspaceSyncEvent({
			type: "SYNC_CONTEXT_LOADED",
			mode: "paused-conflict",
			authenticated: true,
			revision: paused.revision,
			queue,
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

async function handleQueueRefresh() {
	queueResult = null;
	try {
		await refreshPersistenceView();
		queueResult = {
			type: "success",
			message: $t("Queue inspector refreshed."),
		};
	} catch (error) {
		queueResult = { type: "error", message: connectionErrorMessage(error) };
	}
}

async function handleQueueDiscard(workspaceId: string) {
	const workspace = queueInspection?.workspaces.find(
		(item) => item.workspaceId === workspaceId,
	);
	if (!workspace) return;
	const itemCount = workspace.mutations.length + workspace.deadLetters.length;
	const confirmed = await requestConfirm({
		title: $t("Discard Workspace Queue"),
		message: workspace.active
			? $t(
					"Discard the complete active Workspace queue and revert local pending changes? This cannot be undone.",
				)
			: $t(
					"Discard the complete orphan Workspace queue? This cannot be undone.",
				),
		confirmText: $t("Discard Complete Queue"),
		danger: true,
	});
	if (!confirmed) return;
	queueActionWorkspaceId = workspaceId;
	queueResult = null;
	try {
		const persistence = getBrowserWorkspacePersistence();
		let result: Awaited<ReturnType<typeof discardInspectedWorkspaceQueue>>;
		if (workspace.active) {
			const binding = getBrowserWorkspaceBinding();
			if (!binding?.baseline || binding.workspaceId !== workspaceId) {
				throw new Error("Active Workspace baseline is unavailable");
			}
			const realignedBinding = createWorkspaceV2LocalState(binding.gistId, {
				baseline: binding.baseline,
				syncMode: binding.syncMode === "manual" ? "manual" : "automatic",
			});
			const realignedSnapshot = hydrateAppStateFromWorkspaceDocument(
				$appState,
				binding.baseline,
				binding.gistId,
			);
			result = await discardInspectedWorkspaceQueue(persistence, {
				workspaceId,
				realignment: {
					snapshot: realignedSnapshot,
					binding: realignedBinding,
				},
			});
			appState.set(realignedSnapshot);
			conflict = null;
			manualPushReview = null;
		} else {
			result = await discardInspectedWorkspaceQueue(persistence, {
				workspaceId,
			});
		}
		queueInspection = result.inspection;
		persistenceRecord = await refreshBrowserWorkspacePersistence();
		if (workspace.active) {
			dispatchPersistedWorkspaceState("REPAIR_SUCCEEDED");
		}
		queueResult = {
			type: "success",
			message: $t("Complete Workspace queue discarded ({count} items).", {
				count: Math.max(result.discardedCount, itemCount),
			}),
		};
	} catch (error) {
		queueResult = { type: "error", message: connectionErrorMessage(error) };
	} finally {
		queueActionWorkspaceId = null;
	}
}

async function handleQueueRebind(workspaceId: string) {
	if (!$authState.token || !workspaceId.startsWith("gist:")) return;
	const workspace = queueInspection?.workspaces.find(
		(item) => item.workspaceId === workspaceId,
	);
	if (!workspace || workspace.active || workspace.mutations.length > 0) return;
	queueActionWorkspaceId = workspaceId;
	queueResult = null;
	try {
		const gistId = workspaceId.slice("gist:".length);
		const snapshot = await loadWorkspaceSnapshot($authState.token, gistId);
		const binding = createWorkspaceV2LocalState(gistId, {
			baseline: snapshot.document,
			syncMode: "automatic",
		});
		queueInspection = await rebindInspectedWorkspace(
			getBrowserWorkspacePersistence(),
			{ workspaceId, snapshot: snapshot.state, binding },
		);
		appState.set(snapshot.state);
		persistenceRecord = await refreshBrowserWorkspacePersistence();
		dispatchPersistedWorkspaceState("WORKSPACE_BOUND");
		queueResult = {
			type: "success",
			message: $t("Workspace rebound after identity and revision validation."),
		};
	} catch (error) {
		queueResult = { type: "error", message: connectionErrorMessage(error) };
	} finally {
		queueActionWorkspaceId = null;
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
	{#if tombstoneNotice}
		<section class="gh-alert gh-alert-attention" data-testid="tombstone-notice" transition:slide>
			<Octicon icon={alert} className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--attention-emphasis)]" />
			<div class="min-w-0 flex-1">
				<h2 class="text-sm font-semibold">{$t("Remote deletions preserved")}</h2>
				<p class="text-sm text-fg-muted">{tombstoneNotice}</p>
			</div>
		</section>
	{/if}

	{#if conflict}
		<section class="gh-alert gh-alert-attention" data-testid="state-conflict" transition:slide>
			<Octicon icon={alert} className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--attention-emphasis)]" />
			<div class="min-w-0 flex-1 space-y-3">
				<div>
					<h2 class="text-sm font-semibold">{$t("Sync Conflict")}</h2>
					<p class="text-sm text-fg-muted">
						{$t("Remote and local data differ. Choose which side becomes the source of truth.")}
					</p>
					<p class="text-xs text-fg-muted">
						{$t("Merge and Use Local preserve remote tombstones, so deleted items are not restored.")}
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
							<button type="button" class="gh-btn gh-btn-sm" data-testid="repair-sync-action" on:click={handleRepairSyncState} disabled={workspaceBusy}>
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

	<section class="gh-section" aria-labelledby="queue-inspector-heading" data-testid="queue-inspector">
		<div class="gh-section-header">
			<div>
				<h2 id="queue-inspector-heading" class="gh-section-title">
					<Octicon icon={database} className="h-5 w-5" />{$t("Workspace Queue Inspector")}
				</h2>
				<p class="gh-section-description">
					{$t("Review active and orphan Workspace queues without exposing mutation payloads.")}
				</p>
			</div>
			<button type="button" class="gh-btn gh-btn-sm" on:click={handleQueueRefresh} disabled={queueActionWorkspaceId !== null}>
				<Octicon icon={sync} className={cn("h-3.5 w-3.5", queueActionWorkspaceId !== null && "animate-spin")} />
				{$t("Refresh")}
			</button>
		</div>
		<div class="gh-section-body space-y-4">
			<div class="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-default bg-border-muted sm:grid-cols-5">
				<div class="bg-canvas-default p-3"><p class="text-xs text-fg-muted">{$t("Active")}</p><p class="text-lg font-semibold" data-testid="active-queue-count">{queueInspection?.activeQueueCount ?? 0}</p></div>
				<div class="bg-canvas-default p-3"><p class="text-xs text-fg-muted">{$t("Total")}</p><p class="text-lg font-semibold" data-testid="total-queue-count">{queueInspection?.totalQueueCount ?? 0}</p></div>
				<div class="bg-canvas-default p-3"><p class="text-xs text-fg-muted">{$t("Orphan Workspaces")}</p><p class="text-lg font-semibold" data-testid="orphan-queue-count">{queueInspection?.orphanedWorkspaceCount ?? 0}</p></div>
				<div class="bg-canvas-default p-3"><p class="text-xs text-fg-muted">{$t("Blocked")}</p><p class="text-lg font-semibold">{queueInspection?.blockedCount ?? 0}</p></div>
				<div class="bg-canvas-default p-3"><p class="text-xs text-fg-muted">{$t("Dead letters")}</p><p class="text-lg font-semibold">{queueInspection?.deadLetterCount ?? 0}</p></div>
			</div>

			{#if persistenceRecord?.binding}
				<p class="text-xs text-fg-muted">
					{$t("Current binding")}: <code>{persistenceRecord.binding.workspaceId}</code>
					<span class="gh-label gh-label-muted ml-2">{persistenceRecord.binding.syncMode}</span>
				</p>
			{:else}
				<p class="text-xs text-fg-muted">{$t("No current Workspace binding.")}</p>
			{/if}

			{#if queueResult}
				<div
					class={cn("gh-alert", queueResult.type === "success" ? "gh-alert-success" : "gh-alert-danger")}
					role={queueResult.type === "error" ? "alert" : "status"}
					data-testid="queue-action-result"
				>
					<Octicon icon={queueResult.type === "success" ? checkCircle : alert} className="mt-0.5 h-4 w-4 shrink-0" />
					<p class="text-sm">{queueResult.message}</p>
				</div>
			{/if}

			{#if !queueInspection}
				<p class="text-sm text-fg-muted">{$t("Loading queue metadata...")}</p>
			{:else if queueInspection.workspaces.length === 0}
				<p class="text-sm text-fg-muted">{$t("No pending, blocked, or dead-letter Workspace queues.")}</p>
			{:else}
				<div class="divide-y divide-border-muted rounded-md border border-border-default" data-testid="queue-workspace-groups">
					{#each queueInspection.workspaces as workspace}
						<article class="space-y-3 p-4" data-testid={workspace.active ? "active-workspace-queue" : "orphan-workspace-queue"}>
							<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
								<div class="min-w-0 space-y-1">
									<div class="flex flex-wrap items-center gap-2">
										<code class="break-all text-xs font-semibold">{workspace.workspaceId}</code>
										<span class={cn("gh-label", workspace.active ? "badge-success" : "gh-label-muted")}>{workspace.active ? $t("Active Workspace") : $t("Orphan Workspace")}</span>
									</div>
									<p class="text-xs text-fg-muted">{$t("{count} queued mutations", { count: workspace.mutations.length })}</p>
									{#if workspace.blocked}
										<p class="text-xs text-[color:var(--danger-fg)]" data-testid="blocked-queue-metadata">
											{$t("Blocked")}: {workspace.blocked.disposition} / {workspace.blocked.code} / {workspace.blocked.kind}
										</p>
									{/if}
									{#if workspace.retry.attempt > 0}
										<p class="text-xs text-fg-muted">{$t("Retry attempt {count}", { count: workspace.retry.attempt })}</p>
									{/if}
								</div>
								<div class="gh-btn-group shrink-0">
									{#if workspace.active}
										<button type="button" class="gh-btn gh-btn-sm" on:click={handleRepairSyncState} disabled={workspaceBusy || queueActionWorkspaceId !== null}>
											<Octicon icon={shieldCheck} className="h-3.5 w-3.5" />{$t("Repair / Reconcile")}
										</button>
									{:else if workspace.mutations.length === 0 && $authState.token}
										<button type="button" class="gh-btn gh-btn-sm" on:click={() => handleQueueRebind(workspace.workspaceId)} disabled={queueActionWorkspaceId !== null}>
											<Octicon icon={sync} className="h-3.5 w-3.5" />{$t("Validate & Rebind")}
										</button>
									{/if}
									<button type="button" class="gh-btn gh-btn-danger gh-btn-sm" on:click={() => handleQueueDiscard(workspace.workspaceId)} disabled={queueActionWorkspaceId !== null}>
										<Octicon icon={trash} className="h-3.5 w-3.5" />{$t("Discard Complete Queue")}
									</button>
								</div>
							</div>
							{#if workspace.mutations.length > 0 || workspace.deadLetters.length > 0}
								<details class="text-xs text-fg-muted">
									<summary class="cursor-pointer font-medium text-fg-default">{$t("Safe queue metadata")}</summary>
									<ul class="mt-2 space-y-1 font-mono">
										{#each workspace.mutations as mutation}
											<li class="break-all">{mutation.expectedRevision} / {mutation.kind} / {mutation.mutationId} / {mutation.payloadBytes} B</li>
										{/each}
										{#each workspace.deadLetters as deadLetter}
											<li class="break-all text-[color:var(--danger-fg)]">{$t("Dead letter")}: {deadLetter.disposition} / {deadLetter.code} / {deadLetter.mutationId}</li>
										{/each}
									</ul>
								</details>
							{/if}
						</article>
					{/each}
				</div>
			{/if}
		</div>
		<div class="gh-section-footer text-xs text-fg-muted">
			{$t("Discard and repair always operate on a complete Workspace queue. Orphan queues remain stored when the active Workspace changes.")}
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
