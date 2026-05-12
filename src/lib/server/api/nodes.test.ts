import { describe, expect, it } from "bun:test";
import type { AppState, NodeItem } from "$lib/models";
import {
	EXTERNAL_KEY_TAG_PREFIX,
	applyNodeDelete,
	applyNodeUpsertByExternalKey,
	parseNodePayload,
} from "./nodes";

function stateWith(nodes: NodeItem[] = []): AppState {
	return {
		nodes,
		subscriptions: [],
		aggregates: [
			{
				id: "rule-1",
				name: "Rule 1",
				nodeIds: ["node-1", "node-2"],
				subscriptionIds: [],
				excludeTagIds: [],
				renameMap: {},
				allowedTypes: ["vless"],
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		],
		publishTargets: [],
		gists: [],
		activeGistId: "gist-1",
		activeGistFile: "subman.json",
		lastUpdated: "2026-01-01T00:00:00.000Z",
	};
}

describe("parseNodePayload", () => {
	it("normalizes valid node input", () => {
		const parsed = parseNodePayload({
			name: "vps-1",
			type: "vless",
			raw: "vless://example",
			tags: ["sing-box-vps", { id: "region", label: "HK" }],
		});

		expect(parsed).toEqual({
			name: "vps-1",
			type: "vless",
			raw: "vless://example",
			enabled: true,
			source: "single",
			tags: [
				{ id: "sing-box-vps", label: "sing-box-vps" },
				{ id: "region", label: "HK" },
			],
		});
	});

	it("accepts anytls node input", () => {
		const parsed = parseNodePayload({
			name: "anytls-1",
			type: "anytls",
			raw: "anytls://password@example.com:443?sni=example.com#AnyTLS",
		});

		expect(parsed.type).toBe("anytls");
		expect(parsed.raw).toBe("anytls://password@example.com:443?sni=example.com#AnyTLS");
	});

	it("rejects missing required node fields", () => {
		expect(() => parseNodePayload({ type: "vless", raw: "vless://example" })).toThrow(
			"name is required",
		);
		expect(() => parseNodePayload({ name: "vps-1", raw: "vless://example" })).toThrow(
			"type is required",
		);
		expect(() => parseNodePayload({ name: "vps-1", type: "vless" })).toThrow(
			"raw is required",
		);
	});
});

describe("applyNodeUpsertByExternalKey", () => {
	it("creates a node with an external key tag", () => {
		const result = applyNodeUpsertByExternalKey(
			stateWith(),
			"vps-1-vless",
			parseNodePayload({
				name: "vps-1",
				type: "vless",
				raw: "vless://example",
				tags: ["sing-box-vps"],
			}),
			{
				id: () => "node-1",
				now: () => "2026-05-06T00:00:00.000Z",
			},
		);

		expect(result.node.id).toBe("node-1");
		expect(result.node.tags.map((tag) => tag.label)).toEqual([
			"sing-box-vps",
			`${EXTERNAL_KEY_TAG_PREFIX}vps-1-vless`,
		]);
		expect(result.state.nodes).toHaveLength(1);
	});

	it("updates an existing external-key node without duplicating it", () => {
		const existing = applyNodeUpsertByExternalKey(
			stateWith(),
			"vps-1-vless",
			parseNodePayload({
				name: "vps-1",
				type: "vless",
				raw: "vless://old",
			}),
			{
				id: () => "node-1",
				now: () => "2026-05-06T00:00:00.000Z",
			},
		).state;

		const result = applyNodeUpsertByExternalKey(
			existing,
			"vps-1-vless",
			parseNodePayload({
				name: "vps-1 new",
				type: "vless",
				raw: "vless://new",
			}),
			{
				id: () => "node-2",
				now: () => "2026-05-06T01:00:00.000Z",
			},
		);

		expect(result.state.nodes).toHaveLength(1);
		expect(result.node.id).toBe("node-1");
		expect(result.node.name).toBe("vps-1 new");
		expect(result.node.raw).toBe("vless://new");
	});
});

describe("applyNodeDelete", () => {
	it("deletes a node and removes it from aggregate rules", () => {
		const result = applyNodeDelete(
			stateWith([
				{
					id: "node-1",
					name: "vps-1",
					type: "vless",
					raw: "vless://example",
					tags: [],
					enabled: true,
					source: "single",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			]),
			"node-1",
			"2026-05-06T00:00:00.000Z",
		);

		expect(result.deleted).toBe(true);
		expect(result.state.nodes).toEqual([]);
		expect(result.state.aggregates[0]?.nodeIds).toEqual(["node-2"]);
	});
});
