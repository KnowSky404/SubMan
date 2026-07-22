import { describe, expect, it } from "bun:test";
import type { AggregateRule, AppState, NodeItem } from "$lib/models";
import {
	createSyncBaselineEnvelope,
	getWorkspaceSignature,
	hydrateWorkspaceState,
	isTrustedSyncBaseline,
	mergeWorkspaceStateFromBaseline,
	parseWorkspaceState,
	reconcileWorkspaceState,
	serializeWorkspaceState,
} from "$lib/workspace-data";

function state(overrides: Partial<AppState> = {}): AppState {
	return {
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
		gists: [],
		activeGistId: "gist-1",
		activeGistFile: "subman.json",
		lastUpdated: "2026-07-20T00:00:00.000Z",
		...overrides,
	};
}

function node(id: string, updatedAt = "2026-07-20T00:00:00.000Z"): NodeItem {
	return {
		id,
		name: id,
		type: "vless",
		raw: `vless://${id}`,
		tags: [],
		enabled: true,
		updatedAt,
		source: "single",
	};
}

function aggregate(overrides: Partial<AggregateRule> = {}): AggregateRule {
	return {
		id: "aggregate-1",
		name: "All",
		nodeIds: ["node-1", "missing-node"],
		subscriptionIds: ["subscription-1", "missing-subscription"],
		excludeTagIds: [],
		renameMap: {},
		allowedTypes: ["vless"],
		updatedAt: "2026-07-20T00:00:00.000Z",
		...overrides,
	};
}

describe("workspace version 1 data", () => {
	it("signs only business data", () => {
		const original = state({ nodes: [node("node-1")] });
		const metadataOnly = state({
			...original,
			activeGistId: "gist-2",
			activeGistFile: "alternate.json",
			lastUpdated: "2026-07-21T00:00:00.000Z",
			gists: [
				{
					id: "gist-2",
					description: "UI cache",
					files: [],
					updatedAt: "2026-07-21T00:00:00.000Z",
					url: "https://gist.github.com/gist-2",
				},
			],
		});

		expect(getWorkspaceSignature(metadataOnly)).toBe(
			getWorkspaceSignature(original),
		);
	});

	it("round trips version 1 and exact hydrate preserves remote lastUpdated", () => {
		const remote = state({
			activeGistId: null,
			lastUpdated: "2026-07-19T12:34:56.000Z",
			nodes: [node("node-1")],
		});
		const serialized = serializeWorkspaceState(remote, {
			exportedAt: "2026-07-22T00:00:00.000Z",
		});
		const parsed = parseWorkspaceState(serialized);
		const hydrated = hydrateWorkspaceState(parsed, "gist-1", "subman.json");

		expect(JSON.parse(serialized).version).toBe(1);
		expect(hydrated.lastUpdated).toBe("2026-07-19T12:34:56.000Z");
		expect(hydrated.activeGistId).toBe("gist-1");
	});
});

describe("sync baseline envelope", () => {
	it("is trusted only for the exact gist and file", () => {
		const baseline = createSyncBaselineEnvelope(
			state({ nodes: [node("node-1")] }),
			"gist-1",
			"subman.json",
		);

		expect(isTrustedSyncBaseline(baseline, "gist-1", "subman.json")).toBe(true);
		expect(isTrustedSyncBaseline(baseline, "gist-2", "subman.json")).toBe(
			false,
		);
		expect(isTrustedSyncBaseline(baseline, "gist-1", "other.json")).toBe(false);
	});

	it("keeps a remote deletion during a three-way merge", () => {
		const baseline = state({ nodes: [node("kept"), node("removed")] });
		const local = state({
			nodes: [node("kept"), node("removed"), node("local")],
		});
		const remote = state({ nodes: [node("kept")] });

		const merged = mergeWorkspaceStateFromBaseline(local, remote, baseline);

		expect(merged.nodes.map((item) => item.id).sort()).toEqual([
			"kept",
			"local",
		]);
	});
});

describe("workspace reconciliation", () => {
	it("removes stale references and updates only aggregates that changed", () => {
		const unchanged = aggregate({
			id: "aggregate-unchanged",
			nodeIds: ["node-1"],
			subscriptionIds: ["subscription-1"],
		});
		const changed = aggregate();
		const result = reconcileWorkspaceState(
			state({
				nodes: [node("node-1")],
				subscriptions: [
					{
						id: "subscription-1",
						name: "Primary",
						url: "https://example.com/sub",
						enabled: true,
						tags: [],
						updatedAt: "2026-07-20T00:00:00.000Z",
					},
				],
				aggregates: [unchanged, changed],
			}),
			"2026-07-22T12:00:00.000Z",
		);

		expect(result.aggregates[0]).toEqual(unchanged);
		expect(result.aggregates[1]?.nodeIds).toEqual(["node-1"]);
		expect(result.aggregates[1]?.subscriptionIds).toEqual(["subscription-1"]);
		expect(result.aggregates[1]?.updatedAt).toBe("2026-07-22T12:00:00.000Z");
	});
});
