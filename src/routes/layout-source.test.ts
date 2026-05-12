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

test("repo header renders stats in a dedicated right rail", () => {
	expect(layoutSource).toContain('<div class="app-repo-main">');
	expect(layoutSource).toContain('<div class="app-repo-side">');
	expect(layoutSource).toContain('<div class="app-repo-side-meta">');
	expect(layoutSource).toContain("app-repo-tools app-repo-tools-stack");

	const rightRailIndex = layoutSource.indexOf('<div class="app-repo-side">');
	const statsIndex = layoutSource.indexOf('<div class="gh-page-meta">');
	const titleIndex = layoutSource.indexOf('<div class="app-repo-title">');

	expect(rightRailIndex).toBeGreaterThan(titleIndex);
	expect(statsIndex).toBeGreaterThan(rightRailIndex);
});

test("primary navigation reads pathname directly from SvelteKit app state", () => {
	expect(layoutSource).toContain('import { page } from "$app/state";');
	expect(layoutSource).not.toContain("import { page } from \"$app/stores\";");
	expect(layoutSource).not.toContain("$: pathname =");
	expect(layoutSource).toContain('class={cn("gh-underlinenav-item", isActive(page.url.pathname, item.href) && "gh-underlinenav-item-active")}');
	expect(layoutSource).toContain('aria-current={isActive(page.url.pathname, item.href) ? "page" : undefined}');
});

test("layout uses github action primitives in repository header", () => {
	expect(layoutSource).toContain("gh-toolbar-group");
	expect(layoutSource).toContain("gh-counter");
	expect(layoutSource).toContain("gh-btn");
});
