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

test("aggregate publish action requires the cloud Workspace connection", () => {
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

test("aggregate publishing saves drafts to the cloud before publication", () => {
	expect(aggregatePageSource).toContain("ruleDirty");
	expect(aggregatePageSource).toContain("targetDirty");
	expect(aggregatePageSource).toContain("Draft Preview");
	expect(aggregatePageSource).toContain("Saved Rule Preview");
	expect(aggregatePageSource).toContain("Save and Publish");
	expect(aggregatePageSource).not.toContain("Push and Publish");
	expect(aggregatePageSource).not.toContain("pushSelectedManualConfiguration");
	expect(aggregatePageSource).not.toContain("reconcileBrowserWorkspace");
	expect(aggregatePageSource).not.toContain("workspaceIsManual");
	expect(aggregatePageSource).not.toContain("allowManual");
	expect(aggregatePageSource).not.toContain("localDurableMessageKey");
	expect(aggregatePageSource).not.toContain("Local-only");
	expect(aggregatePageSource).toContain("await ruleAction.handle.completion");
	expect(aggregatePageSource).toContain("await targetAction.handle.completion");
	expect(aggregatePageSource).toContain("if (!presentation.remoteCommitted)");
	expect(aggregatePageSource).not.toContain("// Auto-save the rule");
});

test("aggregate live link is gated on proven remote commitment", () => {
	expect(aggregatePageSource).toContain("getCommittedPublishTargetUrl");
	expect(aggregatePageSource).toContain("baseline?.data.publishTargets.find");
	expect(aggregatePageSource).toContain('result.status !== "remote-committed"');
	expect(aggregatePageSource).toContain("!presentation.remoteCommitted");
	expect(aggregatePageSource).toContain("result.state.publishTargets.find");
	expect(aggregatePageSource).not.toContain(
		"$appState.publishTargets.find((target) => target.id === selectedTargetId)\n\t\t\t\t?.lastPublishedUrl",
	);
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

test("aggregate preview exposes safe subscription diagnostics", () => {
	expect(aggregatePageSource).toContain("previewSubscriptionIssues");
	expect(aggregatePageSource).toContain("result.subscriptionIssues");
	expect(aggregatePageSource).toContain("presentSubscriptionFetchDiagnostic");
	expect(aggregatePageSource).toContain(
		"previewEntries.length > 0 || previewSubscriptionIssues.length > 0",
	);
	expect(aggregatePageSource).toContain(
		"Published with {count} subscription source issues.",
	);
});
