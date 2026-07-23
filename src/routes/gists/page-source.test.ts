// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const gistsPageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("gists page uses the octicon file asset instead of gist file loop data", () => {
	expect(gistsPageSource).toContain("file as fileIcon");
	expect(gistsPageSource).toContain("<Octicon icon={fileIcon}");
	expect(gistsPageSource).not.toContain("<Octicon icon={file} ");
	expect(gistsPageSource).not.toContain("<Octicon icon={file}>");
});

test("gists page uses github file list action primitives", () => {
	expect(gistsPageSource).toContain("gh-row-main");
	expect(gistsPageSource).toContain("gh-row-actions");
	expect(gistsPageSource).toContain("gh-btn-group");
	expect(gistsPageSource).toContain("gh-label");
});

test("gists refresh keeps success feedback inside the page instead of toast", () => {
	expect(gistsPageSource).not.toContain(
		'setStatus($t("Refreshed"), "success")',
	);
	expect(gistsPageSource).toContain("lastRefreshedAt");
	expect(gistsPageSource).toContain('{$t("Last refreshed {time}"');
});

test("gists page shows an explicit loading state while workspace files load", () => {
	expect(gistsPageSource).toContain("{#if loading && !workspace}");
	expect(gistsPageSource).toContain('{$t("Loading workspace files...")}');
	expect(gistsPageSource).toContain(
		'{loading ? $t("Refreshing...") : $t("Refresh")}',
	);
});

test("gists output deletion is submitted through the Workspace coordinator", () => {
	expect(gistsPageSource).toContain("submitBrowserWorkspaceMutation");
	expect(gistsPageSource).toContain('kind: "output.delete"');
	expect(gistsPageSource).not.toContain("deleteWorkspaceOutputFile");
});

test("gists page protects every reserved Workspace file", () => {
	expect(gistsPageSource).toContain(
		"WORKSPACE_RESERVED_FILE_NAMES.has(filename)",
	);
	expect(gistsPageSource).toContain(
		"!WORKSPACE_RESERVED_FILE_NAMES.has(gistFile.filename)",
	);
	expect(gistsPageSource).toContain("V1 Migration Backup");
	expect(gistsPageSource).toContain("Bootstrap Marker");
	expect(gistsPageSource).toContain("Managed Output");
	expect(gistsPageSource).toContain("External File");
});

test("gists page resumes incomplete setup and coordinates stale marker cleanup", () => {
	expect(gistsPageSource).toContain('bootstrapStatus === "stale"');
	expect(gistsPageSource).toContain('$t("Initialization incomplete")');
	expect(gistsPageSource).toContain("resumeBootstrapInitialization");
	expect(gistsPageSource).toContain("reconcileBrowserWorkspace");
	expect(gistsPageSource).toContain("requireWorkspaceIdentity");
	expect(gistsPageSource).toContain('kind: "workspace.bootstrap.cleanup"');
	expect(gistsPageSource).toContain("requestConfirm({");
	expect(gistsPageSource).toContain("migration_backup_conflict");
	expect(gistsPageSource).toContain("invalid_bootstrap_marker");
});
