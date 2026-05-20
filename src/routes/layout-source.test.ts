// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync(
	new URL("./+layout.svelte", import.meta.url),
	"utf8",
);

test("compact repository header owns global controls", () => {
	expect(layoutSource).not.toContain(
		'<header class="app-header sticky top-0 z-[100]">',
	);
	expect(layoutSource).not.toContain('<div class="app-repo-topbar">');
	expect(layoutSource).not.toContain('<div class="app-site-title">');
	expect(layoutSource).toContain('<div class="app-repo-masthead">');
	expect(layoutSource).toContain('<div class="app-repo-meta">');
	expect(layoutSource).toContain('<div class="app-repo-tabs">');
	expect(layoutSource).toContain('<div class="app-repo-title-line">');
	expect(layoutSource).toContain('<div class="app-repo-status-line">');
	expect(layoutSource).toContain('<div class="app-repo-actions">');
	expect(layoutSource).toContain(
		'<div class="gh-select-header-shell shrink-0">',
	);
	expect(layoutSource).toContain(
		'<span class="gh-select-header-icon" aria-hidden="true">',
	);
	expect(layoutSource).toContain("GitHubSelect");
	expect(layoutSource).toContain('buttonClass="gh-select gh-select-header"');
	expect(layoutSource).toContain('menuClass="right-0 top-full w-36"');
	expect(layoutSource).not.toContain("absolute inset-y-0 left-0");
});

test("repo header renders identity and stats in one compact row", () => {
	expect(layoutSource).toContain('<div class="app-repo-main">');
	expect(layoutSource).toContain('<div class="app-repo-actions">');
	expect(layoutSource).not.toContain('<div class="app-repo-side-meta">');
	expect(layoutSource).not.toContain("app-repo-tools app-repo-tools-stack");
	expect(layoutSource).not.toContain('<div class="gh-page-meta">');
	expect(layoutSource).not.toContain('{$t("nodes")}');
	expect(layoutSource).not.toContain('{$t("rules")}');
	expect(layoutSource).not.toContain('{$t("live links")}');

	const actionsIndex = layoutSource.indexOf('<div class="app-repo-actions">');
	const siteTitleIndex = layoutSource.indexOf('<div class="app-site-title">');

	expect(actionsIndex).toBeGreaterThan(siteTitleIndex);
});

test("repository tabs are in a full-width band outside the centered content body", () => {
	const mastheadIndex = layoutSource.indexOf('<div class="app-repo-masthead">');
	const tabsIndex = layoutSource.indexOf('<div class="app-repo-tabs">');
	const tabsTrackIndex = layoutSource.indexOf(
		'<div class="app-repo-tabs-track">',
	);
	const navIndex = layoutSource.indexOf('<nav class="gh-underlinenav"');
	const mainIndex = layoutSource.indexOf('<main class="app-main-container">');

	expect(mastheadIndex).toBeGreaterThan(-1);
	expect(tabsIndex).toBeGreaterThan(mastheadIndex);
	expect(tabsTrackIndex).toBeGreaterThan(tabsIndex);
	expect(navIndex).toBeGreaterThan(tabsTrackIndex);
	expect(mainIndex).toBeGreaterThan(navIndex);
	expect(layoutSource).not.toContain(
		'<div class="app-repo-tabs">\n\t\t\t<div class="app-repo-inner">',
	);
});

test("primary navigation reads pathname directly from SvelteKit app state", () => {
	expect(layoutSource).toContain('import { page } from "$app/state";');
	expect(layoutSource).not.toContain('import { page } from "$app/stores";');
	expect(layoutSource).not.toContain("$: pathname =");
	expect(layoutSource).toContain(
		'class={cn("gh-underlinenav-item", isActive(page.url.pathname, item.href) && "gh-underlinenav-item-active")}',
	);
	expect(layoutSource).toContain(
		'aria-current={isActive(page.url.pathname, item.href) ? "page" : undefined}',
	);
});

test("layout uses github action primitives in repository header", () => {
	expect(layoutSource).toContain("app-repo-actions");
	expect(layoutSource).toContain("app-repo-action-button");
	expect(layoutSource).toContain("app-header-link");
});

test("repository identity and global actions share the same masthead row", () => {
	const mastheadIndex = layoutSource.indexOf('<div class="app-repo-masthead">');
	const metaIndex = layoutSource.indexOf('<div class="app-repo-meta">');
	const titleIndex = layoutSource.indexOf('<div class="app-repo-title-line">');
	const actionsIndex = layoutSource.indexOf('<div class="app-repo-actions">');
	const tabsIndex = layoutSource.indexOf('<div class="app-repo-tabs">');

	expect(mastheadIndex).toBeGreaterThan(-1);
	expect(metaIndex).toBeGreaterThan(mastheadIndex);
	expect(titleIndex).toBeGreaterThan(metaIndex);
	expect(actionsIndex).toBeGreaterThan(titleIndex);
	expect(tabsIndex).toBeGreaterThan(actionsIndex);
});

test("primary navigation includes exports between aggregate and gists", () => {
	const aggregateIndex = layoutSource.indexOf(
		'{ href: "/aggregate", label: "Aggregate"',
	);
	const exportsIndex = layoutSource.indexOf(
		'{ href: "/exports", label: "Exports"',
	);
	const gistsIndex = layoutSource.indexOf('{ href: "/gists", label: "Gists"');

	expect(aggregateIndex).toBeGreaterThan(-1);
	expect(exportsIndex).toBeGreaterThan(aggregateIndex);
	expect(gistsIndex).toBeGreaterThan(exportsIndex);
});
