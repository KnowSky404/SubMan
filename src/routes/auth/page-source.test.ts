// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const authPageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
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
	expect(authPageSource).toContain("mergeWorkspaceData({");
	expect(authPageSource).toContain("projectLocalWorkspaceAgainstTombstones(");
	expect(authPageSource).not.toContain("mergeSyncStateFromBaseline(");
	expect(authPageSource).toContain("handleResolveConflict('merge')");
});

test("auth page blocks stale manual push behind a remote-change review", () => {
	expect(authPageSource).toContain("manualPushReview");
	expect(authPageSource).toContain("decideManualPush");
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
		expect(handler.indexOf("requireWorkspaceIdentity(")).toBeGreaterThan(-1);
		expect(
			handler.indexOf("loadWorkspaceSnapshot(token, gistId)"),
		).toBeGreaterThan(handler.indexOf("requireWorkspaceIdentity("));
	}
});

test("auth page uses only initialized transactional Workspace persistence", () => {
	expect(authPageSource).toContain("initializeBrowserWorkspacePersistence({");
	expect(authPageSource).toContain("getBrowserWorkspacePersistence()");
	expect(authPageSource).toContain("getBrowserWorkspaceBinding()");
	expect(authPageSource).not.toContain("WorkspaceV2StateStore");
	expect(authPageSource).not.toContain("WorkspaceMutationQueue");
	expect(authPageSource).not.toContain("workspaceDependencies()");

	const commit = authPageSource.slice(
		authPageSource.indexOf("async function commitBindingSnapshot("),
		authPageSource.indexOf("function setStatus("),
	);
	expect(
		commit.indexOf("await getBrowserWorkspacePersistence().rebindWorkspace"),
	).toBeGreaterThan(-1);
	expect(commit.indexOf("appState.set(snapshot)")).toBeGreaterThan(
		commit.indexOf("await getBrowserWorkspacePersistence()"),
	);
});

test("persisted state conflict restore excludes domain conflicts", () => {
	const restore = authPageSource.slice(
		authPageSource.indexOf("function restorePersistedConflict("),
		authPageSource.indexOf("onMount("),
	);
	expect(restore).toContain('binding?.syncMode === "paused-conflict"');
	expect(restore).toContain(
		'activeQueue?.delivery.blocked?.disposition === "state-conflict"',
	);

	const repair = authPageSource.slice(
		authPageSource.indexOf("async function handleRepairSyncState()"),
		authPageSource.indexOf("async function handleQueueRefresh()"),
	);
	expect(repair).toContain(
		'blockedMetadata?.disposition === "domain-conflict"',
	);
	expect(
		repair.indexOf('blockedMetadata?.disposition === "domain-conflict"'),
	).toBeLessThan(repair.indexOf("conflict = {"));
});

test("queue inspector groups safe persisted metadata and only discards whole queues", () => {
	expect(authPageSource).toContain('data-testid="queue-inspector"');
	expect(authPageSource).toContain('"active-workspace-queue"');
	expect(authPageSource).toContain('"orphan-workspace-queue"');
	expect(authPageSource).toContain('data-testid="blocked-queue-metadata"');
	expect(authPageSource).toContain("workspace.deadLetters");
	expect(authPageSource).toContain("discardInspectedWorkspaceQueue(");
	expect(authPageSource).toContain('$t("Discard Complete Queue")');
	expect(authPageSource).not.toContain(".remove(mutation.mutationId)");
	expect(authPageSource).not.toContain("discardPendingMutations(");
});

test("queue repair and rebind expose result feedback and validate identity", () => {
	expect(authPageSource).toContain("rebindInspectedWorkspace(");
	expect(authPageSource).toContain(
		"{ workspaceId, snapshot: snapshot.state, binding }",
	);
	expect(authPageSource).toContain('data-testid="queue-action-result"');
	expect(authPageSource).toContain('$t("Repair / Reconcile")');
	expect(authPageSource).toContain('$t("Validate & Rebind")');
	expect(authPageSource).toContain(
		'dispatchPersistedWorkspaceState("REPAIR_SUCCEEDED")',
	);
});

test("diagnostics and logout use persisted safe metadata", () => {
	expect(authPageSource).toContain(
		"await exportWorkspaceDiagnosticsFromPersistence(",
	);
	expect(authPageSource).not.toContain("exportWorkspaceDiagnostics($appState)");
	expect(authPageSource).toContain(
		"const queue = getBrowserWorkspaceQueueMetrics();",
	);
	expect(authPageSource).toContain('{ type: "AUTH_LOST", queue }');
});

test("tombstone-aware actions provide a visible preservation notice", () => {
	expect(authPageSource).toContain('data-testid="tombstone-notice"');
	expect(authPageSource).toContain("projected.notices.length > 0");
	expect(authPageSource).toContain("merged.notices.length > 0");
	expect(authPageSource).toContain(
		"Remote tombstones were preserved; deleted items were not restored.",
	);
});
