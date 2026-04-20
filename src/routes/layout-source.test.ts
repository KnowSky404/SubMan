// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync(
	new URL("./+layout.svelte", import.meta.url),
	"utf8",
);

test("header theme switcher keeps shared select chrome and fixed flex width", () => {
	expect(layoutSource).toContain('<div class="relative shrink-0">');
	expect(layoutSource).toContain(
		'class="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-[color:var(--header-muted)]"',
	);
	expect(layoutSource).toContain('class="gh-select gh-select-header w-32 pl-10"');
});
