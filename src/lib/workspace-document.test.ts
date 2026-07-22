import { describe, expect, it } from "bun:test";
import type {
	AggregatePublishTarget,
	AggregateRule,
	ClientExportProfile,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";
import {
	getWorkspaceContentSignature,
	migrateWorkspaceDocumentV1ToV2,
	parseWorkspaceDocument,
	serializeWorkspaceDocumentV2,
	type WorkspaceData,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";

const NOW = "2026-07-22T12:00:00.000Z";

function node(id: string): NodeItem {
	return {
		id,
		name: `Node ${id}`,
		type: "vless",
		raw: `vless://${id}`,
		tags: [{ id: "tag-hk", label: "HK" }],
		enabled: true,
		updatedAt: NOW,
		source: "single",
	};
}

function subscription(id: string): SubscriptionItem {
	return {
		id,
		name: `Subscription ${id}`,
		url: `https://example.com/${id}`,
		enabled: true,
		tags: [],
		updatedAt: NOW,
	};
}

function aggregate(id: string): AggregateRule {
	return {
		id,
		name: `Aggregate ${id}`,
		nodeIds: ["node-a", "node-b"],
		subscriptionIds: ["subscription-1"],
		excludeTagIds: ["tag-blocked"],
		renameMap: { "Node node-a": "Primary" },
		renameRules: ["s/old/new/"],
		allowedTypes: ["vless"],
		prependRegionFlags: true,
		customRegionFlagMap: "HK=flag",
		sortMode: "name",
		sortPriority: "HK",
		updatedAt: NOW,
	};
}

function publishTarget(id: string): AggregatePublishTarget {
	return {
		id,
		name: `Target ${id}`,
		ruleId: "aggregate-1",
		fileName: "aggregate.txt",
		description: "Published aggregate",
		isPublic: true,
		lastPublishedAt: null,
		lastPublishedUrl: null,
		lastPublishTransitionAt: null,
		lastPublishTransitionFromFileName: null,
		lastPublishTransitionToFileName: null,
		lastPublishTransitionOutcome: null,
		updatedAt: NOW,
	};
}

function clientExport(id: string): ClientExportProfile {
	return {
		id,
		name: `Export ${id}`,
		type: "sing-box-client",
		ruleId: "aggregate-1",
		fileName: "sing-box.json",
		options: {
			listenAddress: "127.0.0.1",
			listenPort: 2080,
			inboundType: "mixed",
			dnsMode: "conservative",
			routeMode: "global-proxy",
			includeExperimental: true,
			selectorTag: "Proxy",
			urlTestTag: "Auto",
		},
		lastGeneratedAt: null,
		lastPublishedAt: null,
		lastPublishedUrl: null,
		updatedAt: NOW,
	};
}

function data(): WorkspaceData {
	return {
		nodes: [node("node-b"), node("node-a")],
		subscriptions: [subscription("subscription-1")],
		aggregates: [aggregate("aggregate-1")],
		publishTargets: [publishTarget("target-1")],
		clientExports: [clientExport("export-1")],
	};
}

function document(
	overrides: Partial<WorkspaceDocumentV2> = {},
): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: "gist:gist-1",
		revision: 7,
		updatedAt: NOW,
		lastMutationId: "00000000-0000-4000-8000-000000000007",
		data: data(),
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
		...overrides,
	};
}

