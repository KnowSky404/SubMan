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
	expect(authPageSource).toContain(
		"mergeSyncState($appState, currentConflict.remoteState)",
	);
	expect(authPageSource).toContain("handleResolveConflict('merge')");
});
