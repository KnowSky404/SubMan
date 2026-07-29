<script lang="ts">
import { onMount } from "svelte";
import { slide } from "svelte/transition";
import Octicon from "$lib/components/Octicon.svelte";
import { getGist } from "$lib/gist";
import { t } from "$lib/i18n";
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
import { exportState, exportSyncState, importState } from "$lib/serialization";
import { appState, replaceState } from "$lib/stores/app";
import { authState, clearAuth, setToken } from "$lib/stores/auth";
import { requestConfirm } from "$lib/stores/confirm";
import { showToast } from "$lib/stores/toast";
import { cn } from "$lib/utils/cn";
import {
	discoverWorkspaceGist,
	ensureWorkspaceBootstrapGist,
	type WorkspaceCandidate,
} from "$lib/workspace";
import { readBrowserWorkspaceSnapshot } from "$lib/workspace-browser-session-v2";
import { subscribeWorkspaceEvents } from "$lib/workspace-events";
import {
	presentWorkspaceOperation,
	type WorkspaceOperationPresentationOptions,
} from "$lib/workspace-operation-presenter";
import type { WorkspaceOperationResult } from "$lib/workspace-operation-result";
import type {
	WorkspacePersistenceRecord,
	WorkspaceQueueInspection,
} from "$lib/workspace-persistence";
import {
	createWorkspaceSettingsController,
	type WorkspaceSettingsConflict,
	type WorkspaceSettingsView,
} from "$lib/workspace-settings-controller";
import { workspaceSyncStatus } from "$lib/workspace-sync-status";
import { clearLegacyWorkspaceSyncState } from "$lib/workspace-v1-cleanup";
import type { WorkspaceV2LocalState } from "$lib/workspace-v2-state";

let tokenInput = "";
let rememberToken = false;
let payload = "";
let workspaceBusy = false;
let persistenceRecord: WorkspacePersistenceRecord | null = null;
let queueInspection: WorkspaceQueueInspection | null = null;
let queueActionWorkspaceId: string | null = null;
let queueResult: {
	type: "success" | "info" | "error";
	message: string;
} | null = null;
let tombstoneNotice: string | null = null;
let workspaceCandidates: WorkspaceCandidate[] = [];
let pendingConnection: {
	token: string;
	rememberToken: boolean;
	previousBinding: WorkspaceV2LocalState | null;
} | null = null;

// Conflict State
let conflict: WorkspaceSettingsConflict | null = null;

const workspaceController = createWorkspaceSettingsController({
	getState: () => $appState,
	setState: (state) => appState.set(state),
});

function applyPersistenceView(view: WorkspaceSettingsView) {
	persistenceRecord = view.record;
	queueInspection = view.inspection;
	return view;
}

async function refreshPersistenceView() {
	return applyPersistenceView(await workspaceController.refresh());
}

onMount(() => {
	rememberToken = $authState.persistence === "persistent";
	void workspaceController
		.initialize()
		.then(applyPersistenceView)
		.then((view) => {
			conflict = workspaceController.persistedConflict(view);
		})
		.catch((error) => {
			queueResult = {
				type: "error",
				message: connectionErrorMessage(error),
			};
		});
	const unsubscribe = subscribeWorkspaceEvents((event) => {
		if (event.type === "paused-conflict" && event.document && event.gistId) {
			conflict = workspaceController.createConflict(
				event.document,
				event.gistId,
			);
		}
		void refreshPersistenceView().catch(() => undefined);
	});
	return unsubscribe;
});
let manualPushReview: WorkspaceSettingsConflict | null = null;

function currentSyncMode(): "automatic" | "manual" {
	return workspaceController.syncMode();
}

async function loadWorkspaceSnapshot(token: string, gistId: string) {
	const gist = await getGist(token, gistId);
	return readBrowserWorkspaceSnapshot(token, gist, $appState);
}

