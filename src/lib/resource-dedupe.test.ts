import { describe, expect, it } from "bun:test";
import type { NodeItem, SubscriptionItem } from "./models";
import {
	findDuplicateNodeRaw,
	findDuplicateSubscriptionUrl,
	makeUniqueResourceName,
} from "./resource-dedupe";

const timestamp = "2026-05-26 14:32";

describe("makeUniqueResourceName", () => {
	it("keeps a name when no saved resource has the same name", () => {
		expect(makeUniqueResourceName("HK", ["JP"], timestamp)).toBe("HK");
	});

	it("appends a timestamp when a saved resource has the same name", () => {
		expect(makeUniqueResourceName("HK", ["HK"], timestamp)).toBe(
			"HK 2026-05-26 14:32",
		);
	});

	it("appends a counter when the timestamped name is also taken", () => {
		expect(
			makeUniqueResourceName(
				"HK",
				["HK", "HK 2026-05-26 14:32"],
				timestamp,
			),
		).toBe("HK 2026-05-26 14:32 #2");
	});
});

describe("resource duplicate lookup", () => {
	const node = {
		id: "node-1",
		name: "HK",
		type: "vless",
		raw: "vless://uuid@example.com#HK",
		tags: [],
		enabled: true,
		updatedAt: "",
		source: "single",
	} satisfies NodeItem;

	const subscription = {
		id: "sub-1",
		name: "Main",
		url: "https://example.com/sub",
		tags: [],
		enabled: true,
		updatedAt: "",
	} satisfies SubscriptionItem;

	it("finds duplicate node raw values after trimming whitespace", () => {
		expect(
			findDuplicateNodeRaw([node], "  vless://uuid@example.com#HK  ")?.id,
		).toBe("node-1");
	});

	it("ignores the edited node when checking duplicate raw values", () => {
		expect(
			findDuplicateNodeRaw([node], "vless://uuid@example.com#HK", "node-1"),
		).toBeNull();
	});

	it("finds duplicate subscription URLs after trimming whitespace", () => {
		expect(
			findDuplicateSubscriptionUrl(
				[subscription],
				"  https://example.com/sub  ",
			)?.id,
		).toBe("sub-1");
	});

	it("ignores the edited subscription when checking duplicate URLs", () => {
		expect(
			findDuplicateSubscriptionUrl(
				[subscription],
				"https://example.com/sub",
				"sub-1",
			),
		).toBeNull();
	});
});
