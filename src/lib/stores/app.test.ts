// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appStoreSource = readFileSync(
	new URL("./app.ts", import.meta.url),
	"utf8",
);

test("store actions use the serialized transactional persistence boundary", () => {
	const serialization = appStoreSource.indexOf("function serializedAction");
	const commit = appStoreSource.indexOf("await commitBrowserWorkspaceAction({");
	const publish = appStoreSource.indexOf("appState.set(next)", commit);

	expect(serialization).toBeGreaterThan(-1);
	expect(commit).toBeGreaterThan(serialization);
	expect(publish).toBeGreaterThan(commit);
	expect(appStoreSource).toContain(
		'checkWorkspaceIdentity(current, binding).status === "mismatch"',
	);
	expect(appStoreSource).toContain("WorkspaceActionHandle");
	expect(appStoreSource).toContain('localStatus: "local-saved"');
	expect(appStoreSource).toContain("Workspace change was not saved: {error}");
	expect(appStoreSource).not.toContain("localStorage.setItem");
	expect(appStoreSource).not.toContain("WorkspaceV2StateStore");
	expect(appStoreSource).not.toContain("enqueueAutomaticWorkspaceMutation");
});

test("destructive Workspace actions share the commit-before-publish path", () => {
	expect(appStoreSource).toContain("runDeferredWorkspaceAction");
	expect(appStoreSource).toContain(
		"return runWorkspaceAction(kind, payload, update)",
	);
	expect(appStoreSource).toContain("cleanupUnreferencedOutputs");
});

test("output owners are validated locally before AppState changes", () => {
	expect(appStoreSource).toContain("assertLocalOutputOwnerAvailable");
	expect(appStoreSource).toContain("validateWorkspaceOutputFileName");
	expect(appStoreSource).toContain('kind: "publish-target"');
	expect(appStoreSource).toContain('kind: "client-export"');
});