describe("Workspace Schema V2 migration", () => {
	it("migrates the real V1 envelope without losing business entities", () => {
		const source = {
			version: 1,
			exportedAt: NOW,
			data: {
				...data(),
				gists: [],
				activeGistId: "stale-client-gist",
				activeGistFile: "subman.json",
				lastUpdated: NOW,
			},
		};
		const parsed = parseWorkspaceDocument(JSON.stringify(source));
		if (parsed.schemaVersion !== 1) {
			throw new Error("Expected a V1 workspace document");
		}

		const migrated = migrateWorkspaceDocumentV1ToV2(parsed.document, {
			gistId: "gist-1",
			now: NOW,
		});

		expect(migrated.document.data).toEqual(data());
		expect(migrated.document.workspaceId).toBe("gist:gist-1");
		expect(migrated.document.revision).toBe(0);
		expect(migrated.document.lastMutationId).toBeNull();
		expect(migrated.binding).toEqual({
			gistId: "gist-1",
			fileName: "subman.json",
			syncMode: "automatic",
			baseline: null,
		});
	});

	it("accepts historical V1 documents with omitted optional collections", () => {
		const parsed = parseWorkspaceDocument(
			JSON.stringify({ version: 1, data: {} }),
		);
		if (parsed.schemaVersion !== 1) {
			throw new Error("Expected a V1 workspace document");
		}

		const migrated = migrateWorkspaceDocumentV1ToV2(parsed.document, {
			gistId: "gist-1",
			now: NOW,
		});

		expect(migrated.document.data).toEqual({
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		});
	});

	it("normalizes entity fields that older deployed V1 writers omitted", () => {
		const legacyAggregate = aggregate("aggregate-1") as unknown as Record<
			string,
			unknown
		>;
		const legacyTarget = publishTarget("target-1") as unknown as Record<
			string,
			unknown
		>;
		delete legacyAggregate.allowedTypes;
		delete legacyTarget.lastPublishTransitionAt;
		delete legacyTarget.lastPublishTransitionFromFileName;
		delete legacyTarget.lastPublishTransitionToFileName;
		delete legacyTarget.lastPublishTransitionOutcome;

		const parsed = parseWorkspaceDocument(
			JSON.stringify({
				version: 1,
				data: {
					...data(),
					aggregates: [legacyAggregate],
					publishTargets: [legacyTarget],
				},
			}),
		);
		if (parsed.schemaVersion !== 1) {
			throw new Error("Expected a V1 workspace document");
		}

		expect(parsed.document.data.aggregates[0]?.allowedTypes).toEqual([]);
		expect(parsed.document.data.publishTargets[0]).toEqual({
			...publishTarget("target-1"),
			lastPublishTransitionAt: null,
			lastPublishTransitionFromFileName: null,
			lastPublishTransitionToFileName: null,
			lastPublishTransitionOutcome: null,
		});
	});

	it("rejects malformed legacy Gist metadata instead of returning a typed lie", () => {
		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify({ version: 1, data: { gists: [null] } }),
			),
		).toThrow("data.gists[0] must be an object");
	});
});

describe("Workspace Schema V2 serialization", () => {
	it("is stable across object insertion order and preserves entity order", () => {
		const first = document();
		const reordered = {
			...first,
			data: {
				clientExports: first.data.clientExports.map((item) => ({ ...item })),
				publishTargets: first.data.publishTargets.map((item) => ({ ...item })),
				aggregates: first.data.aggregates.map((item) => ({ ...item })),
				subscriptions: first.data.subscriptions.map((item) => ({ ...item })),
				nodes: first.data.nodes.map((item) => ({
					updatedAt: item.updatedAt,
					source: item.source,
					enabled: item.enabled,
					tags: item.tags,
					raw: item.raw,
					type: item.type,
					name: item.name,
					id: item.id,
				})),
			},
		};

		expect(serializeWorkspaceDocumentV2(reordered)).toBe(
			serializeWorkspaceDocumentV2(first),
		);
		expect(
			parseWorkspaceDocument(
				serializeWorkspaceDocumentV2(first),
			).document.data.nodes.map((item) => item.id),
		).toEqual(["node-b", "node-a"]);
	});

	it("signs content independently of coordination and display fields", () => {
		const first = document();
		const metadataOnly = document({
			revision: 99,
			updatedAt: "2026-07-22T13:00:00.000Z",
			lastMutationId: "00000000-0000-4000-8000-000000000099",
		});

		expect(getWorkspaceContentSignature(metadataOnly)).toBe(
			getWorkspaceContentSignature(first),
		);
	});

	it("normalizes set-like aggregate selectors without mutating input", () => {
		const reordered = document({
			data: {
				...data(),
				aggregates: [
					{
						...aggregate("aggregate-1"),
						nodeIds: ["node-b", "node-a"],
						excludeTagIds: ["tag-z", "tag-a"],
						allowedTypes: ["vmess", "vless"],
					},
				],
			},
		});
		const equivalent = document({
			data: {
				...data(),
				aggregates: [
					{
						...aggregate("aggregate-1"),
						nodeIds: ["node-a", "node-b"],
						excludeTagIds: ["tag-a", "tag-z"],
						allowedTypes: ["vless", "vmess"],
					},
				],
			},
		});
		const originalOrder = reordered.data.aggregates[0]?.nodeIds.slice();

		expect(getWorkspaceContentSignature(reordered)).toBe(
			getWorkspaceContentSignature(equivalent),
		);
		expect(reordered.data.aggregates[0]?.nodeIds).toEqual(originalOrder);
	});

	it("round trips a fully populated V2 document", () => {
		const original = document();
		const parsed = parseWorkspaceDocument(
			serializeWorkspaceDocumentV2(original),
		);

		expect(parsed).toEqual({ schemaVersion: 2, document: original });
	});
});

