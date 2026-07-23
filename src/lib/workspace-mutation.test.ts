import { describe, expect, it } from "bun:test";
import type {
	AggregatePublishTarget,
	AggregateRule,
	ClientExportProfile,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";
import type {
	WorkspaceData,
	WorkspaceDocumentV2,
} from "$lib/workspace-document";
import {
	applyWorkspaceMutation,
	getWorkspaceMutationSignature,
	parseWorkspaceMutation,
	type WorkspaceMutation,
	type WorkspaceMutationError,
} from "$lib/workspace-mutation";

const T0 = "2026-07-22T10:00:00.000Z";
const T1 = "2026-07-22T11:00:00.000Z";
const WORKSPACE_ID = "gist:gist-1";

function node(id = "node-1", raw = `vless://${id}`): NodeItem {
	return {
		id,
		name: id,
		type: "vless",
		raw,
		tags: [],
		enabled: true,
		updatedAt: T0,
		source: "single",
	};
}

function subscription(id = "subscription-1"): SubscriptionItem {
	return {
		id,
		name: id,
		url: `https://example.com/${id}`,
		enabled: true,
		tags: [],
		updatedAt: T0,
	};
}

function aggregate(id = "aggregate-1"): AggregateRule {
	return {
		id,
		name: id,
		nodeIds: ["node-1"],
		subscriptionIds: ["subscription-1"],
		excludeTagIds: [],
		renameMap: {},
		allowedTypes: ["vless"],
		updatedAt: T0,
	};
}

function target(id = "target-1"): AggregatePublishTarget {
	return {
		id,
		name: id,
		ruleId: "aggregate-1",
		fileName: "aggregate.txt",
		description: "Aggregate",
		isPublic: false,
		lastPublishedAt: null,
		lastPublishedUrl: null,
		lastPublishTransitionAt: null,
		lastPublishTransitionFromFileName: null,
		lastPublishTransitionToFileName: null,
		lastPublishTransitionOutcome: null,
		updatedAt: T0,
	};
}

function profile(id = "export-1"): ClientExportProfile {
	return {
		id,
		name: id,
		type: "sing-box-client",
		ruleId: "aggregate-1",
		fileName: "client.json",
		options: {
			listenAddress: "127.0.0.1",
			listenPort: 2080,
			inboundType: "mixed",
			dnsMode: "conservative",
			routeMode: "global-proxy",
			includeExperimental: true,
			selectorTag: "proxy",
			urlTestTag: "auto",
		},
		lastGeneratedAt: null,
		lastPublishedAt: null,
		lastPublishedUrl: null,
		updatedAt: T0,
	};
}

function data(overrides: Partial<WorkspaceData> = {}): WorkspaceData {
	return {
		nodes: [node()],
		subscriptions: [subscription()],
		aggregates: [aggregate()],
		publishTargets: [target()],
		clientExports: [profile()],
		...overrides,
	};
}

function document(
	overrides: Partial<WorkspaceDocumentV2> = {},
): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision: 1,
		updatedAt: T0,
		lastMutationId: null,
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

function mutation(
	kind: WorkspaceMutation["kind"],
	payload: unknown,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		mutationId: "10000000-0000-4000-8000-000000000001",
		workspaceId: WORKSPACE_ID,
		expectedRevision: 1,
		source: "browser",
		createdAt: T1,
		kind,
		payload,
		...overrides,
	};
}

const context = {
	committedAt: T1,
	gist: {
		id: "gist-1",
		ownerLogin: "owner",
		files: [],
	},
};

function expectCode(
	action: () => unknown,
	code: WorkspaceMutationError["code"],
): void {
	try {
		action();
		throw new Error("Expected mutation to fail");
	} catch (error) {
		expect((error as WorkspaceMutationError).code).toBe(code);
	}
}

