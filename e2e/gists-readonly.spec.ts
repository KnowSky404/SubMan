import { expect, test } from "@playwright/test";
import { defaultUiData, seedUiWorkspace } from "./ui-workspace-fixture";

const gistUrl = "https://api.github.com/gists/accessibility-cloud";
const rawUrl =
	"https://gist.githubusercontent.com/e2e/accessibility-cloud/raw/nodes.txt";

for (const variant of [
	{ name: "desktop English", width: 1280, height: 900, locale: "en" },
	{ name: "mobile Chinese", width: 390, height: 844, locale: "zh-CN" },
]) {
	test(`Gists stays read-only while viewing and refreshing all file kinds (${variant.name})`, async ({
		page,
		context,
	}) => {
		await page.setViewportSize(variant);
		const errors: string[] = [];
		const writes: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		context.on("request", (request) => {
			if (
				request.method() !== "GET" &&
				(request.url().startsWith("https://api.github.com/") ||
					request.url().includes("/api/workspaces/"))
			) {
				writes.push(`${request.method()} ${request.url()}`);
			}
		});
		await context.route("**/api/workspaces/**", (route) => route.abort());
		const data = structuredClone(defaultUiData);
		const now = "2026-10-23T10:00:00.000Z";
		data.aggregates.push({
			id: "readonly-rule",
			name: "Read-only rule",
			nodeIds: [data.nodes[0].id],
			subscriptionIds: [],
			excludeTagIds: [],
			renameMap: {},
			allowedTypes: [],
			updatedAt: now,
		});
		data.publishTargets.push({
			id: "readonly-target",
			name: "Published output",
			ruleId: "readonly-rule",
			fileName: "nodes.txt",
			description: "",
			isPublic: false,
			lastPublishedAt: now,
			lastPublishedUrl: rawUrl,
			lastPublishTransitionAt: null,
			lastPublishTransitionFromFileName: null,
			lastPublishTransitionToFileName: null,
			lastPublishTransitionOutcome: null,
			updatedAt: now,
		});
		const files = {
			"nodes.txt": data.nodes[0].raw,
			"notes.txt": "External file",
			"subman.v1.backup.json": "Historical backup",
			"subman.bootstrap.json": JSON.stringify({ version: 1 }),
		};
		await seedUiWorkspace(page, context, data, files);
		await page.evaluate((locale) => {
			localStorage.setItem("subman:locale:v1", locale);
		}, variant.locale);
		await page.goto("/gists");
		await expect(page).toHaveURL(/\/gists$/);
		await expect(page).toHaveTitle("Gists - SubMan");
		await expect(page.locator(".app-header-link-connected")).toBeVisible();
		const main = page.getByRole("main");
		await expect(main.getByRole("heading", { name: "Gists" })).toBeVisible();
		await expect(
			main.getByText(variant.locale === "en" ? "Read-only" : "只读", {
				exact: true,
			}),
		).toBeVisible();
		await expect(main.locator(".gh-box-row")).toHaveCount(5);
		await expect(
			main.getByText(variant.locale === "en" ? "Stale marker" : "过期标记", {
				exact: true,
			}),
		).toBeVisible();
		await expect(
			main.getByRole("button", { name: /Delete|Edit|Clean Up|删除|编辑|清理/ }),
		).toHaveCount(0);
		await expect(main.getByRole("button")).toHaveCount(6);
		const output = main.locator(".gh-box-row").filter({ hasText: "nodes.txt" });
		await expect(output.locator(".gh-label")).toHaveText(
			variant.locale === "en" ? "Managed Output" : "受管输出",
		);
		await expect(output.getByRole("link").first()).toHaveAttribute(
			"href",
			rawUrl,
		);
		await page.evaluate(() => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: async (value: string) => {
						document.documentElement.dataset.copiedUrl = value;
					},
				},
			});
		});
		const copy = output.getByRole("button", {
			name: variant.locale === "en" ? "Copy Raw URL" : "复制原始链接",
			exact: true,
		});
		await copy.click();
		await expect(copy).toHaveAttribute("data-feedback", "copied");
		await expect(page.locator("html")).toHaveAttribute(
			"data-copied-url",
			rawUrl,
		);
		await Promise.all([
			page.waitForResponse(gistUrl),
			main
				.getByRole("button", {
					name: variant.locale === "en" ? "Refresh" : "刷新",
					exact: true,
				})
				.click(),
		]);
		await expect(main.locator(".gh-box-row")).toHaveCount(5);
		await expect(main.getByRole("button")).toHaveCount(6);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
		).toBeLessThanOrEqual(variant.width);
		expect(writes).toEqual([]);
		expect(errors).toEqual([]);
	});
}
