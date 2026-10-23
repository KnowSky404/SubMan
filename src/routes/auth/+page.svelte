<script lang="ts">
import { onMount } from "svelte";
import Octicon from "$lib/components/Octicon.svelte";
import { getGist } from "$lib/gist";
import { t } from "$lib/i18n";
import type { GistMeta } from "$lib/models";
import {
	database,
	download,
	linkExternal,
	markGithub,
	save,
	shieldCheck,
	sync,
	trash,
} from "$lib/octicons";
import { appState } from "$lib/stores/app";
import { authState, clearAuth, setToken } from "$lib/stores/auth";
import { requestConfirm } from "$lib/stores/confirm";
import { showToast } from "$lib/stores/toast";
import { cn } from "$lib/utils/cn";
import {
	classifyWorkspaceCandidate,
	discoverWorkspaceGist,
	ensureWorkspaceBootstrapGist,
} from "$lib/workspace";
import {
	type BrowserWorkspaceSnapshot,
	readBrowserWorkspaceSnapshot,
} from "$lib/workspace-browser-session-v2";
import {
	cancelCloudWorkspaceLoad,
	refreshCloudWorkspace,
} from "$lib/workspace-cloud-session";
import { workspaceCloudStatus } from "$lib/workspace-cloud-status";
import { subscribeWorkspaceEvents } from "$lib/workspace-events";
import { presentWorkspaceOperation } from "$lib/workspace-operation-presenter";
import type { WorkspaceOperationResult } from "$lib/workspace-operation-result";
import {
	createWorkspaceSettingsController,
	type WorkspaceSettingsView,
} from "$lib/workspace-settings-controller";
import { workspaceSyncStatus } from "$lib/workspace-sync-status";
import { clearLegacyWorkspaceSyncState } from "$lib/workspace-v1-cleanup";

let tokenInput = "";
let rememberToken = false;
let gistIdInput = "";
let legacyGistIdInput = "";
let workspaceBusy = false;
let connectionRevision = 0;
let view: WorkspaceSettingsView | null = null;
let notice: { type: "info" | "error"; message: string } | null = null;
let legacyCheckResult: { type: "info" | "error"; message: string } | null =
	null;
let queueResult: {
	type: "success" | "info" | "error";
	message: string;
} | null = null;
let pendingMigration: {
	token: string;
	gist: GistMeta;
	snapshot: BrowserWorkspaceSnapshot;
	remember: boolean;
	mutationId?: string;
} | null = null;
const workspaceController = createWorkspaceSettingsController({
	getState: () => $appState,
	setState: (state) => appState.set(state),
});
$: migrationQueued = Boolean(
	pendingMigration &&
		view?.record.workspaces[`gist:${pendingMigration.gist.id}`]?.mutations.some(
			(mutation) => mutation.kind === "workspace.migrate",
		),
);

