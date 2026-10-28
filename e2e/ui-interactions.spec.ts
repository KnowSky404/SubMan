import { expect, test } from "@playwright/test";
import { defaultUiData, seedUiWorkspace } from "./ui-workspace-fixture";

const mutationRoute = "**/api/workspaces/**/mutations";

test.beforeEach(async ({ page, context }) => {
	await seedUiWorkspace(page, context);
	await page.goto("/nodes");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
});

test("copy feedback acknowledges only a successful clipboard write", async ({
	page,
}) => {
	await page.evaluate(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async () => {} },
		});
	});
	const button = page.getByRole("button", { name: "Copy URI", exact: true });
	await button.click();
	await expect(button).toHaveAttribute("data-feedback", "copied");
	await expect(
		page.getByRole("status").filter({ hasText: "Copied to clipboard" }),
	).toBeVisible();
	await expect(button).toHaveAttribute("data-feedback", "idle");
	await page.evaluate(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async () => {
					throw new Error("Fixture denied");
				},
			},
		});
	});
	await button.click();
	await expect(
		page.getByRole("status").filter({ hasText: "Copy failed" }),
	).toBeVisible();
	await expect(button).toHaveAttribute("data-feedback", "idle");
});

test("edit stays open and busy until the original cloud mutation is confirmed", async ({
	page,
	context,
}) => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let requests = 0;
	await context.route(mutationRoute, async (route) => {
		requests++;
		const mutation = route.request().postDataJSON();
		await gate;
		const data = structuredClone(defaultUiData);
		data.nodes = [mutation.payload.node];
		await route.fulfill({
			json: {
				status: "committed",
				mutationId: mutation.mutationId,
				workspaceId: mutation.workspaceId,
				committedRevision: mutation.expectedRevision + 1,
				committedAt: mutation.createdAt,
				receipt: { kind: mutation.kind, entityId: mutation.payload.node.id },
				document: {
					version: 2,
					schemaVersion: 2,
					workspaceId: mutation.workspaceId,
					revision: mutation.expectedRevision + 1,
					updatedAt: mutation.createdAt,
					lastMutationId: mutation.mutationId,
					data,
					tombstones: {
						nodes: [],
						subscriptions: [],
						aggregates: [],
						publishTargets: [],
						clientExports: [],
					},
				},
			},
		});
	});
	await page.getByRole("button", { name: "Edit node", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Node", exact: true });
	await dialog
		.getByRole("textbox", { name: "Name", exact: true })
		.fill("Cloud-confirmed edit");
	const save = dialog.getByRole("button", { name: "Save", exact: true });
	await save.click();
	await expect.poll(() => requests).toBe(1);
	await expect(dialog).toBeVisible();
	await expect(dialog.locator(".gh-action-button")).toHaveAttribute(
		"aria-busy",
		"true",
	);
	await expect(dialog.locator(".gh-action-button")).toBeDisabled();
	await expect(
		dialog.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("Cloud-confirmed edit");
	await expect(
		page.getByRole("status").filter({ hasText: "Node updated" }),
	).toHaveCount(0);
	release();
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("button", { name: "Cloud-confirmed edit", exact: true }),
	).toBeVisible();
	expect(requests).toBe(1);
});

test("retryable cloud delivery retains the editor and pending presentation", async ({
	page,
	context,
}) => {
	await context.route(mutationRoute, (route) =>
		route.fulfill({
			status: 503,
			json: {
				error: {
					code: "upstream-unavailable",
					disposition: "retryable-upstream",
					message: "Fixture temporarily unavailable",
				},
			},
		}),
	);
	await page.getByRole("button", { name: "Edit node", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Node", exact: true });
	await dialog
		.getByRole("textbox", { name: "Name", exact: true })
		.fill("Retained edit");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog.locator(".gh-operation-feedback")).toHaveAttribute(
		"data-feedback",
		"pending",
	);
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("Retained edit");
	await expect(dialog.locator(".gh-action-button")).toBeDisabled();
	await expect(dialog.locator('[data-feedback="success"]')).toHaveCount(0);
});

test("navigation and menus respect reduced motion without losing keyboard focus", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const nav = page.getByRole("navigation", { name: "Primary" });
	await nav.getByRole("link", { name: "Aggregate", exact: true }).click();
	await expect(page).toHaveURL(/\/aggregate$/);
	await expect(
		nav.getByRole("link", { name: "Aggregate", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await expect
		.poll(() =>
			nav.evaluate((element) =>
				getComputedStyle(element, "::after")
					.transitionDuration.split(",")
					.every((value) => Number.parseFloat(value) === 0),
			),
		)
		.toBe(true);
	await nav.getByRole("link", { name: "Nodes", exact: true }).click();
	await page.getByRole("button", { name: "Edit node", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Node", exact: true });
	await expect(
		dialog.getByRole("textbox", { name: "Name", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("button", { name: "Edit node", exact: true }),
	).toBeFocused();
	await expect(page.locator("main")).not.toHaveAttribute("inert");
});

test("mobile editor locks background scrolling and retains drafts through selection menus", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 844 });
	const header = await page.evaluate(() => ({
		brand:
			document.querySelector(".app-repo-title span")?.getBoundingClientRect()
				.right ?? 0,
		actions:
			document.querySelector(".app-repo-actions")?.getBoundingClientRect()
				.left ?? 0,
	}));
	expect(header.brand).toBeLessThan(header.actions);
	await expect(
		page.getByRole("link", { name: "Open project on GitHub", exact: true }),
	).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole("button", { name: "Edit node", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Node", exact: true });
	await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
	const name = dialog.getByRole("textbox", { name: "Name", exact: true });
	await name.fill("Mobile draft");
	await dialog.locator('[aria-haspopup="menu"]').click();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();
	await expect(name).toHaveValue("Mobile draft");
	await page.evaluate(async () => {
		await Promise.all(
			document
				.getAnimations()
				.filter(
					(animation) => animation.effect?.getTiming().iterations !== Infinity,
				)
				.map((animation) => animation.finished.catch(() => {})),
		);
	});
	const bounds = await dialog.boundingBox();
	expect(bounds?.x).toBe(0);
	expect(bounds && bounds.y + bounds.height).toBeCloseTo(844, 0);
	await page.evaluate(() => {
		Object.defineProperty(visualViewport, "height", {
			configurable: true,
			value: 500,
		});
		visualViewport?.dispatchEvent(new Event("resize"));
	});
	await expect
		.poll(async () => {
			const box = await dialog.boundingBox();
			return Math.round((box?.y ?? 0) + (box?.height ?? 0));
		})
		.toBe(500);
	await expect(name).toHaveValue("Mobile draft");
	await page.evaluate(() => {
		if (visualViewport) Reflect.deleteProperty(visualViewport, "height");
		visualViewport?.dispatchEvent(new Event("resize"));
	});

	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("advanced disclosure handles rapid toggles and keeps unsaved field values", async ({
	page,
}) => {
	await page
		.getByRole("navigation", { name: "Primary" })
		.getByRole("link", { name: "Aggregate", exact: true })
		.click();
	const panel = page.locator("details.gh-advanced-options");
	await panel.locator("summary").click();
	const rename = panel.getByRole("textbox", {
		name: "Rename Rules",
		exact: true,
	});
	await rename.fill("Old = New");
	await panel.locator("summary").dblclick();
	await expect(panel).toHaveAttribute("open");
	await expect(rename).toHaveValue("Old = New");
	await panel.locator("summary").click();
	await expect(panel).not.toHaveAttribute("open");
	await panel.locator("summary").click();
	await expect(rename).toHaveValue("Old = New");
});

test("automatic theme follows the OS while explicit light mode stays fixed", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("html")).toHaveAttribute(
		"data-theme-mode",
		"system",
	);
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		"rgb(13, 17, 23)",
	);
	await page.reload();
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		"rgb(13, 17, 23)",
	);
	await page.locator(".theme-menu-button").click();
	await page.getByRole("menuitemradio", { name: "Light", exact: true }).click();
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		"rgb(255, 255, 255)",
	);
	await page.emulateMedia({ colorScheme: "light" });
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		"rgb(255, 255, 255)",
	);
	await page.locator(".theme-menu-button").click();
	await page.getByRole("menuitemradio", { name: "Auto", exact: true }).click();
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		"rgb(13, 17, 23)",
	);
	await page.emulateMedia({ colorScheme: "light" });
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		"rgb(255, 255, 255)",
	);
});
