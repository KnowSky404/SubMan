import { expect, test } from "bun:test";
import { get } from "svelte/store";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import {
	createEmptyWorkspacePersistenceRecord,
	InMemoryWorkspacePersistence,
} from "$lib/workspace-persistence";
import {
	getBrowserWorkspacePersistence,
	getBrowserWorkspacePersistenceRecord,
	initializeBrowserWorkspacePersistence,
	refreshBrowserWorkspacePersistence,
	setBrowserWorkspacePersistenceForTest,
} from "$lib/workspace-persistence-browser";
import {
	defaultWorkspaceSyncStatus,
	workspaceSyncStatus,
} from "$lib/workspace-sync-status";

const NOW = "2026-07-23T08:00:00.000Z";

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();

	get length(): number {
		return this.values.size;
	}

	clear(): void {
		this.values.clear();
	}

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (error) {
		return error as Error;
	}
	throw new Error("Expected promise to reject");
}

test("browser persistence initializes once, hydrates, and exposes a stable adapter", async () => {
	const record = createEmptyWorkspacePersistenceRecord();
	record.snapshot = createDefaultWorkspaceState(NOW);
	const persistence = new InMemoryWorkspacePersistence(record);
	const storage = new MemoryStorage();
	setBrowserWorkspacePersistenceForTest(persistence);
	let hydrationCount = 0;

	const [first, second] = await Promise.all([
		initializeBrowserWorkspacePersistence({
			storage,
			hydrate: () => {
				hydrationCount += 1;
			},
		}),
		initializeBrowserWorkspacePersistence({
			storage,
			hydrate: () => {
				hydrationCount += 100;
			},
		}),
	]);

	expect(first).toEqual(second);
	expect(hydrationCount).toBe(1);
	expect(first.migration.phase).toBe("confirmed");
	expect(getBrowserWorkspacePersistence()).toBe(persistence);
	expect(getBrowserWorkspacePersistenceRecord()?.snapshot).toEqual(
		record.snapshot,
	);
	expect((await refreshBrowserWorkspacePersistence()).snapshot).toEqual(
		record.snapshot,
	);
	setBrowserWorkspacePersistenceForTest(null);
});

test("initialization failure enters invalid-local-storage without a legacy fallback", async () => {
	const persistence = new InMemoryWorkspacePersistence();
	persistence.setFault("before-transaction", "upgrade-failed");
	const storage = new MemoryStorage();
	workspaceSyncStatus.set(defaultWorkspaceSyncStatus);
	setBrowserWorkspacePersistenceForTest(persistence);

	const error = await captureError(
		initializeBrowserWorkspacePersistence({ storage }),
	);
	expect(error.message).toContain("Injected persistence failure");
	expect(get(workspaceSyncStatus).phase).toBe("invalid-local-storage");
	expect(get(workspaceSyncStatus).lifecycle).toBe("invalid-local-state");
	expect(getBrowserWorkspacePersistenceRecord()).toBeNull();
	expect(storage.length).toBe(0);
	setBrowserWorkspacePersistenceForTest(null);
});
