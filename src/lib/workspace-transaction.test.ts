import { describe, expect, it } from "bun:test";
import { DEFAULT_SING_BOX_CLIENT_OPTIONS } from "$lib/client-export/profile";
import type { AppState, GistMeta, NodeItem } from "$lib/models";
import {
	createDefaultWorkspaceState,
	createSyncBaselineEnvelope,
	hydrateWorkspaceState,
	parseWorkspaceState,
} from "$lib/workspace-data";
import {
	buildAggregatePublication,
	buildClientExportPublication,
} from "$lib/workspace-publication";
import {
	runWorkspaceTransaction,
	WorkspaceBaselineError,
	WorkspaceConflictError,
	type WorkspaceTransactionTransport,
} from "$lib/workspace-transaction";

function node(id: string, updatedAt = "2026-07-22T00:00:00.000Z"): NodeItem {
	return {
		id,
		name: id,
		type: "vless",
		raw: `vless://${id}`,
		tags: [],
		enabled: true,
		updatedAt,
		source: "single",
	};
}

function state(overrides: Partial<AppState> = {}): AppState {
	return hydrateWorkspaceState(
		{
			...createDefaultWorkspaceState("2026-07-22T00:00:00.000Z"),
			...overrides,
		},
		"gist-1",
		"subman.json",
	);
}

function gist(fileNames = ["subman.json"]): GistMeta {
	return {
		id: "gist-1",
		ownerLogin: "octocat",
		description: "SubMan-Data",
		files: fileNames.map((filename) => ({
			filename,
			language: null,
			size: 1,
		})),
		updatedAt: "2026-07-22T00:00:00.000Z",
		url: "https://gist.github.com/gist-1",
	};
}

function publicationState(includeRemote: boolean): AppState {
	const nodeIds = includeRemote ? ["base", "remote"] : ["base"];
	return state({
		nodes: [
			node("base"),
			...(includeRemote ? [node("remote", "2026-07-22T01:00:00.000Z")] : []),
		].map((item) => ({
			...item,
			raw: `vless://uuid@${item.id}.example.com:443?security=tls#${item.id}`,
		})),
		aggregates: [
			{
				id: "rule-1",
				name: "All",
				nodeIds,
				subscriptionIds: [],
				excludeTagIds: [],
				renameMap: {},
				allowedTypes: ["vless"],
				updatedAt: includeRemote
					? "2026-07-22T01:00:00.000Z"
					: "2026-07-22T00:00:00.000Z",
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
				updatedAt: "2026-07-22T00:00:00.000Z",
			},
		],
		clientExports: [
			{
				id: "export-1",
				name: "Client",
				type: "sing-box-client",
				ruleId: "rule-1",
				fileName: "client.json",
				options: { ...DEFAULT_SING_BOX_CLIENT_OPTIONS },
				lastGeneratedAt: null,
				lastPublishedAt: null,
				lastPublishedUrl: null,
				updatedAt: "2026-07-22T00:00:00.000Z",
			},
		],
	});
}

function memoryTransport(initial: AppState): {
	transport: WorkspaceTransactionTransport;
	getState: () => AppState;
	getWrites: () => Array<Record<string, { content: string } | null>>;
} {
	let remote = initial;
	let files = ["subman.json"];
	const writes: Array<Record<string, { content: string } | null>> = [];
	return {
		transport: {
			read: async () => ({ gist: gist(files), state: remote }),
			write: async (_token, input) => {
				writes.push(input.files);
				remote = hydrateWorkspaceState(
					parseWorkspaceState(input.files["subman.json"]?.content ?? ""),
					"gist-1",
					"subman.json",
				);
				for (const [fileName, file] of Object.entries(input.files)) {
					files =
						file === null
							? files.filter((name) => name !== fileName)
							: Array.from(new Set([...files, fileName]));
				}
				return gist(files);
			},
		},
		getState: () => remote,
		getWrites: () => writes,
	};
}

