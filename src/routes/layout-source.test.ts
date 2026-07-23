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
	expect(layoutSource).toContain(
		'<img src="/brand/subman-logo.png" alt="" class="app-brand-mark"',
	);
	expect(layoutSource).toContain('<div class="app-repo-status-line">');
	expect(layoutSource).toContain('<div class="app-repo-actions">');
	expect(layoutSource).toContain('<div class="theme-menu relative shrink-0">');
	expect(layoutSource).toContain(
		'<button type="button" class="theme-menu-button"',
	);
	expect(layoutSource).toContain(
		'<div class="gh-dropdown-menu theme-menu-dropdown right-0 top-full w-40"',
	);
	expect(layoutSource).toContain(
		"{#each themeOptions as option (option.value)}",
	);
	expect(layoutSource).not.toContain("GitHubSelect");
	expect(layoutSource).not.toContain("gh-select-header-shell");
	expect(layoutSource).not.toContain(
		'buttonClass="gh-select gh-select-header"',
	);
	expect(layoutSource).not.toContain("absolute inset-y-0 left-0");
});

test("layout declares the SubMan favicon family", () => {
	expect(layoutSource).toContain("<title>SubMan</title>");
	expect(layoutSource).toContain(
		'<link rel="icon" href="/favicon.ico" sizes="any" />',
	);
	expect(layoutSource).toContain(
		'<link rel="icon" type="image/png" href="/favicon-32.png" sizes="32x32" />',
	);
	expect(layoutSource).toContain(
		'<link rel="icon" type="image/png" href="/favicon-192.png" sizes="192x192" />',
	);
	expect(layoutSource).toContain(
		'<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />',
	);
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
	expect(layoutSource).toContain("gh-btn gh-btn-sm");
	expect(layoutSource).not.toContain("app-repo-action-button");
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

test("browser persistence initializes before sync with synchronous cleanup", () => {
	const initializeIndex = layoutSource.indexOf(
		"initializeAppStatePersistence()",
	);
	const startIndex = layoutSource.indexOf(
		"startWorkspaceMutationSync",
		initializeIndex,
	);
	const cleanupIndex = layoutSource.indexOf("return () => {", initializeIndex);

	expect(initializeIndex).toBeGreaterThan(-1);
	expect(startIndex).toBeGreaterThan(initializeIndex);
	expect(cleanupIndex).toBeGreaterThan(startIndex);
	expect(layoutSource).toContain("void initializeAppStatePersistence()");
	expect(layoutSource).toContain("if (!cancelled)");
	expect(layoutSource).not.toContain("onMount(async");
});
