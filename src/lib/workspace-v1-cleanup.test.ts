import { expect, test } from "bun:test";
import { clearLegacyWorkspaceSyncState } from "$lib/workspace-v1-cleanup";

test("legacy Workspace cleanup removes only V1 sync metadata", () => {
	const removed: string[] = [];
	const originalStorage = Object.getOwnPropertyDescriptor(
		globalThis,
		"localStorage",
	);
	Object.defineProperty(globalThis, "localStorage", {
		value: { removeItem: (key: string) => removed.push(key) },
		configurable: true,
	});

	try {
		clearLegacyWorkspaceSyncState();
	} finally {
		if (originalStorage) {
			Object.defineProperty(globalThis, "localStorage", originalStorage);
		} else {
			Reflect.deleteProperty(globalThis, "localStorage");
		}
	}

	expect(removed).toEqual([
		"subman:sync:baseline-envelope:v1",
		"subman:sync:mode:v1",
		"subman:sync:last-status:v1",
	]);
});
