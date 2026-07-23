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
import { serializeWorkspaceDocumentV2 } from "$lib/workspace-document";
import {
	getWorkspaceTombstoneWarnings,
	utf8ByteLength,
	WORKSPACE_LIMITS,
} from "$lib/workspace-limits";
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

function nodeInput(id = "node-1", raw = `vless://${id}`) {
	const { id: _id, updatedAt: _updatedAt, ...input } = node(id, raw);
	return input;
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
			["workspace.bootstrap.cleanup", {}],
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

describe("Workspace mutation domain limits", () => {
	it("rejects oversized node, subscription, and external-key fields", () => {
		expectCode(
			() =>
				parseWorkspaceMutation(
					mutation("node.upsert", {
						operation: "create",
						nodeId: "node-2",
						node: {
							...nodeInput("node-2"),
							raw: "x".repeat(WORKSPACE_LIMITS.nodeRawBytes + 1),
						},
					}),
				),
			"invalid_mutation",
		);
		expectCode(
			() =>
				applyWorkspaceMutation(
					document(),
					parseWorkspaceMutation(
						mutation("subscription.upsert", {
							subscription: {
								...subscription(),
								url: "x".repeat(WORKSPACE_LIMITS.subscriptionUrlBytes + 1),
							},
						}),
					),
					context,
				),
			"invalid_mutation",
		);
		expectCode(
			() =>
				parseWorkspaceMutation(
					mutation(
						"node.upsert",
						{
							operation: "upsert-by-external-key",
							nodeId: "node-2",
							externalKey: "x".repeat(WORKSPACE_LIMITS.externalKeyBytes + 1),
							node: nodeInput("node-2"),
						},
						{ source: "server-api" },
					),
				),
			"invalid_mutation",
		);
	});

	it("rejects oversized names, labels, and tag counts", () => {
		const oversizedName = "n".repeat(WORKSPACE_LIMITS.nameBytes + 1);
		for (const [kind, payload] of [
			[
				"node.upsert",
				{ operation: "replace", node: { ...node(), name: oversizedName } },
			],
			[
				"subscription.upsert",
				{ subscription: { ...subscription(), name: oversizedName } },
			],
			[
				"aggregate.upsert",
				{ aggregate: { ...aggregate(), name: oversizedName } },
			],
			[
				"publish-target.upsert",
				{ target: { ...target(), name: oversizedName } },
			],
			[
				"client-export.upsert",
				{ profile: { ...profile(), name: oversizedName } },
			],
		] as const) {
			expectCode(
				() =>
					applyWorkspaceMutation(
						document(),
						parseWorkspaceMutation(mutation(kind, payload)),
						context,
					),
				"invalid_mutation",
			);
		}
		expectCode(
			() =>
				applyWorkspaceMutation(
					document(),
					parseWorkspaceMutation(
						mutation("node.upsert", {
							operation: "replace",
							node: {
								...node(),
								tags: [
									{
										id: "tag",
										label: "x".repeat(WORKSPACE_LIMITS.labelBytes + 1),
									},
								],
							},
						}),
					),
					context,
				),
			"invalid_mutation",
		);
		expectCode(
			() =>
				applyWorkspaceMutation(
					document(),
					parseWorkspaceMutation(
						mutation("node.upsert", {
							operation: "replace",
							node: {
								...node(),
								tags: Array.from(
									{ length: WORKSPACE_LIMITS.tagsPerEntity + 1 },
									(_, index) => ({ id: `tag-${index}`, label: `tag-${index}` }),
								),
							},
						}),
					),
					context,
				),
			"invalid_mutation",
		);
	});

	it("rejects oversized rename maps and published outputs", () => {
		expectCode(
			() =>
				applyWorkspaceMutation(
					document(),
					parseWorkspaceMutation(
						mutation("aggregate.upsert", {
							aggregate: {
								...aggregate(),
								renameMap: Object.fromEntries(
									Array.from(
										{ length: WORKSPACE_LIMITS.renameMapEntries + 1 },
										(_, index) => [`from-${index}`, `to-${index}`],
									),
								),
							},
						}),
					),
					context,
				),
			"invalid_mutation",
		);
		expectCode(
			() =>
				applyWorkspaceMutation(
					document(),
					parseWorkspaceMutation(
						mutation("aggregate.upsert", {
							aggregate: {
								...aggregate(),
								renameMap: {
									from: "x".repeat(WORKSPACE_LIMITS.renameMapBytes),
								},
							},
						}),
					),
					context,
				),
			"invalid_mutation",
		);
		for (const kind of [
			"aggregate.publish",
			"client-export.publish",
		] as const) {
			const owner =
				kind === "aggregate.publish"
					? { targetId: "target-1" }
					: { profileId: "export-1" };
			expectCode(
				() =>
					parseWorkspaceMutation(
						mutation(kind, {
							...owner,
							output: {
								fileName: "output.txt",
								content: "x".repeat(WORKSPACE_LIMITS.outputContentBytes + 1),
							},
						}),
					),
				"invalid_mutation",
			);
		}
	});

	it("allows unchanged oversized legacy fields but rejects changing them", () => {
		const legacyRaw = "x".repeat(WORKSPACE_LIMITS.nodeRawBytes + 1);
		const current = document({
			data: data({ nodes: [node("node-1", legacyRaw)] }),
		});
		const currentAggregate = current.data.aggregates[0];
		const currentNode = current.data.nodes[0];
		if (!currentAggregate || !currentNode) {
			throw new Error("fixture is incomplete");
		}
		const unchanged = mutation("workspace.reconcile", {
			baselineRevision: 1,
			data: {
				...current.data,
				aggregates: [{ ...currentAggregate, name: "Updated rule" }],
			},
		}) as WorkspaceMutation;
		expect(
			applyWorkspaceMutation(current, unchanged, context).document.data.nodes[0]
				?.raw,
		).toBe(legacyRaw);

		const changed = mutation("workspace.reconcile", {
			baselineRevision: 1,
			data: {
				...current.data,
				nodes: [
					{
						...currentNode,
						raw: `${legacyRaw}changed`,
					},
				],
			},
		}) as WorkspaceMutation;
		expectCode(
			() => applyWorkspaceMutation(current, changed, context),
			"invalid_mutation",
		);
	});

	it("allows full upserts to preserve unchanged oversized legacy fields", () => {
		const legacyName = "n".repeat(WORKSPACE_LIMITS.nameBytes + 1);
		const legacyRaw = "r".repeat(WORKSPACE_LIMITS.nodeRawBytes + 1);
		const legacyUrl = "u".repeat(WORKSPACE_LIMITS.subscriptionUrlBytes + 1);
		const legacyLabel = "l".repeat(WORKSPACE_LIMITS.labelBytes + 1);
		const legacyRenameMap = {
			from: "x".repeat(WORKSPACE_LIMITS.renameMapBytes),
		};
		const current = document({
			data: data({
				nodes: [{ ...node(), raw: legacyRaw }],
				subscriptions: [{ ...subscription(), url: legacyUrl }],
				aggregates: [{ ...aggregate(), renameMap: legacyRenameMap }],
				publishTargets: [{ ...target(), name: legacyName }],
				clientExports: [
					{
						...profile(),
						options: { ...profile().options, selectorTag: legacyLabel },
					},
				],
			}),
		});
		const cases: Array<{
			kind: WorkspaceMutation["kind"];
			payload: unknown;
		}> = [
			{
				kind: "node.upsert",
				payload: {
					operation: "replace",
					node: { ...current.data.nodes[0], name: "updated-node" },
				},
			},
			{
				kind: "subscription.upsert",
				payload: {
					subscription: {
						...current.data.subscriptions[0],
						name: "updated-subscription",
					},
				},
			},
			{
				kind: "aggregate.upsert",
				payload: {
					aggregate: {
						...current.data.aggregates[0],
						allowedTypes: ["vmess"],
					},
				},
			},
			{
				kind: "publish-target.upsert",
				payload: {
					target: {
						...current.data.publishTargets[0],
						description: "Updated description",
					},
				},
			},
			{
				kind: "client-export.upsert",
				payload: {
					profile: {
						...current.data.clientExports[0],
						options: {
							...current.data.clientExports[0]?.options,
							includeExperimental: false,
						},
					},
				},
			},
		];
		for (const item of cases) {
			applyWorkspaceMutation(
				current,
				parseWorkspaceMutation(mutation(item.kind, item.payload)),
				context,
			);
		}
	});

	it("validates only the bounded field changed by a full upsert", () => {
		const legacyName = "n".repeat(WORKSPACE_LIMITS.nameBytes + 1);
		const legacyLabel = "l".repeat(WORKSPACE_LIMITS.labelBytes + 1);
		const aggregateDocument = document({
			data: data({
				aggregates: [{ ...aggregate(), name: legacyName }],
			}),
		});
		applyWorkspaceMutation(
			aggregateDocument,
			parseWorkspaceMutation(
				mutation("aggregate.upsert", {
					aggregate: {
						...aggregateDocument.data.aggregates[0],
						renameMap: { from: "to" },
					},
				}),
			),
			context,
		);

		const profileDocument = document({
			data: data({
				clientExports: [
					{
						...profile(),
						name: legacyName,
						options: { ...profile().options, urlTestTag: legacyLabel },
					},
				],
			}),
		});
		applyWorkspaceMutation(
			profileDocument,
			parseWorkspaceMutation(
				mutation("client-export.upsert", {
					profile: {
						...profileDocument.data.clientExports[0],
						options: {
							...profileDocument.data.clientExports[0]?.options,
							selectorTag: "updated-selector",
						},
					},
				}),
			),
			context,
		);
	});

	it("validates generated external tags and deduplicated names", () => {
		const tags = Array.from(
			{ length: WORKSPACE_LIMITS.tagsPerEntity },
			(_, index) => ({ id: `tag-${index}`, label: `tag-${index}` }),
		);
		for (const input of [
			{
				externalKey: "external-key",
				node: { ...nodeInput("node-2"), tags },
			},
			{
				externalKey: "x".repeat(WORKSPACE_LIMITS.labelBytes),
				node: nodeInput("node-2"),
			},
		]) {
			expectCode(
				() =>
					applyWorkspaceMutation(
						document(),
						parseWorkspaceMutation(
							mutation(
								"node.upsert",
								{
									operation: "upsert-by-external-key",
									nodeId: "node-2",
									...input,
								},
								{ source: "server-api" },
							),
						),
						context,
					),
				"invalid_mutation",
			);
		}

		const maximumName = "n".repeat(WORKSPACE_LIMITS.nameBytes);
		const current = document({
			data: data({ nodes: [{ ...node(), name: maximumName }] }),
		});
		expectCode(
			() =>
				applyWorkspaceMutation(
					current,
					parseWorkspaceMutation(
						mutation(
							"node.upsert",
							{
								operation: "create",
								nodeId: "node-2",
								node: { ...nodeInput("node-2"), name: maximumName },
							},
							{ source: "server-api" },
						),
					),
					context,
				),
			"invalid_mutation",
		);
	});

	it("counts UTF-8 bytes and accepts exact field limits", () => {
		const exactRaw = "\u00e9".repeat(WORKSPACE_LIMITS.nodeRawBytes / 2);
		expect(utf8ByteLength(exactRaw)).toBe(WORKSPACE_LIMITS.nodeRawBytes);
		applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(
				mutation(
					"node.upsert",
					{
						operation: "create",
						nodeId: "node-2",
						node: { ...nodeInput("node-2"), raw: exactRaw },
					},
					{ source: "server-api" },
				),
			),
			context,
		);
		expectCode(
			() =>
				parseWorkspaceMutation(
					mutation(
						"node.upsert",
						{
							operation: "create",
							nodeId: "node-2",
							node: { ...nodeInput("node-2"), raw: `${exactRaw}\u00e9` },
						},
						{ source: "server-api" },
					),
				),
			"invalid_mutation",
		);
	});

	it("rejects collection growth beyond the entity cap", () => {
		const nodes = Array.from(
			{ length: WORKSPACE_LIMITS.entitiesPerCollection },
			(_, index) => node(`node-${index}`),
		);
		const current = document({
			data: data({
				nodes,
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			}),
		});
		const reconcile = mutation("workspace.reconcile", {
			baselineRevision: 1,
			data: { ...current.data, nodes: [...nodes, node("node-over-limit")] },
		}) as WorkspaceMutation;
		expectCode(
			() => applyWorkspaceMutation(current, reconcile, context),
			"invalid_mutation",
		);
	});

	it("reports tombstone thresholds without rejecting the document", () => {
		const tombstones = Array.from(
			{ length: WORKSPACE_LIMITS.tombstoneWarningPerCollection + 1 },
			(_, index) => ({
				id: `deleted-${index}`,
				deletedAt: T1,
				deletedRevision: 1,
				mutationId: "10000000-0000-4000-8000-000000000001",
			}),
		);
		const current = document({
			tombstones: { ...document().tombstones, nodes: tombstones },
		});
		expect(getWorkspaceTombstoneWarnings(current)).toEqual({
			nodes: tombstones.length,
		});
	});

	it("uses canonical serialized bytes for new document growth", () => {
		const base = document({
			data: data({
				nodes: [node("node-1", "x")],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			}),
		});
		const baseBytes = utf8ByteLength(serializeWorkspaceDocumentV2(base));
		const exact = document({
			...base,
			data: {
				...base.data,
				nodes: [
					node(
						"node-1",
						"x".repeat(WORKSPACE_LIMITS.workspaceDocumentBytes - baseBytes + 1),
					),
				],
			},
		});
		expect(utf8ByteLength(serializeWorkspaceDocumentV2(exact))).toBe(
			WORKSPACE_LIMITS.workspaceDocumentBytes,
		);
		expectCode(
			() =>
				applyWorkspaceMutation(
					exact,
					parseWorkspaceMutation(
						mutation("subscription.upsert", {
							subscription: subscription(),
						}),
					),
					context,
				),
			"invalid_mutation",
		);
	});

	it("blocks growth of an oversized document but allows neutral and shrinking repairs", () => {
		const current = document({
			lastMutationId: "00000000-0000-4000-8000-000000000000",
			data: data({
				nodes: [
					node("node-1", "x".repeat(WORKSPACE_LIMITS.workspaceDocumentBytes)),
				],
			}),
		});
		const growth = mutation("aggregate.upsert", {
			aggregate: { ...aggregate(), name: "A longer aggregate name" },
		}) as WorkspaceMutation;
		expectCode(
			() => applyWorkspaceMutation(current, growth, context),
			"workspace_size_limit",
		);
		const neutral = mutation("node.upsert", {
			operation: "replace",
			node: {
				...current.data.nodes[0],
				name: "node-2",
			},
		}) as WorkspaceMutation;
		applyWorkspaceMutation(current, neutral, context);

		const shrink = mutation("node.delete", {
			id: "node-1",
		}) as WorkspaceMutation;
		expect(
			applyWorkspaceMutation(current, shrink, context).document.data.nodes,
		).toEqual([]);
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
	it("preserves target publication metadata on ordinary edits", () => {
		const publishedTarget = {
			...target(),
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/aggregate.txt",
			lastPublishTransitionAt: T0,
			lastPublishTransitionFromFileName: "old.txt",
			lastPublishTransitionToFileName: "aggregate.txt",
			lastPublishTransitionOutcome: "kept_manual" as const,
		};
		const result = applyWorkspaceMutation(
			document({ data: data({ publishTargets: [publishedTarget] }) }),
			parseWorkspaceMutation(
				mutation("publish-target.upsert", {
					target: {
						...publishedTarget,
						name: "Renamed target",
						ruleId: "aggregate-1",
					},
				}),
			),
			context,
		).document.data.publishTargets[0];

		expect(result?.name).toBe("Renamed target");
		expect(result?.lastPublishedAt).toBe(T0);
		expect(result?.lastPublishedUrl).toBe("https://example.com/aggregate.txt");
		expect(result?.lastPublishTransitionFromFileName).toBe("old.txt");
		expect(result?.lastPublishTransitionOutcome).toBe("kept_manual");
		expect(result?.updatedAt).toBe(T0);
	});

	it("does not trust publication metadata claimed by newly created owners", () => {
		const claimedTarget = {
			...target("target-2"),
			fileName: "claimed.txt",
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/claimed.txt",
			lastPublishTransitionAt: T0,
			lastPublishTransitionFromFileName: "before.txt",
			lastPublishTransitionToFileName: "claimed.txt",
			lastPublishTransitionOutcome: "auto_deleted" as const,
		};
		const targetCreated = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(
				mutation("publish-target.upsert", { target: claimedTarget }),
			),
			context,
		).document.data.publishTargets.find((item) => item.id === "target-2");
		expect(targetCreated?.lastPublishedAt).toBeNull();
		expect(targetCreated?.lastPublishedUrl).toBeNull();
		expect(targetCreated?.lastPublishTransitionAt).toBeNull();

		const claimedProfile = {
			...profile("export-2"),
			fileName: "claimed.json",
			lastGeneratedAt: T0,
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/claimed.json",
		};
		const profileCreated = applyWorkspaceMutation(
			document(),
			parseWorkspaceMutation(
				mutation("client-export.upsert", { profile: claimedProfile }),
			),
			context,
		).document.data.clientExports.find((item) => item.id === "export-2");
		expect(profileCreated?.lastGeneratedAt).toBeNull();
		expect(profileCreated?.lastPublishedAt).toBeNull();
		expect(profileCreated?.lastPublishedUrl).toBeNull();
	});

	it("preserves export publication metadata only for output-equivalent edits", () => {
		const publishedProfile = {
			...profile(),
			lastGeneratedAt: T0,
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/client.json",
		};
		const renamed = applyWorkspaceMutation(
			document({ data: data({ clientExports: [publishedProfile] }) }),
			parseWorkspaceMutation(
				mutation("client-export.upsert", {
					profile: { ...publishedProfile, name: "Renamed export" },
				}),
			),
			context,
		).document.data.clientExports[0];
		expect(renamed?.lastPublishedAt).toBe(T0);
		expect(renamed?.lastPublishedUrl).toBe("https://example.com/client.json");

		const changed = applyWorkspaceMutation(
			document({ data: data({ clientExports: [publishedProfile] }) }),
			parseWorkspaceMutation(
				mutation("client-export.upsert", {
					profile: { ...publishedProfile, fileName: "changed.json" },
				}),
			),
			context,
		).document.data.clientExports[0];
		expect(changed?.lastGeneratedAt).toBeNull();
		expect(changed?.lastPublishedAt).toBeNull();
		expect(changed?.lastPublishedUrl).toBeNull();
	});

	it("records filename transitions and applies the requested cleanup policy", () => {
		const publishedTarget = {
			...target(),
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/aggregate.txt",
		};
		const result = applyWorkspaceMutation(
			document({ data: data({ publishTargets: [publishedTarget] }) }),
			parseWorkspaceMutation(
				mutation("publish-target.upsert", {
					target: { ...publishedTarget, fileName: "renamed.txt" },
					previousFileCleanup: "delete-if-unreferenced",
				}),
			),
			context,
		);
		const updated = result.document.data.publishTargets[0];

		expect(result.files).toEqual({ "aggregate.txt": null });
		expect(updated?.lastPublishedAt).toBe(T0);
		expect(updated?.lastPublishedUrl).toBe("https://example.com/aggregate.txt");
		expect(updated?.lastPublishTransitionAt).toBe(T1);
		expect(updated?.lastPublishTransitionFromFileName).toBe("aggregate.txt");
		expect(updated?.lastPublishTransitionToFileName).toBe("renamed.txt");
		expect(updated?.lastPublishTransitionOutcome).toBe("auto_deleted");
		expect(updated?.updatedAt).toBe(T1);
	});

	it("keeps a renamed target output when another owner still references it", () => {
		const publishedTarget = {
			...target(),
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/aggregate.txt",
		};
		const result = applyWorkspaceMutation(
			document({
				data: data({
					publishTargets: [publishedTarget],
					clientExports: [{ ...profile(), fileName: "aggregate.txt" }],
				}),
			}),
			parseWorkspaceMutation(
				mutation("publish-target.upsert", {
					target: { ...publishedTarget, fileName: "renamed.txt" },
					previousFileCleanup: "delete-if-unreferenced",
				}),
			),
			context,
		);

		expect(result.files).toEqual({});
		expect(
			result.document.data.publishTargets[0]?.lastPublishTransitionOutcome,
		).toBe("kept_shared");
	});

	it("atomically deletes target configuration and only unreferenced published output", () => {
		const publishedTarget = {
			...target(),
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/aggregate.txt",
		};
		const retained = applyWorkspaceMutation(
			document({ data: data({ publishTargets: [publishedTarget] }) }),
			parseWorkspaceMutation(
				mutation("publish-target.delete", {
					id: publishedTarget.id,
					cleanupUnreferencedOutputs: false,
				}),
			),
			context,
		);
		expect(retained.document.data.publishTargets).toEqual([]);
		expect(retained.files).toEqual({});

		const deleted = applyWorkspaceMutation(
			document({ data: data({ publishTargets: [publishedTarget] }) }),
			parseWorkspaceMutation(
				mutation("publish-target.delete", {
					id: publishedTarget.id,
					cleanupUnreferencedOutputs: true,
				}),
			),
			context,
		);
		expect(deleted.document.data.publishTargets).toEqual([]);
		expect(deleted.files).toEqual({ "aggregate.txt": null });
	});

	it("keeps target output cleanup when another owner references the filename", () => {
		const result = applyWorkspaceMutation(
			document({
				data: data({
					publishTargets: [{ ...target(), lastPublishedAt: T0 }],
					clientExports: [{ ...profile(), fileName: "aggregate.txt" }],
				}),
			}),
			parseWorkspaceMutation(
				mutation("publish-target.delete", {
					id: "target-1",
					cleanupUnreferencedOutputs: true,
				}),
			),
			context,
		);

		expect(result.files).toEqual({});
		expect(result.document.data.clientExports).toHaveLength(1);
	});

	it("does not delete a renamed target filename before it has been published", () => {
		const publishedTarget = {
			...target(),
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/aggregate.txt",
		};
		const renamed = applyWorkspaceMutation(
			document({ data: data({ publishTargets: [publishedTarget] }) }),
			parseWorkspaceMutation(
				mutation("publish-target.upsert", {
					target: { ...publishedTarget, fileName: "renamed.txt" },
					previousFileCleanup: "keep",
				}),
			),
			context,
		).document;
		const deleted = applyWorkspaceMutation(
			renamed,
			parseWorkspaceMutation(
				mutation(
					"publish-target.delete",
					{
						id: "target-1",
						cleanupUnreferencedOutputs: true,
					},
					{
						expectedRevision: 2,
						mutationId: "10000000-0000-4000-8000-000000000002",
					},
				),
			),
			context,
		);

		expect(deleted.files).toEqual({});
	});

	it("atomically cleans published outputs while deleting an aggregate", () => {
		const result = applyWorkspaceMutation(
			document({
				data: data({
					publishTargets: [
						{
							...target(),
							lastPublishedAt: T0,
							lastPublishedUrl: "https://example.com/aggregate.txt",
						},
					],
					clientExports: [{ ...profile(), lastPublishedAt: T0 }],
				}),
			}),
			parseWorkspaceMutation(
				mutation("aggregate.delete", {
					id: "aggregate-1",
					cleanupUnreferencedOutputs: true,
				}),
			),
			context,
		);

		expect(result.document.data.aggregates).toEqual([]);
		expect(result.document.data.publishTargets).toEqual([]);
		expect(result.document.data.clientExports).toEqual([]);
		expect(result.files).toEqual({
			"aggregate.txt": null,
			"client.json": null,
		});
	});

	it("blocks new output ownership conflicts and publication of legacy conflicts", () => {
		const conflicting = document({
			data: data({
				publishTargets: [target()],
				clientExports: [{ ...profile(), fileName: "aggregate.txt" }],
			}),
		});
		expectCode(
			() =>
				applyWorkspaceMutation(
					document(),
					parseWorkspaceMutation(
						mutation("client-export.upsert", {
							profile: { ...profile(), fileName: "aggregate.txt" },
						}),
					),
					context,
				),
			"output_file_conflict",
		);
		expectCode(
			() =>
				applyWorkspaceMutation(
					conflicting,
					parseWorkspaceMutation(
						mutation("aggregate.publish", {
							targetId: "target-1",
							output: { fileName: "aggregate.txt", content: "value" },
						}),
					),
					context,
				),
			"output_file_conflict",
		);
	});

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

	it("reconcile preserves only server-established publication metadata", () => {
		const publishedTarget = {
			...target(),
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/aggregate.txt",
		};
		const publishedProfile = {
			...profile(),
			lastGeneratedAt: T0,
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/client.json",
		};
		const current = document({
			data: data({
				publishTargets: [publishedTarget],
				clientExports: [publishedProfile],
			}),
		});
		const resolved = data({
			publishTargets: [
				{
					...publishedTarget,
					fileName: "renamed.txt",
					lastPublishedAt: T1,
					lastPublishedUrl: "https://example.com/renamed.txt",
				},
				{
					...target("target-2"),
					fileName: "claimed.txt",
					lastPublishedAt: T1,
					lastPublishedUrl: "https://example.com/claimed.txt",
				},
			],
			clientExports: [
				{
					...publishedProfile,
					name: "Renamed profile",
					lastPublishedAt: T1,
					lastPublishedUrl: "https://example.com/forged.json",
				},
			],
		});
		const reconciled = applyWorkspaceMutation(
			current,
			parseWorkspaceMutation(
				mutation("workspace.reconcile", {
					baselineRevision: 1,
					data: resolved,
				}),
			),
			context,
		).document.data;
		const renamedTarget = reconciled.publishTargets.find(
			(item) => item.id === "target-1",
		);
		expect(renamedTarget?.lastPublishedAt).toBe(T0);
		expect(renamedTarget?.lastPublishedUrl).toBe(
			"https://example.com/aggregate.txt",
		);
		expect(renamedTarget?.lastPublishTransitionFromFileName).toBe(
			"aggregate.txt",
		);
		expect(renamedTarget?.lastPublishTransitionToFileName).toBe("renamed.txt");
		expect(renamedTarget?.lastPublishTransitionOutcome).toBe("kept_manual");
		expect(
			reconciled.publishTargets.find((item) => item.id === "target-2")
				?.lastPublishedAt,
		).toBeNull();
		expect(reconciled.clientExports[0]?.lastPublishedAt).toBe(T0);
		expect(reconciled.clientExports[0]?.lastPublishedUrl).toBe(
			"https://example.com/client.json",
		);
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
