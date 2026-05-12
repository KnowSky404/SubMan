// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const exportsPageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("exports page renders sing-box client source and action shell", () => {
	expect(exportsPageSource).toContain("sing-box Client");
	expect(exportsPageSource).toContain("Source Aggregate Rule");
	expect(exportsPageSource).toContain("buildSingBoxClientConfig");
	expect(exportsPageSource).toContain("clientExports");
	expect(exportsPageSource).toContain("Copy");
	expect(exportsPageSource).toContain("Download");
	expect(exportsPageSource).toContain("Publish");
	expect(exportsPageSource).toContain("Workspace");
});
