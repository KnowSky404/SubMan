// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const authPageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("auth page uses the showToast helper for status notifications", () => {
	expect(authPageSource).toContain(
		'import { showToast } from "$lib/stores/toast";',
	);
	expect(authPageSource).not.toContain("toastStore.show(");
});

test("auth page uses github settings section primitives", () => {
	expect(authPageSource).toContain("gh-section");
	expect(authPageSource).toContain("gh-section-header");
	expect(authPageSource).toContain("gh-section-body");
	expect(authPageSource).toContain("gh-section-footer");
});
