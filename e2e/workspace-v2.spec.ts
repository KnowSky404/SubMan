import {
	type BrowserContext,
	expect,
	type Page,
	type Route,
	test,
} from "@playwright/test";

const DATABASE_NAME = "subman-workspace";
const DATABASE_VERSION = 1;
const STORE_NAME = "workspace-state";
const ROOT_KEY = "root";
const SESSION_AUTH_KEY = "subman:auth:session:v2";
const PERSISTENT_AUTH_KEY = "subman:auth:v2";
const NOW = "2026-07-23T10:00:00.000Z";
const LATER = "2026-07-23T10:01:00.000Z";
const GIST_ID = "gist-e2e";
const WORKSPACE_ID = `gist:${GIST_ID}`;
const EMPTY_DATA = {
	nodes: [],
	subscriptions: [],
	aggregates: [],
	publishTargets: [],
	clientExports: [],
};

type JsonRecord = Record<string, unknown>;

function workspaceDocument(
	options: {
		workspaceId?: string;
		revision?: number;
		lastMutationId?: string | null;
		updatedAt?: string;
		data?: typeof EMPTY_DATA | JsonRecord;
		tombstones?: JsonRecord;
	} = {},
): JsonRecord {
	const workspaceId = options.workspaceId ?? WORKSPACE_ID;
	const revision = options.revision ?? 0;
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId,
		revision,
		updatedAt: options.updatedAt ?? NOW,
		lastMutationId:
			options.lastMutationId === undefined
				? revision === 0
					? null
					: "a0000000-0000-4000-8000-000000000000"
				: options.lastMutationId,
		data: options.data ?? structuredClone(EMPTY_DATA),
		tombstones: options.tombstones ?? {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
}

function snapshot(
	options: {
		gistId?: string | null;
		data?: typeof EMPTY_DATA | JsonRecord;
		lastUpdated?: string;
	} = {},
): JsonRecord {
	return {
		...(options.data ?? structuredClone(EMPTY_DATA)),
		gists: [],
		activeGistId: options.gistId === undefined ? GIST_ID : options.gistId,
		activeGistFile: "subman.json",
		lastUpdated: options.lastUpdated ?? NOW,
	};
}

function binding(
	options: {
		gistId?: string;
		baseline?: JsonRecord | null;
		conflictBaseline?: JsonRecord | null;
		syncMode?: "automatic" | "manual" | "paused-conflict";
	} = {},
): JsonRecord {
	const gistId = options.gistId ?? GIST_ID;
	const baselineValue =
		options.baseline === undefined
			? workspaceDocument({ workspaceId: `gist:${gistId}` })
			: options.baseline;
	return {
		version: 2,
		gistId,
		fileName: "subman.json",
		workspaceId: `gist:${gistId}`,
		revision:
			baselineValue && typeof baselineValue.revision === "number"
				? baselineValue.revision
				: null,
		syncMode: options.syncMode ?? "automatic",
		baseline: baselineValue,
		conflictBaseline: options.conflictBaseline ?? null,
	};
}

function reconcileMutation(
	options: {
		mutationId?: string;
		workspaceId?: string;
		expectedRevision?: number;
		createdAt?: string;
		data?: typeof EMPTY_DATA | JsonRecord;
	} = {},
): JsonRecord {
	const expectedRevision = options.expectedRevision ?? 0;
	return {
		mutationId: options.mutationId ?? "a0000000-0000-4000-8000-000000000001",
		workspaceId: options.workspaceId ?? WORKSPACE_ID,
		expectedRevision,
		source: "browser",
		createdAt: options.createdAt ?? NOW,
		kind: "workspace.reconcile",
		payload: {
			baselineRevision: expectedRevision,
			data: options.data ?? structuredClone(EMPTY_DATA),
		},
	};
}

function nodeFixture(
	options: { name?: string; raw?: string; updatedAt?: string } = {},
): JsonRecord {
	return {
		id: "node-e2e",
		name: options.name ?? "E2E Node",
		type: "vless",
		raw: options.raw ?? "vless://baseline.example",
		tags: [],
		enabled: true,
		updatedAt: options.updatedAt ?? NOW,
		source: "single",
	};
}

function aggregateData(): JsonRecord {
	const node = nodeFixture();
	return {
		...structuredClone(EMPTY_DATA),
		nodes: [node],
		aggregates: [
			{
				id: "aggregate-e2e",
				name: "E2E Aggregate",
				nodeIds: [node.id],
				subscriptionIds: [],
				excludeTagIds: [],
				renameMap: {},
				renameRules: [],
				customRegionFlagMap: "",
				allowedTypes: [],
				prependRegionFlags: true,
				sortMode: "none",
				sortPriority: "",
				updatedAt: NOW,
			},
		],
		publishTargets: [
			{
				id: "target-e2e",
				name: "E2E Target",
				ruleId: "aggregate-e2e",
				fileName: "aggregate-e2e.txt",
				description: "",
				isPublic: false,
				lastPublishedAt: null,
				lastPublishedUrl: null,
				lastPublishTransitionAt: null,
				lastPublishTransitionFromFileName: null,
				lastPublishTransitionToFileName: null,
				lastPublishTransitionOutcome: null,
				updatedAt: NOW,
			},
		],
	};
}

function nodeUpsertMutation(
	node: JsonRecord,
	options: {
		mutationId?: string;
		expectedRevision?: number;
		createdAt?: string;
	} = {},
): JsonRecord {
	return {
		mutationId: options.mutationId ?? "a0000000-0000-4000-8000-000000000002",
		workspaceId: WORKSPACE_ID,
		expectedRevision: options.expectedRevision ?? 1,
		source: "browser",
		createdAt: options.createdAt ?? LATER,
		kind: "node.upsert",
		payload: { operation: "replace", node },
	};
}

function queue(
	workspaceId: string,
	mutations: JsonRecord[],
	blocked: JsonRecord | null = null,
): JsonRecord {
	return {
		workspaceId,
		mutations,
		delivery: {
			retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
			blocked,
			deadLetters: [],
		},
	};
}

function persistenceRecord(
	options: {
		snapshot?: JsonRecord | null;
		binding?: JsonRecord | null;
		workspaces?: Record<string, JsonRecord>;
		leases?: Record<string, JsonRecord>;
		quarantines?: JsonRecord[];
		quarantinePayloads?: Record<string, string>;
		nextFencingToken?: number;
	} = {},
): JsonRecord {
	return {
		version: 1,
		snapshot: options.snapshot === undefined ? snapshot() : options.snapshot,
		binding: options.binding === undefined ? binding() : options.binding,
		workspaces: options.workspaces ?? {},
		leases: options.leases ?? {},
		quarantines: options.quarantines ?? [],
		quarantinePayloads: options.quarantinePayloads ?? {},
		migration: {
			version: 1,
			phase: "confirmed",
			startedAt: NOW,
			copiedAt: NOW,
			validatedAt: NOW,
			updatedAt: NOW,
			confirmedAt: NOW,
			cleanupCompletedAt: NOW,
		},
		nextFencingToken: options.nextFencingToken ?? 1,
	};
}

async function seedIndexedDb(page: Page, record: JsonRecord): Promise<void> {
	await page.goto("/__e2e_seed__");
	await page.evaluate(
		async ({ databaseName, databaseVersion, storeName, rootKey, value }) => {
			await new Promise<void>((resolve, reject) => {
				const request = indexedDB.deleteDatabase(databaseName);
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
				request.onblocked = () =>
					reject(new Error("IndexedDB deletion was blocked"));
			});
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName, databaseVersion);
				request.onupgradeneeded = () => {
					if (!request.result.objectStoreNames.contains(storeName)) {
						request.result.createObjectStore(storeName);
					}
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(storeName, "readwrite");
				transaction.objectStore(storeName).put(value, rootKey);
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			database.close();
		},
		{
			databaseName: DATABASE_NAME,
			databaseVersion: DATABASE_VERSION,
			storeName: STORE_NAME,
			rootKey: ROOT_KEY,
			value: record,
		},
	);
}

async function readIndexedDb(page: Page): Promise<JsonRecord> {
	return page.evaluate(
		async ({ databaseName, databaseVersion, storeName, rootKey }) => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName, databaseVersion);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const result = await new Promise<unknown>((resolve, reject) => {
				const transaction = database.transaction(storeName, "readonly");
				const request = transaction.objectStore(storeName).get(rootKey);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			database.close();
			return result as JsonRecord;
		},
		{
			databaseName: DATABASE_NAME,
			databaseVersion: DATABASE_VERSION,
			storeName: STORE_NAME,
			rootKey: ROOT_KEY,
		},
	);
}

async function failNextPersistencePut(
	page: Page,
	name: "AbortError" | "QuotaExceededError",
): Promise<void> {
	await page.evaluate(
		({ storeName, errorName }) => {
			const original = IDBObjectStore.prototype.put;
			let armed = true;
			Object.defineProperty(IDBObjectStore.prototype, "put", {
				configurable: true,
				writable: true,
				value(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
					if (armed && this.name === storeName) {
						armed = false;
						throw new DOMException(
							"Injected E2E persistence failure",
							errorName,
						);
					}
					return key === undefined
						? original.call(this, value)
						: original.call(this, value, key);
				},
			});
		},
		{ storeName: STORE_NAME, errorName: name },
	);
}

async function holdPersistenceWrites(page: Page): Promise<void> {
	await page.evaluate(
		async ({ databaseName, databaseVersion, storeName, rootKey }) => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName, databaseVersion);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const transaction = database.transaction(storeName, "readwrite");
			const store = transaction.objectStore(storeName);
			let released = false;
			const global = globalThis as typeof globalThis & {
				__submanReleasePersistenceWrite?: () => void;
			};
			global.__submanReleasePersistenceWrite = () => {
				released = true;
				delete global.__submanReleasePersistenceWrite;
			};
			const keepAlive = () => {
				const request = store.get(rootKey);
				request.onsuccess = () => {
					if (!released) keepAlive();
				};
			};
			keepAlive();
			transaction.oncomplete = () => database.close();
			transaction.onabort = () => database.close();
		},
		{
			databaseName: DATABASE_NAME,
			databaseVersion: DATABASE_VERSION,
			storeName: STORE_NAME,
			rootKey: ROOT_KEY,
		},
	);
}

