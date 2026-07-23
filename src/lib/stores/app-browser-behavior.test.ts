import * as bunTest from "bun:test";
import type { ClientExportProfile } from "$lib/models";

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

test("faulted destructive actions roll back while offline commits survive reload exactly once", async () => {
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
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { documentElement: { lang: "" } },
	});

	const [
		workspaceData,
		stateModule,
		persistenceModule,
		runtime,
		appStore,
		authStore,
	] = await Promise.all([
		import("$lib/workspace-data"),
		import("$lib/workspace-v2-state"),
		import("$lib/workspace-persistence"),
		import("$lib/workspace-persistence-browser"),
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
	const target = {
		id: "target-1",
		name: "Target One",
		ruleId: rule.id,
		fileName: "shared.txt",
		description: "",
		isPublic: false,
		lastPublishedAt: null,
		lastPublishedUrl: null,
		lastPublishTransitionAt: null,
		lastPublishTransitionFromFileName: null,
		lastPublishTransitionToFileName: null,
		lastPublishTransitionOutcome: null,
		updatedAt: NOW,
	};
	const profile = {
		id: "export-1",
		name: "Client Export",
		type: "sing-box-client" as const,
		ruleId: rule.id,
		fileName: "client.json",
		options: {
			listenAddress: "127.0.0.1",
			listenPort: 2080,
			inboundType: "mixed" as const,
			dnsMode: "conservative" as const,
			routeMode: "global-proxy" as const,
			includeExperimental: false,
			selectorTag: "PROXY",
			urlTestTag: "AUTO",
		},
		lastGeneratedAt: NOW,
		lastPublishedAt: NOW,
		lastPublishedUrl: "https://example.com/client.json",
		updatedAt: NOW,
	};
	const document = {
		version: 2 as const,
		schemaVersion: 2 as const,
		workspaceId: WORKSPACE_ID,
		revision: 0,
		updatedAt: NOW,
		lastMutationId: null,
		data: {
			nodes: [],
			subscriptions: [],
			aggregates: [rule],
			publishTargets: [target],
			clientExports: [profile],
		},
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
	const initialSnapshot = {
		...workspaceData.createDefaultWorkspaceState(NOW),
		aggregates: [rule],
		publishTargets: [target],
		clientExports: [profile],
		activeGistId: GIST_ID,
	};
	const record = persistenceModule.createEmptyWorkspacePersistenceRecord();
	record.snapshot = initialSnapshot;
	record.binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
		baseline: document,
	});
	const persistence = new persistenceModule.InMemoryWorkspacePersistence(
		record,
	);
	runtime.setBrowserWorkspacePersistenceForTest(persistence);
	await appStore.initializeAppStatePersistence();
	authStore.authState.set({
		token: null,
		lastLoginAt: NOW,
		persistence: "session",
		migratedLegacyToken: false,
	});
	const conflictingAction = appStore.upsertPublishTarget({
		...target,
		id: "target-2",
		name: "Target Two",
	});
	expect(conflictingAction.accepted).toBe(false);
	expect((await conflictingAction.completion).status).toBe("rejected");
	persistence.setFault("before-commit", "quota-exceeded");

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
	expect((await persistence.read()).workspaces).toEqual({});

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
	const disconnectedResult = await disconnectedAction.completion;
	expect(disconnectedResult.error).toBe(undefined);
	expect(disconnectedResult.status).toBe("queued");
	expect(localStorage.getItem("subman:workspace-mutation-queue:v1")).toBeNull();
	const committed = await persistence.read();
	expect(committed.workspaces[WORKSPACE_ID]?.mutations).toHaveLength(1);
	expect(committed.snapshot?.lastUpdated).toBe(
		committed.workspaces[WORKSPACE_ID]?.mutations[0]?.createdAt,
	);
	expect(committed.snapshot?.nodes.map((node) => node.id)).toEqual([
		"node-after-logout",
	]);

	const restarted = new persistenceModule.InMemoryWorkspacePersistence(
		committed,
	);
	runtime.setBrowserWorkspacePersistenceForTest(restarted);
	appStore.appState.set(workspaceData.createDefaultWorkspaceState(NOW));
	await appStore.initializeAppStatePersistence();
	let reloadedNodeIds: string[] = [];
	const unsubscribeReloaded = appStore.appState.subscribe((state) => {
		reloadedNodeIds = state.nodes.map((node) => node.id);
	});
	expect(reloadedNodeIds).toEqual(["node-after-logout"]);
	unsubscribeReloaded();
	expect(
		(await restarted.read()).workspaces[WORKSPACE_ID]?.mutations,
	).toHaveLength(1);

	const renamedAction = appStore.upsertClientExport({
		...profile,
		name: "Renamed Client Export",
	});
	expect((await renamedAction.completion).status).toBe("queued");
	let currentProfiles: ClientExportProfile[] = [];
	const unsubscribeRenamed = appStore.appState.subscribe((state) => {
		currentProfiles = state.clientExports;
	});
	expect(currentProfiles[0]?.lastGeneratedAt).toBe(NOW);
	expect(currentProfiles[0]?.lastPublishedAt).toBe(NOW);
	expect(currentProfiles[0]?.lastPublishedUrl).toBe(
		"https://example.com/client.json",
	);
	unsubscribeRenamed();

	const changedAction = appStore.upsertClientExport({
		...profile,
		name: "Renamed Client Export",
		options: { ...profile.options, listenPort: 2081 },
	});
	expect((await changedAction.completion).status).toBe("queued");
	const unsubscribeChanged = appStore.appState.subscribe((state) => {
		currentProfiles = state.clientExports;
	});
	expect(currentProfiles[0]?.lastGeneratedAt).toBeNull();
	expect(currentProfiles[0]?.lastPublishedAt).toBeNull();
	expect(currentProfiles[0]?.lastPublishedUrl).toBeNull();
	unsubscribeChanged();
	runtime.setBrowserWorkspacePersistenceForTest(null);
});
