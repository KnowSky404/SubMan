import { describe, expect, test } from "bun:test";
import type { WorkspaceData } from "$lib/workspace-document";
import { validateWorkspaceOutputFileName } from "$lib/workspace-document";
import {
	analyzeAggregateDelete,
	analyzePublishTargetDelete,
	findWorkspaceOutputConflicts,
	isCurrentPublishTargetOutputPublished,
} from "$lib/workspace-output";

const now = "2026-07-23T00:00:00.000Z";

function data(): WorkspaceData {
	return {
		nodes: [],
		subscriptions: [],
		aggregates: [
			{
				id: "rule-1",
				name: "Rule One",
				nodeIds: [],
				subscriptionIds: [],
				excludeTagIds: [],
				renameMap: {},
				allowedTypes: [],
				updatedAt: now,
			},
		],
		publishTargets: [
			{
				id: "target-1",
				name: "Target One",
				ruleId: "rule-1",
				fileName: "shared.txt",
				description: "",
				isPublic: false,
				lastPublishedAt: now,
				lastPublishedUrl: "https://example.com/shared.txt",
				lastPublishTransitionAt: null,
				lastPublishTransitionFromFileName: null,
				lastPublishTransitionToFileName: null,
				lastPublishTransitionOutcome: null,
				updatedAt: now,
			},
		],
		clientExports: [
			{
				id: "export-1",
				name: "Export One",
				type: "sing-box-client",
				ruleId: "rule-1",
				fileName: "shared.txt",
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
				lastGeneratedAt: now,
				lastPublishedAt: now,
				lastPublishedUrl: "https://example.com/shared.txt",
				updatedAt: now,
			},
		],
	};
}

describe("Workspace output ownership", () => {
	test("canonicalizes safe names and rejects unsafe or reserved names", () => {
		expect(validateWorkspaceOutputFileName("  nodes.txt  ")).toBe("nodes.txt");
		for (const value of [
			"",
			".",
			"..",
			"dir/file",
			"dir\\file",
			"a\u0000b",
			"SUBMAN.JSON",
		]) {
			expect(() => validateWorkspaceOutputFileName(value)).toThrow();
		}
	});

	test("reports every owner of a legacy filename conflict", () => {
		const conflicts = findWorkspaceOutputConflicts(data());
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.owners.map((owner) => owner.kind)).toEqual([
			"publish-target",
			"client-export",
		]);
		expect(analyzePublishTargetDelete(data(), "target-1").canDeleteOutput).toBe(
			false,
		);
	});

	test("does not claim a legacy renamed filename is currently published", () => {
		const target = data().publishTargets[0];
		if (!target) throw new Error("Expected publish target fixture");
		expect(
			isCurrentPublishTargetOutputPublished({
				...target,
				fileName: "renamed.txt",
				lastPublishedUrl: "https://example.com/shared.txt",
				lastPublishTransitionAt: null,
			}),
		).toBe(false);
	});

	test("lists every dependent and output before deleting an Aggregate rule", () => {
		const impact = analyzeAggregateDelete(data(), "rule-1");
		expect(impact.targets).toHaveLength(1);
		expect(impact.exports).toHaveLength(1);
		expect(impact.fileNames).toEqual(["shared.txt"]);
	});
});