async function releasePersistenceWrites(page: Page): Promise<void> {
	await page.evaluate(() => {
		const global = globalThis as typeof globalThis & {
			__submanReleasePersistenceWrite?: () => void;
		};
		global.__submanReleasePersistenceWrite?.();
	});
}

async function seedAuth(
	page: Page,
	options: { session?: string; persistent?: string },
): Promise<void> {
	await page.evaluate(
		({ sessionKey, persistentKey, sessionToken, persistentToken, now }) => {
			const envelope = (token: string) =>
				JSON.stringify({ version: 2, token, lastLoginAt: now });
			if (sessionToken)
				sessionStorage.setItem(sessionKey, envelope(sessionToken));
			if (persistentToken)
				localStorage.setItem(persistentKey, envelope(persistentToken));
		},
		{
			sessionKey: SESSION_AUTH_KEY,
			persistentKey: PERSISTENT_AUTH_KEY,
			sessionToken: options.session,
			persistentToken: options.persistent,
			now: NOW,
		},
	);
}

async function installNetworkGuard(context: BrowserContext): Promise<void> {
	await context.route("**/__e2e_seed__", (route) =>
		route.fulfill({
			status: 200,
			contentType: "text/html",
			body: "<!doctype html><title>SubMan E2E seed</title>",
		}),
	);
	await context.route("https://api.github.com/**", (route) =>
		route.abort("blockedbyclient"),
	);
}

async function addNode(page: Page, name: string, raw: string): Promise<void> {
	await page
		.locator(".gh-page-header")
		.getByRole("button", { name: "New Resource" })
		.click();
	await page.getByLabel("Name").fill(name);
	await page.getByLabel("Raw URI").fill(raw);
	await page.getByRole("button", { name: "Save Resource" }).click();
}

