import { defineConfig, devices } from "@playwright/test";

const port = 4_175;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "line",
	use: {
		baseURL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: `bun run build && bun run preview -- --host 127.0.0.1 --port ${port}`,
		url: baseURL,
		env: {
			WRANGLER_LOG_PATH: "/tmp/subman-playwright-wrangler-logs",
			WRANGLER_REGISTRY_PATH: "/tmp/subman-playwright-wrangler-registry",
		},
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
