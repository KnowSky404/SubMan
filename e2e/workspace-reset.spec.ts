import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { seedUiWorkspace } from "./ui-workspace-fixture";

type JsonRecord = Record<string, unknown>;

const GIST_ID = "accessibility-cloud";
const WORKSPACE_ID = `gist:${GIST_ID}`;
const ORPHAN_ID = "gist:retained-previous";
const NEW_GIST_ID = "new-empty-workspace";
const NOW = "2026-10-23T10:00:00.000Z";

async function readRecord(page: Page): Promise<JsonRecord> {
	return page.evaluate(
		() =>
			new Promise<JsonRecord>((resolve, reject) => {
				const request = indexedDB.open("subman-workspace", 1);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const database = request.result;
					const transaction = database.transaction(
						"workspace-state",
						"readonly",
					);
					const read = transaction.objectStore("workspace-state").get("root");
					read.onsuccess = () => resolve(read.result);
					read.onerror = () => reject(read.error);
					transaction.oncomplete = () => database.close();
				};
			}),
	);
}

async function seedResetWorkspace(page: Page, context: BrowserContext) {
	await seedUiWorkspace(page, context);
	await page.evaluate(
		async ({ workspaceId, orphanId, now }) => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open("subman-workspace", 1);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(
					"workspace-state",
					"readwrite",
				);
				const store = transaction.objectStore("workspace-state");
				const read = store.get("root");
				read.onsuccess = () => {
					const record = read.result;
					const queue = (id: string, mutationId: string) => {
						const mutation = {
							mutationId,
							workspaceId: id,
							expectedRevision: 0,
							source: "browser",
							createdAt: now,
							kind: "node.delete",
							payload: { id: "accessibility-node" },
						};
						return {
							workspaceId: id,
							mutations: [mutation],
							delivery: {
								retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
								blocked: {
									mutationId,
									kind: mutation.kind,
									code: "mutation_recovery_failed",
									disposition: "operator-repair",
									messageKey: "workspace.operator-repair",
									createdAt: now,
									blockedAt: now,
								},
								deadLetters: [],
							},
						};
					};
					record.workspaces = {
						[workspaceId]: queue(
							workspaceId,
							"a0000000-0000-4000-8000-000000000001",
						),
						[orphanId]: queue(orphanId, "a0000000-0000-4000-8000-000000000002"),
					};
					record.quarantines = [
						{
							id: "retained-evidence",
							source: "queue:retained-previous",
							reason: "queue-corruption",
							bytes: 2,
							createdAt: now,
						},
					];
					record.quarantinePayloads = { "retained-evidence": "{}" };
					record.nextFencingToken = 40;
					store.put(record, "root");
				};
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			database.close();
		},
		{ workspaceId: WORKSPACE_ID, orphanId: ORPHAN_ID, now: NOW },
	);
}

async function mockDeletedCloud(context: BrowserContext) {
	const requests: Array<{ method: string; path: string; body?: JsonRecord }> =
		[];
	let files: Record<string, { content: string }> = {};
	await context.route("https://api.github.com/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		const method = request.method();
		const body = method === "POST" ? request.postDataJSON() : undefined;
		requests.push({ method, path, body });
		if (path === `/gists/${GIST_ID}`) {
			await route.fulfill({ status: 404, json: { message: "Not Found" } });
			return;
		}
		if (method === "GET" && path === "/gists") {
			await route.fulfill({ json: [] });
			return;
		}
		if (method === "POST" && path === "/gists") {
			files = body?.files as Record<string, { content: string }>;
		}
		if (
			(method === "POST" && path === "/gists") ||
			(method === "GET" && path === `/gists/${NEW_GIST_ID}`)
		) {
			await route.fulfill({
				json: {
					id: NEW_GIST_ID,
					owner: { login: "e2e" },
					description: "SubMan-Data",
					updated_at: NOW,
					html_url: `https://gist.github.com/e2e/${NEW_GIST_ID}`,
					files: Object.fromEntries(
						Object.entries(files).map(([filename, file]) => [
							filename,
							{
								filename,
								raw_url: `https://gist.githubusercontent.com/e2e/${NEW_GIST_ID}/raw/${filename}`,
								size: new TextEncoder().encode(file.content).byteLength,
								content: file.content,
								truncated: false,
							},
						]),
					),
				},
			});
			return;
		}
		await route.abort("blockedbyclient");
	});
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		const request = route.request();
		const mutation = request.postDataJSON();
		requests.push({
			method: request.method(),
			path: new URL(request.url()).pathname,
			body: mutation,
		});
		const document = {
			version: 2,
			schemaVersion: 2,
			workspaceId: mutation.workspaceId,
			revision: mutation.expectedRevision + 1,
			updatedAt: mutation.createdAt,
			lastMutationId: mutation.mutationId,
			data: mutation.payload.data,
			tombstones: {
				nodes: [],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			},
		};
		files = { "subman.json": { content: JSON.stringify(document) } };
		await route.fulfill({
			json: {
				status: "committed",
				mutationId: mutation.mutationId,
				workspaceId: mutation.workspaceId,
				committedRevision: document.revision,
				committedAt: document.updatedAt,
				receipt: { kind: mutation.kind },
				document,
			},
		});
	});
	return requests;
}