describe("Workspace mutation parsing", () => {
	it("parses every required mutation kind", () => {
		const fixtures: Array<[WorkspaceMutation["kind"], unknown]> = [
			["node.upsert", { operation: "replace", node: node() }],
			["node.delete", { id: "node-1" }],
			["subscription.upsert", { subscription: subscription() }],
			["subscription.delete", { id: "subscription-1" }],
			["aggregate.upsert", { aggregate: aggregate() }],
			["aggregate.delete", { id: "aggregate-1" }],
			["publish-target.upsert", { target: target() }],
			["publish-target.delete", { id: "target-1" }],
			["client-export.upsert", { profile: profile() }],
			["client-export.delete", { id: "export-1" }],
			[
				"aggregate.publish",
				{
					targetId: "target-1",
					output: { fileName: "aggregate.txt", content: "vless://node-1" },
				},
			],
			[
				"client-export.publish",
				{
					profileId: "export-1",
					output: { fileName: "client.json", content: "{}" },
				},
			],
			["output.delete", { fileName: "aggregate.txt" }],
			["workspace.reconcile", { baselineRevision: 0, data: data() }],
		];

		for (const [kind, payload] of fixtures) {
			expect(parseWorkspaceMutation(mutation(kind, payload)).kind).toBe(kind);
		}
	});

	it("rejects credentials, unknown fields, and source-specific node commands", () => {
		expectCode(
			() =>
				parseWorkspaceMutation({
					...mutation("node.delete", { id: "node-1" }),
					token: "secret",
				}),
			"invalid_mutation",
		);
		expectCode(
			() =>
				parseWorkspaceMutation(
					mutation("node.upsert", {
						operation: "create",
						nodeId: "node-2",
						node: {
							name: "node-2",
							type: "vless",
							raw: "vless://node-2",
							tags: [],
							enabled: true,
							source: "single",
						},
					}),
				),
			"invalid_mutation",
		);
		expectCode(
			() =>
				parseWorkspaceMutation(
					mutation(
						"aggregate.delete",
						{ id: "aggregate-1" },
						{ source: "server-api" },
					),
				),
			"invalid_mutation",
		);
		expectCode(
			() =>
				parseWorkspaceMutation(
					mutation(
						"node.upsert",
						{
							operation: "create",
							nodeId: "node-2",
							node: {
								name: "node-2",
								type: "vless",
								raw: "vless://node-2",
								tags: [{ id: "external:other", label: "external:other" }],
								enabled: true,
								source: "single",
							},
						},
						{ source: "server-api" },
					),
				),
			"invalid_mutation",
		);
	});

	it("creates a stable fixed-size signature independent of insertion order", async () => {
		const first = parseWorkspaceMutation(
			mutation("node.upsert", { operation: "replace", node: node() }),
		);
		const reordered = parseWorkspaceMutation({
			payload: {
				node: {
					source: "single",
					updatedAt: T0,
					enabled: true,
					tags: [],
					raw: "vless://node-1",
					type: "vless",
					name: "node-1",
					id: "node-1",
				},
				operation: "replace",
			},
			kind: "node.upsert",
			createdAt: T1,
			source: "browser",
			expectedRevision: 1,
			workspaceId: WORKSPACE_ID,
			mutationId: "10000000-0000-4000-8000-000000000001",
		});

		const firstSignature = await getWorkspaceMutationSignature(first);
		expect(await getWorkspaceMutationSignature(reordered)).toBe(firstSignature);
		expect(firstSignature).toHaveLength(64);
		expect(
			await getWorkspaceMutationSignature(
				parseWorkspaceMutation(
					mutation("node.upsert", {
						operation: "replace",
						node: { ...node(), name: "different" },
					}),
				),
			),
		).not.toBe(firstSignature);
	});
});

