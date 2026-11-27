import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SUBMAN_E2E_PORT ?? 4_175);
const server =
	process.env.SUBMAN_E2E_USE_BUILD === "1" ? "dev:cf:built" : "dev:cf";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["github"], ["line"]] : "line",
	use: {
		baseURL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: `bun run ${server} --ip 127.0.0.1 --port ${port}`,
		url: baseURL,
		env: {
			WRANGLER_LOG_PATH: ".wrangler/playwright-logs",
			WRANGLER_REGISTRY_PATH: ".wrangler/playwright-registry",
		},
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
