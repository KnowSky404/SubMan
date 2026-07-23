import type { WorkspaceData } from "$lib/workspace-document";
import { validateWorkspaceOutputFileName } from "$lib/workspace-document";

export type WorkspaceOutputOwner = {
	kind: "publish-target" | "client-export";
	id: string;
	name: string;
	fileName: string;
	published: boolean;
};

export type WorkspaceOutputConflict = {
	fileName: string;
	owners: WorkspaceOutputOwner[];
};

export function isCurrentPublishTargetOutputPublished(
	target: WorkspaceData["publishTargets"][number],
): boolean {
	if (target.lastPublishedAt === null || target.lastPublishedUrl === null)
		return false;
	try {
		const publishedFileName = decodeURIComponent(
			new URL(target.lastPublishedUrl).pathname.split("/").at(-1) ?? "",
		);
		return publishedFileName === target.fileName;
	} catch {
		return false;
	}
}

export function isCurrentClientExportOutputPublished(
	profile: WorkspaceData["clientExports"][number],
): boolean {
	return profile.lastPublishedAt !== null;
}

export function getWorkspaceOutputOwners(
	data: Pick<WorkspaceData, "publishTargets" | "clientExports">,
	fileNameValue: string,
): WorkspaceOutputOwner[] {
	const fileName = validateWorkspaceOutputFileName(fileNameValue);
	return [
		...data.publishTargets
			.filter((target) => target.fileName === fileName)
			.map((target) => ({
				kind: "publish-target" as const,
				id: target.id,
				name: target.name,
				fileName: target.fileName,
				published: isCurrentPublishTargetOutputPublished(target),
			})),
		...data.clientExports
			.filter((profile) => profile.fileName === fileName)
			.map((profile) => ({
				kind: "client-export" as const,
				id: profile.id,
				name: profile.name,
				fileName: profile.fileName,
				published: isCurrentClientExportOutputPublished(profile),
			})),
	];
}

export function findWorkspaceOutputConflicts(
	data: Pick<WorkspaceData, "publishTargets" | "clientExports">,
): WorkspaceOutputConflict[] {
	const fileNames = new Set([
		...data.publishTargets.map((target) => target.fileName),
		...data.clientExports.map((profile) => profile.fileName),
	]);
	return [...fileNames]
		.map((fileName) => ({
			fileName,
			owners: getWorkspaceOutputOwners(data, fileName),
		}))
		.filter((conflict) => conflict.owners.length > 1)
		.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

export function getConflictingOutputOwners(
	data: Pick<WorkspaceData, "publishTargets" | "clientExports">,
	owner: Pick<WorkspaceOutputOwner, "kind" | "id" | "fileName">,
): WorkspaceOutputOwner[] {
	return getWorkspaceOutputOwners(data, owner.fileName).filter(
		(candidate) => candidate.kind !== owner.kind || candidate.id !== owner.id,
	);
}

export function analyzePublishTargetDelete(
	data: WorkspaceData,
	targetId: string,
): {
	target: WorkspaceData["publishTargets"][number];
	ruleName: string;
	otherOwners: WorkspaceOutputOwner[];
	canDeleteOutput: boolean;
} {
	const target = data.publishTargets.find((item) => item.id === targetId);
	if (!target) throw new Error(`Publish target not found: ${targetId}`);
	const otherOwners = getConflictingOutputOwners(data, {
		kind: "publish-target",
		id: target.id,
		fileName: target.fileName,
	});
	return {
		target,
		ruleName:
			data.aggregates.find((rule) => rule.id === target.ruleId)?.name ??
			target.ruleId,
		otherOwners,
		canDeleteOutput:
			isCurrentPublishTargetOutputPublished(target) && otherOwners.length === 0,
	};
}

export function analyzeAggregateDelete(
	data: WorkspaceData,
	aggregateId: string,
): {
	aggregate: WorkspaceData["aggregates"][number];
	targets: WorkspaceData["publishTargets"];
	exports: WorkspaceData["clientExports"];
	fileNames: string[];
} {
	const aggregate = data.aggregates.find((item) => item.id === aggregateId);
	if (!aggregate) throw new Error(`Aggregate not found: ${aggregateId}`);
	const targets = data.publishTargets.filter(
		(target) => target.ruleId === aggregateId,
	);
	const exports = data.clientExports.filter(
		(profile) => profile.ruleId === aggregateId,
	);
	return {
		aggregate,
		targets,
		exports,
		fileNames: [
			...new Set([
				...targets.map((target) => target.fileName),
				...exports.map((profile) => profile.fileName),
			]),
		].sort(),
	};
}
