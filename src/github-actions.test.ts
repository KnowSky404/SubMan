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
const ci = Bun.YAML.parse(ciWorkflow);
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

test("CI isolates fast checks and builds once before Worker and browser tests", () => {
	expect(ci.on).toHaveProperty("pull_request");
	expect(ci.permissions).toEqual({ contents: "read" });
	expect(ci.jobs.fast.needs).toBe("scope");
	expect(ci.jobs.runtime.needs).toBe("scope");

	const runtime = ci.jobs.runtime.steps.map((step) => step.run).filter(Boolean);
	expect(runtime).toEqual([
		"bun install --frozen-lockfile",
		"bun run build",
		"bun run test:cf:built",
		"bun run deploy:check:built",
		"bunx playwright install --with-deps chromium",
		"bun run test:e2e",
	]);
	const browser = ci.jobs.runtime.steps.find(
		(step) => step.run === "bun run test:e2e",
	);
	expect(browser.env.SUBMAN_E2E_USE_BUILD).toBe("1");
	expect(ciWorkflow).toMatch(/actions\/upload-artifact@[a-f0-9]{40}/);
	expect(ciWorkflow).toMatch(/actions\/checkout@[a-f0-9]{40}/);
	expect(ciWorkflow).toContain("persist-credentials: false");
});

test("CI gate fails closed if an applicable check is missing or unsuccessful", () => {
	const verify = ci.jobs.verify;
	expect(verify.if).toBe("always()");
	expect(verify.needs).toEqual(["scope", "fast", "runtime"]);
	const command = verify.steps[0].run;
	for (const [SCOPE, SUITE, FAST, RUNTIME, pass] of [
		["success", "docs", "success", "skipped", true],
		["success", "ui", "success", "success", true],
		["success", "full", "success", "success", true],
		["success", "full", "success", "skipped", false],
		["success", "ui", "success", "cancelled", false],
		["success", "full", "success", "failure", false],
		["success", "full", "success", "", false],
		["success", "docs", "skipped", "skipped", false],
		["failure", "", "skipped", "skipped", false],
		["success", "unknown", "success", "success", false],
	]) {
		const result = Bun.spawnSync(["bash", "-c", command], {
			env: { ...process.env, SCOPE, SUITE, FAST, RUNTIME },
			stdout: "ignore",
		});
		expect(result.exitCode === 0).toBe(pass);
	}
});

test("CI checks generated exports with a pinned sing-box 1.14 image", () => {
	expect(ciWorkflow).toContain("bun run test:sing-box");
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
	expect(playwrightConfig).toContain(' "dev:cf:built" : "dev:cf"');
	expect(playwrightConfig).not.toContain("bun run preview");
	expect(packageJson.scripts["dev:cf:built"]).toBe("wrangler dev --local");
	expect(packageJson.scripts["deploy:check:built"]).toContain(
		"wrangler deploy --dry-run",
	);
});

test("production deployment is manual, main-only, and environment gated", () => {
	expect(deployWorkflow).toContain("workflow_dispatch:");
	expect(deployWorkflow).not.toContain("\n  push:");
	expect(deployWorkflow).toContain('GITHUB_REF" != "refs/heads/main');
	expect(deployWorkflow).toContain('CONFIRMATION" != "deploy');
	expect(deployWorkflow).toContain('COMMIT" != "$GITHUB_SHA');
	expect(deployWorkflow).toContain("bash scripts/production-ci.sh");
	expect(deployWorkflow).toContain("needs: gate");
	expect(deployWorkflow).not.toContain("bun run test:");
	expect(deployWorkflow).toContain("name: production");
	expect(deployWorkflow).toContain("CLOUDFLARE_API_TOKEN");
	expect(deployWorkflow).toContain("CLOUDFLARE_ACCOUNT_ID");
	expect(deployWorkflow).toContain("wrangler deploy --strict");
	expect(deployWorkflow).toContain("cancel-in-progress: false");
	expect(packageJson.scripts.deploy).toContain("--strict");
});
