import { describe, expect, it } from "bun:test";
import type { NodeItem } from "$lib/models";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
	validateWorkspaceV2LocalState,
	WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

const NOW = "2026-07-22T14:00:00.000Z";
const WORKSPACE_ID = "gist:gist-1";

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

function node(id: string): NodeItem {
	return {
		id,
		name: id,
		type: "vless",
		raw: `vless://${id}`,
		tags: [],
		enabled: true,
		updatedAt: NOW,
		source: "single",
	};
}

function document(revision = 4): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision,
		updatedAt: NOW,
		lastMutationId: "b0000000-0000-4000-8000-000000000001",
		data: {
			nodes: [node("remote")],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
}

describe("Workspace V2 local state", () => {
	it("persists a validated revision and committed baseline", () => {
		const storage = new MemoryStorage();
		const store = new WorkspaceV2StateStore(storage);
		const state = createWorkspaceV2LocalState("gist-1", {
			baseline: document(),
		});

		store.write(state);

		expect(store.read()).toEqual(state);
		expect(store.read()?.revision).toBe(4);
		expect(storage.getItem(store.storageKey) ?? "").not.toContain("token");
	});

	it("represents bind-only mode without claiming a remote revision", () => {
		const state = createWorkspaceV2LocalState("gist-1", {
			syncMode: "manual",
		});

		expect(state.revision).toBeNull();
		expect(state.baseline).toBeNull();
		expect(state.workspaceId).toBe(WORKSPACE_ID);
	});

	it("rejects mismatched workspace and baseline revisions", () => {
		const state = createWorkspaceV2LocalState("gist-1", {
			baseline: document(),
		});

		expect(() =>
			validateWorkspaceV2LocalState({
				...state,
				workspaceId: "gist:gist-2",
			}),
		).toThrow("identity is invalid");
		expect(() =>
			validateWorkspaceV2LocalState({ ...state, revision: 3 }),
		).toThrow("baseline revision is invalid");
	});

	it("retains corrupted storage instead of replacing it", () => {
		const storage = new MemoryStorage();
		const store = new WorkspaceV2StateStore(storage);
		storage.setItem(store.storageKey, "corrupted");

		expect(() => store.read()).toThrow(
			"Stored Workspace V2 local state is invalid",
		);
		expect(storage.getItem(store.storageKey)).toBe("corrupted");
	});

	it("hydrates exact committed business data while preserving local Gist metadata", () => {
		const current = {
			...createDefaultWorkspaceState(),
			nodes: [node("local")],
			gists: [
				{
					id: "gist-1",
					url: "https://api.github.com/gists/gist-1",
					description: "SubMan-Data",
					ownerLogin: "owner",
					files: [],
					updatedAt: NOW,
				},
			],
		};

		const hydrated = hydrateAppStateFromWorkspaceDocument(
			current,
			document(),
			"gist-1",
		);

		expect(hydrated.nodes.map((item) => item.id)).toEqual(["remote"]);
		expect(hydrated.gists).toEqual(current.gists);
		expect(hydrated.activeGistId).toBe("gist-1");
		expect(hydrated.activeGistFile).toBe("subman.json");
		expect(hydrated.lastUpdated).toBe(NOW);
	});
});
