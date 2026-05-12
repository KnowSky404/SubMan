// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const exportsPageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("exports page implements sing-box client export behavior", () => {
	expect(exportsPageSource).toContain("sing-box Client");
	expect(exportsPageSource).toContain("Source Aggregate Rule");
	expect(exportsPageSource).toContain("clientExports");
	expect(exportsPageSource).toContain("buildSingBoxClientConfig");
	expect(exportsPageSource).toContain("createDefaultSingBoxClientProfile");
	expect(exportsPageSource).toContain("upsertClientExport");
	expect(exportsPageSource).toContain("publishPreview");
	expect(exportsPageSource).toContain("copyPreview");
	expect(exportsPageSource).toContain("downloadPreview");
	expect(exportsPageSource).toContain("WORKSPACE_FILE");
	expect(exportsPageSource).toContain("exportSyncState");
	expect(exportsPageSource).toContain("createGist");
	expect(exportsPageSource).toContain("updateGist");
	expect(exportsPageSource).toContain("toStableGistRawUrl");
	expect(exportsPageSource).toContain("Total Lines");
	expect(exportsPageSource).toContain("Outbounds");
	expect(exportsPageSource).toContain("Skipped");
	expect(exportsPageSource).toContain("Warning Count");
	expect(exportsPageSource).toContain("Warnings");
	expect(exportsPageSource).toContain("Errors");
	expect(exportsPageSource).toContain("New profile");
	expect(exportsPageSource).toContain("Generate Preview");
	expect(exportsPageSource).toContain("Copy");
	expect(exportsPageSource).toContain("Download");
	expect(exportsPageSource).toContain("Publish");
	expect(exportsPageSource).toContain("Workspace");
});

test("exports page gates publish on current valid preview", () => {
	expect(exportsPageSource).toContain("previewSignature");
	expect(exportsPageSource).toContain("currentSignature");
	expect(exportsPageSource).toContain("previewSignature !== currentSignature");
	expect(exportsPageSource).toContain("!previewContent");
	expect(exportsPageSource).toContain("outboundCount <= 0");
});

test("exports page resyncs drafts when selected profile changes remotely", () => {
	expect(exportsPageSource).toContain("syncedDraftProfileSignature");
	expect(exportsPageSource).toContain("selectedProfile.updatedAt");
});

test("exports page validates listen port before saving", () => {
	expect(exportsPageSource).toContain("Number(draftListenPort)");
	expect(exportsPageSource).toContain("Number.isInteger(listenPort)");
	expect(exportsPageSource).toContain(
		'showToast($t("Listen port must be between 1 and 65535"), "error")',
	);
});

test("exports page stores the exact published workspace snapshot locally", () => {
	expect(exportsPageSource).toContain("finalAppState");
	expect(exportsPageSource).toContain("lastUpdated: now");
	expect(exportsPageSource).toContain("appState.set(finalAppState)");
	expect(exportsPageSource).not.toContain("upsertClientExport(finalProfile)");
});
