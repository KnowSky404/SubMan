import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import type { WorkspaceDocumentV2 } from "../src/lib/workspace-document";
import {
	defaultUiData,
	seedUiWorkspace,
	type UiWorkspaceData,
} from "./ui-workspace-fixture";

const GIST_ID = "accessibility-cloud";
const WORKSPACE_ID = `gist:${GIST_ID}`;
const NOW = "2026-10-23T10:00:00.000Z";
type JsonRecord = Record<string, unknown>;

function resetData(): UiWorkspaceData {
	const data = structuredClone(defaultUiData);
	data.aggregates = [
		{
			id: "reset-rule",
			name: "Reset rule",
			nodeIds: ["accessibility-node"],
			subscriptionIds: [],
			excludeTagIds: [],
			renameMap: {},
			allowedTypes: [],
			sortMode: "none",
			updatedAt: NOW,
		},
	];
	const target = {
		id: "published-target",
		name: "Published target",
		ruleId: "reset-rule",
		fileName: "published.txt",
		description: "",
		isPublic: false,
		lastPublishedAt: NOW,
		lastPublishedUrl: `https://gist.githubusercontent.com/e2e/${GIST_ID}/raw/published.txt`,
		lastPublishTransitionAt: null,
		lastPublishTransitionFromFileName: null,
		lastPublishTransitionToFileName: null,
		lastPublishTransitionOutcome: null,
		updatedAt: NOW,
	};
	data.publishTargets = [
		target,
		{
			...target,
			id: "unpublished-target",
			name: "Unpublished target",
			fileName: "manual.txt",
			lastPublishedAt: null,
			lastPublishedUrl: null,
		},
	];
	return data;
}

async function readRecord(page: Page): Promise<JsonRecord> {
	return page.evaluate(async () => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("subman-workspace", 1);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise<JsonRecord>((resolve, reject) => {
				const transaction = database.transaction("workspace-state", "readonly");
				const request = transaction.objectStore("workspace-state").get("root");
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		} finally {
			database.close();
		}
	});
}

async function mockCloudReset(
	page: Page,
	context: BrowserContext,
	options: { deferCommit?: boolean; conflict?: boolean; retry?: boolean } = {},
) {
	const data = resetData();
	const files: Record<string, string> = {
		"published.txt": "published output",
		"manual.txt": "external contents without publication evidence",
		"notes.txt": "operator notes",
		"subman.v1.backup.json": "immutable migration backup",
	};
	await seedUiWorkspace(page, context, data, files);
	let document: WorkspaceDocumentV2 = {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision: 0,
		updatedAt: NOW,
		lastMutationId: null,
		data,
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
	const requests: Array<{ method: string; path: string }> = [];
	const mutations: JsonRecord[] = [];
	let releaseCommit: () => void = () => undefined;
	const commitReady = options.deferCommit
		? new Promise<void>((resolve) => {
				releaseCommit = resolve;
			})
		: Promise.resolve();
	await context.route("https://api.github.com/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		requests.push({ method: request.method(), path });
		if (request.method() !== "GET" || path !== `/gists/${GIST_ID}`) {
			await route.abort("blockedbyclient");
			return;
		}
		await route.fulfill({
			json: {
				id: GIST_ID,
				owner: { login: "e2e" },
				description: "SubMan-Data",
				updated_at: document.updatedAt,
				html_url: `https://gist.github.com/e2e/${GIST_ID}`,
				files: Object.fromEntries(
					Object.entries({
						...files,
						"subman.json": JSON.stringify(document),
					}).map(([filename, content]) => [
						filename,
						{
							filename,
							content,
							size: new TextEncoder().encode(content).byteLength,
							raw_url: `https://gist.githubusercontent.com/e2e/${GIST_ID}/raw/${filename}`,
							truncated: false,
						},
					]),
				),
			},
		});
	});
	await context.route("**/api/workspaces/**/mutations", async (route) => {
		const mutation = route.request().postDataJSON() as JsonRecord;
		mutations.push(mutation);
		await commitReady;
		if (options.retry) {
			await route.fulfill({
				status: 503,
				headers: { "Retry-After": "120" },
				json: {
					error: {
						code: "gist_read_failed",
						message: "GitHub is temporarily unavailable",
						disposition: "retryable-upstream",
					},
				},
			});
			return;
		}
		if (options.conflict) {
			await route.fulfill({
				status: 409,
				json: {
					error: {
						code: "revision_conflict",
						message: "Cloud data changed after reset preview",
						disposition: "state-conflict",
					},
					revision: document.revision + 1,
					document: { ...document, revision: document.revision + 1 },
				},
			});
			return;
		}
		document = {
			...document,
			revision: Number(mutation.expectedRevision) + 1,
			resetRevision: Number(mutation.expectedRevision) + 1,
			lastMutationId: String(mutation.mutationId),
			updatedAt: String(mutation.createdAt),
			data: {
				nodes: [],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			},
		};
		delete files["published.txt"];
		await route.fulfill({
			json: {
				status: "committed",
				mutationId: mutation.mutationId,
				workspaceId: WORKSPACE_ID,
				committedRevision: document.revision,
				committedAt: document.updatedAt,
				receipt: { kind: "workspace.reset" },
				document,
			},
		});
	});
	return { mutations, requests, releaseCommit };
}

