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

test("aggregate publish action directs local-only users to workspace setup", () => {
	expect(aggregatePageSource).toContain("isWorkspaceConnected");
	expect(aggregatePageSource).toContain("Connect to Publish");
	expect(aggregatePageSource).toContain('href="/auth"');
	expect(aggregatePageSource).toContain('disabled={publishing || !isWorkspaceConnected}');
});