function committedResult(
	mutation: JsonRecord,
	baseData: JsonRecord = structuredClone(EMPTY_DATA),
): JsonRecord {
	const payload = mutation.payload as JsonRecord;
	let data = structuredClone(baseData) as JsonRecord;
	let receipt: JsonRecord | null = null;
	if (mutation.kind === "workspace.reconcile") {
		data = payload.data as JsonRecord;
	} else if (mutation.kind === "node.upsert") {
		const node = payload.node as JsonRecord;
		const nodes = (data.nodes as JsonRecord[]).filter(
			(item) => item.id !== node.id,
		);
		data = {
			...data,
			nodes: [{ ...node, updatedAt: mutation.createdAt }, ...nodes],
		};
		receipt = { kind: mutation.kind, entityId: node.id };
	} else if (mutation.kind === "publish-target.upsert") {
		const target = payload.target as JsonRecord;
		const targets = (data.publishTargets as JsonRecord[]).filter(
			(item) => item.id !== target.id,
		);
		data = {
			...data,
			publishTargets: [
				{ ...target, updatedAt: mutation.createdAt },
				...targets,
			],
		};
		receipt = { kind: mutation.kind, entityId: target.id };
	} else if (mutation.kind === "aggregate.publish") {
		const targetId = payload.targetId;
		data = {
			...data,
			publishTargets: (data.publishTargets as JsonRecord[]).map((target) =>
				target.id === targetId
					? {
							...target,
							lastPublishedAt: mutation.createdAt,
							lastPublishedUrl: `https://gist.githubusercontent.com/e2e/${GIST_ID}/raw/${String((payload.output as JsonRecord).fileName)}`,
							updatedAt: mutation.createdAt,
						}
					: target,
			),
		};
		receipt = { kind: mutation.kind, entityId: targetId };
	} else {
		throw new Error(
			`Unsupported E2E committed mutation: ${String(mutation.kind)}`,
		);
	}
	const committedRevision = Number(mutation.expectedRevision) + 1;
	return {
		document: workspaceDocument({
			workspaceId: String(mutation.workspaceId),
			revision: committedRevision,
			lastMutationId: String(mutation.mutationId),
			updatedAt: String(mutation.createdAt),
			data,
		}),
		mutationId: mutation.mutationId,
		workspaceId: mutation.workspaceId,
		committedRevision,
		committedAt: mutation.createdAt,
		receipt,
		status: "committed",
	};
}

async function fulfillCommitted(
	route: Route,
	mutation: JsonRecord,
	baseData?: JsonRecord,
): Promise<void> {
	await route.fulfill({
		status: 200,
		json: committedResult(mutation, baseData),
	});
}

async function expireLease(page: Page, leaseName: string): Promise<void> {
	await page.evaluate(
		async ({ databaseName, databaseVersion, storeName, rootKey, name }) => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName, databaseVersion);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(storeName, "readwrite");
				const store = transaction.objectStore(storeName);
				const read = store.get(rootKey);
				read.onsuccess = () => {
					const record = read.result as JsonRecord;
					const leases = record.leases as JsonRecord;
					const lease = leases[name] as JsonRecord;
					leases[name] = { ...lease, expiresAt: 0, heartbeatAt: 0 };
					store.put(record, rootKey);
				};
				read.onerror = () => reject(read.error);
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			database.close();
		},
		{
			databaseName: DATABASE_NAME,
			databaseVersion: DATABASE_VERSION,
			storeName: STORE_NAME,
			rootKey: ROOT_KEY,
			name: leaseName,
		},
	);
}

test.beforeEach(async ({ context }) => {
	await installNetworkGuard(context);
});

test("rolls back the visible node when the IndexedDB transaction fails", async ({
	page,
}) => {
	await seedIndexedDb(
		page,
		persistenceRecord({ snapshot: snapshot({ gistId: null }), binding: null }),
	);
	await page.goto("/nodes");
	await failNextPersistencePut(page, "QuotaExceededError");

	await addNode(page, "Must Roll Back", "vless://rollback.example");

	const rejection = page.getByText(/Workspace change was not saved/);
	await expect(rejection).toHaveCount(1);
	await expect(rejection).toBeVisible();
	await expect(page.getByText("Resource added", { exact: true })).toHaveCount(
		0,
	);
	await expect(page.getByLabel("Name")).toHaveValue("Must Roll Back");
	await expect(page.getByLabel("Raw URI")).toHaveValue(
		"vless://rollback.example",
	);
	await expect(
		page.getByRole("button", { name: "Save Resource" }),
	).toBeVisible();
	await expect(page.getByText("Must Roll Back", { exact: true })).toHaveCount(
		0,
	);
	await expect(page.getByText("0 nodes", { exact: true })).toBeVisible();
	const stored = await readIndexedDb(page);
	expect((stored.snapshot as JsonRecord).nodes).toEqual([]);
});

