import { expect, test } from "@playwright/test";
import { defaultUiData, seedUiWorkspace } from "./ui-workspace-fixture";

test("header tooltips support hover, focus, Escape, and viewport edges", async ({
	page,
	context,
}) => {
	await seedUiWorkspace(page, context);
	await page.goto("/nodes");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	const github = page.getByRole("link", { name: "Open project on GitHub" });
	await github.hover();
	const tip = page.getByRole("tooltip");
	await expect(tip).toHaveText("Open project on GitHub");
	const bounds = await tip.boundingBox();
	if (!bounds) throw new Error("Tooltip did not render");
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(
		(await page.evaluate(() => innerWidth)) - 7,
	);
	await page.keyboard.press("Escape");
	await expect(tip).toHaveCount(0);
	await github.focus();
	await expect(tip).toBeVisible();
	await expect(github).toHaveAttribute(
		"aria-describedby",
		(await tip.getAttribute("id")) as string,
	);
	await expect(github).not.toHaveAttribute("title");
	await page.keyboard.press("Tab");
	await page.mouse.move(0, 0);
	await expect(tip).toHaveCount(0);
});

test("theme menu supports keyboard selection and preserves primary emphasis in dark mode", async ({
	page,
	context,
}) => {
	await seedUiWorkspace(page, context);
	await page.goto("/");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	const trigger = page.locator(".theme-menu-button");
	await trigger.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("menuitemradio", { name: "Auto" })).toBeFocused();
	await page.keyboard.press("End");
	await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect(trigger).toBeFocused();
	await expect(page.getByRole("menu", { name: "Theme" })).toHaveCount(0);
	await expect(page.locator("main .gh-btn-primary").first()).toHaveCSS(
		"background-color",
		"rgb(35, 134, 54)",
	);
	await trigger.click();
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("node search distinguishes no matches and clears the complete filter", async ({
	page,
	context,
}) => {
	await seedUiWorkspace(page, context);
	await page.goto("/nodes");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "New Resource", exact: true }),
	).toHaveCount(1);
	const search = page.getByRole("textbox", {
		name: "Filter resources",
		exact: true,
	});
	await search.fill("missing-resource");
	await expect(
		page.getByRole("heading", { name: "No matching resources" }),
	).toBeVisible();
	await expect(page.getByRole("heading", { name: "No nodes yet" })).toHaveCount(
		0,
	);
	await page.locator("#resource-filter-status").click();
	await page
		.getByRole("menu")
		.getByRole("button", { name: "Disabled", exact: true })
		.click();
	await page.getByRole("button", { name: "Clear filters" }).click();
	await expect(search).toHaveValue("");
	await expect(page.locator("#resource-filter-status")).toContainText("All");
	await expect(
		page.getByRole("button", { name: "Accessibility Node", exact: true }),
	).toBeVisible();
	await expect(search).toHaveCSS("padding-left", "36px");
});

test("mobile navigation reveals settings and keeps the selected page visible", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await seedUiWorkspace(page, context);
	await page.goto("/");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	for (let attempt = 0; attempt < 4; attempt++) {
		const more = page.getByRole("button", {
			name: "More navigation items",
			exact: true,
		});
		if (!(await more.count())) break;
		const previous = await page
			.locator("nav")
			.evaluate((node) => node.scrollLeft);
		await more.click();
		await expect
			.poll(() => page.locator("nav").evaluate((node) => node.scrollLeft))
			.toBeGreaterThan(previous);
	}
	const settings = page
		.getByRole("navigation", { name: "Primary" })
		.getByRole("link", { name: "Settings" });
	await expect(settings).toBeInViewport({ ratio: 1 });
	await settings.click();
	await expect(page).toHaveURL(/\/auth$/);
	await expect(settings).toHaveAttribute("aria-current", "page");
	await expect(settings).toBeInViewport({ ratio: 1 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
		390,
	);
});

