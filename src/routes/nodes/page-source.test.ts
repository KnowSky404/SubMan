// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const nodesPageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("nodes page uses the octicon tag asset instead of tag loop data", () => {
	expect(nodesPageSource).toContain("tag as tagIcon");
	expect(nodesPageSource).toContain("<Octicon icon={tagIcon}");
	expect(nodesPageSource).not.toContain("<Octicon icon={tag} ");
	expect(nodesPageSource).not.toContain("<Octicon icon={tag}>");
});

test("nodes page uses a unified github-style filter bar", () => {
	expect(nodesPageSource).toContain('class="gh-filter-bar"');
	expect(nodesPageSource).toContain('class="gh-filter-controls"');
	expect(nodesPageSource).toContain('class="gh-counter"');
	expect(nodesPageSource).toContain("gh-btn-group");
});

test("nodes filter bar separates search, status, and primary action controls", () => {
	expect(nodesPageSource).toContain("nodes-filter-tabs");
	expect(nodesPageSource).toContain("nodes-filter-search");
	expect(nodesPageSource).toContain("nodes-filter-status");
	expect(nodesPageSource).toContain("nodes-filter-action");
});

test("nodes page uses stable list row primitives", () => {
	expect(nodesPageSource).toContain("gh-row-main");
	expect(nodesPageSource).toContain("gh-row-title");
	expect(nodesPageSource).toContain("gh-row-actions");
	expect(nodesPageSource).toContain("gh-label");
});

test("single node add can derive the name from the raw URI", () => {
	expect(nodesPageSource).toContain("const raw = nodeRaw.trim();");
	expect(nodesPageSource).toContain("if (!raw) return;");
	expect(nodesPageSource).toContain(
		'nodeName.trim() || inferNodeNameFromRaw(raw, "Imported Node")',
	);
	expect(nodesPageSource).not.toContain(
		"if (!nodeName.trim() || !nodeRaw.trim()) return;",
	);
});

test("nodes page prevents duplicate raw URIs and subscription URLs", () => {
	expect(nodesPageSource).toContain(
		"findDuplicateNodeRaw($appState.nodes, raw)",
	);
	expect(nodesPageSource).toContain(
		"findDuplicateSubscriptionUrl(\n\t\t\t\t$appState.subscriptions,",
	);
	expect(nodesPageSource).toContain(
		'$t("A node with the same raw URI already exists: {name}"',
	);
	expect(nodesPageSource).toContain(
		'$t("A subscription with the same URL already exists: {name}"',
	);
});

test("nodes page makes saved resource names unique", () => {
	expect(nodesPageSource).toContain("function uniqueNodeName");
	expect(nodesPageSource).toContain("function uniqueSubscriptionName");
	expect(nodesPageSource).toContain("makeUniqueResourceName(");
	expect(nodesPageSource).toContain("formatResourceNameTimestamp()");
});

test("resource deletion interpolates the target name in confirmation and toast text", () => {
	expect(nodesPageSource).toContain(
		'message: $t("Delete {name} forever?", { name }),',
	);
	expect(nodesPageSource).toContain(
		'showToastNotify($t("Deleted {name}", { name }));',
	);
	expect(nodesPageSource).not.toContain(
		'showToastNotify($t("Deleted {name}"));',
	);
});

test("resource deletion shows per-row loading while the delete action settles", () => {
	expect(nodesPageSource).toContain(
		"let deletingResourceId: string | null = null;",
	);
	expect(nodesPageSource).toContain("deletingResourceId = id;");
	expect(nodesPageSource).toContain("deletingResourceId = null;");
	expect(nodesPageSource).toContain("deletingResourceId === node.id");
	expect(nodesPageSource).toContain("deletingResourceId === sub.id");
	expect(nodesPageSource).toContain("Deleting...");
	expect(nodesPageSource).toContain("animate-spin");
	expect(nodesPageSource).toContain("out:slide");
});

test("resource editing opens a modal instead of expanding inline editors", () => {
	expect(nodesPageSource).toContain("let editingResource");
	expect(nodesPageSource).toContain("closeEditModal");
	expect(nodesPageSource).toContain("Edit Node");
	expect(nodesPageSource).toContain("Edit Subscription");
	expect(nodesPageSource).toContain("Close edit modal");
	expect(nodesPageSource).toContain("fixed inset-0 z-[150]");
	expect(nodesPageSource).not.toContain("Inline Editor for Node");
	expect(nodesPageSource).not.toContain("Inline Editor for Subscription");
	expect(nodesPageSource).not.toContain("expandedId");
});

test("resource editing preserves tag IDs for unchanged labels", () => {
	expect(nodesPageSource).toContain(
		"tags: reconcileTags(draft.tags, original.tags)",
	);
	expect(nodesPageSource).not.toContain("function parseTags(");
});