describe("Workspace mutation conflicts and tombstones", () => {
	it("checks revision before tombstones and blocks a fresh resurrection", () => {
		const deleted = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(mutation("node.delete", { id: "node-1" })),
			context,
		).document;
		const replacement = { ...node(), name: "resurrected", updatedAt: T1 };

		expectCode(
			() =>
				applyWorkspaceMutation(
					deleted,
					parseWorkspaceMutation(
						mutation("node.upsert", {
							operation: "replace",
							node: replacement,
						}),
					),
					context,
				),
			"revision_conflict",
		);
		expectCode(
			() =>
				applyWorkspaceMutation(
					deleted,
					parseWorkspaceMutation(
						mutation(
							"node.upsert",
							{ operation: "replace", node: replacement },
							{
								expectedRevision: 2,
								mutationId: "10000000-0000-4000-8000-000000000002",
							},
						),
					),
					context,
				),
			"entity_deleted",
		);
	});

	it("allows only one mutation from the same expected revision", () => {
		const first = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(
				mutation("node.upsert", {
					operation: "replace",
					node: { ...node(), name: "first", updatedAt: T1 },
				}),
			),
			context,
		).document;

		expectCode(
			() =>
				applyWorkspaceMutation(
					first,
					parseWorkspaceMutation(
						mutation(
							"subscription.upsert",
							{ subscription: { ...subscription(), name: "second" } },
							{ mutationId: "10000000-0000-4000-8000-000000000002" },
						),
					),
					context,
				),
			"revision_conflict",
		);
	});

	it("reconciles references and cascades aggregate dependents into tombstones", () => {
		const nodeDeleted = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(mutation("node.delete", { id: "node-1" })),
			context,
		).document;
		expect(nodeDeleted.data.aggregates[0]?.nodeIds).toEqual([]);
		expect(nodeDeleted.data.aggregates[0]?.updatedAt).toBe(T1);
		expect(nodeDeleted.tombstones.nodes[0]?.id).toBe("node-1");

		const aggregateDeleted = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(
				mutation("aggregate.delete", { id: "aggregate-1" }),
			),
			context,
		).document;
		expect(aggregateDeleted.data.publishTargets).toEqual([]);
		expect(aggregateDeleted.data.clientExports).toEqual([]);
		expect(aggregateDeleted.tombstones.aggregates[0]?.id).toBe("aggregate-1");
		expect(aggregateDeleted.tombstones.publishTargets[0]?.id).toBe("target-1");
		expect(aggregateDeleted.tombstones.clientExports[0]?.id).toBe("export-1");
	});

	it("applies direct upsert and delete transitions for every entity collection", () => {
		const upserts: Array<{
			kind: WorkspaceMutation["kind"];
			payload: unknown;
			readName: (value: WorkspaceDocumentV2) => string | undefined;
		}> = [
			{
				kind: "subscription.upsert",
				payload: { subscription: { ...subscription(), name: "updated-sub" } },
				readName: (value) => value.data.subscriptions[0]?.name,
			},
			{
				kind: "aggregate.upsert",
				payload: { aggregate: { ...aggregate(), name: "updated-aggregate" } },
				readName: (value) => value.data.aggregates[0]?.name,
			},
			{
				kind: "publish-target.upsert",
				payload: { target: { ...target(), name: "updated-target" } },
				readName: (value) => value.data.publishTargets[0]?.name,
			},
			{
				kind: "client-export.upsert",
				payload: { profile: { ...profile(), name: "updated-export" } },
				readName: (value) => value.data.clientExports[0]?.name,
			},
		];
		for (const item of upserts) {
			const result = applyWorkspaceMutation(
				document(),
				parseWorkspaceMutation(mutation(item.kind, item.payload)),
				context,
			).document;
			expect(item.readName(result)?.startsWith("updated-")).toBe(true);
			expect(result.revision).toBe(2);
		}

		const deletions: Array<{
			kind: WorkspaceMutation["kind"];
			id: string;
			readTombstone: (value: WorkspaceDocumentV2) => string | undefined;
		}> = [
			{
				kind: "subscription.delete",
				id: "subscription-1",
				readTombstone: (value) => value.tombstones.subscriptions[0]?.id,
			},
			{
				kind: "publish-target.delete",
				id: "target-1",
				readTombstone: (value) => value.tombstones.publishTargets[0]?.id,
			},
			{
				kind: "client-export.delete",
				id: "export-1",
				readTombstone: (value) => value.tombstones.clientExports[0]?.id,
			},
		];
		for (const item of deletions) {
			const result = applyWorkspaceMutation(
				document(),
				parseWorkspaceMutation(mutation(item.kind, { id: item.id })),
				context,
			).document;
			expect(item.readTombstone(result)).toBe(item.id);
			expect(result.revision).toBe(2);
		}
	});
});

