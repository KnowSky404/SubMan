import * as bunTest from "bun:test";
import type { ClientExportProfile } from "$lib/models";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";

const { expect, test } = bunTest;
const bun = bunTest as unknown as {
	mock: {
		module: (specifier: string, factory: () => unknown) => void;
	};
	spyOn: <T extends object, K extends keyof T>(
		target: T,
		method: K,
	) => {
		mockImplementation: (implementation: T[K]) => void;
		mockRestore: () => void;
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
		cloudStatus,
	] = await Promise.all([
		import("$lib/workspace-data"),
		import("$lib/workspace-v2-state"),
		import("$lib/workspace-persistence"),
		import("$lib/workspace-persistence-browser"),
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/workspace-cloud-status"),
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
	let automaticCommitCount = 0;
	const commitAutomaticAction =
		persistence.commitAutomaticAction.bind(persistence);
	persistence.commitAutomaticAction = async (input) => {
		automaticCommitCount += 1;
		return commitAutomaticAction(input);
	};
	runtime.setBrowserWorkspacePersistenceForTest(persistence);
	await appStore.initializeAppStatePersistence();
	authStore.authState.set({
		token: null,
		lastLoginAt: NOW,
		persistence: "session",
		migratedLegacyToken: false,
	});
	cloudStatus.workspaceCloudStatus.set({ phase: "ready", message: null });
	const conflictingAction = appStore.upsertPublishTarget({
		...target,
		id: "target-2",
		name: "Target Two",
	});
	expect(conflictingAction.submitted).toBe(false);
	expect((await conflictingAction.completion).status).toBe(
		"rejected-before-durable-commit",
	);
	expect(automaticCommitCount).toBe(0);
	expect((await persistence.read()).snapshot).toEqual(initialSnapshot);
	let visibleTargetIds: string[] = [];
	const unsubscribeRejected = appStore.appState.subscribe((state) => {
		visibleTargetIds = state.publishTargets.map((item) => item.id);
	});
	expect(visibleTargetIds).toEqual([target.id]);
	unsubscribeRejected();
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
	expect(disconnectedAction.submitted).toBe(false);
	expect((await disconnectedAction.completion).status).toBe(
		"rejected-before-durable-commit",
	);
	expect((await persistence.read()).workspaces).toEqual({});
	authStore.authState.update((state) => ({ ...state, token: "test-token" }));
	persistence.setFault("before-commit", "quota-exceeded");

	const action = appStore.removeAggregate(rule.id, {
		cleanupUnreferencedOutputs: true,
	});
	expect(action.submitted).toBe(true);
	expect((await action.completion).status).toBe(
		"rejected-before-durable-commit",
	);
	let aggregateIds: string[] = [];
	const unsubscribe = appStore.appState.subscribe((state) => {
		aggregateIds = state.aggregates.map((aggregate) => aggregate.id);
	});
	expect(aggregateIds).toEqual([rule.id]);
	unsubscribe();
	expect((await persistence.read()).workspaces).toEqual({});

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("offline");
	}) as typeof fetch;
	const offlineAction = appStore.upsertNode({
		id: "node-offline",
		name: "Node offline",
		type: "vless",
		raw: "vless://node-offline",
		tags: [],
		enabled: true,
		updatedAt: NOW,
		source: "single",
	});
	const offlineResult = await offlineAction.completion;
	globalThis.fetch = originalFetch;
	expect(offlineResult.status).toBe("retry-scheduled");
	expect(localStorage.getItem("subman:workspace-mutation-queue:v1")).toBeNull();
	const committed = await persistence.read();
	expect(committed.workspaces[WORKSPACE_ID]?.mutations).toHaveLength(1);
	expect(committed.snapshot?.lastUpdated).toBe(
		committed.workspaces[WORKSPACE_ID]?.mutations[0]?.createdAt,
	);
	expect(committed.snapshot?.nodes.map((node) => node.id)).toEqual([
		"node-offline",
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
	expect(reloadedNodeIds).toEqual(["node-offline"]);
	unsubscribeReloaded();
	expect(
		(await restarted.read()).workspaces[WORKSPACE_ID]?.mutations,
	).toHaveLength(1);

	const blockedAction = appStore.upsertClientExport({
		...profile,
		name: "Renamed Client Export",
	});
	const blockedResult = await blockedAction.completion;
	expect(blockedResult.status).toBe("rejected-before-durable-commit");
	expect("code" in blockedResult ? blockedResult.code : null).toBe(
		"workspace_sync_pending",
	);
	const queued = (await restarted.read()).workspaces[WORKSPACE_ID]?.mutations;
	expect(queued).toHaveLength(1);
	const queuedId = queued?.[0]?.mutationId;
	expect(queuedId).toBe(
		committed.workspaces[WORKSPACE_ID]?.mutations[0]?.mutationId,
	);
	await restarted.discardWorkspaceQueue({
		workspaceId: WORKSPACE_ID,
		snapshot: initialSnapshot,
		binding: record.binding ?? undefined,
	});
	await runtime.refreshBrowserWorkspacePersistence();
	const { applyWorkspaceMutation } = await import("$lib/workspace-mutation");
	let remoteDocument: WorkspaceDocumentV2 = document;
	globalThis.fetch = (async (_input, init) => {
		const mutation = JSON.parse(String(init?.body));
		const applied = applyWorkspaceMutation(remoteDocument, mutation, {
			committedAt: mutation.createdAt,
			gist: { id: GIST_ID, files: [] },
		});
		remoteDocument = applied.document;
		return Response.json({
			document: remoteDocument,
			mutationId: mutation.mutationId,
			workspaceId: WORKSPACE_ID,
			committedRevision: remoteDocument.revision,
			committedAt: remoteDocument.updatedAt,
			receipt: applied.receipt,
			status: "committed",
		});
	}) as typeof fetch;
	const renamedAction = appStore.upsertClientExport({
		...profile,
		name: "Renamed Client Export",
	});
	expect((await renamedAction.completion).status).toBe("remote-committed");
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
	expect((await changedAction.completion).status).toBe("remote-committed");
	const unsubscribeChanged = appStore.appState.subscribe((state) => {
		currentProfiles = state.clientExports;
	});
	expect(currentProfiles[0]?.lastGeneratedAt).toBeNull();
	expect(currentProfiles[0]?.lastPublishedAt).toBeNull();
	expect(currentProfiles[0]?.lastPublishedUrl).toBeNull();
	unsubscribeChanged();
	globalThis.fetch = originalFetch;
	runtime.setBrowserWorkspacePersistenceForTest(null);
});

test("cloud edits require a ready automatic binding and complete only after remote acknowledgement", async () => {
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: new FailingStorage(),
	});
	Object.defineProperty(globalThis, "sessionStorage", {
		configurable: true,
		value: new FailingStorage(),
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
		cloudStatus,
		mutations,
	] = await Promise.all([
		import("$lib/workspace-data"),
		import("$lib/workspace-v2-state"),
		import("$lib/workspace-persistence"),
		import("$lib/workspace-persistence-browser"),
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/workspace-cloud-status"),
		import("$lib/workspace-mutation"),
	]);
	const baseline: WorkspaceDocumentV2 = {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision: 0,
		updatedAt: NOW,
		lastMutationId: null,
		data: {
			nodes: [],
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
	const record = persistenceModule.createEmptyWorkspacePersistenceRecord();
	record.snapshot = stateModule.hydrateAppStateFromWorkspaceDocument(
		workspaceData.createDefaultWorkspaceState(NOW),
		baseline,
		GIST_ID,
	);
	record.binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
		baseline,
	});
	const persistence = new persistenceModule.InMemoryWorkspacePersistence(
		record,
	);
	runtime.setBrowserWorkspacePersistenceForTest(persistence);
	await appStore.initializeAppStatePersistence();
	authStore.authState.update((state) => ({ ...state, token: "test-token" }));
	const node = {
		id: "node-cloud",
		name: "Cloud Node",
		type: "vless" as const,
		raw: "vless://cloud",
		tags: [],
		enabled: true,
		updatedAt: NOW,
		source: "single" as const,
	};
	cloudStatus.workspaceCloudStatus.set({ phase: "loading", message: null });
	const loading = appStore.upsertNode(node);
	expect(loading.submitted).toBe(false);
	const loadingResult = await loading.completion;
	expect("code" in loadingResult ? loadingResult.code : null).toBe(
		"workspace_cloud_not_ready",
	);
	cloudStatus.workspaceCloudStatus.set({ phase: "ready", message: null });
	for (const syncMode of ["manual", "paused-conflict"] as const) {
		await persistence.rebindWorkspace({
			snapshot: record.snapshot,
			binding: stateModule.createWorkspaceV2LocalState(GIST_ID, {
				baseline,
				syncMode,
			}),
		});
		await runtime.refreshBrowserWorkspacePersistence();
		const action = appStore.upsertNode(node);
		expect(action.submitted).toBe(false);
		const actionResult = await action.completion;
		expect("code" in actionResult ? actionResult.code : null).toBe(
			"workspace_sync_required",
		);
	}
	await persistence.rebindWorkspace({
		snapshot: record.snapshot,
		binding: record.binding,
	});
	await runtime.refreshBrowserWorkspacePersistence();
	let releaseRemote = () => {};
	const remoteGate = new Promise<void>((resolve) => {
		releaseRemote = resolve;
	});
	let requestArrived = () => {};
	const requestStarted = new Promise<void>((resolve) => {
		requestArrived = resolve;
	});
	let requestCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (_input, init) => {
		requestCount += 1;
		const mutation = mutations.parseWorkspaceMutation(
			JSON.parse(String(init?.body)),
		);
		requestArrived();
		await remoteGate;
		const applied = mutations.applyWorkspaceMutation(baseline, mutation, {
			committedAt: mutation.createdAt,
			gist: { id: GIST_ID, files: [] },
		});
		return Response.json({
			document: applied.document,
			mutationId: mutation.mutationId,
			workspaceId: WORKSPACE_ID,
			committedRevision: applied.document.revision,
			committedAt: applied.document.updatedAt,
			receipt: applied.receipt,
			status: "committed",
		});
	}) as typeof fetch;
	try {
		const action = appStore.upsertNode(node);
		let completed = false;
		void action.completion.then(() => {
			completed = true;
		});
		await requestStarted;
		expect(completed).toBe(false);
		expect((await persistence.read()).binding?.revision).toBe(0);
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations,
		).toHaveLength(1);
		releaseRemote();
		const result = await action.completion;
		expect(result.status).toBe("remote-committed");
		expect("revision" in result ? result.revision : null).toBe(1);
		expect(requestCount).toBe(1);
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations,
		).toEqual([]);
		const commitAutomaticAction =
			persistence.commitAutomaticAction.bind(persistence);
		persistence.commitAutomaticAction = async (input) => {
			const committed = await commitAutomaticAction(input);
			authStore.authState.update((state) => ({ ...state, token: null }));
			return committed;
		};
		const logoutAction = appStore.upsertNode({
			...node,
			name: "Changed before logout",
		});
		expect((await logoutAction.completion).status).toBe("local-durable-queued");
		expect(requestCount).toBe(1);
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations,
		).toHaveLength(1);
	} finally {
		releaseRemote();
		globalThis.fetch = originalFetch;
		runtime.setBrowserWorkspacePersistenceForTest(null);
	}
});

