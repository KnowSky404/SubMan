import * as bunTest from "bun:test";
import type { GistMeta } from "$lib/models";
import {
	createWorkspaceBootstrapContent,
	discoverWorkspaceGist,
	ensureWorkspaceBootstrapGist,
	isValidWorkspaceBootstrapMarker,
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

		expect(result).toEqual({
			status: "found",
			gist: gist("saved"),
			candidate: {
				gist: gist("saved"),
				kind: "legacy-v1",
				currentBinding: true,
			},
		});
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

		expect(result.status).toBe("found");
		expect(result.status === "found" && result.candidate.kind).toBe(
			"legacy-v1",
		);
	});

	it("selects one materialized workspace without bootstrap ambiguity", async () => {
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

		expect(result.status).toBe("found");
		expect(result.status === "found" && result.gist.id).toBe("v2");
		expect(result.status === "found" && result.candidate.kind).toBe(
			"materialized-v2",
		);
	});

	it("returns chooser candidates for multiple materialized workspaces", async () => {
		const result = await discoverWorkspaceGist("token", null, {
			api: api({ listGists: mock(async () => [gist("one"), gist("two")]) }),
		});

		expect(result.status).toBe("chooser");
		expect(
			result.status === "chooser"
				? result.candidates.map((candidate) => candidate.kind)
				: [],
		).toEqual(["legacy-v1", "legacy-v1"]);
	});

	it("returns chooser data for multiple bootstrap-only workspaces", async () => {
		const first = gist("bootstrap-1", "SubMan-Data", "subman.bootstrap.json");
		const second = gist("bootstrap-2", "SubMan-Data", "subman.bootstrap.json");
		const result = await discoverWorkspaceGist("token", null, {
			api: api({
				listGists: mock(async () => [first, second]),
				getGistFileContent: mock(async () => JSON.stringify({ version: 1 })),
			}),
		});

		expect(result.status).toBe("chooser");
		expect(
			result.status === "chooser"
				? result.candidates.map((candidate) => candidate.kind)
				: [],
		).toEqual(["bootstrap-incomplete", "bootstrap-incomplete"]);
	});

	it("classifies an invalid bootstrap marker without selecting it", async () => {
		const invalid = gist("invalid", "SubMan-Data", "subman.bootstrap.json");
		const result = await discoverWorkspaceGist("token", null, {
			api: api({
				listGists: mock(async () => [invalid]),
				getGistFileContent: mock(async () => JSON.stringify({ version: 2 })),
			}),
		});

		expect(result).toEqual({
			status: "chooser",
			candidates: [
				{
					gist: invalid,
					kind: "invalid",
					currentBinding: false,
					reason: "invalid_bootstrap_marker",
				},
			],
		});
	});

	it("does not auto-resume a bootstrap marker with extra files", async () => {
		const candidate = {
			...gist("bootstrap-extra", "SubMan-Data", "subman.bootstrap.json"),
			files: [
				...gist("bootstrap-extra", "SubMan-Data", "subman.bootstrap.json")
					.files,
				{ filename: "notes.txt", language: "Text", size: 5 },
			],
		};
		const result = await discoverWorkspaceGist("token", null, {
			api: api({
				listGists: mock(async () => [candidate]),
				getGistFileContent: mock(async () => JSON.stringify({ version: 1 })),
			}),
		});

		expect(result.status).toBe("chooser");
		expect(
			result.status === "chooser" ? result.candidates[0]?.reason : null,
		).toBe("bootstrap_has_extra_files");
	});

	it("rejects an invalid stale marker beside valid V2 config", async () => {
		const candidate = {
			...gist("v2-with-marker"),
			files: [
				...gist("v2-with-marker").files,
				{
					filename: "subman.bootstrap.json",
					language: "JSON",
					size: 10,
				},
			],
		};
		const result = await discoverWorkspaceGist("token", null, {
			api: api({
				listGists: mock(async () => [candidate]),
				getGistFileContent: mock(
					async (_token: string, _gistId: string, fileName: string) =>
						fileName === "subman.json"
							? validV2Content.replace("gist:v2", "gist:v2-with-marker")
							: JSON.stringify({ version: 2 }),
				),
			}),
		});

		expect(result.status).toBe("chooser");
		expect(
			result.status === "chooser" ? result.candidates[0]?.reason : null,
		).toBe("invalid_bootstrap_marker");
	});
});

describe("workspace bootstrap markers", () => {
	it("accepts the legacy marker and the structured V2 marker", () => {
		expect(
			isValidWorkspaceBootstrapMarker(JSON.stringify({ version: 1 })),
		).toBe(true);
		expect(
			isValidWorkspaceBootstrapMarker(
				createWorkspaceBootstrapContent(
					"2026-07-23T00:00:00.000Z",
					"bootstrap-nonce",
				),
			),
		).toBe(true);
		expect(
			isValidWorkspaceBootstrapMarker(
				JSON.stringify({
					kind: "subman-workspace-bootstrap",
					bootstrapVersion: 2,
					createdAt: "not-a-time",
					nonce: "bootstrap-nonce",
				}),
			),
		).toBe(false);
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
			now: () => "2026-07-23T00:00:00.000Z",
			nonce: () => "bootstrap-nonce",
		});

		expect(result.created).toBe(true);
		expect(payload).toEqual({
			description: "SubMan-Data",
			isPublic: false,
			files: {
				"subman.bootstrap.json": {
					content: createWorkspaceBootstrapContent(
						"2026-07-23T00:00:00.000Z",
						"bootstrap-nonce",
					),
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