async function refreshView() {
	view = await workspaceController.refresh();
}
function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : "";
	if (message.includes("migration_backup_conflict"))
		return $t(
			"The immutable V1 migration backup does not match subman.json. Restore the matching backup before retrying.",
		);
	if (message.includes("invalid_bootstrap_marker"))
		return $t(
			"The Workspace bootstrap marker is invalid. Repair or remove it in GitHub before resuming.",
		);
	const safeMessages = [
		"Enter a Gist ID, not a URL.",
		"The bound cloud Workspace is invalid. Repair this Gist before reconnecting.",
		"This Gist is not a valid Workspace. Check its description is SubMan-Data and it contains a valid subman.json.",
		"This device is already connected to a Workspace. Reconnect the same Gist.",
		"Pending cloud changes must finish syncing before refreshing cloud data.",
		"Workspace queue requires repair before connection",
	];
	return $t(
		safeMessages.includes(message)
			? message
			: "Cloud data could not be loaded. Check your connection and retry.",
	);
}
function showOperation(
	result: WorkspaceOperationResult,
	remoteCommittedMessageKey?: string,
) {
	const presentation = presentWorkspaceOperation(result, {
		remoteCommittedMessageKey,
	});
	showToast(
		$t(presentation.messageKey, presentation.messageParams),
		presentation.tone,
	);
	return presentation;
}
onMount(() => {
	rememberToken = $authState.persistence === "persistent";
	void workspaceController
		.initialize()
		.then(async (initial) => {
			view = initial;
			const gistId = initial.record.binding?.gistId ?? $appState.activeGistId;
			const token = $authState.token;
			const revision = connectionRevision;
			if (!gistId || !token) return;
			try {
				const gist = await getGist(token, gistId);
				const snapshot = await readBrowserWorkspaceSnapshot(
					token,
					gist,
					$appState,
				);
				if (
					revision === connectionRevision &&
					token === $authState.token &&
					snapshot.origin === "v1"
				)
					pendingMigration = { token, gist, snapshot, remember: rememberToken };
			} catch {
				// The shared cloud session owns connection feedback.
			}
		})
		.catch((error) => {
			notice = { type: "error", message: errorMessage(error) };
		});
	return subscribeWorkspaceEvents(() => {
		void refreshView().catch(() => undefined);
	});
});
async function connectGist(
	token: string,
	gist: GistMeta,
	created: boolean,
	remember: boolean,
) {
	const revision = connectionRevision;
	const snapshot = await readBrowserWorkspaceSnapshot(token, gist, $appState);
	if (revision !== connectionRevision) return;
	const previousBinding = workspaceController.binding();
	if (previousBinding?.gistId === gist.id && snapshot.origin === "v2") {
		setToken(token, { remember });
		await refreshCloudWorkspace(token);
		await refreshView();
		if ($workspaceCloudStatus.phase === "ready") {
			tokenInput = "";
			showToast($t("Cloud data loaded."), "success");
		}
		return;
	}
	const result = await workspaceController.connect({
		token,
		gistId: gist.id,
		created,
		snapshot,
		previousBinding,
	});
	if (revision !== connectionRevision) return;
	if (result.status === "migration-required") {
		pendingMigration = { token, gist, snapshot, remember };
		return;
	}
	await refreshView();
	clearLegacyWorkspaceSyncState();
	setToken(token, { remember });
	tokenInput = "";
	pendingMigration = null;
	if (
		"operation" in result &&
		result.operation &&
		!showOperation(result.operation).remoteCommitted
	) {
		workspaceCloudStatus.set({
			phase: "error",
			message:
				"Cloud synchronization is pending. Retry after the connection is restored.",
		});
		return;
	}
	workspaceCloudStatus.set({ phase: "ready", message: null });
	showToast($t("Cloud data loaded."), "success");
}
async function handleTokenSave() {
	const token = (tokenInput || $authState.token || "").trim();
	if (!token || workspaceBusy) return;
	connectionRevision += 1;
	workspaceBusy = true;
	notice = null;
	try {
		await refreshView();
		const gistId =
			view?.record.binding?.gistId ??
			$appState.activeGistId ??
			gistIdInput.trim();
		if (gistId && !/^[a-zA-Z0-9_-]{1,64}$/.test(gistId))
			throw new Error("Enter a Gist ID, not a URL.");
		const discovery = await discoverWorkspaceGist(token, gistId || null);
		if (discovery.status === "ambiguous") {
			notice = {
				type: "info",
				message: $t(
					"Multiple Workspace Gists found. Enter the Gist ID to connect.",
				),
			};
			return;
		}
		const target =
			discovery.status === "found"
				? { gist: discovery.gist, created: false }
				: await ensureWorkspaceBootstrapGist(token);
		await connectGist(token, target.gist, target.created, rememberToken);
	} catch (error) {
		notice = { type: "error", message: errorMessage(error) };
	} finally {
		workspaceBusy = false;
	}
}
async function handleSync() {
	if (!$authState.token || workspaceBusy) return;
	workspaceBusy = true;
	notice = null;
	try {
		await refreshCloudWorkspace($authState.token);
		await refreshView();
		if ($workspaceCloudStatus.phase === "ready")
			showToast($t("Cloud data loaded."), "success");
	} catch (error) {
		notice = { type: "error", message: errorMessage(error) };
	} finally {
		workspaceBusy = false;
	}
}
async function handleLegacyWorkspaceCheck() {
	const token = ($authState.token ?? tokenInput).trim();
	const gistId = legacyGistIdInput.trim();
	if (
		!token ||
		!gistId ||
		workspaceBusy ||
		pendingMigration ||
		$appState.activeGistId
	)
		return;
	connectionRevision += 1;
	workspaceBusy = true;
	legacyCheckResult = null;
	try {
		if (!/^[a-zA-Z0-9_-]{1,64}$/.test(gistId))
			throw new Error("Enter a Gist ID, not a URL.");
		const gist = await getGist(token, gistId);
		const candidate = await classifyWorkspaceCandidate(token, gist);
		if (candidate.kind === "invalid")
			throw new Error(
				"This Gist is not a valid Workspace. Check its description is SubMan-Data and it contains a valid subman.json.",
			);
		if (candidate.kind !== "legacy-v1") {
			legacyCheckResult = {
				type: "info",
				message: $t(
					"Workspace {gistId} does not contain legacy V1 data. No migration is needed.",
					{ gistId },
				),
			};
			return;
		}
		await connectGist(token, gist, false, rememberToken);
	} catch (error) {
		legacyCheckResult = { type: "error", message: errorMessage(error) };
	} finally {
		workspaceBusy = false;
	}
}
async function handleLegacyMigration() {
	if (!pendingMigration || workspaceBusy) return;
	workspaceBusy = true;
	try {
		const migration = pendingMigration;
		const result = await workspaceController.migrateLegacy({
			token: migration.token,
			gistId: migration.gist.id,
			snapshot: migration.snapshot,
			retryMutationId: migration.mutationId,
		});
		if (result.mutationId) migration.mutationId = result.mutationId;
		setToken(migration.token, { remember: migration.remember });
		await refreshView();
		if (
			showOperation(
				result,
				"Workspace migrated. Existing publication links are unchanged.",
			).remoteCommitted
		) {
			pendingMigration = null;
			workspaceCloudStatus.set({ phase: "ready", message: null });
		}
	} catch (error) {
		notice = { type: "error", message: errorMessage(error) };
	} finally {
		workspaceBusy = false;
	}
}
async function handleRecheckMigration() {
	if (!pendingMigration || workspaceBusy) return;
	workspaceBusy = true;
	try {
		const migration = pendingMigration;
		await connectGist(
			migration.token,
			await getGist(migration.token, migration.gist.id),
			false,
			migration.remember,
		);
	} catch (error) {
		notice = { type: "error", message: errorMessage(error) };
	} finally {
		workspaceBusy = false;
	}
}
function handleTokenClear() {
	connectionRevision += 1;
	cancelCloudWorkspaceLoad();
	clearAuth();
	workspaceController.disconnect();
	pendingMigration = null;
	notice = null;
}
function handleTokenReplacement() {
	const token = tokenInput.trim();
	if (!token) return;
	setToken(token, { remember: $authState.persistence === "persistent" });
	if (pendingMigration) pendingMigration = { ...pendingMigration, token };
	tokenInput = "";
	showToast($t("Token replaced; Workspace sync is resuming"), "info");
}
async function handleReloadCloud() {
	if (!$authState.token || workspaceBusy || !view?.record.binding) return;
	const confirmed = await requestConfirm({
		title: $t("Reload from Cloud"),
		message: $t(
			"Discard unconfirmed changes and reload the latest cloud data?",
		),
		confirmText: $t("Reload from Cloud"),
		danger: true,
	});
	if (!confirmed) return;
	workspaceBusy = true;
	try {
		await workspaceController.discardQueue(view.record.binding.workspaceId);
		await refreshCloudWorkspace($authState.token);
		await refreshView();
	} catch (error) {
		notice = { type: "error", message: errorMessage(error) };
	} finally {
		workspaceBusy = false;
	}
}
async function handleQueueDiscard(workspaceId: string) {
	if (workspaceId === view?.record.binding?.workspaceId) {
		await handleReloadCloud();
		return;
	}
	const confirmed = await requestConfirm({
		title: $t("Discard Workspace Queue"),
		message: $t(
			"Discard the complete orphan Workspace queue? This cannot be undone.",
		),
		confirmText: $t("Discard Complete Queue"),
		danger: true,
	});
	if (!confirmed) return;
	workspaceBusy = true;
	try {
		const result = await workspaceController.discardQueue(workspaceId);
		view = result.view;
		queueResult = {
			type: "success",
			message: $t("Complete Workspace queue discarded ({count} items).", {
				count: result.discardedCount,
			}),
		};
	} catch (error) {
		queueResult = { type: "error", message: errorMessage(error) };
	} finally {
		workspaceBusy = false;
	}
}
async function handleDiagnosticsExport() {
	try {
		const payload = await workspaceController.exportDiagnostics();
		const url = URL.createObjectURL(
			new Blob([payload], { type: "application/json" }),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "subman-diagnostics.json";
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	} catch (error) {
		notice = { type: "error", message: errorMessage(error) };
	}
}
</script>

<div class="gh-page">
	<header class="gh-page-header"><div class="gh-page-heading">
		<h1 class="gh-page-title">{$t("Settings")}</h1>
		<p class="gh-page-subtitle">{$t("Manage one cloud Workspace. Every change is saved to GitHub.")}</p>
	</div></header>
	{#if pendingMigration}
		<section class="gh-section" data-testid="legacy-migration" aria-labelledby="legacy-migration-heading">
			<div class="gh-section-header"><div>
				<h2 id="legacy-migration-heading" class="gh-section-title"><Octicon icon={database} className="h-5 w-5" />{$t("Upgrade this Workspace")}</h2>
				<p class="gh-section-description">{$t("An older Workspace format was detected. Migration keeps the same Gist, output filenames, published content, and existing subscription links.")}</p>
			</div></div>
			<div class="gh-section-body space-y-4">
				<p class="text-sm">{$t("Workspace")}: <code class="break-all">{pendingMigration.gist.id}</code></p>
				<p class="text-sm text-fg-muted">{$t("Rules: {rules}, publish targets: {targets}, client exports: {exports}", { rules: pendingMigration.snapshot.document.data.aggregates.length, targets: pendingMigration.snapshot.document.data.publishTargets.length, exports: pendingMigration.snapshot.document.data.clientExports.length })}</p>
				{#each [...pendingMigration.snapshot.document.data.publishTargets, ...pendingMigration.snapshot.document.data.clientExports] as output}
					<div class="rounded-md border border-border-muted p-3 text-sm"><p class="font-semibold break-all">{output.fileName}</p>{#if output.lastPublishedUrl}<code class="block break-all text-xs text-fg-muted">{output.lastPublishedUrl}</code>{/if}</div>
				{/each}
				<p class="text-sm text-fg-muted">{$t("The old configuration will be backed up automatically. Existing output files are retained, including files without a saved publish target.")}</p>
			</div>
			<div class="gh-section-footer flex flex-wrap gap-2">
				<button type="button" class="gh-btn gh-btn-primary" on:click={handleLegacyMigration} disabled={workspaceBusy}>{workspaceBusy ? $t("Migrating...") : $t("Migrate and load Workspace")}</button>
				<button type="button" class="gh-btn" on:click={handleRecheckMigration} disabled={workspaceBusy}>{$t("Recheck Workspace")}</button>
				<button type="button" class="gh-btn" on:click={() => { connectionRevision += 1; pendingMigration = null; }} disabled={workspaceBusy || migrationQueued}>{$t("Cancel")}</button>
			</div>
		</section>
	{/if}
	<section id="workspace-repair" class="gh-section">
		<div class="gh-section-header"><div>
			<h2 class="gh-section-title"><Octicon icon={markGithub} className="h-5 w-5" />{$t("GitHub Workspace")}</h2>
			<p class="gh-section-description">{$t("The cloud is the source of truth. Connect a private Gist to create or manage your data.")}</p>
		</div><span class={cn("State State--inline", $workspaceCloudStatus.phase === "ready" ? "State--success" : "State--muted")}>{$workspaceCloudStatus.phase === "ready" ? $t("Connected") : $workspaceCloudStatus.phase === "loading" ? $t("Syncing") : $t("Not connected")}</span></div>
		<div class="gh-section-body space-y-4">
			{#if notice}<p data-testid="workspace-connection-notice" class={cn("text-sm", notice.type === "error" ? "text-danger-fg" : "text-fg-muted")} role={notice.type === "error" ? "alert" : "status"}>{notice.message}</p>{/if}
			{#if $workspaceCloudStatus.phase === "error"}<p class="text-sm text-danger-fg" role="alert">{$t($workspaceCloudStatus.message ?? "Cloud data could not be loaded. Check your connection and retry.")}</p>{/if}
			{#if !$authState.token || !$appState.activeGistId}
				<form class="space-y-3" on:submit|preventDefault={handleTokenSave}>
					<label class="gh-form-label" for="github-token">{$t("Personal access token")}</label>
					<input id="github-token" type="password" class="gh-input w-full font-mono" placeholder="ghp_xxxxxxxxxxxx" bind:value={tokenInput} autocomplete="off" />
					{#if !$appState.activeGistId}
						<label class="gh-form-label" for="workspace-gist-id">{$t("Workspace Gist ID (optional)")}</label>
						<input id="workspace-gist-id" class="gh-input w-full font-mono" bind:value={gistIdInput} aria-describedby="workspace-gist-help" />
						<p id="workspace-gist-help" class="gh-form-caption">{$t("Leave blank to find your cloud data or create an empty private Gist.")}</p>
					{:else}<p class="break-all text-sm">{$t("Workspace")}: <code>{$appState.activeGistId}</code></p>{/if}
					<label class="flex items-start gap-2 text-sm text-fg-muted" for="remember-token"><input id="remember-token" type="checkbox" class="mt-0.5" bind:checked={rememberToken} aria-describedby="remember-token-risk" /><span>{$t("Remember token on this device")}</span></label>
					<p id="remember-token-risk" class="text-xs text-attention-fg">{$t("Persistent storage keeps the token on this device where same-origin JavaScript can read it. Active XSS can steal it; browser-side encryption would not prevent that.")}</p>
					<button type="submit" class="gh-btn gh-btn-primary" disabled={workspaceBusy || pendingMigration !== null || !(tokenInput || $authState.token || "").trim()}><Octicon icon={workspaceBusy ? sync : save} className={cn("h-4 w-4", workspaceBusy && "animate-spin")} />{$t("Connect")}</button>
				</form>
				<a href="https://github.com/settings/tokens/new?description=SubMan&scopes=gist" target="_blank" rel="noreferrer" class="gh-link flex items-center gap-1 text-xs"><Octicon icon={linkExternal} className="h-3 w-3" />{$t("Generate a new token on GitHub")}</a>
			{:else}
				<p class="break-all font-mono text-sm">{$appState.activeGistId}</p>
				<p class="text-sm text-fg-muted">{$t("Every change is synchronized automatically. A save is complete only after cloud confirmation.")}</p>
				{#if $workspaceSyncStatus.phase === "auth-required"}
					<form class="space-y-3" data-testid="auth-recovery" on:submit|preventDefault={handleTokenReplacement}><label class="gh-form-label" for="replacement-github-token">{$t("Replacement personal access token")}</label><input id="replacement-github-token" type="password" class="gh-input w-full font-mono" bind:value={tokenInput} autocomplete="off" /><button type="submit" class="gh-btn gh-btn-primary" disabled={!tokenInput.trim()}>{$t("Replace Token & Resume")}</button></form>
				{/if}
				<label class="flex items-center gap-2 text-sm" for="remember-connected-token"><input id="remember-connected-token" type="checkbox" checked={$authState.persistence === "persistent"} aria-describedby="remember-connected-token-risk" on:change={(event) => { setToken($authState.token, { remember: event.currentTarget.checked }); if (pendingMigration) pendingMigration = { ...pendingMigration, remember: event.currentTarget.checked }; }} /><span>{$t("Remember token on this device")}</span></label>
				<p id="remember-connected-token-risk" class="text-xs text-fg-muted">{$t("Persistent storage keeps the token on this device where same-origin JavaScript can read it. Active XSS can steal it; browser-side encryption would not prevent that.")}</p>
				<div class="flex flex-wrap gap-2">
					<button type="button" class="gh-btn gh-btn-primary" on:click={handleSync} disabled={workspaceBusy || pendingMigration !== null}><Octicon icon={sync} className="h-4 w-4" />{$t("Sync from Cloud")}</button>
					{#if $workspaceSyncStatus.repairRequired || (view?.inspection.activeQueueCount ?? 0) > 0}<button type="button" class="gh-btn" data-testid="repair-sync-action" on:click={handleReloadCloud} disabled={workspaceBusy}><Octicon icon={shieldCheck} className="h-4 w-4" />{$t("Reload from Cloud")}</button>{/if}
					<button type="button" class="gh-btn gh-btn-danger" on:click={handleTokenClear} disabled={workspaceBusy}><Octicon icon={trash} className="h-4 w-4" />{$t("Disconnect")}</button>
				</div>
			{/if}
		</div>
	</section>
	{#if !$appState.activeGistId}
		<section class="gh-section" aria-labelledby="legacy-check-heading" data-testid="legacy-workspace-check">
			<div class="gh-section-header"><div><h2 id="legacy-check-heading" class="gh-section-title"><Octicon icon={database} className="h-5 w-5" />{$t("Manual Workspace migration")}</h2><p class="gh-section-description">{$t("Enter the original cloud Gist ID to preview an upgrade. Checking does not change cloud data.")}</p></div></div>
			<form class="gh-section-body space-y-3" on:submit|preventDefault={handleLegacyWorkspaceCheck}>
				<label class="gh-form-label" for="legacy-workspace-gist">{$t("Old Workspace Gist ID")}</label>
				<div class="flex flex-col gap-2 sm:flex-row"><input id="legacy-workspace-gist" class="gh-input min-w-0 flex-1 font-mono" bind:value={legacyGistIdInput} disabled={workspaceBusy || pendingMigration !== null} /><button type="submit" class="gh-btn" disabled={workspaceBusy || pendingMigration !== null || !legacyGistIdInput.trim() || !($authState.token ?? tokenInput).trim()}>{$t("Check for legacy Workspace")}</button></div>
				{#if legacyCheckResult}<p class={cn("text-sm", legacyCheckResult.type === "error" ? "text-danger-fg" : "text-fg-muted")} role={legacyCheckResult.type === "error" ? "alert" : "status"}>{legacyCheckResult.message}</p>{/if}
			</form>
		</section>
	{/if}
	<details class="gh-section" data-testid="queue-inspector">
		<summary class="gh-section-header cursor-pointer"><span class="gh-section-title"><Octicon icon={database} className="h-5 w-5" />{$t("Sync recovery")}</span></summary>
		<div class="gh-section-body space-y-4">
			<div class="flex flex-wrap gap-3 text-sm"><span>{$t("Active")}: <strong data-testid="active-queue-count">{view?.inspection.activeQueueCount ?? 0}</strong></span><span>{$t("Total")}: <strong data-testid="total-queue-count">{view?.inspection.totalQueueCount ?? 0}</strong></span><span>{$t("Retained previous queues")}: <strong data-testid="orphan-queue-count">{view?.inspection.orphanedWorkspaceCount ?? 0}</strong></span></div>
			{#if queueResult}<p data-testid="queue-action-result" role={queueResult.type === "error" ? "alert" : "status"}>{queueResult.message}</p>{/if}
			<div class="space-y-3" data-testid="queue-workspace-groups">
				{#each view?.inspection.workspaces ?? [] as workspace}
					<article class="space-y-2 rounded-md border border-border-muted p-3" data-testid={workspace.active ? "active-workspace-queue" : "orphan-workspace-queue"}>
						<code class="break-all text-xs">{workspace.workspaceId}</code>
						<p class="text-sm">{$t("{count} queued mutations", { count: workspace.mutations.length })}</p>
						{#if workspace.blocked}<p class="text-xs text-danger-fg" data-testid="blocked-queue-metadata">{workspace.blocked.disposition} / {workspace.blocked.code}</p>{/if}
						{#if workspace.mutations.length || workspace.deadLetters.length}<details class="text-xs"><summary>{$t("Safe queue metadata")}</summary><ul>{#each workspace.mutations as mutation}<li class="break-all font-mono">{mutation.expectedRevision} / {mutation.kind} / {mutation.mutationId} / {mutation.payloadBytes} B</li>{/each}{#each workspace.deadLetters as item}<li class="break-all font-mono">{item.disposition} / {item.code} / {item.mutationId}</li>{/each}</ul></details>{/if}
						<button type="button" class="gh-btn gh-btn-danger gh-btn-sm" on:click={() => handleQueueDiscard(workspace.workspaceId)} disabled={workspaceBusy || (workspace.active && !$authState.token)}>{$t(workspace.active ? "Reload from Cloud" : "Discard Complete Queue")}</button>
					</article>
				{/each}
			</div>
			<div class="flex flex-wrap gap-2"><button type="button" class="gh-btn gh-btn-sm" on:click={refreshView} disabled={workspaceBusy}><Octicon icon={sync} className="h-4 w-4" />{$t("Refresh")}</button><button type="button" class="gh-btn gh-btn-sm" on:click={handleDiagnosticsExport}><Octicon icon={download} className="h-4 w-4" />{$t("Export Diagnostics")}</button></div>
		</div>
	</details>
</div>