test("canceling device reset preserves the unavailable binding, current queue, and credentials", async ({
	page,
	context,
}) => {
	await seedResetWorkspace(page, context);
	const requests = await mockDeletedCloud(context);
	await page.goto("/auth");
	const action = page.getByTestId("device-reset-action");
	await expect(action).toBeEnabled();
	await expect(page.getByTestId("total-queue-count")).toHaveText("2");
	const before = await readRecord(page);
	await action.click();
	const dialog = page.getByRole("dialog", {
		name: "Reset this device",
		exact: true,
	});
	await expect(dialog).toContainText("Cloud data is preserved.");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	expect(await readRecord(page)).toEqual(before);
	expect(
		await page.evaluate(() => sessionStorage.getItem("subman:auth:session:v2")),
	).toContain("fixture-accessibility-token");
	expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
});

test("explicit reset clears only the current Workspace and permits fresh empty initialization", async ({
	page,
	context,
}) => {
	await seedResetWorkspace(page, context);
	const requests = await mockDeletedCloud(context);
	await page.goto("/auth");
	await expect(page.getByTestId("device-reset-action")).toBeEnabled();
	await page.getByRole("button", { name: "Disconnect", exact: true }).click();
	await page
		.getByLabel("Personal access token", { exact: true })
		.fill("fixture-reconnect-token");
	await page.getByRole("button", { name: "Connect", exact: true }).click();
	await expect(page.getByTestId("workspace-connection-notice")).toBeVisible();
	expect(
		requests.every((request) => request.path === `/gists/${GIST_ID}`),
	).toBe(true);
	const before = await readRecord(page);
	await page.getByTestId("device-reset-action").click();
	await page
		.getByRole("dialog", { name: "Reset this device", exact: true })
		.getByRole("button", { name: "Reset this device", exact: true })
		.click();
	await expect(page.getByTestId("device-reset-notice")).toHaveText(
		"Device reset. Connect again to load cloud data or create an empty Workspace.",
	);
	const reset = await readRecord(page);
	expect(reset.binding).toBeNull();
	expect((reset.snapshot as JsonRecord).activeGistId).toBeNull();
	expect((reset.snapshot as JsonRecord).nodes).toEqual([]);
	expect((reset.workspaces as JsonRecord)[WORKSPACE_ID]).toBeUndefined();
	expect((reset.workspaces as JsonRecord)[ORPHAN_ID]).toEqual(
		(before.workspaces as JsonRecord)[ORPHAN_ID],
	);
	expect(reset.quarantines).toEqual(before.quarantines);
	expect(reset.quarantinePayloads).toEqual(before.quarantinePayloads);
	expect(reset.nextFencingToken).toBe(before.nextFencingToken);
	expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
	await page.reload();
	await expect(
		page.getByLabel("Workspace Gist ID (optional)", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByLabel("Personal access token", { exact: true }),
	).toHaveValue("");
	expect((await readRecord(page)).binding).toBeNull();
	await page
		.getByLabel("Personal access token", { exact: true })
		.fill("fixture-new-token");
	await page.getByRole("button", { name: "Connect", exact: true }).click();
	await expect(
		page.getByText("Cloud data loaded.", { exact: true }),
	).toBeVisible();
	const initialized = await readRecord(page);
	expect((initialized.binding as JsonRecord).gistId).toBe(NEW_GIST_ID);
	expect((initialized.snapshot as JsonRecord).nodes).toEqual([]);
	expect((initialized.workspaces as JsonRecord)[ORPHAN_ID]).toEqual(
		(before.workspaces as JsonRecord)[ORPHAN_ID],
	);
	const create = requests.filter(
		(request) => request.method === "POST" && request.path === "/gists",
	);
	expect(create).toHaveLength(1);
	expect(Object.keys(create[0].body?.files as JsonRecord)).toEqual([
		"subman.bootstrap.json",
	]);
	const mutations = requests.filter((request) =>
		request.path.includes("/mutations"),
	);
	expect(mutations).toHaveLength(1);
	expect(mutations[0].body?.workspaceId).toBe(`gist:${NEW_GIST_ID}`);
	expect(mutations[0].body?.kind).toBe("workspace.reconcile");
	expect((mutations[0].body?.payload as JsonRecord).data).toEqual({
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
	});
	expect(
		requests.some(
			(request) => request.method === "PATCH" || request.method === "DELETE",
		),
	).toBe(false);
});

test("signed-out mobile Chinese settings can reset an unavailable Workspace", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await seedResetWorkspace(page, context);
	const requests = await mockDeletedCloud(context);
	await page.evaluate(() => {
		sessionStorage.removeItem("subman:auth:session:v2");
		localStorage.setItem("subman:locale:v1", "zh-CN");
	});
	await page.goto("/auth");
	const action = page.getByTestId("device-reset-action");
	await expect(action).toHaveText("重置此设备");
	await expect(action).toBeEnabled();
	await expect(page.getByTestId("total-queue-count")).toHaveText("2");
	await action.click();
	const dialog = page.getByRole("dialog", { name: "重置此设备", exact: true });
	await expect(dialog).toContainText("全部未确认变更");
	await dialog.getByRole("button", { name: "重置此设备", exact: true }).click();
	await expect(page.getByTestId("device-reset-notice")).toHaveText(
		"此设备已重置。请重新连接，以加载云端数据或创建空工作区。",
	);
	await expect(
		page.getByRole("button", { name: "连接", exact: true }),
	).toBeVisible();
	expect((await readRecord(page)).binding).toBeNull();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	expect(requests).toEqual([]);
});

