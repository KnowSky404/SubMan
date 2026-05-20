// @ts-nocheck
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function collectSvelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return collectSvelteFiles(path);
		return path.endsWith(".svelte") ? [path] : [];
	});
}

test("route dropdowns use the GitHubSelect menu instead of native selects", () => {
	const routeFiles = collectSvelteFiles(new URL(".", import.meta.url).pathname);
	const nativeSelectUsages = routeFiles.flatMap((file) => {
		const source = readFileSync(file, "utf8");
		return source.includes("<select") ? [file] : [];
	});

	expect(nativeSelectUsages).toEqual([]);
});
