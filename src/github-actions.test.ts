// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ciWorkflow = readFileSync(`${root}/.github/workflows/ci.yml`, "utf8");
const deployWorkflow = readFileSync(
	`${root}/.github/workflows/deploy.yml`,
	"utf8",
);
const playwrightConfig = readFileSync(`${root}/playwright.config.ts`, "utf8");
const packageJson = JSON.parse(
	readFileSync(`${root}/package.json`, "utf8"),
) as {
	scripts: Record<string, string>;
};
const singBoxTarget = readFileSync(
	`${root}/src/lib/client-export/target.ts`,
	"utf8",
);
const singBoxVerifier = readFileSync(
	`${root}/scripts/verify-sing-box-export.ts`,
	"utf8",
);

function sourcePosition(source: string, marker: string): number {
	const position = source.indexOf(marker);
	expect(position).toBeGreaterThanOrEqual(0);
	return position;
}

test("CI fails fast before installing Chromium and validates the Worker bundle", () => {
	expect(ciWorkflow).toContain("workflow_dispatch:");
	expect(ciWorkflow).toContain("permissions:\n  contents: read");
	expect(ciWorkflow).toContain("uses: actions/checkout@v6");
	expect(ciWorkflow).toContain("persist-credentials: false");

	const browserInstall = sourcePosition(ciWorkflow, "Install Chromium");
	for (const gate of [
		"Run unit tests",
		"Validate sing-box 1.14 export",
		"Run type and Svelte checks",
		"Run lint",
		"Build",
		"Run Cloudflare integration tests",
		"Verify Cloudflare deployment bundle",
	]) {
		expect(sourcePosition(ciWorkflow, gate)).toBeLessThan(browserInstall);
	}

	expect(ciWorkflow).toContain("wrangler deploy --dry-run");
	expect(ciWorkflow).toContain("actions/upload-artifact@v7");
});

test("CI checks generated exports with a pinned sing-box 1.14 image", () => {
	expect(ciWorkflow).toContain("run: bun run test:sing-box");
	expect(packageJson.scripts["test:sing-box"]).toBe(
		"bun run scripts/verify-sing-box-export.ts",
	);
	expect(singBoxTarget).toContain("ghcr.io/sagernet/sing-box:v1.14.0@sha256:");
	expect(singBoxTarget).not.toContain(":latest");
	expect(singBoxVerifier).toContain("buildSingBoxClientConfig");
	expect(singBoxVerifier).toContain('"/dev/stdin"');
	expect(singBoxVerifier).not.toContain("fetch(");
});

test("browser CI starts the built Worker through Wrangler local mode", () => {
	expect(playwrightConfig).toContain("bun run dev:cf");
	expect(playwrightConfig).not.toContain("bun run preview");
	expect(packageJson.scripts["dev:cf"]).toContain("wrangler dev --local");
	expect(packageJson.scripts["deploy:check"]).toContain(
		"wrangler deploy --dry-run",
	);
});

test("production deployment is manual, main-only, and environment gated", () => {
	expect(deployWorkflow).toContain("workflow_dispatch:");
	expect(deployWorkflow).not.toContain("\n  push:");
	expect(deployWorkflow).toContain('GITHUB_REF" != "refs/heads/main');
	expect(deployWorkflow).toContain('CONFIRMATION" != "deploy');
	expect(deployWorkflow).toContain("name: production");
	expect(deployWorkflow).toContain("CLOUDFLARE_API_TOKEN");
	expect(deployWorkflow).toContain("CLOUDFLARE_ACCOUNT_ID");
	expect(deployWorkflow).toContain("wrangler deploy --strict");
	expect(deployWorkflow).toContain("cancel-in-progress: false");
	expect(packageJson.scripts.deploy).toContain("--strict");
});