describe("workspace transaction", () => {
	it("serializes same-origin writes and preserves both mutations", async () => {
		const memory = memoryTransport(state());
		let activeWrites = 0;
		let maxActiveWrites = 0;
		const write = memory.transport.write;
		memory.transport.write = async (token, input) => {
			activeWrites += 1;
			maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
			await new Promise((resolve) => setTimeout(resolve, 1));
			const result = await write(token, input);
			activeWrites -= 1;
			return result;
		};

		await Promise.all(
			["first", "second"].map((id) =>
				runWorkspaceTransaction(
					{
						token: "token",
						gistId: "gist-1",
						mutate: (remote) => ({
							...remote,
							nodes: [...remote.nodes, node(id)],
						}),
					},
					{ transport: memory.transport },
				),
			),
		);

		expect(maxActiveWrites).toBe(1);
		expect(
			memory
				.getState()
				.nodes.map((item) => item.id)
				.sort(),
		).toEqual(["first", "second"]);
	});

	it("preserves a remote deletion while merging trusted local changes", async () => {
		const baselineState = state({ nodes: [node("kept"), node("deleted")] });
		const local = state({
			nodes: [node("kept"), node("deleted"), node("local")],
		});
		const memory = memoryTransport(state({ nodes: [node("kept")] }));

		const result = await runWorkspaceTransaction(
			{
				token: "token",
				gistId: "gist-1",
				localState: local,
				baseline: createSyncBaselineEnvelope(
					baselineState,
					"gist-1",
					"subman.json",
				),
			},
			{ transport: memory.transport },
		);

		expect(result.state.nodes.map((item) => item.id).sort()).toEqual([
			"kept",
			"local",
		]);
	});

	it("rejects a baseline from another workspace identity", async () => {
		const memory = memoryTransport(state());
		const baseline = createSyncBaselineEnvelope(
			state(),
			"gist-other",
			"subman.json",
		);

		let error: unknown;
		try {
			await runWorkspaceTransaction(
				{
					token: "token",
					gistId: "gist-1",
					localState: state({ nodes: [node("local")] }),
					baseline,
				},
				{ transport: memory.transport },
			);
		} catch (caught) {
			error = caught;
		}
		expect(error instanceof WorkspaceBaselineError).toBe(true);
	});

	it("commits workspace config and output files in one write", async () => {
		const memory = memoryTransport(state());
		const result = await runWorkspaceTransaction(
			{
				token: "token",
				gistId: "gist-1",
				mutate: (remote, context) => ({
					state: {
						...remote,
						nodes: [node("published")],
					},
					files: {
						"aggregate.txt": { content: context.gist.id },
					},
				}),
			},
			{ transport: memory.transport },
		);

		expect(result.gist.files.map((file) => file.filename).sort()).toEqual([
			"aggregate.txt",
			"subman.json",
		]);
		expect(memory.getWrites()).toHaveLength(1);
		expect(Object.keys(memory.getWrites()[0] ?? {}).sort()).toEqual([
			"aggregate.txt",
			"subman.json",
		]);
	});

	it("retries when the config changes after a write", async () => {
		const memory = memoryTransport(state());
		let readCount = 0;
		let injected = false;
		const baseRead = memory.transport.read;
		memory.transport.read = async (...args) => {
			readCount += 1;
			const snapshot = await baseRead(...args);
			if (readCount === 2 && !injected) {
				injected = true;
				return {
					...snapshot,
					state: { ...snapshot.state, nodes: [node("concurrent")] },
				};
			}
			return snapshot;
		};

		const result = await runWorkspaceTransaction(
			{
				token: "token",
				gistId: "gist-1",
				mutate: (remote) => ({
					...remote,
					nodes: [...remote.nodes, node("local")],
				}),
			},
			{ transport: memory.transport },
		);

		expect(memory.getWrites()).toHaveLength(2);
		expect(result.state.nodes.map((item) => item.id).sort()).toEqual([
			"concurrent",
			"local",
		]);
	});

	it("returns an explicit conflict when verification keeps changing", async () => {
		const memory = memoryTransport(state());
		let verification = 0;
		const baseRead = memory.transport.read;
		memory.transport.read = async (...args) => {
			const snapshot = await baseRead(...args);
			if (memory.getWrites().length > verification) {
				verification += 1;
				return {
					...snapshot,
					state: {
						...snapshot.state,
						nodes: [node(`race-${verification}`)],
					},
				};
			}
			return snapshot;
		};

		let error: unknown;
		try {
			await runWorkspaceTransaction(
				{
					token: "token",
					gistId: "gist-1",
					mutate: (remote) => ({
						...remote,
						nodes: [...remote.nodes, node("local")],
					}),
					maxAttempts: 2,
				},
				{ transport: memory.transport },
			);
		} catch (caught) {
			error = caught;
		}
		expect(error instanceof WorkspaceConflictError).toBe(true);
	});

	it("aggregate publishing keeps concurrent remote workspace changes", async () => {
		const baselineState = publicationState(false);
		const memory = memoryTransport(publicationState(true));
		const result = await runWorkspaceTransaction(
			{
				token: "token",
				gistId: "gist-1",
				localState: baselineState,
				baseline: createSyncBaselineEnvelope(
					baselineState,
					"gist-1",
					"subman.json",
				),
				mutate: (state, context) =>
					buildAggregatePublication(
						state,
						context.gist,
						"target-1",
						"2026-07-22T02:00:00.000Z",
					),
			},
			{ transport: memory.transport },
		);

		expect(result.state.nodes.some((item) => item.id === "remote")).toBe(true);
		expect(memory.getWrites()[0]?.["aggregate.txt"]?.content).toContain(
			"remote.example.com",
		);
	});

	it("rebuilds aggregate output when verification finds a concurrent change", async () => {
		const baselineState = publicationState(false);
		const memory = memoryTransport(baselineState);
		let injected = false;
		const baseRead = memory.transport.read;
		memory.transport.read = async (...args) => {
			const snapshot = await baseRead(...args);
			if (memory.getWrites().length === 1 && !injected) {
				injected = true;
				return { ...snapshot, state: publicationState(true) };
			}
			return snapshot;
		};

		const result = await runWorkspaceTransaction(
			{
				token: "token",
				gistId: "gist-1",
				localState: baselineState,
				baseline: createSyncBaselineEnvelope(
					baselineState,
					"gist-1",
					"subman.json",
				),
				mutate: (state, context) =>
					buildAggregatePublication(
						state,
						context.gist,
						"target-1",
						"2026-07-22T02:00:00.000Z",
					),
			},
			{ transport: memory.transport },
		);

		expect(result.attempts).toBe(2);
		expect(memory.getWrites()[1]?.["aggregate.txt"]?.content).toContain(
			"remote.example.com",
		);
	});

	it("client export publishing keeps concurrent remote workspace changes", async () => {
		const baselineState = publicationState(false);
		const memory = memoryTransport(publicationState(true));
		const result = await runWorkspaceTransaction(
			{
				token: "token",
				gistId: "gist-1",
				localState: baselineState,
				baseline: createSyncBaselineEnvelope(
					baselineState,
					"gist-1",
					"subman.json",
				),
				mutate: async (state, context) => {
					const publication = await buildClientExportPublication(
						state,
						context.gist,
						"export-1",
						"2026-07-22T02:00:00.000Z",
					);
					return { state: publication.state, files: publication.files };
				},
			},
			{ transport: memory.transport },
		);

		expect(result.state.nodes.some((item) => item.id === "remote")).toBe(true);
		expect(memory.getWrites()[0]?.["client.json"]?.content).toContain(
			'"server": "remote.example.com"',
		);
	});
});
