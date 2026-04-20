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
