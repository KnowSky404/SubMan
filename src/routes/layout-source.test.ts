// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync(
	new URL("./+layout.svelte", import.meta.url),
	"utf8",
);

test("header theme switcher keeps icon and select in separate layout slots", () => {
	expect(layoutSource).toContain('<div class="gh-select-header-shell shrink-0">');
	expect(layoutSource).toContain(
		'<span class="gh-select-header-icon" aria-hidden="true">',
	);
	expect(layoutSource).toContain('class="gh-select gh-select-header"');
	expect(layoutSource).not.toContain("absolute inset-y-0 left-0");
});
