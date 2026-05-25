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
	expect(nodesPageSource).toContain("if (!nodeRaw.trim()) return;");
	expect(nodesPageSource).toContain(
		'name:\n\t\t\t\t\tnodeName.trim() ||\n\t\t\t\t\tinferNodeNameFromRaw(nodeRaw.trim(), "Imported Node")',
	);
	expect(nodesPageSource).not.toContain(
		"if (!nodeName.trim() || !nodeRaw.trim()) return;",
	);
});

test("resource deletion interpolates the target name in confirmation and toast text", () => {
	expect(nodesPageSource).toContain(
		'message: $t("Delete {name} forever?", { name }),',
	);
	expect(nodesPageSource).toContain('showToastNotify($t("Deleted {name}", { name }));');
	expect(nodesPageSource).not.toContain('showToastNotify($t("Deleted {name}"));');
});

test("resource deletion shows per-row loading while the delete action settles", () => {
	expect(nodesPageSource).toContain("let deletingResourceId: string | null = null;");
	expect(nodesPageSource).toContain("deletingResourceId = id;");
	expect(nodesPageSource).toContain("deletingResourceId = null;");
	expect(nodesPageSource).toContain("deletingResourceId === node.id");
	expect(nodesPageSource).toContain("deletingResourceId === sub.id");
	expect(nodesPageSource).toContain("Deleting...");
	expect(nodesPageSource).toContain("animate-spin");
	expect(nodesPageSource).toContain("out:slide");
});
