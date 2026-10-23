import { expect, test } from "@playwright/test";

const routes = ["/", "/auth", "/nodes", "/aggregate", "/exports", "/gists"];

test.beforeEach(async ({ page, context }) => {
	const now = "2026-10-23T10:00:00.000Z";
	const gistId = "accessibility-cloud";
	const data = {
		nodes: [
			{
				id: "accessibility-node",
				name: "Accessibility Node",
				type: "vless",
				raw: "vless://00000000-0000-4000-8000-000000000001@example.com:443#A11y",
				tags: [],
				enabled: true,
				updatedAt: now,
				source: "single",
			},
		],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
	};
	const document = {
		version: 2,
		schemaVersion: 2,
		workspaceId: `gist:${gistId}`,
		revision: 0,
		updatedAt: now,
		lastMutationId: null,
		data,
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
	await context.route("https://api.github.com/**", async (route) => {
		if (
			route.request().method() !== "GET" ||
			new URL(route.request().url()).pathname !== `/gists/${gistId}`
		) {
			await route.abort("blockedbyclient");
			return;
		}
		await route.fulfill({
			json: {
				id: gistId,
				owner: { login: "e2e" },
				description: "SubMan-Data",
				updated_at: now,
				html_url: `https://gist.github.com/e2e/${gistId}`,
				files: {
					"subman.json": {
						filename: "subman.json",
						content: JSON.stringify(document),
						truncated: false,
					},
				},
			},
		});
	});
	await context.route("**/__e2e_seed__", (route) =>
		route.fulfill({
			status: 200,
			contentType: "text/html",
			body: "<!doctype html><title>SubMan E2E seed</title>",
		}),
	);
	await page.goto("/__e2e_seed__");
	await page.evaluate(
		async ({ gistId, now, data, document }) => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open("subman-workspace", 1);
				request.onupgradeneeded = () =>
					request.result.createObjectStore("workspace-state");
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(
					"workspace-state",
					"readwrite",
				);
				transaction.objectStore("workspace-state").put(
					{
						version: 1,
						snapshot: {
							...data,
							gists: [],
							activeGistId: gistId,
							activeGistFile: "subman.json",
							lastUpdated: now,
						},
						binding: {
							version: 2,
							gistId,
							workspaceId: `gist:${gistId}`,
							fileName: "subman.json",
							revision: 0,
							syncMode: "automatic",
							baseline: document,
							conflictBaseline: null,
						},
						workspaces: {},
						leases: {},
						quarantines: [],
						quarantinePayloads: {},
						nextFencingToken: 1,
						migration: {
							version: 1,
							phase: "confirmed",
							startedAt: now,
							copiedAt: now,
							validatedAt: now,
							updatedAt: now,
							confirmedAt: now,
							cleanupCompletedAt: now,
						},
					},
					"root",
				);
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			database.close();
			sessionStorage.setItem(
				"subman:auth:session:v2",
				JSON.stringify({
					version: 2,
					token: "fixture-accessibility-token",
					lastLoginAt: now,
				}),
			);
		},
		{ gistId, now, data, document },
	);
});

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
	await expect(menu.locator("button").nth(1)).toBeFocused();
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