async function openCloudReset(page: Page) {
	await page.goto("/auth");
	await expect(page.getByTestId("cloud-reset-action")).toBeEnabled();
	await page.getByTestId("cloud-reset-action").click();
	const dialog = page.getByRole("dialog", {
		name: "Reset cloud data",
		exact: true,
	});
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveCSS("opacity", "1");
	return dialog;
}

test("cloud reset previews its scope and cancellation sends no mutation", async ({
	page,
	context,
}) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error" || message.type() === "warning")
			browserErrors.push(message.text());
	});
	const cloud = await mockCloudReset(page, context);
	const dialog = await openCloudReset(page);
	await expect(page).toHaveTitle("Settings - SubMan");
	await expect(
		page.getByRole("heading", { name: "Settings", exact: true }),
	).toBeVisible();
	await expect(page.locator("vite-error-overlay")).toHaveCount(0);
	await expect(
		dialog.getByRole("heading", { name: "Reset cloud data", exact: true }),
	).toBeFocused();
	await expect(dialog.locator("#cloud-reset-warning")).toBeInViewport();
	await expect(dialog).toContainText(GIST_ID);
	await expect(dialog).toContainText("Files to remove: 1");
	await expect(dialog).toContainText("published.txt");
	await expect(dialog).toContainText("Files to retain: 3");
	await expect(dialog).toContainText("subman.v1.backup.json");
	await expect(dialog).toContainText("manual.txt");
	await expect(page.getByTestId("cloud-reset-confirm")).toBeDisabled();
	await page.screenshot({
		path: "/tmp/subman-cloud-reset-desktop.png",
		animations: "disabled",
	});
	await dialog.getByLabel("Type RESET to confirm").fill("reset");
	await expect(page.getByTestId("cloud-reset-confirm")).toBeDisabled();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	expect(cloud.mutations).toEqual([]);
	expect(cloud.requests.every((request) => request.method === "GET")).toBe(
		true,
	);
	expect((await readRecord(page)).binding).toMatchObject({ gistId: GIST_ID });
	expect(browserErrors).toEqual([]);
});

test("cloud reset waits for confirmation and keeps the original Gist and credentials", async ({
	page,
	context,
}) => {
	const cloud = await mockCloudReset(page, context, { deferCommit: true });
	const dialog = await openCloudReset(page);
	await dialog.getByLabel("Type RESET to confirm").fill("RESET");
	await page.getByTestId("cloud-reset-confirm").click();
	await expect.poll(() => cloud.mutations.length).toBe(1);
	await expect(page.getByTestId("cloud-reset-confirm")).toHaveText(
		"Resetting cloud data...",
	);
	await expect(page.getByTestId("cloud-reset-confirm")).toBeDisabled();
	expect((await readRecord(page)).binding).toMatchObject({
		gistId: GIST_ID,
		revision: 0,
	});
	await expect(page.getByTestId("cloud-reset-notice")).toHaveCount(0);
	cloud.releaseCommit();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("cloud-reset-notice")).toHaveText(
		"Cloud data reset. This Workspace is ready to start again.",
	);
	const record = await readRecord(page);
	expect(record.binding).toMatchObject({
		gistId: GIST_ID,
		revision: 1,
		baseline: { resetRevision: 1 },
	});
	expect(record.snapshot).toMatchObject({
		activeGistId: GIST_ID,
		nodes: [],
		aggregates: [],
		publishTargets: [],
	});
	expect(cloud.mutations[0]).toMatchObject({
		kind: "workspace.reset",
		expectedRevision: 0,
		expectedResetRevision: 0,
		payload: {},
	});
	expect(
		await page.evaluate(() => sessionStorage.getItem("subman:auth:session:v2")),
	).toContain("fixture-accessibility-token");
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Disconnect", exact: true }),
	).toBeVisible();
	await expect(page.getByTestId("cloud-reset-action")).toBeEnabled();
	expect(cloud.requests.every((request) => request.method === "GET")).toBe(
		true,
	);
});

