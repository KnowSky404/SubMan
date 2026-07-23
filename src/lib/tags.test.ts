import { describe, expect, it } from "bun:test";
import type { NodeItem, SubscriptionItem } from "$lib/models";
import {
	parseTagLabels,
	reconcileTags,
	resolveLegacyExcludeTags,
} from "$lib/tags";

const node: NodeItem = {
	id: "node-1",
	name: "Node",
	type: "vless",
	raw: "vless://node",
	tags: [
		{ id: "tag-hk", label: "HK" },
		{ id: "shared-id", label: "Shared" },
	],
	enabled: true,
	updatedAt: "2026-07-23T00:00:00.000Z",
	source: "single",
};

const subscription: SubscriptionItem = {
	id: "subscription-1",
	name: "Subscription",
	url: "https://example.com/subscription",
	tags: [
		{ id: "tag-sub", label: "Subscription" },
		{ id: "shared-id", label: "Different" },
	],
	enabled: true,
	updatedAt: "2026-07-23T00:00:00.000Z",
};

describe("tag editing", () => {
	it("deduplicates normalized labels", () => {
		expect(parseTagLabels(" HK, gaming, hk, Gaming,  ")).toEqual([
			"HK",
			"gaming",
		]);
	});

	it("preserves IDs for unchanged labels and creates IDs only for new labels", () => {
		let nextId = 0;
		const result = reconcileTags(
			"hk, New, new",
			[
				{ id: "tag-hk", label: "HK" },
				{ id: "tag-removed", label: "Removed" },
			],
			() => `tag-new-${++nextId}`,
		);

		expect(result).toEqual([
			{ id: "tag-hk", label: "hk" },
			{ id: "tag-new-1", label: "New" },
		]);
		expect(nextId).toBe(1);
	});
});

describe("legacy aggregate exclusions", () => {
	it("maps known tag IDs to labels and preserves unresolved values", () => {
		expect(
			resolveLegacyExcludeTags(
				["tag-hk", "Subscription", "missing-tag"],
				[node],
				[subscription],
			),
		).toEqual({
			values: ["HK", "Subscription", "missing-tag"],
			warnings: [{ value: "missing-tag", reason: "unresolved" }],
			migrations: [{ from: "tag-hk", to: "HK" }],
		});
	});

	it("does not guess when a legacy ID maps to multiple labels", () => {
		expect(
			resolveLegacyExcludeTags(["shared-id"], [node], [subscription]),
		).toEqual({
			values: ["shared-id"],
			warnings: [{ value: "shared-id", reason: "ambiguous-id" }],
			migrations: [],
		});
	});

	it("prefers stable label semantics when a label equals another tag ID", () => {
		const collisionNode: NodeItem = {
			...node,
			id: "collision-node",
			tags: [{ id: "different-id", label: "tag-hk" }],
		};

		expect(
			resolveLegacyExcludeTags(
				["tag-hk"],
				[node, collisionNode],
				[subscription],
			),
		).toEqual({
			values: ["tag-hk"],
			warnings: [{ value: "tag-hk", reason: "ambiguous-id" }],
			migrations: [],
		});
	});
});
