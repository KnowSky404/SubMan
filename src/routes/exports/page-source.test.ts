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

test("exports page exposes profile management actions", () => {
	expect(exportsPageSource).toContain("Profiles");
	expect(exportsPageSource).toContain("removeClientExport");
	expect(exportsPageSource).toContain("requestConfirm");
	expect(exportsPageSource).toContain("deleteProfile");
	expect(exportsPageSource).toContain("editProfile");
	expect(exportsPageSource).toContain("Edit export profile");
	expect(exportsPageSource).toContain("Delete Profile");
	expect(exportsPageSource).toContain("Delete export profile");
	expect(exportsPageSource).not.toContain(
		"$appState.clientExports.length === 0 && !!firstRule",
	);
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

test("exports page keeps rejected Workspace drafts unsaved", () => {
	expect(exportsPageSource).toContain(
		"if (!upsertClientExport(nextProfile).accepted) return;",
	);
});

test("exports page clears stale live link metadata only after output changes", () => {
	expect(exportsPageSource).toContain("hasClientExportOutputChanged");
	expect(exportsPageSource).toContain("const outputChanged");
	expect(exportsPageSource).toContain("outputChanged");
	expect(exportsPageSource).toContain("lastGeneratedAt: null");
	expect(exportsPageSource).toContain("lastPublishedAt: null");
	expect(exportsPageSource).toContain("lastPublishedUrl: null");
});

test("exports page exposes gist live link publishing for remote profiles", () => {
	expect(exportsPageSource).toContain("Publish to Gist");
	expect(exportsPageSource).toContain("Live Link");
	expect(exportsPageSource).toContain("copyPublishedUrl");
	expect(exportsPageSource).toContain("selectedProfile.lastPublishedUrl");
	expect(exportsPageSource).toContain("remote profile URL");
	expect(exportsPageSource).toContain("Connect to Publish");
});

test("exports publication uses the default transactional browser adapter", () => {
	expect(exportsPageSource).toContain("submitBrowserWorkspaceMutation(");
	expect(exportsPageSource).toContain('kind: "client-export.publish"');
	expect(exportsPageSource).not.toContain("WorkspaceMutationQueue");
	expect(exportsPageSource).not.toContain("WorkspaceV2StateStore");
	expect(exportsPageSource).not.toContain("allowManual: true");
});

test("exports page blocks dirty or conflicting profile publication", () => {
	expect(exportsPageSource).toContain("profileDirty");
	expect(exportsPageSource).toContain("selectedOutputConflict");
	expect(exportsPageSource).toContain("findWorkspaceOutputConflicts");
	expect(exportsPageSource).toContain("profile.fileName = `sing-box-client-");
	expect(exportsPageSource).toContain("$" + "{suffix}.json`");
});

test("exports page resets deletion state only after deferred acceptance", () => {
	expect(exportsPageSource).toContain("const result = await handle.completion");
	expect(exportsPageSource).toContain('result.status === "rejected"');
	expect(exportsPageSource).toContain(
		"showDeleteActionFeedback(result.status)",
	);
	expect(exportsPageSource).toContain('status === "queued"');
});

test("exports page localizes legacy exclusion warnings", () => {
	expect(exportsPageSource).toContain("formatPreviewWarning(warning)");
	expect(exportsPageSource).toContain(
		'const prefix = "excluded-tag-needs-review:"',
	);
	expect(exportsPageSource).toContain(
		'$t("Excluded tag value needs review: {tag}"',
	);
});
