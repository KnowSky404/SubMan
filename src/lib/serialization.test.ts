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
