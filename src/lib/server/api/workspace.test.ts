import { describe, expect, it } from "bun:test";
import type { AppState } from "../../models";
import { createSyncBaselineEnvelope } from "../../workspace-data";
import {
	readStateFromWorkspaceContent,
	transactServerWorkspace,
} from "./workspace";

const defaultState: AppState = {
	nodes: [],
	subscriptions: [],
	aggregates: [],
	publishTargets: [],
	clientExports: [],
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

describe("transactServerWorkspace", () => {
	it("runs server mutations through the shared workspace transaction", async () => {
		let transactionCalls = 0;
		const result = await transactServerWorkspace(
			"token",
			(state) => ({
				state: { ...state, lastUpdated: "2026-07-22T00:00:00.000Z" },
				value: "mutated",
			}),
			{
				ensureWorkspace: async () => ({
					gist: {
						id: "gist-1",
						description: "SubMan-Data",
						files: [],
						updatedAt: "2026-07-22T00:00:00.000Z",
						url: "https://gist.github.com/gist-1",
					},
					created: false,
				}),
				runTransaction: async (input) => {
					transactionCalls += 1;
					const mutation = await input.mutate?.(defaultState, {
						gist: {
							id: "gist-1",
							description: "SubMan-Data",
							files: [],
							updatedAt: "2026-07-22T00:00:00.000Z",
							url: "https://gist.github.com/gist-1",
						},
						gistId: "gist-1",
						fileName: "subman.json",
					});
					if (!mutation) throw new Error("Expected mutation");
					const state = "state" in mutation ? mutation.state : mutation;
					return {
						status: "committed",
						gist: {
							id: "gist-1",
							description: "SubMan-Data",
							files: [],
							updatedAt: "2026-07-22T00:00:00.000Z",
							url: "https://gist.github.com/gist-1",
						},
						state,
						baseline: createSyncBaselineEnvelope(
							state,
							"gist-1",
							"subman.json",
						),
						attempts: 1,
					};
				},
			},
		);

		expect(transactionCalls).toBe(1);
		expect(result.value).toBe("mutated");
		expect(result.gist.id).toBe("gist-1");
	});
});
