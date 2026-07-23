// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const authPageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);
const controllerSource = readFileSync(
	new URL("../../lib/workspace-settings-controller.ts", import.meta.url),
	"utf8",
);

test("auth page uses the showToast helper for status notifications", () => {
	expect(authPageSource).toContain(
		'import { showToast } from "$lib/stores/toast";',
	);
	expect(authPageSource).not.toContain("toastStore.show(");
});

test("auth page uses github settings section primitives", () => {
	expect(authPageSource).toContain("gh-section");
	expect(authPageSource).toContain("gh-section-header");
	expect(authPageSource).toContain("gh-section-body");
	expect(authPageSource).toContain("gh-section-footer");
});

test("auth local mode badge keeps intrinsic width on mobile", () => {
	expect(authPageSource).toContain("State--inline");
	expect(authPageSource).toContain('class="State State--muted State--inline"');
});

test("auth page exposes manual workspace push control", () => {
	expect(authPageSource).toContain("async function handleManualPush()");
	expect(authPageSource).toContain("on:click={handleManualPush}");
	expect(authPageSource).toContain('$t("Push Now")');
	expect(authPageSource).toContain('$t("Pushed successfully")');
});

test("auth conflict actions require confirmation before writing state", () => {
	expect(authPageSource).toContain(
		'async function handleResolveConflict(action: "local" | "remote" | "merge")',
	);
	expect(authPageSource).toContain('confirmText: $t("Pull Remote")');
	expect(authPageSource).toContain('confirmText: $t("Push Local")');
	expect(authPageSource).toContain('confirmText: $t("Merge & Save")');
	expect(authPageSource).toContain("workspaceController.resolveConflict({");
	expect(controllerSource).toContain("mergeWorkspaceData({");
	expect(controllerSource).toContain("projectLocalWorkspaceAgainstTombstones(");
	expect(authPageSource).not.toContain("mergeSyncStateFromBaseline(");
	expect(authPageSource).toContain("handleResolveConflict('merge')");
});

test("auth page blocks stale manual push behind a remote-change review", () => {
	expect(authPageSource).toContain("manualPushReview");
	expect(authPageSource).toContain("workspaceController.evaluateManualPush(");
	expect(controllerSource).toContain("function evaluateManualPush(");
	expect(authPageSource).toContain("handleManualForcePush");
	expect(authPageSource).toContain(
		'$t("Remote workspace changed since your last sync. Choose how to continue.")',
	);
	expect(authPageSource).toContain('$t("Force Push")');
	expect(authPageSource).toContain("handleManualPushReview('merge')");
});

test("auth page presents structured Workspace chooser candidates", () => {
	expect(authPageSource).toContain("discoverWorkspaceGist");
	expect(authPageSource).toContain('discovery.status === "chooser"');
	expect(authPageSource).toContain("workspaceCandidates");
	expect(authPageSource).toContain('$t("Choose Workspace")');
	expect(authPageSource).toContain("candidate.gist.updatedAt");
	expect(authPageSource).toContain("candidate.gist.files.map");
	expect(authPageSource).toContain("candidate.currentBinding");
	expect(authPageSource).toContain('$t("Resume")');
});

test("auth token persistence is opt-in and follows a successful connection", () => {
	expect(authPageSource).toContain("let rememberToken = false;");
	expect(authPageSource).toContain('$t("Remember token on this device")');
	expect(authPageSource).toContain('aria-describedby="remember-token-risk"');
	expect(authPageSource).toContain(
		"Active XSS can steal it; browser-side encryption would not prevent that.",
	);
	expect(authPageSource).toContain("setToken(token, { remember });");
	expect(authPageSource).toContain("migratedLegacyToken");

	const connection = authPageSource.indexOf(
		"async function completeWorkspaceConnection",
	);
	const snapshot = authPageSource.indexOf(
		"const snapshot = await readBrowserWorkspaceSnapshot",
		connection,
	);
	const tokenCommit = authPageSource.indexOf(
		"setToken(token, { remember });",
		snapshot,
	);
	expect(snapshot).toBeGreaterThan(connection);
	expect(tokenCommit).toBeGreaterThan(snapshot);
});

test("auth resolution keeps migration and bootstrap failures actionable", () => {
	expect(authPageSource).toContain("migration_backup_conflict");
	expect(authPageSource).toContain("invalid_bootstrap_marker");
	expect(authPageSource).not.toContain(
		'setStatus($t("Resolution failed"), "error")',
	);
	expect(
		authPageSource.match(
			/setStatus\(connectionErrorMessage\(error\), "error"\)/g,
		)?.length ?? 0,
	).toBeGreaterThanOrEqual(2);
});