test("active delivery prevents reset and preserves the current browser record", async ({
	page,
	context,
}) => {
	await seedResetWorkspace(page, context);
	const requests = await mockDeletedCloud(context);
	await page.evaluate(async (workspaceId) => {
		sessionStorage.removeItem("subman:auth:session:v2");
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("subman-workspace", 1);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction("workspace-state", "readwrite");
			const store = transaction.objectStore("workspace-state");
			const read = store.get("root");
			read.onsuccess = () => {
				const record = read.result;
				const name = `dispatcher:${workspaceId}`;
				record.leases[name] = {
					name,
					ownerId: "another-browser-context",
					fencingToken: 39,
					expiresAt: Date.now() + 60_000,
					heartbeatAt: Date.now(),
				};
				store.put(record, "root");
			};
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();
	}, WORKSPACE_ID);
	await page.goto("/auth");
	await expect(page.getByTestId("total-queue-count")).toHaveText("2");
	const before = await readRecord(page);
	await page.getByTestId("device-reset-action").click();
	await page
		.getByRole("dialog", { name: "Reset this device", exact: true })
		.getByRole("button", { name: "Reset this device", exact: true })
		.click();
	await expect(page.getByTestId("device-reset-notice")).toHaveText(
		"Cloud delivery is active. Wait for it to finish before resetting this device.",
	);
	expect(await readRecord(page)).toEqual(before);
	expect(requests).toEqual([]);
});

