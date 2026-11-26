import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
		},
	},
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.toml" },
			miniflare: {
				bindings: {
					GITHUB_TOKEN: "fixture-github-token-for-worker-test",
					SUBMAN_API_TOKEN: "fixture-rest-token-for-worker-test",
					SUBMAN_MCP_GIST_ID: "0123456789abcdef0123456789abcdef",
					SUBMAN_MCP_READ_TOKEN: "fixture-mcp-read-token-for-worker-test",
					SUBMAN_MCP_WRITE_TOKEN: "fixture-mcp-write-token-for-worker-test",
				},
			},
		}),
	],
	test: {
		include: ["test/cloudflare/**/*.integration.ts"],
	},
});
