import { describe, expect, it } from "bun:test";
import {
	validateWorkspaceData,
	type WorkspaceData,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import {
	mergeWorkspaceData,
	projectLocalWorkspaceAgainstTombstones,
	workspaceMergeChoiceKey,
} from "$lib/workspace-merge";

const NOW = "2026-07-23T10:00:00.000Z";
const LATER = "2026-07-23T11:00:00.000Z";
const TOMBSTONE_MUTATION_ID = "c0000000-0000-4000-8000-000000000001";
const COLLECTIONS = [
	"nodes",
	"subscriptions",
	"aggregates",
	"publishTargets",
	"clientExports",
] as const satisfies readonly (keyof WorkspaceData)[];

function workspaceData(): WorkspaceData {
	return validateWorkspaceData({
		nodes: [
			{
				id: "node-1",
				name: "Node",
				type: "vless",
				raw: "vless://node-1",
				tags: [],
				enabled: true,
				updatedAt: NOW,
				source: "single",
			},
		],
		subscriptions: [
			{
				id: "subscription-1",
				name: "Subscription",
				url: "https://example.test/subscription",
				enabled: true,
				tags: [],
				updatedAt: NOW,
			},
		],
		aggregates: [
			{
				id: "aggregate-1",
				name: "Aggregate",
				nodeIds: ["node-1"],
				subscriptionIds: ["subscription-1"],
				excludeTagIds: [],
				renameMap: {},
				allowedTypes: ["vless"],
				updatedAt: NOW,
			},
		],
		publishTargets: [
			{
				id: "target-1",
				name: "Target",
				ruleId: "aggregate-1",
				fileName: "aggregate.txt",
				description: "",
				isPublic: false,
				lastPublishedAt: null,
				lastPublishedUrl: null,
				lastPublishTransitionAt: null,
				lastPublishTransitionFromFileName: null,
				lastPublishTransitionToFileName: null,
				lastPublishTransitionOutcome: null,
				updatedAt: NOW,
			},
		],
		clientExports: [
			{
				id: "export-1",
				name: "Export",
				type: "sing-box-client",
				ruleId: "aggregate-1",
				fileName: "client.json",
				options: {
					listenAddress: "127.0.0.1",
					listenPort: 2080,
					inboundType: "mixed",
					dnsMode: "conservative",
					routeMode: "global-proxy",
					includeExperimental: false,
					selectorTag: "proxy",
					urlTestTag: "auto",
				},
				lastGeneratedAt: null,
				lastPublishedAt: null,
				lastPublishedUrl: null,
				updatedAt: NOW,
			},
		],
	});
}

function itemId(data: WorkspaceData, collection: keyof WorkspaceData): string {
	return (data[collection] as Array<{ id: string }>)[0]?.id ?? "missing";
}

function cleanupReferences(data: WorkspaceData): WorkspaceData {
	const nodeIds = new Set(data.nodes.map((item) => item.id));
	const subscriptionIds = new Set(data.subscriptions.map((item) => item.id));
	const aggregates = data.aggregates.map((item) => ({
		...item,
		nodeIds: item.nodeIds.filter((id) => nodeIds.has(id)),
		subscriptionIds: item.subscriptionIds.filter((id) =>
			subscriptionIds.has(id),
		),
	}));
	const aggregateIds = new Set(aggregates.map((item) => item.id));
	return validateWorkspaceData({
		...data,
		aggregates,
		publishTargets: data.publishTargets.filter((item) =>
			aggregateIds.has(item.ruleId),
		),
		clientExports: data.clientExports.filter((item) =>
			aggregateIds.has(item.ruleId),
		),
	});
}

function removeItem(
	data: WorkspaceData,
	collection: keyof WorkspaceData,
	id: string,
): WorkspaceData {
	return cleanupReferences({
		...data,
		[collection]: (data[collection] as Array<{ id: string }>).filter(
			(item) => item.id !== id,
		),
	} as WorkspaceData);
}

function modifyItem(
	data: WorkspaceData,
	collection: keyof WorkspaceData,
	name: string,
): WorkspaceData {
	return validateWorkspaceData({
		...data,
		[collection]: (data[collection] as Array<{ id: string; name: string }>).map(
			(item) => ({ ...item, name, updatedAt: LATER }),
		),
	} as WorkspaceData);
}

function addItem(
	data: WorkspaceData,
	collection: keyof WorkspaceData,
	item: { id: string; name: string },
): WorkspaceData {
	return validateWorkspaceData({
		...data,
		[collection]: [...data[collection], item],
	} as WorkspaceData);
}

function document(
	data: WorkspaceData,
	options: { tombstone?: { collection: keyof WorkspaceData; id: string } } = {},
): WorkspaceDocumentV2 {
	const tombstones = {
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
	} as WorkspaceDocumentV2["tombstones"];
	if (options.tombstone) {
		tombstones[options.tombstone.collection] = [
			{
				id: options.tombstone.id,
				deletedAt: LATER,
				deletedRevision: 2,
				mutationId: TOMBSTONE_MUTATION_ID,
			},
		];
	}
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: "gist:test",
		revision: 2,
		updatedAt: LATER,
		lastMutationId: TOMBSTONE_MUTATION_ID,
		data,
		tombstones,
	};
}