test("manual sync validates the authoritative Workspace identity before reads", () => {
	for (const [start, end] of [
		["async function handleManualPull()", "async function handleManualPush()"],
		[
			"async function handleManualPush()",
			"async function handleManualPushReview(",
		],
	] as const) {
		const handler = authPageSource.slice(
			authPageSource.indexOf(start),
			authPageSource.indexOf(end),
		);
		expect(
			handler.indexOf("workspaceController.requireIdentity()"),
		).toBeGreaterThan(-1);
		expect(
			handler.indexOf("loadWorkspaceSnapshot(token, gistId)"),
		).toBeGreaterThan(handler.indexOf("workspaceController.requireIdentity()"));
	}
});

test("auth page uses only initialized transactional Workspace persistence", () => {
	expect(authPageSource).toContain("createWorkspaceSettingsController({");
	expect(authPageSource).toContain(".initialize()");
	expect(authPageSource).not.toContain(
		"initializeBrowserWorkspacePersistence({",
	);
	expect(authPageSource).not.toContain("getBrowserWorkspacePersistence()");
	expect(authPageSource).not.toContain("getBrowserWorkspaceBinding()");
	expect(authPageSource).not.toContain("WorkspaceV2StateStore");
	expect(authPageSource).not.toContain("WorkspaceMutationQueue");
	expect(authPageSource).not.toContain("workspaceDependencies()");
	expect(controllerSource).toContain(
		"await persistence().repairWorkspaceQueue({",
	);
	expect(
		controllerSource.indexOf("dependencies.setState(queuedSnapshot)"),
	).toBeGreaterThan(
		controllerSource.indexOf("await persistence().repairWorkspaceQueue({"),
	);
});

test("persisted state conflict restore excludes domain conflicts", () => {
	expect(authPageSource).toContain(
		"workspaceController.persistedConflict(view)",
	);
	expect(controllerSource).toContain(
		'persistedBinding?.syncMode !== "paused-conflict"',
	);
	expect(controllerSource).toContain(
		'activeQueue?.delivery.blocked?.disposition !== "state-conflict"',
	);

	const repair = authPageSource.slice(
		authPageSource.indexOf("async function handleRepairSyncState()"),
		authPageSource.indexOf("async function handleQueueRefresh()"),
	);
	expect(repair).toContain(
		"workspaceController.evaluateRepair(snapshot, gistId)",
	);
	expect(repair.indexOf('decision.status === "domain-blocked"')).toBeLessThan(
		repair.indexOf("workspaceController.pauseForRepair("),
	);
	expect(controllerSource).toContain(
		'workspace?.blocked?.disposition === "domain-conflict"',
	);
});

test("queue inspector groups safe persisted metadata and only discards whole queues", () => {
	expect(authPageSource).toContain('data-testid="queue-inspector"');
	expect(authPageSource).toContain('"active-workspace-queue"');
	expect(authPageSource).toContain('"orphan-workspace-queue"');
	expect(authPageSource).toContain('data-testid="blocked-queue-metadata"');
	expect(authPageSource).toContain("workspace.deadLetters");
	expect(authPageSource).toContain(
		"workspaceController.discardQueue(workspaceId)",
	);
	expect(controllerSource).toContain("discardInspectedWorkspaceQueue(");
	expect(authPageSource).toContain('$t("Discard Complete Queue")');
	expect(authPageSource).not.toContain(".remove(mutation.mutationId)");
	expect(authPageSource).not.toContain("discardPendingMutations(");
});

test("queue repair and rebind expose result feedback and validate identity", () => {
	expect(authPageSource).toContain("workspaceController.rebindOrphan({");
	expect(controllerSource).toContain(
		"rebindInspectedWorkspace(persistence(), {",
	);
	expect(authPageSource).toContain('data-testid="queue-action-result"');
	expect(authPageSource).toContain('$t("Repair / Reconcile")');
	expect(authPageSource).toContain('$t("Validate & Rebind")');
	expect(authPageSource).toContain(
		'workspaceController.dispatchPersistedState("REPAIR_SUCCEEDED")',
	);
});

test("diagnostics and logout use persisted safe metadata", () => {
	expect(authPageSource).toContain(
		"await workspaceController.exportDiagnostics()",
	);
	expect(controllerSource).toContain(
		"return exportWorkspaceDiagnosticsFromPersistence(persistence())",
	);
	expect(authPageSource).not.toContain("exportWorkspaceDiagnostics($appState)");
	expect(authPageSource).toContain("workspaceController.disconnect()");
	expect(controllerSource).toContain('{ type: "AUTH_LOST", queue }');
});

test("tombstone-aware actions provide a visible preservation notice", () => {
	expect(authPageSource).toContain('data-testid="tombstone-notice"');
	expect(authPageSource).toContain("result.notices.length > 0");
	expect(controllerSource).toContain("projected.notices");
	expect(controllerSource).toContain("merged.notices");
	expect(authPageSource).toContain(
		"Remote tombstones were preserved; deleted items were not restored.",
	);
});
