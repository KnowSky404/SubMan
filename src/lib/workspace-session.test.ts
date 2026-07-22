import { expect, test } from "bun:test";
import type { AppState } from "$lib/models";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import {
	bindWorkspaceOnly,
	pullWorkspaceExactly,
} from "$lib/workspace-session";

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
