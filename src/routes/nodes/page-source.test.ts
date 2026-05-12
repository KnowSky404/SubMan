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

test("nodes page uses stable list row primitives", () => {
	expect(nodesPageSource).toContain("gh-row-main");
	expect(nodesPageSource).toContain("gh-row-title");
	expect(nodesPageSource).toContain("gh-row-actions");
	expect(nodesPageSource).toContain("gh-label");
});
