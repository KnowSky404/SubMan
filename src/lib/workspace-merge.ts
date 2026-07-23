import {
	validateWorkspaceData,
	validateWorkspaceDocumentV2,
	type WorkspaceData,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import {
	findWorkspaceOutputConflicts,
	type WorkspaceOutputOwner,
} from "$lib/workspace-output";

export type WorkspaceEntityCollection = keyof WorkspaceData;
export type WorkspaceMergeChoice = "local" | "remote";

type WorkspaceEntity = WorkspaceData[WorkspaceEntityCollection][number];

export type WorkspaceEntityConflict = {
	kind:
		| "local-deleted-remote-modified"
		| "remote-deleted-local-modified"
		| "both-modified"
		| "both-added"
		| "baseline-missing";
	collection: WorkspaceEntityCollection;
	id: string;
	local: WorkspaceEntity | null;
	remote: WorkspaceEntity | null;
	baseline: WorkspaceEntity | null;
};

export type WorkspaceOutputOwnerConflict = {
	kind: "output-owner";
	collection: "output";
	id: string;
	owners: WorkspaceOutputOwner[];
};

export type WorkspaceMergeConflict =
	| WorkspaceEntityConflict
	| WorkspaceOutputOwnerConflict;

export type WorkspaceMergeNotice = {
	kind:
		| "remote-deletion-preserved"
		| "remote-deletion-blocked-local-change"
		| "reference-pruned"
		| "dependent-removed";
	collection: WorkspaceEntityCollection;
	id: string;
};

export type WorkspaceMergeResult =
	| {
			status: "resolved";
			data: WorkspaceData;
			notices: WorkspaceMergeNotice[];
	  }
	| {
			status: "needs-choice";
			conflicts: WorkspaceMergeConflict[];
			partialData: WorkspaceData;
			notices: WorkspaceMergeNotice[];
	  };

export type WorkspaceMergeChoices = Record<string, WorkspaceMergeChoice>;

const COLLECTIONS = [
	"nodes",
	"subscriptions",
	"aggregates",
	"publishTargets",
	"clientExports",
] as const satisfies readonly WorkspaceEntityCollection[];

export function workspaceMergeChoiceKey(
	collection: WorkspaceEntityCollection,
	id: string,
): string {
	return `${collection}:${id}`;
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, canonicalize(entry)]),
	);
}

function equal(
	left: WorkspaceEntity | undefined,
	right: WorkspaceEntity | undefined,
): boolean {
	if (left === undefined || right === undefined) return left === right;
	return (
		JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
	);
}

function entities(
	data: WorkspaceData,
	collection: WorkspaceEntityCollection,
): WorkspaceEntity[] {
	return data[collection] as WorkspaceEntity[];
}

function orderedIds(
	local: WorkspaceEntity[],
	remote: WorkspaceEntity[],
	baseline: WorkspaceEntity[],
): string[] {
	return [
		...new Set([
			...remote.map((item) => item.id),
			...local.map((item) => item.id),
			...baseline.map((item) => item.id),
		]),
	];
}

function createEntityConflict(
	kind: WorkspaceEntityConflict["kind"],
	collection: WorkspaceEntityCollection,
	id: string,
	local: WorkspaceEntity | undefined,
	remote: WorkspaceEntity | undefined,
	baseline: WorkspaceEntity | undefined,
): WorkspaceEntityConflict {
	return {
		kind,
		collection,
		id,
		local: local ?? null,
		remote: remote ?? null,
		baseline: baseline ?? null,
	};
}

function selectConflict(
	conflict: WorkspaceEntityConflict,
	choices: WorkspaceMergeChoices,
	conflicts: WorkspaceMergeConflict[],
): WorkspaceEntity | undefined {
	const choice =
		choices[workspaceMergeChoiceKey(conflict.collection, conflict.id)];
	if (choice === "local") return conflict.local ?? undefined;
	if (choice === "remote") return conflict.remote ?? undefined;
	conflicts.push(conflict);
	return conflict.remote ?? undefined;
}

function tombstoneIds(
	document: WorkspaceDocumentV2,
	collection: WorkspaceEntityCollection,
): Set<string> {
	return new Set(document.tombstones[collection].map((item) => item.id));
}

