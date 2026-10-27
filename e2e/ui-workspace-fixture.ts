import type { BrowserContext, Page } from "@playwright/test";
import type { AppState } from "../../src/lib/models";

export type UiWorkspaceData = Pick<
	AppState,
	"nodes" | "subscriptions" | "aggregates" | "publishTargets" | "clientExports"
>;

export const defaultUiData: UiWorkspaceData = {
	nodes: [
		{
			id: "accessibility-node",
			name: "Accessibility Node",
			type: "vless",
			raw: "vless://00000000-0000-4000-8000-000000000001@example.com:443#A11y",
			tags: [],
			enabled: true,
			updatedAt: "2026-10-23T10:00:00.000Z",
			source: "single",
		},
	],
	subscriptions: [],
	aggregates: [],
	publishTargets: [],
	clientExports: [],
};

export async function seedUiWorkspace(
	page: Page,
	context: BrowserContext,
	data: UiWorkspaceData = structuredClone(defaultUiData),
) {
	const now = "2026-10-23T10:00:00.000Z";
	const gistId = "accessibility-cloud";

	const document = {
		version: 2,
		schemaVersion: 2,
		workspaceId: `gist:${gistId}`,
		revision: 0,
		updatedAt: now,
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
	await context.route("https://api.github.com/**", async (route) => {
		if (
			route.request().method() !== "GET" ||
			new URL(route.request().url()).pathname !== `/gists/${gistId}`
		) {
			await route.abort("blockedbyclient");
			return;
		}
		await route.fulfill({
			json: {
				id: gistId,
				owner: { login: "e2e" },
				description: "SubMan-Data",
				updated_at: now,
				html_url: `https://gist.github.com/e2e/${gistId}`,
				files: {
					"subman.json": {
						filename: "subman.json",
						raw_url: `https://gist.githubusercontent.com/e2e/${gistId}/raw/subman.json`,
						size: JSON.stringify(document).length,
						content: JSON.stringify(document),
						truncated: false,
					},
				},
			},
		});
	});
	await context.route("**/__e2e_seed__", (route) =>
		route.fulfill({
			status: 200,
			contentType: "text/html",
			body: "<!doctype html><title>SubMan E2E seed</title>",
		}),
	);
	await page.goto("/__e2e_seed__");
	await page.evaluate(
		async ({ gistId, now, data, document }) => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open("subman-workspace", 1);
				request.onupgradeneeded = () =>
					request.result.createObjectStore("workspace-state");
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(
					"workspace-state",
					"readwrite",
				);
				transaction.objectStore("workspace-state").put(
					{
						version: 1,
						snapshot: {
							...data,
							gists: [],
							activeGistId: gistId,
							activeGistFile: "subman.json",
							lastUpdated: now,
						},
						binding: {
							version: 2,
							gistId,
							workspaceId: `gist:${gistId}`,
							fileName: "subman.json",
							revision: 0,
							syncMode: "automatic",
							baseline: document,
							conflictBaseline: null,
						},
						workspaces: {},
						leases: {},
						quarantines: [],
						quarantinePayloads: {},
						nextFencingToken: 1,
						migration: {
							version: 1,
							phase: "confirmed",
							startedAt: now,
							copiedAt: now,
							validatedAt: now,
							updatedAt: now,
							confirmedAt: now,
							cleanupCompletedAt: now,
						},
					},
					"root",
				);
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			database.close();
			sessionStorage.setItem(
				"subman:auth:session:v2",
				JSON.stringify({
					version: 2,
					token: "fixture-accessibility-token",
					lastLoginAt: now,
				}),
			);
		},
		{ gistId, now, data, document },
	);
}
