// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appCssSource = readFileSync(
	new URL("./app.css", import.meta.url),
	"utf8",
);

test("global theme uses Primer system font stacks without remote font imports", () => {
	expect(appCssSource).toContain('@import "tailwindcss";');
	expect(appCssSource).not.toContain("@fontsource/roboto");
	expect(appCssSource).not.toContain("@fontsource/roboto-mono");
	expect(appCssSource).not.toContain('"Roboto"');
	expect(appCssSource).not.toContain('"Roboto Mono"');
	expect(appCssSource).toContain(
		'-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
	);
	expect(appCssSource).toContain(
		'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono"',
	);
	expect(appCssSource).not.toContain("Noto Sans SC");
	expect(appCssSource).not.toContain("chinese-simplified.css");
	expect(appCssSource.indexOf("@import")).toBeLessThan(
		appCssSource.indexOf("@theme"),
	);
});

test("desktop theme keeps stable base size while increasing tabs", () => {
	expect(appCssSource).toContain("@media (min-width: 1024px)");
	expect(appCssSource).toContain("html {\n\tfont-size: 14px;");
	expect(appCssSource).not.toContain("html {\n\t\tfont-size: 15px;");
	expect(appCssSource).toContain(".gh-underlinenav-item,\n\t.gh-tab");
	expect(appCssSource).toContain("font-size: 1rem;");
});