test("keeps an edit modal and draft open when the transaction aborts", async ({
	page,
}) => {
	const existing = nodeFixture();
	const data = { ...structuredClone(EMPTY_DATA), nodes: [existing] };
	await seedIndexedDb(
		page,
		persistenceRecord({
			snapshot: snapshot({ gistId: null, data }),
			binding: null,
		}),
	);
	await page.goto("/nodes");
	await failNextPersistencePut(page, "AbortError");
	await page.getByRole("button", { name: "Edit node" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Unsaved Edit");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();

	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel("Name")).toHaveValue("Unsaved Edit");
	await expect(
		page.getByText(existing.name as string, { exact: true }),
	).toBeVisible();
	await expect(page.getByText("Node updated", { exact: true })).toHaveCount(0);
	await expect(page.getByText(/Workspace change was not saved/)).toHaveCount(1);
	const stored = await readIndexedDb(page);
	expect(((stored.snapshot as JsonRecord).nodes as JsonRecord[])[0]?.name).toBe(
		existing.name,
	);
});

test("keeps a node visible and loading until a failed delete settles", async ({
	page,
}) => {
	const existing = nodeFixture();
	const data = { ...structuredClone(EMPTY_DATA), nodes: [existing] };
	await seedIndexedDb(
		page,
		persistenceRecord({
			snapshot: snapshot({ gistId: null, data }),
			binding: null,
		}),
	);
	await page.goto("/nodes");
	await expect(
		page.getByText(existing.name as string, { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Delete node" }).click();
	await failNextPersistencePut(page, "AbortError");
	await holdPersistenceWrites(page);

	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Delete", exact: true })
		.click();
	const deleteButton = page.getByRole("button", { name: "Delete node" });
	await expect(deleteButton).toBeDisabled();
	await expect(page.getByText("Deleting...", { exact: true })).toBeVisible();
	await expect(
		page.getByText(existing.name as string, { exact: true }),
	).toBeVisible();

	await releasePersistenceWrites(page);
	await expect(page.getByText(/Workspace change was not saved/)).toHaveCount(1);
	await expect(deleteButton).toBeEnabled();
	await expect(
		page.getByText(existing.name as string, { exact: true }),
	).toBeVisible();
	await expect(page.getByText(`Deleted ${String(existing.name)}`)).toHaveCount(
		0,
	);
	let stored = await readIndexedDb(page);
	expect(((stored.snapshot as JsonRecord).nodes as JsonRecord[])[0]?.id).toBe(
		existing.id,
	);

	await deleteButton.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Delete", exact: true })
		.click();
	await expect(
		page.getByText(existing.name as string, { exact: true }),
	).toHaveCount(0);
	stored = await readIndexedDb(page);
	expect((stored.snapshot as JsonRecord).nodes).toEqual([]);
});

test("retains an import payload when IndexedDB rejects the transaction", async ({
	page,
}) => {
	await seedIndexedDb(
		page,
		persistenceRecord({ snapshot: snapshot({ gistId: null }), binding: null }),
	);
	const imported = {
		version: 2,
		kind: "subman-business-configuration",
		exportedAt: NOW,
		data: {
			...structuredClone(EMPTY_DATA),
			nodes: [nodeFixture({ name: "Imported but rejected" })],
		},
	};
	const payload = JSON.stringify(imported);
	await page.goto("/auth");
	await page.locator("#settings-payload").fill(payload);
	await failNextPersistencePut(page, "QuotaExceededError");
	await page.getByRole("button", { name: "Import", exact: true }).click();

	await expect(page.locator("#settings-payload")).toHaveValue(payload);
	await expect(page.getByText("Config imported", { exact: true })).toHaveCount(
		0,
	);
	await expect(page.getByText(/Workspace change was not saved/)).toHaveCount(1);
	const stored = await readIndexedDb(page);
	expect((stored.snapshot as JsonRecord).nodes).toEqual([]);
});

test("keeps one mutation ID across offline enqueue, reload, and recovery", async ({
	context,
	page,
}) => {
	await seedIndexedDb(page, persistenceRecord());
	await seedAuth(page, { session: "fake-session-token" });
	let offline = true;
	const attempts: JsonRecord[] = [];
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		const mutation = route.request().postDataJSON() as JsonRecord;
		attempts.push(mutation);
		if (offline) {
			await route.fulfill({
				status: 503,
				json: {
					error: {
						code: "network_error",
						message: "E2E offline",
						disposition: "retryable-upstream",
					},
				},
			});
			return;
		}
		await fulfillCommitted(route, mutation);
	});

	await page.goto("/nodes");
	await addNode(page, "Offline Node", "vless://offline.example");
	await expect.poll(() => attempts.length).toBeGreaterThan(0);
	const queuedBeforeReload = await readIndexedDb(page);
	const queuedMutation = (
		(queuedBeforeReload.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord
	).mutations as JsonRecord[];
	expect(queuedMutation).toHaveLength(1);
	const mutationId = queuedMutation[0]?.mutationId;

	offline = false;
	await page.reload();
	await expect
		.poll(
			async () => {
				const record = await readIndexedDb(page);
				return (
					((record.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord)
						.mutations as JsonRecord[]
				).length;
			},
			{ timeout: 5_000 },
		)
		.toBe(0);

	expect(new Set(attempts.map((attempt) => attempt.mutationId))).toEqual(
		new Set([mutationId]),
	);
	const recovered = await readIndexedDb(page);
	expect((recovered.binding as JsonRecord).revision).toBe(1);
	expect((recovered.snapshot as JsonRecord).nodes as JsonRecord[]).toHaveLength(
		1,
	);
});

test("replaces a rejected token and resumes the same queued mutation", async ({
	context,
	page,
}) => {
	const pending = reconcileMutation();
	await seedIndexedDb(
		page,
		persistenceRecord({
			workspaces: { [WORKSPACE_ID]: queue(WORKSPACE_ID, [pending]) },
		}),
	);
	await seedAuth(page, { persistent: "rejected-token" });
	const attempts: {
		authorization: string | undefined;
		mutation: JsonRecord;
	}[] = [];
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		const authorization = route.request().headers().authorization;
		const mutation = route.request().postDataJSON() as JsonRecord;
		attempts.push({ authorization, mutation });
		if (authorization === "Bearer rejected-token") {
			await route.fulfill({
				status: 401,
				json: {
					error: {
						code: "unauthorized",
						message: "E2E rejected token",
						disposition: "auth-required",
					},
				},
			});
			return;
		}
		expect(authorization).toBe("Bearer replacement-token");
		await fulfillCommitted(route, mutation);
	});

	await page.goto("/auth");
	const recovery = page.getByTestId("auth-recovery");
	await expect(recovery).toBeVisible();
	await expect(recovery).toContainText("Pending changes remain queued");
	await page.getByLabel("Remember token on this device").uncheck();
	await recovery
		.getByLabel("Replacement personal access token")
		.fill("replacement-token");
	await recovery
		.getByRole("button", { name: "Replace Token & Resume" })
		.click();

	await expect
		.poll(
			async () => {
				const record = await readIndexedDb(page);
				return (
					((record.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord)
						.mutations as JsonRecord[]
				).length;
			},
			{ timeout: 5_000 },
		)
		.toBe(0);
	await expect(recovery).toHaveCount(0);
	expect(attempts.length).toBeGreaterThanOrEqual(2);
	expect(new Set(attempts.map(({ mutation }) => mutation.mutationId))).toEqual(
		new Set([pending.mutationId]),
	);
	expect(attempts.at(-1)?.authorization).toBe("Bearer replacement-token");
	expect(
		attempts
			.slice(0, -1)
			.every(({ authorization }) => authorization === "Bearer rejected-token"),
	).toBe(true);
	const storedAuth = await page.evaluate(
		({ sessionKey, persistentKey }) => ({
			session: sessionStorage.getItem(sessionKey),
			persistent: localStorage.getItem(persistentKey),
		}),
		{ sessionKey: SESSION_AUTH_KEY, persistentKey: PERSISTENT_AUTH_KEY },
	);
	expect(storedAuth.session).toContain("replacement-token");
	expect(storedAuth.session).not.toContain("rejected-token");
	expect(storedAuth.persistent).toBeNull();
});

test("allows one tab to take over an expired lease without duplicate submission", async ({
	context,
	page,
}) => {
	const pending = reconcileMutation();
	const leaseName = `dispatcher:${WORKSPACE_ID}`;
	await seedIndexedDb(
		page,
		persistenceRecord({
			workspaces: { [WORKSPACE_ID]: queue(WORKSPACE_ID, [pending]) },
			leases: {
				[leaseName]: {
					name: leaseName,
					ownerId: "dead-tab",
					fencingToken: 1,
					expiresAt: 0,
					heartbeatAt: 0,
				},
			},
			nextFencingToken: 2,
		}),
	);
	await seedAuth(page, { persistent: "fake-persistent-token" });
	let requestCount = 0;
	let releaseRequest = () => {};
	const requestGate = new Promise<void>((resolve) => {
		releaseRequest = resolve;
	});
	let signalRequest = () => {};
	const requestStarted = new Promise<void>((resolve) => {
		signalRequest = resolve;
	});
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		requestCount += 1;
		signalRequest();
		await requestGate;
		await fulfillCommitted(route, route.request().postDataJSON() as JsonRecord);
	});

	const secondPage = await context.newPage();
	await Promise.all([page.goto("/"), secondPage.goto("/")]);
	await requestStarted;
	await page.waitForTimeout(300);
	expect(requestCount).toBe(1);
	const duringDelivery = await readIndexedDb(page);
	const lease = (duringDelivery.leases as JsonRecord)[leaseName] as JsonRecord;
	expect(lease.ownerId).not.toBe("dead-tab");
	expect(lease.fencingToken).toBe(2);

	releaseRequest();
	await expect
		.poll(async () => {
			const record = await readIndexedDb(secondPage);
			return (
				((record.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord)
					.mutations as JsonRecord[]
			).length;
		})
		.toBe(0);
	expect(requestCount).toBe(1);
});

test("manual Push and Publish stops when the local target draft is rejected", async ({
	context,
	page,
}) => {
	const data = aggregateData();
	const baseline = workspaceDocument({ data });
	await seedIndexedDb(
		page,
		persistenceRecord({
			snapshot: snapshot({ data }),
			binding: binding({ baseline, syncMode: "manual" }),
		}),
	);
	await seedAuth(page, { persistent: "fake-manual-rejection-token" });
	const submissions: JsonRecord[] = [];
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		submissions.push(route.request().postDataJSON() as JsonRecord);
		await route.fulfill({ status: 500, json: { error: "unexpected request" } });
	});

	await page.goto("/aggregate");
	await page.locator("#aggregate-target-select").click();
	await page.getByRole("button", { name: "E2E Target", exact: true }).click();
	await page.getByLabel("Target name").fill("Rejected Manual Target");
	await failNextPersistencePut(page, "QuotaExceededError");
	await page.getByRole("button", { name: "Push and Publish" }).click();

	await expect(page.getByLabel("Target name")).toHaveValue(
		"Rejected Manual Target",
	);
	await expect(page.getByText(/Workspace change was not saved/)).toHaveCount(1);
	await expect(
		page.getByText("Published successfully to GitHub Gist", { exact: true }),
	).toHaveCount(0);
	expect(submissions).toEqual([]);
	const stored = await readIndexedDb(page);
	expect(
		((stored.snapshot as JsonRecord).publishTargets as JsonRecord[])[0]?.name,
	).toBe("E2E Target");
});