function buildWorkspaceData(
	selected: Record<WorkspaceEntityCollection, WorkspaceEntity[]>,
): WorkspaceData {
	return {
		nodes: selected.nodes as WorkspaceData["nodes"],
		subscriptions: selected.subscriptions as WorkspaceData["subscriptions"],
		aggregates: selected.aggregates as WorkspaceData["aggregates"],
		publishTargets: selected.publishTargets as WorkspaceData["publishTargets"],
		clientExports: selected.clientExports as WorkspaceData["clientExports"],
	};
}

function cleanReferences(
	data: WorkspaceData,
	remote: WorkspaceDocumentV2,
	notices: WorkspaceMergeNotice[],
): WorkspaceData {
	const filtered = Object.fromEntries(
		COLLECTIONS.map((collection) => {
			const deletedIds = tombstoneIds(remote, collection);
			return [
				collection,
				entities(data, collection).filter((item) => !deletedIds.has(item.id)),
			];
		}),
	) as Record<WorkspaceEntityCollection, WorkspaceEntity[]>;
	const raw = buildWorkspaceData(filtered);
	const nodeIds = new Set(raw.nodes.map((item) => item.id));
	const subscriptionIds = new Set(raw.subscriptions.map((item) => item.id));
	const aggregates = raw.aggregates.map((aggregate) => {
		const nextNodeIds = aggregate.nodeIds.filter((id) => nodeIds.has(id));
		const nextSubscriptionIds = aggregate.subscriptionIds.filter((id) =>
			subscriptionIds.has(id),
		);
		if (
			nextNodeIds.length === aggregate.nodeIds.length &&
			nextSubscriptionIds.length === aggregate.subscriptionIds.length
		) {
			return aggregate;
		}
		notices.push({
			kind: "reference-pruned",
			collection: "aggregates",
			id: aggregate.id,
		});
		return {
			...aggregate,
			nodeIds: nextNodeIds,
			subscriptionIds: nextSubscriptionIds,
		};
	});
	const aggregateIds = new Set(aggregates.map((item) => item.id));
	const publishTargets = raw.publishTargets.filter((target) => {
		const keep = aggregateIds.has(target.ruleId);
		if (!keep) {
			notices.push({
				kind: "dependent-removed",
				collection: "publishTargets",
				id: target.id,
			});
		}
		return keep;
	});
	const clientExports = raw.clientExports.filter((profile) => {
		const keep = aggregateIds.has(profile.ruleId);
		if (!keep) {
			notices.push({
				kind: "dependent-removed",
				collection: "clientExports",
				id: profile.id,
			});
		}
		return keep;
	});
	return validateWorkspaceData({
		...raw,
		aggregates,
		publishTargets,
		clientExports,
	});
}

