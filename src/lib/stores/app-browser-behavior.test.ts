import * as bunTest from "bun:test";

const { expect, test } = bunTest;
const bun = bunTest as unknown as {
	mock: {
		module: (specifier: string, factory: () => unknown) => void;
	};
};

bun.mock.module("$app/environment", () => ({ browser: true }));

const NOW = "2026-07-23T08:00:00.000Z";
const GIST_ID = "gist-1";
const WORKSPACE_ID = `gist:${GIST_ID}`;

class FailingStorage implements Storage {
	private readonly values = new Map<string, string>();
	failKey: string | null = null;

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
		if (key === this.failKey) throw new Error("storage write failed");
		this.values.set(key, value);
	}
}

test("failed deletion and disconnected edits preserve the correct local state", async () => {
	const localStorage = new FailingStorage();
	const sessionStorage = new FailingStorage();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: localStorage,
	});
	Object.defineProperty(globalThis, "sessionStorage", {
		configurable: true,
		value: sessionStorage,
	});

	const [workspaceData, stateModule, appStore, authStore] = await Promise.all([
		import("$lib/workspace-data"),
		import("$lib/workspace-v2-state"),
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
	]);
	const rule = {
		id: "rule-1",
		name: "Rule One",
		nodeIds: [],
		subscriptionIds: [],
		excludeTagIds: [],
		renameMap: {},
		allowedTypes: [],
		updatedAt: NOW,
	};
	const document = {
		version: 2 as const,
		schemaVersion: 2 as const,
		workspaceId: WORKSPACE_ID,
		revision: 1,
		updatedAt: NOW,
		lastMutationId: null,
		data: {
			nodes: [],
			subscriptions: [],
			aggregates: [rule],
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
	new stateModule.WorkspaceV2StateStore(localStorage).write(
		stateModule.createWorkspaceV2LocalState(GIST_ID, { baseline: document }),
	);
	appStore.appState.set({
		...workspaceData.createDefaultWorkspaceState(NOW),
		aggregates: [rule],
		activeGistId: GIST_ID,
	});
	authStore.authState.set({
		token: "browser-token",
		lastLoginAt: NOW,
		persistence: "session",
		migratedLegacyToken: false,
	});
	localStorage.failKey = "subman:workspace-mutation-queue:v1";

	const action = appStore.removeAggregate(rule.id, {
		cleanupUnreferencedOutputs: true,
	});
	expect(action.accepted).toBe(true);
	expect((await action.completion).status).toBe("rejected");
	let aggregateIds: string[] = [];
	const unsubscribe = appStore.appState.subscribe((state) => {
		aggregateIds = state.aggregates.map((aggregate) => aggregate.id);
	});
	expect(aggregateIds).toEqual([rule.id]);
	unsubscribe();

	localStorage.failKey = null;
	authStore.authState.set({
		token: null,
		lastLoginAt: NOW,
		persistence: "session",
		migratedLegacyToken: false,
	});
	const disconnectedAction = appStore.upsertNode({
		id: "node-after-logout",
		name: "Node after logout",
		type: "vless",
		raw: "vless://node-after-logout",
		tags: [],
		enabled: true,
		updatedAt: NOW,
		source: "single",
	});
	expect((await disconnectedAction.completion).status).toBe("auth-required");
	expect(localStorage.getItem("subman:workspace-mutation-queue:v1")).toBeNull();
});
