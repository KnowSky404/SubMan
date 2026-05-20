// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appCssSource = readFileSync(
	new URL("./app.css", import.meta.url),
	"utf8",
);

test("global theme loads a stable remote font before local fallbacks", () => {
	expect(appCssSource).toContain(
		'@import url("https://cdn.jsdelivr.net/npm/fontsource-noto-sans-sc@4.0.0/latin.css");',
	);
	expect(appCssSource).toContain(
		'@import url("https://cdn.jsdelivr.net/npm/fontsource-noto-sans-sc@4.0.0/chinese-simplified.css");',
	);
	expect(appCssSource).toContain('"Noto Sans SC", "Noto Sans"');
	expect(appCssSource.indexOf("@import")).toBeLessThan(
		appCssSource.indexOf("@theme"),
	);
});

test("desktop theme increases app and tab typography", () => {
	expect(appCssSource).toContain("@media (min-width: 1024px)");
	expect(appCssSource).toContain("html {\n\t\tfont-size: 15px;");
	expect(appCssSource).toContain(".gh-underlinenav-item,\n\t.gh-tab");
	expect(appCssSource).toContain("font-size: 1rem;");
});