test("Save and Publish reports peer ownership until another tab commits once", async ({
	context,
	page,
}) => {
	const data = aggregateData();
	const baseline = workspaceDocument({ data });
	const leaseName = `dispatcher:${WORKSPACE_ID}`;
	await seedIndexedDb(
		page,
		persistenceRecord({
			snapshot: snapshot({ data }),
			binding: binding({ baseline }),
			leases: {
				[leaseName]: {
					name: leaseName,
					ownerId: "peer-tab",
					fencingToken: 1,
					expiresAt: Date.now() + 60_000,
					heartbeatAt: Date.now(),
				},
			},
			nextFencingToken: 2,
		}),
	);
	await seedAuth(page, { persistent: "fake-peer-token" });
	const submissions: JsonRecord[] = [];
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		const mutation = route.request().postDataJSON() as JsonRecord;
		submissions.push(mutation);
		await fulfillCommitted(route, mutation, data);
	});

	await page.goto("/aggregate");
	await page.locator("#aggregate-target-select").click();
	await page.getByRole("button", { name: "E2E Target", exact: true }).click();
	await page.getByLabel("Target name").fill("Peer Updated Target");
	await page.getByRole("button", { name: "Save and Publish" }).click();

	await expect(
		page.getByText("Saved locally; another tab is synchronizing", {
			exact: true,
		}),
	).toBeVisible();
	await expect(page.getByText(/Publish failed/)).toHaveCount(0);
	const queued = await readIndexedDb(page);
	const mutation = (
		(queued.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord
	).mutations as JsonRecord[];
	expect(mutation).toHaveLength(1);
	expect(mutation[0]?.kind).toBe("aggregate.publish");
	const mutationId = mutation[0]?.mutationId;

	await expireLease(page, leaseName);
	const peer = await context.newPage();
	await peer.goto("/");
	await expect
		.poll(async () => {
			const record = await readIndexedDb(page);
			return (
				((record.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord)
					.mutations as JsonRecord[]
			).length;
		})
		.toBe(0);
	await expect(
		page.getByText("Saved to Workspace", { exact: true }).first(),
	).toBeVisible();
	expect(submissions).toHaveLength(1);
	expect(submissions[0]?.mutationId).toBe(mutationId);
});

