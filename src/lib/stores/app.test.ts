// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appStoreSource = readFileSync(
	new URL("./app.ts", import.meta.url),
	"utf8",
);

test("store validation gates optimistic Workspace updates", () => {
	const validation = appStoreSource.indexOf(
		"validateAutomaticWorkspaceMutationDraft(draft)",
	);
	const firstUpdate = appStoreSource.indexOf("appState.update");

	expect(validation).toBeGreaterThan(-1);
	expect(firstUpdate).toBeGreaterThan(validation);
	expect(appStoreSource).toContain("return false;");
	expect(appStoreSource).toContain("Workspace change was not saved: {error}");
	expect(appStoreSource).not.toContain(").catch(() => {");
});
