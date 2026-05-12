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