describe("Workspace mutation domain behavior", () => {
	it("preserves external-key upsert ID and deterministic naming", () => {
		const nodeInput = {
			name: "node-1",
			type: "vless",
			raw: "vless://new",
			tags: [],
			enabled: true,
			source: "single",
		};
		const created = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(
				mutation(
					"node.upsert",
					{
						operation: "upsert-by-external-key",
						nodeId: "node-2",
						externalKey: "vps-1",
						node: nodeInput,
					},
					{ source: "server-api" },
				),
			),
			context,
		).document;
		const external = created.data.nodes.find((item) => item.id === "node-2");
		expect(external?.name).toBe("node-1 2026-07-22 11:00");
		expect(external?.tags.map((tag) => tag.label)).toContain("external:vps-1");

		const updated = applyWorkspaceMutation(
			created,
			parseWorkspaceMutation(
				mutation(
					"node.upsert",
					{
						operation: "upsert-by-external-key",
						nodeId: "unused-id",
						externalKey: "vps-1",
						node: { ...nodeInput, name: "renamed", raw: "vless://updated" },
					},
					{
						source: "server-api",
						expectedRevision: 2,
						mutationId: "10000000-0000-4000-8000-000000000002",
					},
				),
			),
			context,
		).document;
		expect(updated.data.nodes).toHaveLength(2);
		expect(updated.data.nodes.find((item) => item.id === "node-2")?.name).toBe(
			"renamed",
		);
	});

	it("serializes publication and node mutations without losing either change", () => {
		const published = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(
				mutation("aggregate.publish", {
					targetId: "target-1",
					output: { fileName: "aggregate.txt", content: "vless://node-1" },
				}),
			),
			context,
		);
		expect(published.files).toEqual({
			"aggregate.txt": { content: "vless://node-1" },
		});

		const withNode = applyWorkspaceMutation(
			published.document,
			parseWorkspaceMutation(
				mutation(
					"node.upsert",
					{
						operation: "create",
						nodeId: "node-2",
						node: {
							name: "node-2",
							type: "vless",
							raw: "vless://node-2",
							tags: [],
							enabled: true,
							source: "single",
						},
					},
					{
						source: "server-api",
						expectedRevision: 2,
						mutationId: "10000000-0000-4000-8000-000000000002",
					},
				),
			),
			context,
		).document;
		expect(withNode.data.nodes.map((item) => item.id)).toContain("node-2");
		expect(withNode.data.publishTargets[0]?.lastPublishedAt).toBe(T1);
	});

	it("preserves export publication when a later browser deletion commits", () => {
		const published = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(
				mutation("client-export.publish", {
					profileId: "export-1",
					output: { fileName: "client.json", content: "{}" },
				}),
			),
			context,
		).document;
		const deleted = applyWorkspaceMutation(
			published,
			parseWorkspaceMutation(
				mutation(
					"node.delete",
					{ id: "node-1" },
					{
						expectedRevision: 2,
						mutationId: "10000000-0000-4000-8000-000000000002",
					},
				),
			),
			context,
		).document;
		expect(deleted.data.clientExports[0]?.lastPublishedAt).toBe(T1);
		expect(deleted.tombstones.nodes[0]?.id).toBe("node-1");
	});

	it("deletes an output and clears every matching publication reference", () => {
		const current = document({
			data: data({
				publishTargets: [
					{
						...target(),
						lastPublishedAt: T0,
						lastPublishedUrl: "https://example.com/aggregate.txt",
					},
				],
				clientExports: [
					{
						...profile(),
						fileName: "aggregate.txt",
						lastPublishedAt: T0,
						lastPublishedUrl: "https://example.com/aggregate.txt",
					},
				],
			}),
		});
		const result = applyWorkspaceMutation(
			current,
			parseWorkspaceMutation(
				mutation("output.delete", { fileName: "aggregate.txt" }),
			),
			context,
		);

		expect(result.files).toEqual({ "aggregate.txt": null });
		expect(result.document.revision).toBe(2);
		const updatedTarget = result.document.data.publishTargets[0];
		expect(updatedTarget?.lastPublishedAt).toBeNull();
		expect(updatedTarget?.lastPublishedUrl).toBeNull();
		expect(updatedTarget?.updatedAt).toBe(T1);
		const updatedProfile = result.document.data.clientExports[0];
		expect(updatedProfile?.lastPublishedAt).toBeNull();
		expect(updatedProfile?.lastPublishedUrl).toBeNull();
		expect(updatedProfile?.lastGeneratedAt).toBeNull();
		expect(updatedProfile?.updatedAt).toBe(T1);
	});

	it("rejects deleting reserved Workspace files", () => {
		expectCode(
			() =>
				parseWorkspaceMutation(
					mutation("output.delete", { fileName: "subman.json" }),
				),
			"invalid_mutation",
		);
	});

	it("reconcile converts every omitted live entity into a tombstone", () => {
		const empty: WorkspaceData = {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		};
		const reconciled = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(
				mutation("workspace.reconcile", { baselineRevision: 0, data: empty }),
			),
			context,
		).document;

		expect(reconciled.data).toEqual(empty);
		expect(reconciled.tombstones.nodes[0]?.id).toBe("node-1");
		expect(reconciled.tombstones.subscriptions[0]?.id).toBe("subscription-1");
		expect(reconciled.tombstones.aggregates[0]?.id).toBe("aggregate-1");
		expect(reconciled.tombstones.publishTargets[0]?.id).toBe("target-1");
		expect(reconciled.tombstones.clientExports[0]?.id).toBe("export-1");
	});

	it("is deterministic and leaves the document and mutation untouched", () => {
		const original = document();
		const parsed = parseWorkspaceMutation(
			mutation("subscription.upsert", {
				subscription: { ...subscription(), name: "updated", updatedAt: T1 },
			}),
		);
		const documentSnapshot = JSON.stringify(original);
		const mutationSnapshot = JSON.stringify(parsed);

		expect(applyWorkspaceMutation(original, parsed, context)).toEqual(
			applyWorkspaceMutation(original, parsed, context),
		);
		expect(JSON.stringify(original)).toBe(documentSnapshot);
		expect(JSON.stringify(parsed)).toBe(mutationSnapshot);
	});
});
