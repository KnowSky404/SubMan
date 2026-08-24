import { expect, test } from "@playwright/test";

const routes = ["/", "/auth", "/nodes", "/aggregate", "/exports", "/gists"];

test.describe("basic route accessibility", () => {
	for (const route of routes) {
		test(`${route} exposes names for visible controls`, async ({ page }) => {
			await page.goto(route);
			await expect(page.locator("main").first()).toBeVisible();

			const missingNames = await page.evaluate(() => {
				const isVisible = (element: Element): boolean => {
					const node = element as HTMLElement;
					const style = window.getComputedStyle(node);
					const rect = node.getBoundingClientRect();
					return (
						style.visibility !== "hidden" &&
						style.display !== "none" &&
						rect.width > 0 &&
						rect.height > 0
					);
				};
				const accessibleName = (element: Element): string => {
					const labelledBy = element.getAttribute("aria-labelledby");
					const labelledText = labelledBy
						?.split(/\s+/)
						.map((id) => document.getElementById(id)?.textContent ?? "")
						.join(" ");
					return (
						element.getAttribute("aria-label") ??
						labelledText ??
						element.getAttribute("title") ??
						element.textContent ??
						""
					)
						.replace(/\s+/g, " ")
						.trim();
				};

				return [
					...Array.from(document.querySelectorAll("button, a")),
					...Array.from(document.querySelectorAll("input, textarea, select")),
				]
					.filter(isVisible)
					.filter((element) => {
						if (element.matches("input, textarea, select")) {
							const id = element.getAttribute("id");
							const hasLabel = Boolean(
								id && document.querySelector(`label[for="${CSS.escape(id)}"]`),
							);
							return (
								!hasLabel &&
								!element.closest("label") &&
								!accessibleName(element)
							);
						}
						return !accessibleName(element);
					})
					.map((element) => element.outerHTML.slice(0, 180));
			});

			expect(missingNames, `unnamed controls on ${route}`).toEqual([]);
		});
	}
});

test("nodes edit dialog traps focus and restores it after Escape", async ({
	page,
}) => {
	await page.goto("/nodes");
	await page.getByRole("button", { name: "New Resource" }).first().click();
	await page.locator("#node-name").fill("Accessibility Node");
	await page
		.locator("#node-raw")
		.fill("vless://00000000-0000-4000-8000-000000000001@example.com:443#A11y");
	await page.getByRole("button", { name: "Save Resource" }).click();

	const editButton = page.getByRole("button", { name: "Edit node" }).first();
	await expect(editButton).toBeVisible();
	await editButton.click();
	const dialog = page.getByRole("dialog", { name: "Edit Node" });
	await expect(dialog).toBeVisible();
	await expect(dialog.locator("input").first()).toBeFocused();

	await page.keyboard.press("Shift+Tab");
	await expect(
		dialog.getByRole("button", { name: "Close edit modal" }),
	).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(dialog.getByRole("button", { name: "Save" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(editButton).toBeFocused();
});

test("nodes select menus support keyboard navigation", async ({ page }) => {
	await page.goto("/nodes");
	const statusSelect = page.locator("#resource-filter-status");
	await statusSelect.focus();
	await page.keyboard.press("Enter");

	const menu = page.locator('[role="menu"]').last();
	await expect(menu).toBeVisible();
	await page.keyboard.press("ArrowDown");
	await expect(menu.locator('[role="menuitemradio"]').nth(1)).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(menu).toBeHidden();
	await expect(statusSelect).toContainText("Enabled");
});

test("aggregate region dialog exposes focus and Escape behavior", async ({
	page,
}) => {
	await page.goto("/aggregate");
	const openButton = page.getByRole("button", { name: "Browse Icons" });
	await openButton.click();

	const dialog = page.getByRole("dialog", {
		name: "Built-in Region Flag Rules",
	});
	await expect(dialog).toBeVisible();
	await expect(page.locator("#aggregate-region-map-search")).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(openButton).toBeFocused();
});