test("overview changes from onboarding to recent resources and confirmed output metadata", async ({
	page,
	context,
}) => {
	const data = structuredClone(defaultUiData);
	data.aggregates.push({
		id: "ui-rule",
		name: "UI rule",
		nodeIds: [data.nodes[0].id],
		subscriptionIds: [],
		excludeTagIds: [],
		renameMap: {},
		allowedTypes: [],
		updatedAt: "2026-10-23T10:00:00.000Z",
	});
	data.publishTargets.push({
		id: "ui-target",
		name: "Published target",
		ruleId: "ui-rule",
		fileName: "nodes.txt",
		description: "",
		isPublic: false,
		lastPublishedAt: "2026-10-23T10:00:00.000Z",
		lastPublishedUrl:
			"https://gist.githubusercontent.com/e2e/accessibility-cloud/raw/nodes.txt",
		lastPublishTransitionAt: null,
		lastPublishTransitionFromFileName: null,
		lastPublishTransitionToFileName: null,
		lastPublishTransitionOutcome: null,
		updatedAt: "2026-10-23T10:00:00.000Z",
	});
	await seedUiWorkspace(page, context, data);
	await page.goto("/");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Recently updated" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Collect sources" }),
	).toHaveCount(0);
	const publications = page.getByRole("region", {
		name: "Publication targets",
	});
	await expect(
		publications.getByRole("link", { name: /Published target/ }),
	).toContainText("Last published");
	await expect(publications.getByText("nodes.txt")).toBeVisible();
});

test("empty workspace retains onboarding and advanced controls keep drafts", async ({
	page,
	context,
}) => {
	await seedUiWorkspace(page, context, {
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
	});
	await page.goto("/");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Collect sources" }),
	).toBeVisible();
	await page.goto("/aggregate");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	const advanced = page.locator("details.gh-advanced-options");
	await expect(advanced).not.toHaveAttribute("open");
	await advanced.locator("summary").click();
	await page
		.getByRole("textbox", { name: "Rename Rules", exact: true })
		.fill("Old = New");
	await advanced.locator("summary").click();
	await advanced.locator("summary").click();
	await expect(
		page.getByRole("textbox", { name: "Rename Rules", exact: true }),
	).toHaveValue("Old = New");
	await expect(
		page.getByText("Save a publish target before publishing.", { exact: true }),
	).toBeVisible();
});

test("Gist filenames expose real raw links and accessible icon labels", async ({
	page,
	context,
}) => {
	await seedUiWorkspace(page, context);
	await page.goto("/gists");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "subman.json · Open Raw" }),
	).toHaveAttribute(
		"href",
		"https://gist.githubusercontent.com/e2e/accessibility-cloud/raw/subman.json",
	);
	const copy = page.getByRole("button", { name: "Copy Raw URL", exact: true });
	await copy.focus();
	await expect(page.getByRole("tooltip")).toHaveText("Copy Raw URL");
});

test("loading a saved rule exposes its existing advanced configuration", async ({
	page,
	context,
}) => {
	const data = structuredClone(defaultUiData);
	data.aggregates.push({
		id: "advanced-rule",
		name: "Configured rule",
		nodeIds: [data.nodes[0].id],
		subscriptionIds: [],
		excludeTagIds: [],
		renameMap: {},
		renameRules: ["Old = New"],
		allowedTypes: ["vless"],
		updatedAt: "2026-10-23T10:00:00.000Z",
	});
	await seedUiWorkspace(page, context, data);
	await page.goto("/aggregate");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	await page.getByRole("button", { name: "New Rule", exact: true }).click();
	await page
		.getByRole("button", { name: "Configured rule", exact: true })
		.click();
	await expect(page.locator("details.gh-advanced-options")).toHaveAttribute(
		"open",
	);
	await expect(
		page.getByRole("textbox", { name: "Rename Rules", exact: true }),
	).toHaveValue("Old = New");
	await expect(
		page.getByRole("button", { name: "VLESS", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
});
