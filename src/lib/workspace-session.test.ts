import { expect, test } from "bun:test";
import type { AppState, GistMeta } from "$lib/models";
import {
	createDefaultWorkspaceState,
	createSyncBaselineEnvelope,
	hydrateWorkspaceState,
} from "$lib/workspace-data";
import {
	bindWorkspaceOnly,
	pullWorkspaceExactly,
} from "$lib/workspace-session";
import {
	runWorkspaceTransaction,
	type WorkspaceTransactionTransport,
} from "$lib/workspace-transaction";

function state(overrides: Partial<AppState> = {}): AppState {
	return {
		...createDefaultWorkspaceState("2026-07-20T00:00:00.000Z"),
		...overrides,
	};
}

test("bind only changes identity without replacing local business data", () => {
	const local = state({
		nodes: [
			{
				id: "local",
				name: "Local",
				type: "vless",
				raw: "vless://local",
				tags: [],
				enabled: true,
				updatedAt: "2026-07-20T00:00:00.000Z",
				source: "single",
			},
		],
	});

	const bound = bindWorkspaceOnly(local, "gist-2", "subman.json");

	expect(bound.nodes).toEqual(local.nodes);
	expect(bound.lastUpdated).toBe(local.lastUpdated);
	expect(bound.activeGistId).toBe("gist-2");
});

test("exact pull keeps the remote lastUpdated value", () => {
	const remote = state({ lastUpdated: "2026-07-18T04:05:06.000Z" });

	const pulled = pullWorkspaceExactly(remote, "gist-2", "subman.json");

	expect(pulled.lastUpdated).toBe("2026-07-18T04:05:06.000Z");
	expect(pulled.activeGistId).toBe("gist-2");
});

test("pushing immediately after an exact pull is already synced", async () => {
	const gist: GistMeta = {
		id: "gist-2",
		description: "SubMan-Data",
		files: [{ filename: "subman.json", language: "JSON", size: 1 }],
		updatedAt: "2026-07-22T00:00:00.000Z",
		url: "https://gist.github.com/gist-2",
	};
	const remote = hydrateWorkspaceState(
		state({ lastUpdated: "2026-07-18T04:05:06.000Z" }),
		"gist-2",
		"subman.json",
	);
	const pulled = pullWorkspaceExactly(remote, "gist-2", "subman.json");
	let writes = 0;
	const transport: WorkspaceTransactionTransport = {
		read: async () => ({ gist, state: remote }),
		write: async () => {
			writes += 1;
			return gist;
		},
	};

	const result = await runWorkspaceTransaction(
		{
			token: "token",
			gistId: "gist-2",
			fileName: "subman.json",
			localState: pulled,
			baseline: createSyncBaselineEnvelope(pulled, "gist-2", "subman.json"),
		},
		{ transport },
	);

	expect(result.status).toBe("already-synced");
	expect(result.state.lastUpdated).toBe("2026-07-18T04:05:06.000Z");
	expect(writes).toBe(0);
});
