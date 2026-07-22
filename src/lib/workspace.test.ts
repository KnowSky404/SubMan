import * as bunTest from "bun:test";
import type { GistMeta } from "$lib/models";
import {
	discoverWorkspaceGist,
	ensureWorkspaceGist,
	type WorkspaceGistApi,
} from "$lib/workspace";
import {
	createDefaultWorkspaceState,
	serializeWorkspaceState,
} from "$lib/workspace-data";

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
	hasConfig = true,
): GistMeta {
	return {
		id,
		description,
		files: hasConfig
			? [
					{
						filename: "subman.json",
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
			gist("description-only", "SubMan-Data", false),
			gist("file-only", "Other", true),
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
	it("serializes concurrent ensure calls so only one gist is created", async () => {
		let created: GistMeta | null = null;
		const createGist = mock(async () => {
			await Promise.resolve();
			created = gist("created");
			return created;
		});
		const workspaceApi = api({
			createGist,
			listGists: mock(async () => (created ? [created] : [])),
		});

		const [first, second] = await Promise.all([
			ensureWorkspaceGist("token", validContent, { api: workspaceApi }),
			ensureWorkspaceGist("token", validContent, { api: workspaceApi }),
		]);

		expect(createGist.mock.calls).toHaveLength(1);
		expect(first.gist.id).toBe("created");
		expect(second.gist.id).toBe("created");
	});
});
