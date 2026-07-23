import * as bunTest from "bun:test";
import type { AppState } from "$lib/models";

const { expect, test } = bunTest;
const mockModule = (
	bunTest as unknown as {
		mock: { module: (specifier: string, factory: () => unknown) => void };
	}
).mock.module;

mockModule("$app/environment", () => ({
	browser: false,
}));

test("exportSyncState preserves active workspace gist identity", async () => {
	const [{ exportSyncState }, { defaultState }] = await Promise.all([
		import("$lib/serialization"),
		import("$lib/stores/app"),
	]);
	const state: AppState = {
		...defaultState,
		activeGistId: "gist-123",
		activeGistFile: "workspace/subman.json",
		lastUpdated: "2026-05-12T00:00:00.000Z",
	};

	const exported = JSON.parse(exportSyncState(state)) as { data: AppState };

	expect(exported.data.activeGistId).toBe("gist-123");
	expect(exported.data.activeGistFile).toBe("workspace/subman.json");
});

test("getSyncStateSignature ignores active workspace gist identity", async () => {
	const [{ getSyncStateSignature }, { defaultState }] = await Promise.all([
		import("$lib/serialization"),
		import("$lib/stores/app"),
	]);
	const state: AppState = {
		...defaultState,
		activeGistId: "gist-123",
		activeGistFile: "workspace/subman.json",
		lastUpdated: "2026-05-12T00:00:00.000Z",
	};

	expect(getSyncStateSignature(state)).toBe(
		getSyncStateSignature({
			...state,
			activeGistId: "gist-456",
			activeGistFile: "alternate/subman.json",
		}),
	);
});

test("business configuration export and import exclude Workspace identity", async () => {
	const [{ exportState, importState }, { defaultState }] = await Promise.all([
		import("$lib/serialization"),
		import("$lib/stores/app"),
	]);
	const exported = exportState({
		...defaultState,
		activeGistId: "secret-binding",
		activeGistFile: "subman.json",
	});
	const parsed = JSON.parse(exported) as { data: Record<string, unknown> };

	expect(parsed.data.activeGistId).toBe(undefined);
	expect(parsed.data.activeGistFile).toBe(undefined);
	expect(importState(exported).activeGistId).toBeNull();
});