describe("tombstone-aware Workspace merge", () => {
	for (const collection of COLLECTIONS) {
		it(`${collection}: remote delete keeps deletion when local is unchanged`, () => {
			const baselineData = workspaceData();
			const id = itemId(baselineData, collection);
			const result = mergeWorkspaceData({
				local: baselineData,
				baseline: document(baselineData),
				remote: document(removeItem(baselineData, collection, id), {
					tombstone: { collection, id },
				}),
			});
			expect(result.status).toBe("resolved");
			expect(
				(result.status === "resolved" ? result.data[collection] : []).some(
					(item) => item.id === id,
				),
			).toBe(false);
		});

		it(`${collection}: remote delete blocks a modified local copy`, () => {
			const baselineData = workspaceData();
			const id = itemId(baselineData, collection);
			const result = mergeWorkspaceData({
				local: modifyItem(baselineData, collection, "Local edit"),
				baseline: document(baselineData),
				remote: document(removeItem(baselineData, collection, id), {
					tombstone: { collection, id },
				}),
			});
			expect(result.status).toBe("resolved");
			expect(
				result.notices.some(
					(notice) =>
						notice.collection === collection &&
						notice.id === id &&
						notice.kind === "remote-deletion-blocked-local-change",
				),
			).toBe(true);
		});

		it(`${collection}: local delete and remote modification requires a choice`, () => {
			const baselineData = workspaceData();
			const id = itemId(baselineData, collection);
			const result = mergeWorkspaceData({
				local: removeItem(baselineData, collection, id),
				baseline: document(baselineData),
				remote: document(modifyItem(baselineData, collection, "Remote edit")),
			});
			expect(result.status).toBe("needs-choice");
			expect(
				result.status === "needs-choice" &&
					result.conflicts.some(
						(conflict) =>
							conflict.kind === "local-deleted-remote-modified" &&
							conflict.collection === collection &&
							conflict.id === id,
					),
			).toBe(true);
		});

		it(`${collection}: concurrent modifications require a choice without timestamp authority`, () => {
			const baselineData = workspaceData();
			const id = itemId(baselineData, collection);
			const result = mergeWorkspaceData({
				local: modifyItem(baselineData, collection, "Local edit"),
				baseline: document(baselineData),
				remote: document(modifyItem(baselineData, collection, "Remote edit")),
			});
			expect(result.status).toBe("needs-choice");
			expect(
				result.status === "needs-choice" &&
					result.conflicts.some(
						(conflict) =>
							conflict.kind === "both-modified" &&
							conflict.collection === collection &&
							conflict.id === id,
					),
			).toBe(true);
		});

		it(`${collection}: both-added same ID requires a choice`, () => {
			const full = workspaceData();
			const id = itemId(full, collection);
			const baselineData = removeItem(full, collection, id);
			const original = (
				full[collection] as Array<{ id: string; name: string }>
			)[0];
			if (!original) throw new Error("fixture item is missing");
			const result = mergeWorkspaceData({
				local: addItem(baselineData, collection, {
					...original,
					name: "Local add",
				}),
				baseline: document(baselineData),
				remote: document(
					addItem(baselineData, collection, {
						...original,
						name: "Remote add",
					}),
				),
			});
			expect(result.status).toBe("needs-choice");
			expect(
				result.status === "needs-choice" &&
					result.conflicts.some(
						(conflict) =>
							conflict.kind === "both-added" &&
							conflict.collection === collection &&
							conflict.id === id,
					),
			).toBe(true);
		});
	}

	it("applies explicit local and remote choices deterministically", () => {
		const baselineData = workspaceData();
		const local = modifyItem(baselineData, "nodes", "Local edit");
		const remote = document(modifyItem(baselineData, "nodes", "Remote edit"));
		const key = workspaceMergeChoiceKey("nodes", "node-1");
		const localResult = mergeWorkspaceData({
			local,
			remote,
			baseline: document(baselineData),
			choices: { [key]: "local" },
		});
		const remoteResult = mergeWorkspaceData({
			local,
			remote,
			baseline: document(baselineData),
			choices: { [key]: "remote" },
		});
		expect(localResult.status).toBe("resolved");
		expect(remoteResult.status).toBe("resolved");
		expect(
			localResult.status === "resolved" && localResult.data.nodes[0]?.name,
		).toBe("Local edit");
		expect(
			remoteResult.status === "resolved" && remoteResult.data.nodes[0]?.name,
		).toBe("Remote edit");
	});

	it("cascades aggregate deletion to targets and exports and validates the result", () => {
		const baselineData = workspaceData();
		const remoteData = removeItem(baselineData, "aggregates", "aggregate-1");
		const result = mergeWorkspaceData({
			local: modifyItem(baselineData, "aggregates", "Local edit"),
			baseline: document(baselineData),
			remote: document(remoteData, {
				tombstone: { collection: "aggregates", id: "aggregate-1" },
			}),
		});
		expect(result.status).toBe("resolved");
		if (result.status !== "resolved") return;
		expect(result.data.aggregates).toEqual([]);
		expect(result.data.publishTargets).toEqual([]);
		expect(result.data.clientExports).toEqual([]);
		expect(validateWorkspaceData(result.data)).toEqual(result.data);
	});

	it("filters every remote tombstoned ID from a safe local projection", () => {
		let remoteData = workspaceData();
		const remote = document(remoteData);
		for (const collection of COLLECTIONS) {
			const id = itemId(remoteData, collection);
			remote.tombstones[collection] = [
				{
					id,
					deletedAt: LATER,
					deletedRevision: 2,
					mutationId: TOMBSTONE_MUTATION_ID,
				},
			];
			remoteData = removeItem(remoteData, collection, id);
		}
		remote.data = remoteData;
		const projected = projectLocalWorkspaceAgainstTombstones(
			workspaceData(),
			remote,
		);
		for (const collection of COLLECTIONS) {
			const tombstoned = new Set(
				remote.tombstones[collection].map((item) => item.id),
			);
			expect(
				projected.data[collection].some((item) => tombstoned.has(item.id)),
			).toBe(false);
		}
		expect(validateWorkspaceData(projected.data)).toEqual(projected.data);
	});

	it("reports output ownership conflicts after merging independent changes", () => {
		const baselineData = workspaceData();
		const local = validateWorkspaceData({
			...baselineData,
			publishTargets: baselineData.publishTargets.map((item) => ({
				...item,
				fileName: "shared.txt",
			})),
		});
		const remoteData = validateWorkspaceData({
			...baselineData,
			clientExports: baselineData.clientExports.map((item) => ({
				...item,
				fileName: "shared.txt",
			})),
		});
		const result = mergeWorkspaceData({
			local,
			baseline: document(baselineData),
			remote: document(remoteData),
		});
		expect(result.status).toBe("needs-choice");
		expect(
			result.status === "needs-choice" &&
				result.conflicts.some(
					(conflict) =>
						conflict.kind === "output-owner" && conflict.id === "shared.txt",
				),
		).toBe(true);
	});
});