test("aggregate publish keeps one mutation across retry, reload, and recovery", async ({
	context,
	page,
}) => {
	const data = aggregateData();
	const baseline = workspaceDocument({ data });
	await seedIndexedDb(
		page,
		persistenceRecord({
			snapshot: snapshot({ data }),
			binding: binding({ baseline }),
		}),
	);
	await seedAuth(page, { persistent: "fake-retry-token" });
	let offline = true;
	let committedCount = 0;
	const attempts: JsonRecord[] = [];
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		const mutation = route.request().postDataJSON() as JsonRecord;
		attempts.push(mutation);
		if (offline) {
			await route.fulfill({
				status: 503,
				json: {
					error: {
						code: "upstream_unavailable",
						message: "E2E unavailable",
						disposition: "retryable-upstream",
					},
				},
			});
			return;
		}
		committedCount++;
		await fulfillCommitted(route, mutation, data);
	});

	await page.goto("/aggregate");
	await page.locator("#aggregate-target-select").click();
	await page.getByRole("button", { name: "E2E Target", exact: true }).click();
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(
		page
			.getByRole("status")
			.getByText("Saved locally; retrying Workspace sync", { exact: true }),
	).toBeVisible();
	await expect(page.getByText(/Publish failed/)).toHaveCount(0);
	await expect(
		page.getByText("Published successfully to GitHub Gist", { exact: true }),
	).toHaveCount(0);
	const beforeReload = await readIndexedDb(page);
	const queued = (
		(beforeReload.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord
	).mutations as JsonRecord[];
	expect(queued).toHaveLength(1);
	const mutationId = queued[0]?.mutationId;
	expect(queued[0]?.kind).toBe("aggregate.publish");

	offline = false;
	await page.reload();
	await expect
		.poll(
			async () => {
				const record = await readIndexedDb(page);
				return (
					((record.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord)
						.mutations as JsonRecord[]
				).length;
			},
			{ timeout: 10_000 },
		)
		.toBe(0);
	expect(new Set(attempts.map((attempt) => attempt.mutationId))).toEqual(
		new Set([mutationId]),
	);
	expect(committedCount).toBe(1);
	const recovered = await readIndexedDb(page);
	expect((recovered.binding as JsonRecord).revision).toBe(1);
	expect(
		((recovered.snapshot as JsonRecord).publishTargets as JsonRecord[])[0]
			?.lastPublishedAt,
	).not.toBeNull();
});

