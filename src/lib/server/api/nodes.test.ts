import { describe, expect, it } from "bun:test";
import type { AppState, NodeItem } from "$lib/models";
import {
	applyNodeCreate,
	applyNodeDelete,
	applyNodePatch,
	applyNodeUpsertByExternalKey,
	EXTERNAL_KEY_TAG_PREFIX,
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
		clientExports: [],
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
		expect(parsed.raw).toBe(
			"anytls://password@example.com:443?sni=example.com#AnyTLS",
		);
	});

	it("rejects missing required node fields", () => {
		expect(() =>
			parseNodePayload({ type: "vless", raw: "vless://example" }),
		).toThrow("name is required");
		expect(() =>
			parseNodePayload({ name: "vps-1", raw: "vless://example" }),
		).toThrow("type is required");
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

describe("node create and patch duplicate handling", () => {
	const existingNode = {
		id: "node-1",
		name: "HK",
		type: "vless",
		raw: "vless://existing",
		tags: [],
		enabled: true,
		source: "single",
		updatedAt: "2026-01-01T00:00:00.000Z",
	} satisfies NodeItem;

	it("adds a timestamp suffix when API create receives a duplicate name", () => {
		const result = applyNodeCreate(
			stateWith([existingNode]),
			parseNodePayload({
				name: "HK",
				type: "vless",
				raw: "vless://new",
			}),
			{
				id: () => "node-2",
				now: () => "2026-05-26T06:32:00.000Z",
			},
		);

		expect(result.node.name).toBe("HK 2026-05-26 06:32");
	});

	it("rejects API create when raw already exists", () => {
		expect(() =>
			applyNodeCreate(
				stateWith([existingNode]),
				parseNodePayload({
					name: "HK New",
					type: "vless",
					raw: " vless://existing ",
				}),
			),
		).toThrow("A node with the same raw URI already exists: HK");
	});

	it("adds a timestamp suffix when API patch receives a duplicate name", () => {
		const result = applyNodePatch(
			stateWith([
				existingNode,
				{
					...existingNode,
					id: "node-2",
					name: "JP",
					raw: "vless://new",
				},
			]),
			"node-2",
			{ name: "HK" },
			"2026-05-26T06:32:00.000Z",
		);

		expect(result.node?.name).toBe("HK 2026-05-26 06:32");
	});

	it("rejects API patch when raw already exists on another node", () => {
		expect(() =>
			applyNodePatch(
				stateWith([
					existingNode,
					{
						...existingNode,
						id: "node-2",
						name: "JP",
						raw: "vless://new",
					},
				]),
				"node-2",
				{ raw: "vless://existing" },
			),
		).toThrow("A node with the same raw URI already exists: HK");
	});

	it("keeps external-key upsert idempotent while applying duplicate-name rules", () => {
		const result = applyNodeUpsertByExternalKey(
			stateWith([existingNode]),
			"vps-1-vless",
			parseNodePayload({
				name: "HK",
				type: "vless",
				raw: "vless://new",
			}),
			{
				id: () => "node-2",
				now: () => "2026-05-26T06:32:00.000Z",
			},
		);

		expect(result.node.name).toBe("HK 2026-05-26 06:32");
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
