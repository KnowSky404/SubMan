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