test("device reset removes cached business state in another open tab", async ({
	page,
	context,
}) => {
	await seedUiWorkspace(page, context);
	const writes: string[] = [];
	context.on("request", (request) => {
		if (request.method() !== "GET") writes.push(request.url());
	});
	await page.goto("/auth");
	await expect(page.locator(".app-header-link-connected")).toBeVisible();
	const peer = await context.newPage();
	await peer.goto("/__e2e_seed__");
	await peer.evaluate((now) => {
		sessionStorage.setItem(
			"subman:auth:session:v2",
			JSON.stringify({
				version: 2,
				token: "fixture-peer-token",
				lastLoginAt: now,
			}),
		);
	}, NOW);
	await peer.goto("/nodes");
	await expect(
		peer.getByRole("button", { name: "Accessibility Node", exact: true }),
	).toBeVisible();
	await page.getByTestId("device-reset-action").click();
	await page
		.getByRole("dialog", { name: "Reset this device", exact: true })
		.getByRole("button", { name: "Reset this device", exact: true })
		.click();
	await expect(page.getByTestId("device-reset-notice")).toHaveText(
		"Device reset. Connect again to load cloud data or create an empty Workspace.",
	);
	await expect(
		peer.getByRole("button", { name: "Accessibility Node", exact: true }),
	).toHaveCount(0);
	await expect(
		peer.getByRole("button", { name: "Edit node", exact: true }),
	).toHaveCount(0);
	const peerRecord = await readRecord(peer);
	expect(peerRecord.binding).toBeNull();
	expect((peerRecord.snapshot as JsonRecord).nodes).toEqual([]);
	expect(writes).toEqual([]);
	// Drain connections before closing the peer in the local Worker harness.
	await peer.waitForLoadState("networkidle");
	await peer.close();
});

test("reset remains reachable when browser persistence initialization fails", async ({
	page,
	context,
}) => {
	await seedResetWorkspace(page, context);
	const requests = await mockDeletedCloud(context);
	await context.addInitScript(() => {
		Object.defineProperty(window, "indexedDB", {
			configurable: true,
			value: undefined,
		});
	});
	await page.goto("/auth");
	const action = page.getByTestId("device-reset-action");
	await expect(action).toBeEnabled();
	await action.click();
	await expect(page.getByTestId("device-reset-notice")).toHaveText(
		"Device reset could not be confirmed. Check browser storage access, reload Settings, and review the connection before retrying.",
	);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	expect(
		await page.evaluate(() => sessionStorage.getItem("subman:auth:session:v2")),
	).toContain("fixture-accessibility-token");
	expect(requests).toEqual([]);
});

test("a token storage failure does not report a committed device reset as rejected", async ({
	page,
	context,
}) => {
	await seedResetWorkspace(page, context);
	const requests = await mockDeletedCloud(context);
	await page.goto("/auth");
	await expect(page.getByTestId("total-queue-count")).toHaveText("2");
	await page.evaluate(() => {
		const removeItem = Storage.prototype.removeItem;
		Storage.prototype.removeItem = function (key: string) {
			if (key === "subman:auth:v2" || key === "subman:auth:session:v2") {
				throw new DOMException("Fixture denied token removal", "SecurityError");
			}
			removeItem.call(this, key);
		};
	});
	await page.getByTestId("device-reset-action").click();
	await page
		.getByRole("dialog", { name: "Reset this device", exact: true })
		.getByRole("button", { name: "Reset this device", exact: true })
		.click();
	await expect(page.getByTestId("device-reset-notice")).toHaveText(
		"Device reset completed, but saved token removal could not be confirmed. Check browser storage access before reconnecting.",
	);
	expect((await readRecord(page)).binding).toBeNull();
	await expect(
		page.getByLabel("Personal access token", { exact: true }),
	).toBeVisible();
	expect(
		await page.evaluate(() => sessionStorage.getItem("subman:auth:session:v2")),
	).toContain("fixture-accessibility-token");
	expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
});