test("stale tabs without BroadcastChannel rebase without reviving a deletion", async ({
	context,
	page,
}) => {
	await context.addInitScript(() => {
		Object.defineProperty(globalThis, "BroadcastChannel", {
			configurable: true,
			value: undefined,
		});
	});
	const existing = nodeFixture();
	const data = { ...structuredClone(EMPTY_DATA), nodes: [existing] };
	const baseline = workspaceDocument({ data });
	await seedIndexedDb(
		page,
		persistenceRecord({
			snapshot: snapshot({ data }),
			binding: binding({ baseline }),
		}),
	);
	await seedAuth(page, { persistent: "fake-stale-tab-token" });
	let remote = structuredClone(baseline) as JsonRecord;
	const submissions: JsonRecord[] = [];
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		const mutation = route.request().postDataJSON() as JsonRecord;
		submissions.push(mutation);
		expect(mutation.expectedRevision).toBe(remote.revision);
		const payload = mutation.payload as JsonRecord;
		const remoteData = structuredClone(remote.data) as JsonRecord;
		const remoteTombstones = structuredClone(remote.tombstones) as JsonRecord;
		const revision = Number(remote.revision) + 1;
		let receipt: JsonRecord;
		if (mutation.kind === "node.delete") {
			const id = String(payload.id);
			remoteData.nodes = (remoteData.nodes as JsonRecord[]).filter(
				(node) => node.id !== id,
			);
			remoteTombstones.nodes = [
				...(remoteTombstones.nodes as JsonRecord[]),
				{
					id,
					deletedAt: mutation.createdAt,
					deletedRevision: revision,
					mutationId: mutation.mutationId,
				},
			];
			receipt = { kind: mutation.kind, entityId: id };
		} else if (mutation.kind === "node.upsert") {
			const submittedNode = payload.node as JsonRecord;
			remoteData.nodes = [
				{ ...submittedNode, updatedAt: mutation.createdAt },
				...(remoteData.nodes as JsonRecord[]).filter(
					(node) => node.id !== submittedNode.id,
				),
			];
			receipt = { kind: mutation.kind, entityId: submittedNode.id };
		} else {
			throw new Error(
				`Unexpected stale-tab mutation: ${String(mutation.kind)}`,
			);
		}
		remote = workspaceDocument({
			revision,
			lastMutationId: String(mutation.mutationId),
			updatedAt: String(mutation.createdAt),
			data: remoteData,
			tombstones: remoteTombstones,
		});
		await route.fulfill({
			status: 200,
			json: {
				document: remote,
				mutationId: mutation.mutationId,
				workspaceId: mutation.workspaceId,
				committedRevision: revision,
				committedAt: mutation.createdAt,
				receipt,
				status: "committed",
			},
		});
	});
	const stalePage = await context.newPage();
	await Promise.all([page.goto("/nodes"), stalePage.goto("/nodes")]);
	await expect(
		stalePage.getByText(existing.name as string, { exact: true }),
	).toBeVisible();

	await page.getByRole("button", { name: "Delete node" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Delete", exact: true })
		.click();
	await expect(
		page.getByText(existing.name as string, { exact: true }),
	).toHaveCount(0);
	await expect.poll(() => submissions.length).toBe(1);
	let stored = await readIndexedDb(page);
	expect((stored.binding as JsonRecord).revision).toBe(1);
	await expect(
		stalePage.getByText(existing.name as string, { exact: true }),
	).toBeVisible();
	await addNode(stalePage, "Compatible Peer Node", "vless://compatible-peer");

	await expect.poll(() => submissions.length).toBe(2);
	stored = await readIndexedDb(stalePage);
	const storedNodes = (stored.snapshot as JsonRecord).nodes as JsonRecord[];
	expect(storedNodes.map((node) => node.name)).toEqual([
		"Compatible Peer Node",
	]);
	const mutations = (
		(stored.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord
	).mutations as JsonRecord[];
	expect(mutations).toEqual([]);
	expect((stored.binding as JsonRecord).revision).toBe(2);
	expect((stored.binding as JsonRecord).baseline).toEqual(remote);
	expect(remote.revision).toBe(2);
	expect(
		((remote.data as JsonRecord).nodes as JsonRecord[]).map(
			(node) => node.name,
		),
	).toEqual(["Compatible Peer Node"]);
	expect(
		((remote.tombstones as JsonRecord).nodes as JsonRecord[]).map(
			(tombstone) => tombstone.id,
		),
	).toEqual([existing.id]);
	expect(submissions.map((mutation) => mutation.expectedRevision)).toEqual([
		0, 1,
	]);
	expect(new Set(submissions.map((mutation) => mutation.mutationId)).size).toBe(
		2,
	);
	expect(
		submissions.every(
			(mutation) =>
				submissions.filter(
					(candidate) => candidate.mutationId === mutation.mutationId,
				).length === 1,
		),
	).toBe(true);
	expect(stored.quarantines).toEqual([]);
	await expect(stalePage.getByText(/local state needs repair/i)).toHaveCount(0);
});

test("keeps a token in session storage until persistent storage is explicitly selected", async ({
	page,
}) => {
	await seedIndexedDb(page, persistenceRecord());
	await seedAuth(page, { session: "fake-session-opt-in-token" });
	await page.goto("/auth");

	const remember = page.getByRole("checkbox", {
		name: "Remember token on this device",
	});
	await expect(remember).not.toBeChecked();
	let storage = await page.evaluate(
		({ sessionKey, persistentKey }) => ({
			session: sessionStorage.getItem(sessionKey),
			persistent: localStorage.getItem(persistentKey),
		}),
		{ sessionKey: SESSION_AUTH_KEY, persistentKey: PERSISTENT_AUTH_KEY },
	);
	expect(storage.session).toContain("fake-session-opt-in-token");
	expect(storage.persistent).toBeNull();

	await remember.check();
	storage = await page.evaluate(
		({ sessionKey, persistentKey }) => ({
			session: sessionStorage.getItem(sessionKey),
			persistent: localStorage.getItem(persistentKey),
		}),
		{ sessionKey: SESSION_AUTH_KEY, persistentKey: PERSISTENT_AUTH_KEY },
	);
	expect(storage.session).toBeNull();
	expect(storage.persistent).toContain("fake-session-opt-in-token");
});

test("preserves a remote tombstone when a locally edited node is merged", async ({
	context,
	page,
}) => {
	const baselineNode = nodeFixture();
	const localNode = nodeFixture({
		name: "Locally Edited Node",
		raw: "vless://local-edit.example",
		updatedAt: LATER,
	});
	const baseline = workspaceDocument({
		revision: 1,
		data: { ...structuredClone(EMPTY_DATA), nodes: [baselineNode] },
	});
	const tombstoneMutationId = "a0000000-0000-4000-8000-000000000003";
	const remote = workspaceDocument({
		revision: 2,
		lastMutationId: tombstoneMutationId,
		updatedAt: LATER,
		tombstones: {
			nodes: [
				{
					id: baselineNode.id,
					deletedAt: LATER,
					deletedRevision: 2,
					mutationId: tombstoneMutationId,
				},
			],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	});
	const pending = nodeUpsertMutation(localNode);
	const blocked = {
		mutationId: pending.mutationId,
		kind: pending.kind,
		code: "entity_deleted",
		disposition: "state-conflict",
		messageKey: "workspace.state-conflict",
		createdAt: pending.createdAt,
		blockedAt: LATER,
	};
	await seedIndexedDb(
		page,
		persistenceRecord({
			snapshot: snapshot({
				data: { ...structuredClone(EMPTY_DATA), nodes: [localNode] },
				lastUpdated: LATER,
			}),
			binding: binding({
				baseline: remote,
				conflictBaseline: baseline,
				syncMode: "paused-conflict",
			}),
			workspaces: { [WORKSPACE_ID]: queue(WORKSPACE_ID, [pending], blocked) },
		}),
	);
	await seedAuth(page, { session: "fake-conflict-token" });
	const submissions: JsonRecord[] = [];
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		const mutation = route.request().postDataJSON() as JsonRecord;
		submissions.push(mutation);
		const result = committedResult(mutation);
		(result.document as JsonRecord).tombstones = remote.tombstones;
		await route.fulfill({ status: 200, json: result });
	});

	await page.goto("/auth");
	await expect(page.getByTestId("state-conflict")).toBeVisible();
	await page.getByRole("button", { name: /Use Local/ }).click();
	await page
		.getByRole("button", { name: "Push Local", exact: true })
		.last()
		.click();
	const discardPending = page.getByRole("button", {
		name: "Discard 1 Changes",
	});
	await discardPending.click();
	await expect.poll(() => submissions.length).toBe(1);

	await expect(page.getByTestId("tombstone-notice")).toContainText(
		"deleted items were not restored",
	);
	await expect(page.getByTestId("state-conflict")).toHaveCount(0);
	const stored = await readIndexedDb(page);
	expect((stored.binding as JsonRecord).revision).toBe(3);
	expect((stored.snapshot as JsonRecord).nodes).toEqual([]);
});

