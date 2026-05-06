import { describe, expect, it } from "bun:test";
import type { AppState } from "../../models";
import { readStateFromWorkspaceContent } from "./workspace";

const defaultState: AppState = {
	nodes: [],
	subscriptions: [],
	aggregates: [],
	publishTargets: [],
	gists: [],
	activeGistId: null,
	activeGistFile: "subman.json",
	lastUpdated: "2026-01-01T00:00:00.000Z",
};

function exportSyncState(state: AppState): string {
	return JSON.stringify({
		version: 1,
		exportedAt: "2026-05-06T00:00:00.000Z",
		data: state,
	});
}

describe("readStateFromWorkspaceContent", () => {
	it("imports existing sync content", () => {
		const content = exportSyncState({
			...defaultState,
			nodes: [
				{
					id: "node-1",
					name: "vps-1",
					type: "vless",
					raw: "vless://example",
					tags: [],
					enabled: true,
					source: "single",
					updatedAt: "2026-05-06T00:00:00.000Z",
				},
			],
		});

		const state = readStateFromWorkspaceContent(content);

		expect(state.nodes).toHaveLength(1);
		expect(state.nodes[0]?.name).toBe("vps-1");
	});

	it("falls back to default state when workspace content is empty", () => {
		const state = readStateFromWorkspaceContent("");

		expect(state.nodes).toEqual([]);
		expect(state.activeGistFile).toBe("subman.json");
	});
});
