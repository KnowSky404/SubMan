// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync(
	new URL("./+layout.svelte", import.meta.url),
	"utf8",
);

test("header theme switcher keeps shared select chrome and fixed flex width", () => {
	expect(layoutSource).toContain('<div class="relative shrink-0">');
	expect(layoutSource).toContain('class="gh-select gh-select-header w-28 pl-8"');
});
