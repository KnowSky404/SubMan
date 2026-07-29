// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const aggregatePageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("aggregate page uses github-style dropdown menus for source selectors", () => {
	expect(aggregatePageSource).toContain("gh-dropdown-menu");
	expect(aggregatePageSource).toContain("gh-dropdown-header");
	expect(aggregatePageSource).toContain("gh-dropdown-body");
	expect(aggregatePageSource).toContain("gh-dropdown-item");
});

test("aggregate page uses section footer actions and grouped buttons", () => {
	expect(aggregatePageSource).toContain("gh-section-footer");
	expect(aggregatePageSource).toContain("gh-btn-group");
	expect(aggregatePageSource).toContain("gh-label");
});

test("aggregate rule count stays inline with the rule definition heading", () => {
	expect(aggregatePageSource).toContain(
		'<div class="flex min-w-0 items-center gap-2">',
	);
	expect(aggregatePageSource).toContain(
		'<span class="gh-counter">{$appState.aggregates.length}</span>\n\t\t\t\t\t</div>',
	);
	expect(aggregatePageSource).toContain(
		'<div class="gh-toolbar-group min-w-0 relative">',
	);
});

test("aggregate rule selector uses a github-style dropdown menu", () => {
	expect(aggregatePageSource).not.toContain(
		'<select class="gh-select gh-select-sm w-48" value={editingRuleId}',
	);
	expect(aggregatePageSource).toContain("let showRuleMenu = false;");
	expect(aggregatePageSource).toContain("currentRulePickerLabel");
	expect(aggregatePageSource).toContain('aria-haspopup="menu"');
	expect(aggregatePageSource).toContain(
		'class="gh-dropdown-menu right-0 top-full w-56"',
	);
	expect(aggregatePageSource).toContain(
		"on:click={() => { resetRuleForm(); showRuleMenu = false; }}",
	);
});

test("aggregate publish action directs local-only users to workspace setup", () => {
	expect(aggregatePageSource).toContain("isWorkspaceConnected");
	expect(aggregatePageSource).toContain("Connect to Publish");
	expect(aggregatePageSource).toContain('href="/auth"');
	expect(aggregatePageSource).toContain("disabled={ordinaryPublishDisabled}");
});

test("aggregate preview generation does not show a success toast", () => {
	expect(aggregatePageSource).not.toContain(
		'showToast($t("Preview generated"), "success")',
	);
	expect(aggregatePageSource).toContain("previewGeneratedAt");
	expect(aggregatePageSource).toContain('{$t("Preview generated {time}"');
});

test("aggregate publishing distinguishes drafts, saved state, and manual push", () => {
	expect(aggregatePageSource).toContain("ruleDirty");
	expect(aggregatePageSource).toContain("targetDirty");
	expect(aggregatePageSource).toContain("Draft Preview");
	expect(aggregatePageSource).toContain("Saved Rule Preview");
	expect(aggregatePageSource).toContain("Save and Publish");
	expect(aggregatePageSource).toContain("Push and Publish");
	expect(aggregatePageSource).toContain("pushSelectedManualConfiguration");
	expect(aggregatePageSource).toContain("reconcileBrowserWorkspace");
	expect(aggregatePageSource).toContain("manualReconcileState");
	expect(aggregatePageSource).toContain("manualStateBeforeTargetAction");
	expect(aggregatePageSource).toContain(
		'action.previousFileCleanup === "delete-if-unreferenced"',
	);
	expect(aggregatePageSource).not.toContain("// Auto-save the rule");
});

test("aggregate failures never roll back only the Svelte store", () => {
	expect(aggregatePageSource).not.toContain("appState.set(localSnapshot)");
	expect(aggregatePageSource).not.toContain("appState.set(");
});

test("aggregate rules migrate legacy tag IDs to stable labels with warnings", () => {
	expect(aggregatePageSource).toContain("resolveLegacyExcludeTags(");
	expect(aggregatePageSource).toContain("excludeTagMigrationWarnings");
	expect(aggregatePageSource).toContain("excludeTagIdsMigrated");
	expect(aggregatePageSource).toContain("parseTagLabels(excludeTags)");
	expect(aggregatePageSource).toContain("handleExcludeTagsInput");
	expect(aggregatePageSource).not.toContain(
		"excludeTagMigrationWarnings = [];\n\t\t\t\t\t\t\t\t\texcludeTagIdsMigrated = false;",
	);
});