export function mergeWorkspaceData(input: {
	local: WorkspaceData;
	remote: WorkspaceDocumentV2;
	baseline?: WorkspaceDocumentV2 | null;
	choices?: WorkspaceMergeChoices;
}): WorkspaceMergeResult {
	const local = validateWorkspaceData(input.local);
	const remote = validateWorkspaceDocumentV2(input.remote);
	const baseline = input.baseline
		? validateWorkspaceDocumentV2(input.baseline, {
				expectedWorkspaceId: remote.workspaceId,
			})
		: null;
	const choices = input.choices ?? {};
	const conflicts: WorkspaceMergeConflict[] = [];
	const notices: WorkspaceMergeNotice[] = [];
	const selected = {
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
	} as Record<WorkspaceEntityCollection, WorkspaceEntity[]>;

	for (const collection of COLLECTIONS) {
		const localItems = entities(local, collection);
		const remoteItems = entities(remote.data, collection);
		const baselineItems = baseline ? entities(baseline.data, collection) : [];
		const localById = new Map(localItems.map((item) => [item.id, item]));
		const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
		const baselineById = new Map(baselineItems.map((item) => [item.id, item]));
		const deletedIds = tombstoneIds(remote, collection);

		for (const id of orderedIds(localItems, remoteItems, baselineItems)) {
			const localItem = localById.get(id);
			const remoteItem = remoteById.get(id);
			const baselineItem = baselineById.get(id);

			if (deletedIds.has(id)) {
				if (localItem) {
					notices.push({
						kind:
							baselineItem && equal(localItem, baselineItem)
								? "remote-deletion-preserved"
								: "remote-deletion-blocked-local-change",
						collection,
						id,
					});
				}
				continue;
			}

			if (!baselineItem) {
				if (localItem && remoteItem) {
					const selectedItem = equal(localItem, remoteItem)
						? remoteItem
						: selectConflict(
								createEntityConflict(
									baseline ? "both-added" : "baseline-missing",
									collection,
									id,
									localItem,
									remoteItem,
									undefined,
								),
								choices,
								conflicts,
							);
					if (selectedItem) selected[collection].push(selectedItem);
				} else if (remoteItem) {
					selected[collection].push(remoteItem);
				} else if (localItem) {
					selected[collection].push(localItem);
				}
				continue;
			}

			if (!localItem && !remoteItem) continue;
			if (!localItem && remoteItem) {
				if (!equal(remoteItem, baselineItem)) {
					const selectedItem = selectConflict(
						createEntityConflict(
							"local-deleted-remote-modified",
							collection,
							id,
							undefined,
							remoteItem,
							baselineItem,
						),
						choices,
						conflicts,
					);
					if (selectedItem) selected[collection].push(selectedItem);
				}
				continue;
			}
			if (localItem && !remoteItem) {
				if (!equal(localItem, baselineItem)) {
					const selectedItem = selectConflict(
						createEntityConflict(
							"remote-deleted-local-modified",
							collection,
							id,
							localItem,
							undefined,
							baselineItem,
						),
						choices,
						conflicts,
					);
					if (selectedItem) selected[collection].push(selectedItem);
				}
				continue;
			}
			if (!localItem || !remoteItem) continue;
			if (equal(localItem, remoteItem)) {
				selected[collection].push(remoteItem);
				continue;
			}
			const localChanged = !equal(localItem, baselineItem);
			const remoteChanged = !equal(remoteItem, baselineItem);
			if (localChanged && remoteChanged) {
				const selectedItem = selectConflict(
					createEntityConflict(
						"both-modified",
						collection,
						id,
						localItem,
						remoteItem,
						baselineItem,
					),
					choices,
					conflicts,
				);
				if (selectedItem) selected[collection].push(selectedItem);
			} else {
				selected[collection].push(localChanged ? localItem : remoteItem);
			}
		}
	}

	const data = cleanReferences(buildWorkspaceData(selected), remote, notices);
	for (const conflict of findWorkspaceOutputConflicts(data)) {
		conflicts.push({
			kind: "output-owner",
			collection: "output",
			id: conflict.fileName,
			owners: conflict.owners,
		});
	}
	return conflicts.length > 0
		? { status: "needs-choice", conflicts, partialData: data, notices }
		: { status: "resolved", data, notices };
}

export function projectLocalWorkspaceAgainstTombstones(
	localValue: WorkspaceData,
	remoteValue: WorkspaceDocumentV2,
): { data: WorkspaceData; notices: WorkspaceMergeNotice[] } {
	const local = validateWorkspaceData(localValue);
	const remote = validateWorkspaceDocumentV2(remoteValue);
	const notices: WorkspaceMergeNotice[] = [];
	const selected = Object.fromEntries(
		COLLECTIONS.map((collection) => {
			const deletedIds = tombstoneIds(remote, collection);
			return [
				collection,
				entities(local, collection).filter((item) => {
					if (!deletedIds.has(item.id)) return true;
					notices.push({
						kind: "remote-deletion-blocked-local-change",
						collection,
						id: item.id,
					});
					return false;
				}),
			];
		}),
	) as Record<WorkspaceEntityCollection, WorkspaceEntity[]>;
	const data = cleanReferences(buildWorkspaceData(selected), remote, notices);
	const outputConflicts = findWorkspaceOutputConflicts(data);
	if (outputConflicts.length > 0) {
		throw new Error(
			`Workspace output ownership requires repair: ${outputConflicts
				.map((conflict) => conflict.fileName)
				.join(", ")}`,
		);
	}
	return { data, notices };
}