describe("Workspace Schema V2 validation", () => {
	it("rejects unknown higher schemas before interpreting their data", () => {
		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify({ schemaVersion: 3, version: 3, data: data() }),
			),
		).toThrow("Unsupported workspace schema version: 3");
	});

	it("rejects invalid timestamps, duplicate IDs, and broken references", () => {
		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify(document({ updatedAt: "not-a-date" })),
			),
		).toThrow("updatedAt must be an ISO timestamp");

		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify(
					document({
						data: { ...data(), nodes: [node("node-a"), node("node-a")] },
					}),
				),
			),
		).toThrow("data.nodes contains duplicate id: node-a");

		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify(
					document({
						data: {
							...data(),
							aggregates: [
								{ ...aggregate("aggregate-1"), nodeIds: ["missing"] },
							],
						},
					}),
				),
			),
		).toThrow("references missing node: missing");
	});

	it("rejects a live entity that also has a tombstone", () => {
		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify(
					document({
						tombstones: {
							nodes: [
								{
									id: "node-a",
									deletedAt: NOW,
									deletedRevision: 6,
									mutationId: "00000000-0000-4000-8000-000000000006",
								},
							],
							subscriptions: [],
							aggregates: [],
							publishTargets: [],
							clientExports: [],
						},
					}),
				),
			),
		).toThrow("data.nodes id is both live and tombstoned: node-a");
	});

	it("rejects malformed mutation IDs and non-canonical timestamps", () => {
		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify(document({ lastMutationId: "not-a-uuid" })),
			),
		).toThrow("lastMutationId must be a UUID");

		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify(document({ updatedAt: "2026-02-31T00:00:00.000Z" })),
			),
		).toThrow("updatedAt must be an ISO timestamp");

		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify(document({ updatedAt: "2026-07-22" })),
			),
		).toThrow("updatedAt must be an ISO timestamp");
	});

	it("rejects duplicate tag IDs, labels, and external-key owners", () => {
		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify(
					document({
						data: {
							...data(),
							nodes: [
								{
									...node("node-a"),
									tags: [
										{ id: "tag-1", label: "HK" },
										{ id: "tag-1", label: "JP" },
									],
								},
								node("node-b"),
							],
						},
					}),
				),
			),
		).toThrow("data.nodes[0].tags contains duplicate id: tag-1");

		const first = {
			...node("node-a"),
			tags: [{ id: "external:shared", label: "external:shared" }],
		};
		const second = {
			...node("node-b"),
			tags: [{ id: "external:shared", label: "external:shared" }],
		};
		expect(() =>
			parseWorkspaceDocument(
				JSON.stringify(
					document({ data: { ...data(), nodes: [first, second] } }),
				),
			),
		).toThrow("data.nodes contains duplicate external key: external:shared");
	});
});