test("shows a domain conflict without full-state merge and clears Repair after complete discard", async ({
	context,
	page,
}) => {
	await seedIndexedDb(page, persistenceRecord());
	await seedAuth(page, { session: "fake-domain-token" });
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		await route.fulfill({
			status: 409,
			json: {
				error: {
					code: "duplicate_node_raw",
					message: "Duplicate node URI",
					disposition: "domain-conflict",
				},
			},
		});
	});

	await page.goto("/nodes");
	await addNode(
		page,
		"Domain Conflict Node",
		"vless://domain-conflict.example",
	);
	const repairLink = page.getByRole("link", { name: "Repair", exact: true });
	await expect(repairLink).toBeVisible();
	await repairLink.click();
	await expect(page.getByTestId("blocked-queue-metadata")).toContainText(
		"domain-conflict / duplicate_node_raw",
	);
	await expect(page.getByTestId("state-conflict")).toHaveCount(0);

	await page
		.getByTestId("active-workspace-queue")
		.getByRole("button", {
			name: "Discard Complete Queue",
		})
		.click();
	await page
		.getByRole("button", { name: "Discard Complete Queue" })
		.last()
		.click();
	await expect(page.getByTestId("queue-action-result")).toContainText(
		"Complete Workspace queue discarded",
	);
	await expect(
		page.getByRole("link", { name: "Repair", exact: true }),
	).toHaveCount(0);
	await expect(page.getByTestId("active-queue-count")).toHaveText("0");
});

test("renders active and orphan Workspace queues as separate groups", async ({
	page,
}) => {
	const active = reconcileMutation();
	const orphanWorkspaceId = "gist:orphan-e2e";
	const orphan = reconcileMutation({
		mutationId: "a0000000-0000-4000-8000-000000000004",
		workspaceId: orphanWorkspaceId,
		expectedRevision: 7,
	});
	await seedIndexedDb(
		page,
		persistenceRecord({
			workspaces: {
				[WORKSPACE_ID]: queue(WORKSPACE_ID, [active]),
				[orphanWorkspaceId]: queue(orphanWorkspaceId, [orphan]),
			},
		}),
	);

	await page.goto("/auth");
	await expect(page.getByTestId("active-queue-count")).toHaveText("1");
	await expect(page.getByTestId("total-queue-count")).toHaveText("2");
	await expect(page.getByTestId("orphan-queue-count")).toHaveText("1");
	await expect(page.getByTestId("active-workspace-queue")).toContainText(
		WORKSPACE_ID,
	);
	await expect(page.getByTestId("orphan-workspace-queue")).toContainText(
		orphanWorkspaceId,
	);
});

test("exports diagnostics through the UI without payload, token, or quarantine canaries", async ({
	page,
}) => {
	const payloadCanary = "vless://PAYLOAD-CANARY.example";
	const sessionCanary = "SESSION-TOKEN-CANARY";
	const persistentCanary = "PERSISTENT-TOKEN-CANARY";
	const quarantineCanary = "QUARANTINE-RAW-CANARY";
	const orphanWorkspaceId = "gist:diagnostics-orphan";
	const canaryData = {
		...structuredClone(EMPTY_DATA),
		nodes: [nodeFixture({ raw: payloadCanary })],
	};
	const pending = reconcileMutation({
		mutationId: "a0000000-0000-4000-8000-000000000005",
		workspaceId: orphanWorkspaceId,
		expectedRevision: 4,
		data: canaryData,
	});
	await seedIndexedDb(
		page,
		persistenceRecord({
			workspaces: { [orphanWorkspaceId]: queue(orphanWorkspaceId, [pending]) },
			quarantines: [
				{
					id: "queue:diagnostics-orphan:deadbeef",
					source: "queue:gist:diagnostics-orphan",
					reason: "invalid-persisted-queue",
					bytes: quarantineCanary.length,
					createdAt: NOW,
				},
			],
			quarantinePayloads: {
				"queue:diagnostics-orphan:deadbeef": quarantineCanary,
			},
		}),
	);
	await seedAuth(page, {
		session: sessionCanary,
		persistent: persistentCanary,
	});
	await page.goto("/auth");

	await page.getByRole("button", { name: "Export Diagnostics" }).click();
	const payloadField = page.locator("#settings-payload");
	await expect(payloadField).not.toHaveValue("");
	const payload = await payloadField.inputValue();
	const diagnostics = JSON.parse(payload) as JsonRecord;
	expect(payload).not.toContain(payloadCanary);
	expect(payload).not.toContain(sessionCanary);
	expect(payload).not.toContain(persistentCanary);
	expect(payload).not.toContain(quarantineCanary);
	expect(diagnostics.kind).toBe("subman-workspace-diagnostics");
	expect((diagnostics.counts as JsonRecord).orphanedWorkspaces).toBe(1);
	expect((diagnostics.mutations as JsonRecord[])[0]?.payloadSha256).toMatch(
		/^[0-9a-f]{64}$/,
	);
});

test("opens a conflict confirmation as a keyboard-accessible dialog", async ({
	page,
}) => {
	const baselineNode = nodeFixture();
	const localNode = nodeFixture({ name: "Keyboard Edit", updatedAt: LATER });
	const baseline = workspaceDocument({
		revision: 1,
		data: { ...structuredClone(EMPTY_DATA), nodes: [baselineNode] },
	});
	const remote = workspaceDocument({ revision: 2 });
	const pending = nodeUpsertMutation(localNode);
	const blocked = {
		mutationId: pending.mutationId,
		kind: pending.kind,
		code: "revision_conflict",
		disposition: "state-conflict",
		messageKey: "workspace.state-conflict",
		createdAt: pending.createdAt,
		blockedAt: LATER,
	};
	await seedIndexedDb(
		page,
		persistenceRecord({
			snapshot: snapshot({
				data: { ...structuredClone(EMPTY_DATA), nodes: [localNode] },
				lastUpdated: LATER,
			}),
			binding: binding({
				baseline: remote,
				conflictBaseline: baseline,
				syncMode: "paused-conflict",
			}),
			workspaces: { [WORKSPACE_ID]: queue(WORKSPACE_ID, [pending], blocked) },
		}),
	);
	await seedAuth(page, { session: "fake-keyboard-token" });
	await page.goto("/auth");

	const mergeAction = page
		.getByTestId("state-conflict")
		.getByRole("button", { name: /Merge & Save/ });
	await mergeAction.focus();
	await page.keyboard.press("Enter");
	const dialog = page.getByRole("dialog", { name: "Sync Update" });
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Merge & Save" }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(mergeAction).toBeFocused();
});
