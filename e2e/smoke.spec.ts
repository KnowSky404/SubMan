import { expect, test } from "@playwright/test";

test("loads the application shell without browser errors", async ({ page }) => {
	const browserErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") browserErrors.push(message.text());
	});
	page.on("pageerror", (error) => browserErrors.push(error.message));

	await page.goto("/");

	await expect(page).toHaveTitle("SubMan");
	await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
	await expect(page.locator("body")).not.toBeEmpty();
	expect(browserErrors).toEqual([]);
});
