// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appStoreSource = readFileSync(
	new URL("./app.ts", import.meta.url),
	"utf8",
);

test("store validation and identity gate local Workspace updates", () => {
	const validation = appStoreSource.indexOf(
		"validateAutomaticWorkspaceMutationDraft(draft)",
	);
	const localPersistence = appStoreSource.indexOf(
		"localStorage.setItem(STORAGE_KEY, JSON.stringify(next))",
	);

	expect(validation).toBeGreaterThan(-1);
	expect(localPersistence).toBeGreaterThan(validation);
	expect(appStoreSource).toContain('identity.status === "mismatch"');
	expect(appStoreSource).toContain("WorkspaceActionHandle");
	expect(appStoreSource).toContain('localStatus: "local-saved"');
	expect(appStoreSource).toContain("!get(authState).token");
	expect(appStoreSource).toContain("Workspace change was not saved: {error}");
	expect(appStoreSource).toContain(
		"Saved locally; Workspace synchronization needs repair: {error}",
	);
});

test("destructive Workspace actions defer local state until enqueue acceptance", () => {
	expect(appStoreSource).toContain("runDeferredWorkspaceAction");
	const deferredStart = appStoreSource.indexOf(
		"function runDeferredWorkspaceAction",
	);
	const enqueue = appStoreSource.indexOf(
		"await enqueueAutomaticWorkspaceMutation(draft)",
		deferredStart,
	);
	const persist = appStoreSource.indexOf(
		"localStorage.setItem(STORAGE_KEY, JSON.stringify(next))",
		enqueue,
	);
	expect(enqueue).toBeGreaterThan(deferredStart);
	expect(persist).toBeGreaterThan(enqueue);
	expect(appStoreSource).toContain("cleanupUnreferencedOutputs");
});

test("output owners are validated locally before AppState changes", () => {
	expect(appStoreSource).toContain("assertLocalOutputOwnerAvailable");
	expect(appStoreSource).toContain("validateWorkspaceOutputFileName");
	expect(appStoreSource).toContain('kind: "publish-target"');
	expect(appStoreSource).toContain('kind: "client-export"');
});
