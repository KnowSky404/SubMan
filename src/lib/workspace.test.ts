import * as bunTest from "bun:test";
import type { GistMeta } from "$lib/models";
import {
	discoverWorkspaceGist,
	ensureWorkspaceBootstrapGist,
	type WorkspaceGistApi,
} from "$lib/workspace";
import {
	createDefaultWorkspaceState,
	serializeWorkspaceState,
} from "$lib/workspace-data";
import { serializeWorkspaceDocumentV2 } from "$lib/workspace-document";

type MockedFunction<T extends (...args: never[]) => unknown> = T & {
	mock: { calls: unknown[][] };
};

const { describe, expect, it } = bunTest;
const { mock } = bunTest as unknown as {
	mock: <T extends (...args: never[]) => unknown>(
		callback: T,
	) => MockedFunction<T>;
};

function gist(
	id: string,
	description = "SubMan-Data",
	fileName: string | null = "subman.json",
): GistMeta {
	return {
		id,
		description,
		files: fileName
			? [
					{
						filename: fileName,
						language: "JSON",
						size: 10,
					},
				]
			: [],
		updatedAt: "2026-07-22T00:00:00.000Z",
		url: `https://gist.github.com/${id}`,
	};
}

const validContent = serializeWorkspaceState(createDefaultWorkspaceState());
const validV2Content = serializeWorkspaceDocumentV2({
	version: 2,
	schemaVersion: 2,
	workspaceId: "gist:v2",
	revision: 0,
	updatedAt: "2026-07-22T00:00:00.000Z",
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
});

function api(overrides: Partial<WorkspaceGistApi> = {}): WorkspaceGistApi {
	return {
		createGist: mock(async () => gist("created")),
		getGist: mock(async (_token: string, gistId: string) => gist(gistId)),
		getGistFileContent: mock(async () => validContent),
		listGists: mock(async () => []),
		...overrides,
	};
}

describe("workspace discovery", () => {
	it("validates a saved active gist before listing candidates", async () => {
		const listGists = mock(async () => [gist("fallback")]);
		const result = await discoverWorkspaceGist("token", "saved", {
			api: api({ listGists }),
		});

		expect(result).toEqual({ status: "found", gist: gist("saved") });
		expect(listGists.mock.calls).toHaveLength(0);
	});

	it("requires both workspace markers and parseable config", async () => {
		const candidates = [
			gist("description-only", "SubMan-Data", null),
			gist("file-only", "Other"),
			gist("invalid"),
			gist("valid"),
		];
		const result = await discoverWorkspaceGist("token", null, {
			api: api({
				listGists: mock(async () => candidates),
				getGistFileContent: mock(async (_token: string, gistId: string) =>
					gistId === "invalid" ? "not json" : validContent,
				),
			}),
		});

		expect(result).toEqual({ status: "found", gist: gist("valid") });
	});

	it("recognizes valid V2 documents and bootstrap markers", async () => {
		const bootstrap = gist("bootstrap", "SubMan-Data", "subman.bootstrap.json");
		const v2 = gist("v2");
		const result = await discoverWorkspaceGist("token", null, {
			api: api({
				listGists: mock(async () => [bootstrap, v2]),
				getGistFileContent: mock(
					async (_token: string, gistId: string, fileName: string) => {
						if (fileName === "subman.bootstrap.json") {
							return JSON.stringify({ version: 1 });
						}
						return gistId === "v2" ? validV2Content : validContent;
					},
				),
			}),
		});

		expect(result).toEqual({
			status: "ambiguous",
			gists: [bootstrap, v2],
		});
	});

	it("returns an explicit ambiguous result for multiple valid workspaces", async () => {
		const result = await discoverWorkspaceGist("token", null, {
			api: api({ listGists: mock(async () => [gist("one"), gist("two")]) }),
		});

		expect(result).toEqual({
			status: "ambiguous",
			gists: [gist("one"), gist("two")],
		});
	});
});

describe("workspace creation", () => {
	it("creates only the reserved bootstrap marker for coordinator initialization", async () => {
		let payload: Parameters<WorkspaceGistApi["createGist"]>[1] | null = null;
		const workspaceApi = api({
			createGist: mock(
				async (
					_token: string,
					input: Parameters<WorkspaceGistApi["createGist"]>[1],
				) => {
					payload = input;
					return gist("created", "SubMan-Data", "subman.bootstrap.json");
				},
			),
		});

		const result = await ensureWorkspaceBootstrapGist("token", {
			api: workspaceApi,
		});

		expect(result.created).toBe(true);
		expect(payload).toEqual({
			description: "SubMan-Data",
			isPublic: false,
			files: {
				"subman.bootstrap.json": {
					content: JSON.stringify({ version: 1 }),
				},
			},
		});
	});

	it("serializes concurrent ensure calls so only one gist is created", async () => {
		let created: GistMeta | null = null;
		const createGist = mock(async () => {
			await Promise.resolve();
			created = gist("created", "SubMan-Data", "subman.bootstrap.json");
			return created;
		});
		const workspaceApi = api({
			createGist,
			getGistFileContent: mock(async () => JSON.stringify({ version: 1 })),
			listGists: mock(async () => (created ? [created] : [])),
		});

		const [first, second] = await Promise.all([
			ensureWorkspaceBootstrapGist("token", { api: workspaceApi }),
			ensureWorkspaceBootstrapGist("token", { api: workspaceApi }),
		]);

		expect(createGist.mock.calls).toHaveLength(1);
		expect(first.gist.id).toBe("created");
		expect(second.gist.id).toBe("created");
	});
});