test("a downstream dispatch rejection cannot relabel a durable cloud edit as unsaved", async () => {
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: new FailingStorage(),
	});
	Object.defineProperty(globalThis, "sessionStorage", {
		configurable: true,
		value: new FailingStorage(),
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
		cloudStatus,
		dispatcher,
	] = await Promise.all([
		import("$lib/workspace-data"),
		import("$lib/workspace-v2-state"),
		import("$lib/workspace-persistence"),
		import("$lib/workspace-persistence-browser"),
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/workspace-cloud-status"),
		import("$lib/workspace-browser-session-v2"),
	]);
	const baseline: WorkspaceDocumentV2 = {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision: 0,
		updatedAt: NOW,
		lastMutationId: null,
		data: {
			nodes: [],
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
	const record = persistenceModule.createEmptyWorkspacePersistenceRecord();
	record.snapshot = stateModule.hydrateAppStateFromWorkspaceDocument(
		workspaceData.createDefaultWorkspaceState(NOW),
		baseline,
		GIST_ID,
	);
	record.binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
		baseline,
	});
	const persistence = new persistenceModule.InMemoryWorkspacePersistence(
		record,
	);
	runtime.setBrowserWorkspacePersistenceForTest(persistence);
	await appStore.initializeAppStatePersistence();
	authStore.authState.update((state) => ({ ...state, token: "test-token" }));
	cloudStatus.workspaceCloudStatus.set({ phase: "ready", message: null });
	const dispatch = bun.spyOn(
		dispatcher,
		"commitQueuedBrowserWorkspaceMutation",
	);
	dispatch.mockImplementation(async ({ mutationId }) => ({
		status: "rejected-before-durable-commit",
		durable: false,
		mutationId,
		code: "workspace_settlement_read_failed",
		message: "Injected dispatch initialization failure",
	}));
	try {
		const action = appStore.upsertNode({
			id: "node-durable-dispatch",
			name: "Durable Dispatch Node",
			type: "vless",
			raw: "vless://durable-dispatch",
			tags: [],
			enabled: true,
			updatedAt: NOW,
			source: "single",
		});
		const result = await action.completion;
		expect(result.status).toBe("local-durable-queued");
		expect(result.durable).toBe(true);
		const stored = await persistence.read();
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toHaveLength(1);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations[0]?.mutationId).toBe(
			result.mutationId,
		);
		expect(stored.snapshot?.nodes.map((node) => node.id)).toEqual([
			"node-durable-dispatch",
		]);
	} finally {
		dispatch.mockRestore();
		runtime.setBrowserWorkspacePersistenceForTest(null);
	}
});

