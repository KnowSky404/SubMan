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
