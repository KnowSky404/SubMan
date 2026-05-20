// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appCssSource = readFileSync(
	new URL("./app.css", import.meta.url),
	"utf8",
);

test("global theme loads English-first remote fonts before local fallbacks", () => {
	expect(appCssSource).toContain(
		'@import url("https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.2.10/latin.css");',
	);
	expect(appCssSource).toContain(
		'@import url("https://cdn.jsdelivr.net/npm/@fontsource/roboto-mono@5.2.9/latin.css");',
	);
	expect(appCssSource).toContain('"Roboto", -apple-system');
	expect(appCssSource).toContain('"Roboto Mono", ui-monospace');
	expect(appCssSource).not.toContain("Noto Sans SC");
	expect(appCssSource).not.toContain("chinese-simplified.css");
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
