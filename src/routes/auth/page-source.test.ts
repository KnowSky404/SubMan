// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const authPageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("auth page keeps shared notification and settings primitives", () => {
	expect(authPageSource).toContain(
		'import { showToast } from "$lib/stores/toast";',
	);
	for (const primitive of [
		"gh-section",
		"gh-section-header",
		"gh-section-body",
		"gh-section-footer",
		"State--inline",
	])
		expect(authPageSource).toContain(primitive);
});

test("settings exposes cloud synchronization without local configuration writers", () => {
	for (const removed of [
		"replaceState",
		"importState",
		"exportState",
		"exportSyncState",
		"handleManualPush",
		"handleBindOnly",
		"workspaceCandidates",
		"handleQueueRebind",
		"workspace.reconcile",
	])
		expect(authPageSource).not.toContain(removed);
	expect(authPageSource).toContain('"Sync from Cloud"');
	expect(authPageSource).toContain('"Reload from Cloud"');
	expect(authPageSource).toContain("workspaceController.connect({");
});

test("token persistence remains opt-in with explicit browser storage disclosure", () => {
	expect(authPageSource).toContain("let rememberToken = false;");
	expect(authPageSource).toContain('aria-describedby="remember-token-risk"');
	expect(authPageSource).toContain(
		"Active XSS can steal it; browser-side encryption would not prevent that.",
	);
	expect(authPageSource).toContain("setToken(token, { remember });");
	expect(authPageSource).toContain(
		"pendingMigration = { ...pendingMigration, remember: event.currentTarget.checked }",
	);
});

test("auth recovery replaces credentials without changing Workspace identity", () => {
	expect(authPageSource).toContain('data-testid="auth-recovery"');
	expect(authPageSource).toContain(
		'setToken(token, { remember: $authState.persistence === "persistent" });',
	);
	expect(authPageSource).toContain('"Replace Token & Resume"');
	expect(authPageSource).toContain("workspaceController.disconnect()");
});

test("cloud reload requires confirmation and complete queue discard", () => {
	const handler = authPageSource.slice(
		authPageSource.indexOf("async function handleReloadCloud()"),
		authPageSource.indexOf("async function handleQueueDiscard("),
	);
	expect(handler.indexOf("await requestConfirm(")).toBeGreaterThan(-1);
	expect(handler.indexOf("workspaceController.discardQueue(")).toBeGreaterThan(
		handler.indexOf("if (!confirmed) return"),
	);
	expect(handler.indexOf("await refreshCloudWorkspace(")).toBeGreaterThan(
		handler.indexOf("workspaceController.discardQueue("),
	);
});

test("repair tooling retains safe diagnostics and complete historical queues", () => {
	expect(authPageSource).toContain('data-testid="queue-inspector"');
	expect(authPageSource).toContain('"active-workspace-queue"');
	expect(authPageSource).toContain('"orphan-workspace-queue"');
	expect(authPageSource).toContain("workspace.deadLetters");
	expect(authPageSource).toContain(
		"await workspaceController.exportDiagnostics()",
	);
	expect(authPageSource).not.toContain(".remove(mutation.mutationId)");
});