test("a stale browser cache rebases one business intent onto the latest IndexedDB snapshot", async () => {
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
		cloudStatus,
	] = await Promise.all([
		import("$lib/workspace-data"),
		import("$lib/workspace-v2-state"),
		import("$lib/workspace-persistence"),
		import("$lib/workspace-persistence-browser"),
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/workspace-cloud-status"),
	]);
	const baseline = {
		version: 2 as const,
		schemaVersion: 2 as const,
		workspaceId: WORKSPACE_ID,
		revision: 0,
		updatedAt: NOW,
		lastMutationId: null,
		data: {
			nodes: [],
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
	const initial = stateModule.hydrateAppStateFromWorkspaceDocument(
		workspaceData.createDefaultWorkspaceState(NOW),
		baseline,
		GIST_ID,
	);
	const record = persistenceModule.createEmptyWorkspacePersistenceRecord();
	record.snapshot = initial;
	record.binding = stateModule.createWorkspaceV2LocalState(GIST_ID, {
		baseline,
	});
	const persistence = new persistenceModule.InMemoryWorkspacePersistence(
		record,
	);
	runtime.setBrowserWorkspacePersistenceForTest(persistence);
	await appStore.initializeAppStatePersistence();
	authStore.authState.update((state) => ({ ...state, token: "test-token" }));
	cloudStatus.workspaceCloudStatus.set({ phase: "ready", message: null });

	const peerNode = {
		id: "node-peer",
		name: "Peer Node",
		type: "vless" as const,
		raw: "vless://peer",
		tags: [],
		enabled: true,
		updatedAt: NOW,
		source: "single" as const,
	};
	const peerDocument = {
		...baseline,
		revision: 1,
		lastMutationId: "b0000000-0000-4000-8000-000000000201",
		data: { ...baseline.data, nodes: [peerNode] },
	};
	await persistence.rebindWorkspace({
		snapshot: stateModule.hydrateAppStateFromWorkspaceDocument(
			initial,
			peerDocument,
			GIST_ID,
		),
		binding: stateModule.createWorkspaceV2LocalState(GIST_ID, {
			baseline: peerDocument,
		}),
	});

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("offline");
	}) as typeof fetch;
	const action = appStore.upsertNode({
		id: "node-local",
		name: "Local Node",
		type: "vless",
		raw: "vless://local",
		tags: [],
		enabled: true,
		updatedAt: NOW,
		source: "single",
	});
	expect(action.submitted).toBe(true);
	const result = await action.completion;
	globalThis.fetch = originalFetch;
	expect(result.status).toBe("retry-scheduled");
	const stored = await persistence.read();
	expect(stored.snapshot?.nodes.map((node) => node.id).sort()).toEqual([
		"node-local",
		"node-peer",
	]);
	expect(stored.workspaces[WORKSPACE_ID]?.mutations[0]?.expectedRevision).toBe(
		1,
	);
	expect(stored.quarantines).toEqual([]);
	runtime.setBrowserWorkspacePersistenceForTest(null);
});