test("a concurrent browser change invalidates the cloud reset confirmation", async ({
	page,
	context,
}) => {
	const cloud = await mockCloudReset(page, context);
	const dialog = await openCloudReset(page);
	await dialog.getByLabel("Type RESET to confirm").fill("RESET");
	await page.evaluate(async () => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("subman-workspace", 1);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(
					"workspace-state",
					"readwrite",
				);
				const store = transaction.objectStore("workspace-state");
				const read = store.get("root");
				read.onsuccess = () => {
					const record = read.result;
					record.snapshot.lastUpdated = "2026-11-01T12:00:00.000Z";
					store.put(record, "root");
				};
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
		} finally {
			database.close();
		}
	});
	const before = await readRecord(page);
	await page.getByTestId("cloud-reset-confirm").click();
	await expect(page.getByTestId("cloud-reset-dialog-notice")).toBeVisible();
	await expect(page.getByTestId("cloud-reset-confirm")).toBeDisabled();
	expect(cloud.mutations).toEqual([]);
	expect(await readRecord(page)).toEqual(before);
});

test("cloud reset requires authentication while device reset remains available", async ({
	page,
	context,
}) => {
	const cloud = await mockCloudReset(page, context);
	await page.evaluate(() =>
		sessionStorage.removeItem("subman:auth:session:v2"),
	);
	await page.goto("/auth");
	await expect(page.getByTestId("cloud-reset-action")).toBeDisabled();
	await expect(page.getByTestId("device-reset-action")).toBeEnabled();
	expect(cloud.mutations).toEqual([]);
});

for (const outcome of ["retry", "conflict"] as const) {
	test(`cloud reset retains its original mutation after ${outcome} and does not report success`, async ({
		page,
		context,
	}) => {
		const cloud = await mockCloudReset(page, context, { [outcome]: true });
		const dialog = await openCloudReset(page);
		await dialog.getByLabel("Type RESET to confirm").fill("RESET");
		await page.getByTestId("cloud-reset-confirm").click();
		await expect(page.getByTestId("cloud-reset-dialog-notice")).toBeVisible();
		await expect(dialog).toBeVisible();
		await expect(page.getByTestId("cloud-reset-confirm")).toBeDisabled();
		await expect(page.getByTestId("cloud-reset-notice")).not.toHaveText(
			"Cloud data reset. This Workspace is ready to start again.",
		);
		const record = await readRecord(page);
		const queue = (record.workspaces as JsonRecord)[WORKSPACE_ID] as JsonRecord;
		expect(queue.mutations).toHaveLength(1);
		if (outcome === "conflict") {
			expect(queue.delivery).toMatchObject({
				blocked: { disposition: "state-conflict", code: "revision_conflict" },
			});
		}
		expect((queue.mutations as JsonRecord[])[0].mutationId).toBe(
			cloud.mutations[0].mutationId,
		);
		expect(cloud.mutations).toHaveLength(1);
		expect(record.binding).toMatchObject({ gistId: GIST_ID });
	});
}

test("mobile Chinese cloud reset uses an explicit confirmation phrase", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const cloud = await mockCloudReset(page, context);
	await page.evaluate(() => localStorage.setItem("subman:locale:v1", "zh-CN"));
	await page.goto("/auth");
	await expect(page.getByTestId("cloud-reset-action")).toBeEnabled();
	await page.getByTestId("cloud-reset-action").click();
	const dialog = page.getByRole("dialog", {
		name: "重置云端数据",
		exact: true,
	});
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveCSS("opacity", "1");
	await expect(dialog).toContainText("所有已连接设备");
	await dialog.getByLabel("输入 RESET 以确认").fill("RESET");
	await expect(dialog.getByLabel("输入 RESET 以确认")).toBeInViewport({
		ratio: 1,
	});
	await expect(page.getByTestId("cloud-reset-confirm")).toBeEnabled();
	await page.screenshot({
		path: "/tmp/subman-cloud-reset-mobile.png",
		animations: "disabled",
	});
	await dialog.getByRole("button", { name: "取消", exact: true }).click();
	expect(cloud.mutations).toEqual([]);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
});