async function confirmDiscardPendingMutations(
	workspaceId: string,
): Promise<boolean> {
	const count = await workspaceController.pendingCount(workspaceId);
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

function setStatus(
	message: string,
	type: "success" | "info" | "error" = "success",
) {
	showToast(message, type);
}

function showWorkspaceResult(
	result: WorkspaceOperationResult,
	options: WorkspaceOperationPresentationOptions = {},
) {
	const presentation = presentWorkspaceOperation(result, options);
	setStatus(
		$t(presentation.messageKey, presentation.messageParams),
		presentation.tone,
	);
	return presentation;
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
	const snapshot = await readBrowserWorkspaceSnapshot(token, gist, $appState);
	const result = await workspaceController.connect({
		token,
		gistId: gist.id,
		created,
		snapshot,
		previousBinding,
	});
	applyPersistenceView(
		workspaceController.currentView() as WorkspaceSettingsView,
	);
	clearLegacyWorkspaceSyncState();
	setToken(token, { remember });
	if (result.status === "conflict") {
		conflict = result.conflict;
		setStatus($t("Sync conflict detected"), "info");
	} else {
		if (
			result.operation &&
			!presentWorkspaceOperation(result.operation).remoteCommitted
		) {
			showWorkspaceResult(result.operation);
		} else {
			setStatus(
				$t(
					result.status === "created"
						? "Workspace created and connected"
						: "Workspace connected (In Sync)",
				),
				"success",
			);
		}
		tokenInput = "";
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
	const previousBinding = workspaceController.binding();
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

async function handleBindOnly() {
	if (!conflict) return;
	await workspaceController.bindOnly(conflict);
	applyPersistenceView(
		workspaceController.currentView() as WorkspaceSettingsView,
	);
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
		const result = await workspaceController.resolveConflict({
			token: $authState.token,
			conflict: currentConflict,
			action,
		});
		applyPersistenceView(
			workspaceController.currentView() as WorkspaceSettingsView,
		);
		if (result.status === "needs-choice") {
			setStatus(
				$t(
					"Entity conflicts require choosing Use Local or Use Remote before saving",
				),
				"info",
			);
			return;
		}
		if (
			action !== "remote" &&
			result.operation &&
			!presentWorkspaceOperation(result.operation).remoteCommitted
		) {
			showWorkspaceResult(result.operation);
			return;
		}
		if (action === "remote") {
			setStatus($t("Remote data loaded"), "success");
		} else if (action === "local") {
			setStatus(
				result.notices.length > 0
					? $t("Local data pushed; remote deletions were preserved")
					: $t("Local data pushed to Gist"),
				"success",
			);
			tombstoneNotice =
				result.notices.length > 0
					? $t(
							"Remote tombstones were preserved; deleted items were not restored.",
						)
					: null;
		} else {
			tombstoneNotice =
				result.notices.length > 0
					? $t(
							"Remote tombstones were preserved; deleted items were not restored.",
						)
					: null;
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
		const { gistId } = workspaceController.requireIdentity();
		const snapshot = await loadWorkspaceSnapshot(token, gistId);
		const decision = workspaceController.evaluateManualPull(snapshot, gistId);

		if (decision.status === "already-synced") {
			await workspaceController.persistSnapshot(
				snapshot,
				gistId,
				currentSyncMode(),
			);
			await refreshPersistenceView();
			setStatus($t("Already in sync"), "info");
		} else {
			const confirmed = await requestConfirm({
				title: $t("Sync Update"),
				message: $t("Remote data is different. Overwrite local with remote?"),
				confirmText: $t("Pull Remote"),
			});
			if (confirmed) {
				if (!(await confirmDiscardPendingMutations(`gist:${gistId}`))) return;
				await workspaceController.persistSnapshot(
					snapshot,
					gistId,
					currentSyncMode(),
				);
				await refreshPersistenceView();
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
		const { gistId } = workspaceController.requireIdentity();
		const snapshot = await loadWorkspaceSnapshot(token, gistId);
		const decision = workspaceController.evaluateManualPush(snapshot, gistId);

		if (decision.status === "already-synced") {
			await workspaceController.persistSnapshot(
				snapshot,
				gistId,
				currentSyncMode(),
			);
			await refreshPersistenceView();
			manualPushReview = null;
			setStatus($t("Already in sync"), "info");
			return;
		}

		if (decision.status === "needs-review") {
			manualPushReview = decision.conflict;
			setStatus($t("Remote workspace changed since your last sync."), "info");
			return;
		}

		const confirmed = await requestConfirm({
			title: $t("Sync Update"),
			message: $t("Overwrite remote workspace data with current local state?"),
			confirmText: $t("Push Local"),
		});
		if (!confirmed) return;

		const result = await workspaceController.reconcile({
			token,
			gistId,
			baseline: snapshot.document,
			resolvedState: $appState,
			syncMode: currentSyncMode(),
		});
		await refreshPersistenceView();
		const presentation = showWorkspaceResult(result, {
			remoteCommittedMessageKey: "Pushed successfully",
		});
		if (!presentation.remoteCommitted) return;
		manualPushReview = null;
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
		await workspaceController.resolveConflict({
			token: $authState.token,
			conflict: manualPushReview,
			action: "remote",
			syncMode: currentSyncMode(),
		});
		await refreshPersistenceView();
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
		const result = await workspaceController.resolveConflict({
			token: $authState.token,
			conflict: manualPushReview,
			action: "merge",
			baselineMode: "current",
			syncMode: currentSyncMode(),
		});
		if (result.status === "needs-choice") {
			setStatus(
				$t(
					"Entity conflicts require choosing Force Push or Pull Remote before saving",
				),
				"info",
			);
			return;
		}
		if (
			result.operation &&
			!presentWorkspaceOperation(result.operation).remoteCommitted
		) {
			showWorkspaceResult(result.operation);
			return;
		}
		await refreshPersistenceView();
		manualPushReview = null;
		tombstoneNotice =
			result.notices.length > 0
				? $t(
						"Remote tombstones were preserved; deleted items were not restored.",
					)
				: null;
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
		const result = await workspaceController.resolveConflict({
			token: $authState.token,
			conflict: manualPushReview,
			action: "local",
			syncMode: currentSyncMode(),
		});
		if (result.status === "needs-choice") return;
		if (
			result.operation &&
			!presentWorkspaceOperation(result.operation).remoteCommitted
		) {
			showWorkspaceResult(result.operation);
			return;
		}
		await refreshPersistenceView();
		manualPushReview = null;
		setStatus(
			result.notices.length > 0
				? $t("Pushed successfully; remote deletions were preserved")
				: $t("Pushed successfully"),
			"success",
		);
		tombstoneNotice =
			result.notices.length > 0
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
	clearAuth();
	workspaceController.disconnect();
	setStatus($t("Logged out"), "info");
	conflict = null;
	manualPushReview = null;
}

function handleTokenReplacement() {
	const token = tokenInput.trim();
	if (!token) return;
	setToken(token, { remember: $authState.persistence === "persistent" });
	tokenInput = "";
	setStatus($t("Token replaced; Workspace sync is resuming"), "info");
}

function handleExport() {
	payload = exportState($appState);
	setStatus($t("Config exported"), "success");
}

async function handleDiagnosticsExport() {
	try {
		payload = await workspaceController.exportDiagnostics();
		setStatus($t("Diagnostics exported"), "success");
	} catch (error) {
		setStatus(connectionErrorMessage(error), "error");
	}
}

async function handleRepairSyncState() {
	const token = $authState.token;
	const binding = workspaceController.binding();
	const gistId = binding?.gistId ?? $appState.activeGistId;
	if (!token || !gistId) {
		setStatus($t("Reconnect GitHub before repairing Workspace sync."), "error");
		return;
	}
	workspaceBusy = true;
	try {
		await workspaceController.refresh();
		applyPersistenceView(
			workspaceController.currentView() as WorkspaceSettingsView,
		);
		const snapshot = await loadWorkspaceSnapshot(token, gistId);
		const decision = workspaceController.evaluateRepair(snapshot, gistId);
		if (decision.status === "domain-blocked") {
			queueResult = {
				type: "error",
				message: $t(
					"This is a domain conflict. Edit the affected item or discard and realign the complete Workspace queue.",
				),
			};
			return;
		}
		if (decision.status === "already-synced") {
			if (decision.clearMetadata) {
				const confirmed = await requestConfirm({
					title: $t("Repair Sync State"),
					message: $t(
						"Remote and local state match. Clear the complete active queue repair metadata?",
					),
					confirmText: $t("Repair / Reconcile"),
				});
				if (!confirmed) return;
			}
			await workspaceController.persistSnapshot(
				snapshot,
				gistId,
				currentSyncMode(),
			);
			workspaceController.dispatchPersistedState("REPAIR_SUCCEEDED");
			await refreshPersistenceView();
			queueResult = {
				type: "success",
				message: $t("Workspace sync state repaired"),
			};
			setStatus($t("Workspace sync state repaired"), "success");
			return;
		}
		conflict = await workspaceController.pauseForRepair(
			snapshot.document,
			gistId,
		);
		await refreshPersistenceView();
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
		const result = await workspaceController.discardQueue(workspaceId);
		applyPersistenceView(result.view);
		if (result.active) {
			conflict = null;
			manualPushReview = null;
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
		const view = applyPersistenceView(
			await workspaceController.rebindOrphan({ workspaceId, snapshot }),
		);
		const active = view.inspection.workspaces.find(
			(item) => item.workspaceId === workspaceId,
		);
		const repairRequired = Boolean(
			active?.blocked || active?.deadLetters.length,
		);
		queueResult = {
			type: repairRequired ? "info" : "success",
			message: repairRequired
				? $t(
						"Workspace rebound; retained repair evidence still requires review.",
					)
				: $t("Workspace rebound after identity and revision validation."),
		};
	} catch (error) {
		queueResult = { type: "error", message: connectionErrorMessage(error) };
	} finally {
		queueActionWorkspaceId = null;
	}
}

async function handleImport() {
	try {
		const result = await replaceState(importState(payload)).completion;
		const presentation = showWorkspaceResult(result, {
			localDurableMessageKey: "Config imported",
			remoteCommittedMessageKey: "Config imported",
		});
		if (presentation.finalizeDraft) payload = "";
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
					{#if $workspaceSyncStatus.phase === "auth-required"}
						<form class="space-y-3 rounded-md border border-attention-muted bg-attention-subtle p-3" data-testid="auth-recovery" on:submit|preventDefault={handleTokenReplacement}>
							<div>
								<label class="gh-form-label" for="replacement-github-token">{$t("Replacement personal access token")}</label>
								<p class="gh-form-caption">{$t("The current token was rejected. Pending changes remain queued and will resume with the replacement token.")}</p>
							</div>
							<div class="flex flex-col gap-2 sm:flex-row">
								<input id="replacement-github-token" type="password" class="gh-input flex-1 font-mono" placeholder="ghp_xxxxxxxxxxxx" bind:value={tokenInput} autocomplete="off" />
								<button type="submit" class="gh-btn gh-btn-primary" disabled={!tokenInput.trim()}>
									<Octicon icon={sync} className="h-4 w-4" />
									{$t("Replace Token & Resume")}
								</button>
							</div>
						</form>
					{/if}
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
				<div class="bg-canvas-default p-3"><p class="text-xs text-fg-muted">{$t("Blocked")}</p><p class="text-lg font-semibold">{queueInspection?.blockedMutationCount ?? 0}</p></div>
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
					class={cn(
						"gh-alert",
						queueResult.type === "success"
							? "gh-alert-success"
							: queueResult.type === "info"
								? "gh-alert-attention"
								: "gh-alert-danger",
					)}
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
