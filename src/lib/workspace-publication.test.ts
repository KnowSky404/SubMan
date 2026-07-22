import { expect, test } from "bun:test";
import { DEFAULT_SING_BOX_CLIENT_OPTIONS } from "$lib/client-export/profile";
import type { AppState, GistMeta } from "$lib/models";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import {
	buildAggregatePublication,
	buildClientExportPublication,
} from "$lib/workspace-publication";

const now = "2026-07-22T12:00:00.000Z";

function gist(): GistMeta {
	return {
		id: "gist-1",
		ownerLogin: "octocat",
		description: "SubMan-Data",
		files: [],
		updatedAt: now,
		url: "https://gist.github.com/gist-1",
	};
}

function workspace(): AppState {
	return {
		...createDefaultWorkspaceState(now),
		nodes: [
			{
				id: "remote-node",
				name: "Remote Node",
				type: "vless",
				raw: "vless://uuid@example.com:443?security=tls#Remote",
				tags: [],
				enabled: true,
				updatedAt: now,
				source: "single",
			},
		],
		aggregates: [
			{
				id: "rule-1",
				name: "Remote Rule",
				nodeIds: ["remote-node"],
				subscriptionIds: [],
				excludeTagIds: [],
				renameMap: {},
				allowedTypes: ["vless"],
				updatedAt: now,
			},
		],
		publishTargets: [
			{
				id: "target-1",
				name: "Aggregate",
				ruleId: "rule-1",
				fileName: "aggregate.txt",
				description: "Aggregate",
				isPublic: false,
				lastPublishedAt: null,
				lastPublishedUrl: null,
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
				name: "sing-box",
				type: "sing-box-client",
				ruleId: "rule-1",
				fileName: "client.json",
				options: { ...DEFAULT_SING_BOX_CLIENT_OPTIONS },
				lastGeneratedAt: null,
				lastPublishedAt: null,
				lastPublishedUrl: null,
				updatedAt: now,
			},
		],
	};
}

test("aggregate publication uses latest workspace data and finalizes metadata", async () => {
	const result = await buildAggregatePublication(
		workspace(),
		gist(),
		"target-1",
		now,
	);

	expect(result.files?.["aggregate.txt"]?.content).toContain("example.com:443");
	expect(result.state.publishTargets[0]?.lastPublishedAt).toBe(now);
	expect(result.state.publishTargets[0]?.lastPublishedUrl).toBe(
		"https://gist.githubusercontent.com/octocat/gist-1/raw/aggregate.txt",
	);
});

test("client export publication generates output and metadata together", async () => {
	const result = await buildClientExportPublication(
		workspace(),
		gist(),
		"export-1",
		now,
	);

	expect(result.files?.["client.json"]?.content).toContain(
		'"server": "example.com"',
	);
	expect(result.state.clientExports[0]?.lastGeneratedAt).toBe(now);
	expect(result.state.clientExports[0]?.lastPublishedAt).toBe(now);
	expect(result.state.clientExports[0]?.lastPublishedUrl).toBe(
		"https://gist.githubusercontent.com/octocat/gist-1/raw/client.json",
	);
});
