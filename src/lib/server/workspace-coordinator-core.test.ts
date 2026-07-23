import { describe, expect, it } from "bun:test";
import type {
	AggregatePublishTarget,
	AggregateRule,
	ClientExportProfile,
	GistMeta,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";
import {
	handleBrowserWorkspaceMutation,
	type WorkspaceCoordinatorNamespace,
} from "$lib/server/api/workspace-mutations";
import {
	WorkspaceCoordinatorCore,
	WorkspaceCoordinatorError,
	type WorkspaceCoordinatorGateway,
	type WorkspaceCoordinatorJournal,
	type WorkspaceCoordinatorPendingMutation,
	type WorkspaceCoordinatorProcessedMutation,
	type WorkspaceGistSnapshot,
} from "$lib/server/workspace-coordinator-core";
import {
	serializeWorkspaceDocumentV2,
	type WorkspaceData,
	type WorkspaceDocumentV2,
} from "$lib/workspace-document";
import type {
	WorkspaceFiles,
	WorkspaceMutation,
} from "$lib/workspace-mutation";

const GIST_ID = "gist-1";
const WORKSPACE_ID = `gist:${GIST_ID}`;
const T0 = "2026-07-22T10:00:00.000Z";
const T1 = "2026-07-22T11:00:00.000Z";
const T2 = "2026-07-22T12:00:00.000Z";
const TOKEN = "github-token-that-must-not-be-stored";

function node(id = "node-1"): NodeItem {
	return {
		id,
		name: id,
		type: "vless",
		raw: `vless://${id}`,
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

function aggregate(): AggregateRule {
	return {
		id: "aggregate-1",
		name: "aggregate-1",
		nodeIds: ["node-1"],
		subscriptionIds: [],
		excludeTagIds: [],
		renameMap: {},
		allowedTypes: ["vless"],
		updatedAt: T0,
	};
}

function target(): AggregatePublishTarget {
	return {
		id: "target-1",
		name: "target-1",
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

function profile(): ClientExportProfile {
	return {
		id: "export-1",
		name: "export-1",
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
	id: string,
	expectedRevision: number,
	kind: WorkspaceMutation["kind"],
	payload: WorkspaceMutation["payload"],
	source: WorkspaceMutation["source"] = "browser",
): WorkspaceMutation {
	return {
		mutationId: id,
		workspaceId: WORKSPACE_ID,
		expectedRevision,
		source,
		createdAt: T1,
		kind,
		payload,
	} as WorkspaceMutation;
}

function replaceNodeMutation(
	id: string,
	expectedRevision = 1,
	nodeId = "node-2",
): WorkspaceMutation {
	return mutation(id, expectedRevision, "node.upsert", {
		operation: "replace",
		node: node(nodeId),
	});
}

class MemoryJournal implements WorkspaceCoordinatorJournal {
	readonly pending = new Map<string, WorkspaceCoordinatorPendingMutation>();
	readonly processed = new Map<string, WorkspaceCoordinatorProcessedMutation>();
	failNextCommit = false;

	getProcessed(mutationId: string) {
		return this.processed.get(mutationId) ?? null;
	}

	getPendingByWorkspace(workspaceId: string) {
		return (
			[...this.pending.values()].find(
				(entry) => entry.workspaceId === workspaceId,
			) ?? null
		);
	}

	putPending(entry: WorkspaceCoordinatorPendingMutation) {
		this.pending.set(entry.mutationId, structuredClone(entry));
	}

	commitPending(entry: WorkspaceCoordinatorPendingMutation) {
		if (this.failNextCommit) {
			this.failNextCommit = false;
			throw new Error("simulated coordinator eviction");
		}
		this.processed.set(entry.mutationId, {
			mutationId: entry.mutationId,
			workspaceId: entry.workspaceId,
			requestHash: entry.requestHash,
			committedRevision: entry.candidateRevision,
			resultJson: entry.resultJson,
			committedAt: entry.committedAt,
		});
		this.pending.delete(entry.mutationId);
	}

	deletePending(mutationId: string) {
		this.pending.delete(mutationId);
	}
}

class MemoryGateway implements WorkspaceCoordinatorGateway {
	readonly events: string[] = [];
	readonly tokens: string[] = [];
	patches: WorkspaceFiles[] = [];
	patchFailure: "before" | "after" | null = null;
	readGate: Promise<void> | null = null;
	readCount = 0;
	readonly failingReads = new Set<number>();
	afterPatch: ((files: Record<string, string>) => void) | null = null;

	constructor(readonly files: Record<string, string>) {}

	async read(
		githubToken: string,
		gistId: string,
		requiredFiles: readonly string[] = [],
	): Promise<WorkspaceGistSnapshot> {
		this.readCount += 1;
		this.tokens.push(githubToken);
		this.events.push(`read:${gistId}`);
		if (this.failingReads.has(this.readCount)) {
			throw new Error("Gist read failed");
		}
		if (this.readGate) await this.readGate;
		const selected =
			requiredFiles.length === 0
				? Object.entries(this.files)
				: Object.entries(this.files).filter(([name]) =>
						requiredFiles.includes(name),
					);
		const gist: Pick<GistMeta, "id" | "ownerLogin" | "files"> = {
			id: gistId,
			ownerLogin: "owner",
			files: Object.entries(this.files).map(([filename, content]) => ({
				filename,
				language: null,
				size: content.length,
				rawUrl: `https://gist.githubusercontent.com/owner/${gistId}/raw/${filename}`,
			})),
		};
		return { gist, contents: Object.fromEntries(selected) };
	}

	async patch(githubToken: string, gistId: string, files: WorkspaceFiles) {
		this.tokens.push(githubToken);
		this.events.push(`patch:${gistId}`);
		this.patches.push(structuredClone(files));
		if (this.patchFailure === "before") throw new Error("GitHub write failed");
		for (const [name, file] of Object.entries(files)) {
			if (file === null) delete this.files[name];
			else this.files[name] = file.content;
		}
		this.afterPatch?.(this.files);
		if (this.patchFailure === "after") throw new Error("response lost");
	}
}

function coordinator(
	gateway: MemoryGateway,
	journal = new MemoryJournal(),
	times = [T1, T2],
) {
	let index = 0;
	return {
		core: new WorkspaceCoordinatorCore({
			gateway,
			journal,
			now: () => times[Math.min(index++, times.length - 1)] ?? T2,
		}),
		journal,
	};
}

async function expectCode(
	promise: Promise<unknown>,
	code: WorkspaceCoordinatorError["code"] | string,
): Promise<void> {
	try {
		await promise;
		throw new Error("Expected coordinator operation to fail");
	} catch (error) {
		expect((error as { code?: string }).code).toBe(code);
	}
}

describe("Workspace coordinator serialization and idempotency", () => {
	it("serializes concurrent mutations across GitHub I/O", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core } = coordinator(gateway);
		const first = core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation("10000000-0000-4000-8000-000000000001"),
		});
		const second = core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation(
				"10000000-0000-4000-8000-000000000002",
				1,
				"node-3",
			),
		});

		const committed = await first;
		expect(committed.committedRevision).toBe(2);
		let conflict: WorkspaceCoordinatorError | null = null;
		try {
			await second;
		} catch (error) {
			conflict = error as WorkspaceCoordinatorError;
		}
		expect(conflict?.code).toBe("revision_conflict");
		expect(conflict?.latestDocument?.revision).toBe(2);
		expect(
			conflict?.latestDocument?.data.nodes.map((item) => item.id),
		).toContain("node-2");
		expect(gateway.patches).toHaveLength(1);
		expect(gateway.events).toEqual([
			"read:gist-1",
			"patch:gist-1",
			"read:gist-1",
			"read:gist-1",
		]);

		const third = await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation(
				"10000000-0000-4000-8000-000000000003",
				2,
				"node-4",
			),
		});
		expect(third.committedRevision).toBe(3);
	});

	it("returns a prior result for the same ID and rejects a hash collision", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core } = coordinator(gateway);
		const id = "20000000-0000-4000-8000-000000000001";
		const input = {
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation(id),
		};
		const first = await core.mutate(input);
		const retry = await core.mutate(input);

		expect(retry.committedRevision).toBe(first.committedRevision);
		expect(retry.document.revision).toBe(2);
		expect(gateway.patches).toHaveLength(1);
		await expectCode(
			core.mutate({
				...input,
				mutation: replaceNodeMutation(id, 99, "different-node"),
			}),
			"mutation_id_reused",
		);
	});

	it("retries a Server API create without duplicating the node", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core } = coordinator(gateway);
		const create = mutation(
			"20000000-0000-4000-8000-000000000010",
			1,
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
			"server-api",
		);
		const input = { githubToken: TOKEN, gistId: GIST_ID, mutation: create };

		const first = await core.mutate(input);
		const retry = await core.mutate(input);

		expect(
			first.document.data.nodes.filter((item) => item.id === "node-2"),
		).toHaveLength(1);
		expect(
			retry.document.data.nodes.filter((item) => item.id === "node-2"),
		).toHaveLength(1);
		expect(retry.committedRevision).toBe(2);
		expect(gateway.patches).toHaveLength(1);
	});

	it("returns one HTTP success and one 409 for competing revisions", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core } = coordinator(gateway);
		const namespace: WorkspaceCoordinatorNamespace = {
			getByName() {
				return {
					async mutate(command, githubToken) {
						const outcome = await core.mutateSettled({
							githubToken,
							gistId: command.gistId,
							mutation: command.mutation,
						});
						if (outcome.ok) return { ok: true, result: outcome.result };
						if (outcome.error instanceof WorkspaceCoordinatorError) {
							return {
								ok: false,
								error: {
									code: outcome.error.code,
									message: outcome.error.message,
									...(outcome.error.latestDocument
										? {
												document: outcome.error.latestDocument,
												revision: outcome.error.latestDocument.revision,
											}
										: {}),
								},
							};
						}
						return {
							ok: false,
							error: { code: "server_error", message: "Mutation failed" },
						};
					},
				};
			},
		};
		const firstMutation = replaceNodeMutation(
			"20000000-0000-4000-8000-000000000011",
		);
		const secondMutation = replaceNodeMutation(
			"20000000-0000-4000-8000-000000000012",
			1,
			"node-3",
		);
		const request = (value: WorkspaceMutation) =>
			new Request("https://subman.example/api/workspaces/mutations", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(value),
			});

		const [first, second] = await Promise.all([
			handleBrowserWorkspaceMutation(
				request(firstMutation),
				WORKSPACE_ID,
				namespace,
			),
			handleBrowserWorkspaceMutation(
				request(secondMutation),
				WORKSPACE_ID,
				namespace,
			),
		]);

		expect([first.status, second.status]).toEqual([200, 409]);
		const conflict = (await second.json()) as { error: { code: string } };
		expect(conflict.error.code).toBe("revision_conflict");
		expect(gateway.patches).toHaveLength(1);
	});

	it("reconciles the latest Gist mutation before returning an older retry", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core } = coordinator(gateway);
		const id = "20000000-0000-4000-8000-000000000002";
		const input = {
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation(id),
		};
		await core.mutate(input);
		gateway.files["subman.json"] = serializeWorkspaceDocumentV2(
			document({
				revision: 3,
				updatedAt: T2,
				lastMutationId: "20000000-0000-4000-8000-000000000099",
			}),
		);

		await expectCode(core.mutate(input), "mutation_recovery_failed");
	});

	it("rejects an idempotent retry after the Gist rolls back", async () => {
		const original = serializeWorkspaceDocumentV2(document());
		const gateway = new MemoryGateway({ "subman.json": original });
		const { core } = coordinator(gateway);
		const input = {
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation("20000000-0000-4000-8000-000000000003"),
		};
		await core.mutate(input);
		gateway.files["subman.json"] = original;

		await expectCode(core.mutate(input), "mutation_recovery_failed");
	});
});

describe("Workspace coordinator migration and recovery", () => {
	it("writes the exact V1 bytes as an immutable backup", async () => {
		const v1 = `${JSON.stringify({ version: 1, data: data() }, null, 2).replaceAll("\n", "\r\n")}\r\n`;
		const gateway = new MemoryGateway({ "subman.json": v1 });
		const { core } = coordinator(gateway);

		await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: mutation(
				"30000000-0000-4000-8000-000000000001",
				0,
				"workspace.reconcile",
				{ baselineRevision: 0, data: data() },
			),
		});

		expect(gateway.files["subman.v1.backup.json"]).toBe(v1);
		expect(gateway.patches[0]?.["subman.v1.backup.json"]?.content).toBe(v1);
		const committed = JSON.parse(gateway.files["subman.json"] ?? "{}") as {
			data?: WorkspaceData;
		};
		expect(committed.data).toEqual(data());
	});

	it("rejects corrupt and higher schemas without journal or Gist writes", async () => {
		for (const [content, code] of [
			[
				JSON.stringify({ version: 3, schemaVersion: 3, data: data() }),
				"unsupported_schema",
			],
			["not-json", "invalid_workspace_document"],
			[
				JSON.stringify({
					version: 2,
					schemaVersion: 2,
					workspaceId: WORKSPACE_ID,
				}),
				"invalid_workspace_document",
			],
		] as const) {
			const gateway = new MemoryGateway({ "subman.json": content });
			const { core, journal } = coordinator(gateway);

			await expectCode(
				core.mutate({
					githubToken: TOKEN,
					gistId: GIST_ID,
					mutation: replaceNodeMutation("30000000-0000-4000-8000-000000000010"),
				}),
				code,
			);
			expect(gateway.patches).toHaveLength(0);
			expect(journal.pending.size).toBe(0);
			expect(journal.processed.size).toBe(0);
			expect(gateway.files["subman.json"]).toBe(content);
		}
	});

	it("commits a tombstone and rejects stale and current-revision resurrection", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core } = coordinator(gateway);
		const deletion = core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: mutation(
				"30000000-0000-4000-8000-000000000011",
				1,
				"node.delete",
				{ id: "node-1" },
			),
		});
		const staleUpdate = core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation(
				"30000000-0000-4000-8000-000000000012",
				1,
				"node-1",
			),
		});

		const deleted = await deletion;
		await expectCode(staleUpdate, "revision_conflict");
		expect(deleted.document.tombstones.nodes[0]).toEqual({
			id: "node-1",
			deletedAt: T1,
			deletedRevision: 2,
			mutationId: "30000000-0000-4000-8000-000000000011",
		});
		await expectCode(
			core.mutate({
				githubToken: TOKEN,
				gistId: GIST_ID,
				mutation: replaceNodeMutation(
					"30000000-0000-4000-8000-000000000013",
					2,
					"node-1",
				),
			}),
			"entity_deleted",
		);
		expect(gateway.patches).toHaveLength(1);
	});

	it("rejects a conflicting V1 backup before writing", async () => {
		const gateway = new MemoryGateway({
			"subman.json": JSON.stringify({ version: 1, data: data() }),
			"subman.v1.backup.json": "different bytes",
		});
		const { core } = coordinator(gateway);

		await expectCode(
			core.mutate({
				githubToken: TOKEN,
				gistId: GIST_ID,
				mutation: mutation(
					"30000000-0000-4000-8000-000000000002",
					0,
					"workspace.reconcile",
					{ baselineRevision: 0, data: data() },
				),
			}),
			"migration_backup_conflict",
		);
		expect(gateway.patches).toHaveLength(0);
	});

	it("turns a bootstrap marker into a V2 workspace", async () => {
		const gateway = new MemoryGateway({
			"subman.bootstrap.json": JSON.stringify({ version: 1 }),
		});
		const { core } = coordinator(gateway);
		const result = await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: mutation(
				"30000000-0000-4000-8000-000000000003",
				0,
				"workspace.reconcile",
				{ baselineRevision: 0, data: data() },
			),
		});

		expect(result.document.revision).toBe(1);
		expect(gateway.files["subman.bootstrap.json"] ?? null).toBeNull();
		expect(JSON.parse(gateway.files["subman.json"] ?? "{}").schemaVersion).toBe(
			2,
		);
	});

	it("recovers a committed pending mutation after a restart", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const journal = new MemoryJournal();
		journal.failNextCommit = true;
		const input = {
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation("40000000-0000-4000-8000-000000000001"),
		};
		const first = new WorkspaceCoordinatorCore({
			gateway,
			journal,
			now: () => T1,
		});
		await expectCode(first.mutate(input), "commit_index_failed");
		expect(journal.pending.size).toBe(1);

		const restarted = new WorkspaceCoordinatorCore({
			gateway,
			journal,
			now: () => T2,
		});
		const recovered = await restarted.mutate(input);
		expect(recovered.committedRevision).toBe(2);
		expect(gateway.patches).toHaveLength(1);
		expect(journal.pending.size).toBe(0);
		expect(journal.processed.size).toBe(1);
	});

	it("recovers a prior pending commit before accepting a different mutation", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const journal = new MemoryJournal();
		journal.failNextCommit = true;
		const first = new WorkspaceCoordinatorCore({
			gateway,
			journal,
			now: () => T1,
		});
		await expectCode(
			first.mutate({
				githubToken: TOKEN,
				gistId: GIST_ID,
				mutation: replaceNodeMutation("40000000-0000-4000-8000-000000000002"),
			}),
			"commit_index_failed",
		);

		const restarted = new WorkspaceCoordinatorCore({
			gateway,
			journal,
			now: () => T2,
		});
		const next = await restarted.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation(
				"40000000-0000-4000-8000-000000000003",
				2,
				"node-3",
			),
		});

		expect(next.document.revision).toBe(3);
		expect(journal.processed.size).toBe(2);
		expect(gateway.patches).toHaveLength(2);
	});

	it("reuses the original commit time when resuming an ambiguous write", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		gateway.patchFailure = "before";
		gateway.failingReads.add(2);
		const journal = new MemoryJournal();
		const input = {
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation("40000000-0000-4000-8000-000000000004"),
		};
		const first = new WorkspaceCoordinatorCore({
			gateway,
			journal,
			now: () => T1,
		});
		await expectCode(first.mutate(input), "write_verification_failed");
		expect(journal.pending.size).toBe(1);

		gateway.patchFailure = null;
		const restarted = new WorkspaceCoordinatorCore({
			gateway,
			journal,
			now: () => T2,
		});
		const result = await restarted.mutate(input);

		expect(result.committedAt).toBe(T1);
		expect(result.document.updatedAt).toBe(T1);
	});
});

describe("Workspace coordinator write verification and security", () => {
	it("classifies an initial GitHub read failure without exposing its cause", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		gateway.failingReads.add(1);
		const { core } = coordinator(gateway);
		let failure: WorkspaceCoordinatorError | null = null;
		try {
			await core.mutate({
				githubToken: TOKEN,
				gistId: GIST_ID,
				mutation: replaceNodeMutation("50000000-0000-4000-8000-000000000007"),
			});
		} catch (error) {
			failure = error as WorkspaceCoordinatorError;
		}
		expect(failure?.code).toBe("gist_read_failed");
		expect(failure?.message).toBe("Unable to read the workspace Gist");
		expect(failure?.message).not.toContain(TOKEN);
	});

	it("accepts a lost PATCH response when read-back proves the commit", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		gateway.patchFailure = "after";
		const { core } = coordinator(gateway);
		const result = await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation("50000000-0000-4000-8000-000000000001"),
		});
		expect(result.committedRevision).toBe(2);
	});

	it("does not advance the remote revision or committed index on failed PATCH", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		gateway.patchFailure = "before";
		const { core, journal } = coordinator(gateway);
		await expectCode(
			core.mutate({
				githubToken: TOKEN,
				gistId: GIST_ID,
				mutation: replaceNodeMutation("50000000-0000-4000-8000-000000000002"),
			}),
			"gist_write_failed",
		);
		expect(JSON.parse(gateway.files["subman.json"] ?? "{}").revision).toBe(1);
		expect(journal.processed.size).toBe(0);
		expect(journal.pending.size).toBe(0);
	});

	it("classifies a failed PATCH when an immutable backup is retained", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
			"subman.v1.backup.json": "original V1 bytes",
		});
		gateway.patchFailure = "before";
		const { core, journal } = coordinator(gateway);
		await expectCode(
			core.mutate({
				githubToken: TOKEN,
				gistId: GIST_ID,
				mutation: replaceNodeMutation("50000000-0000-4000-8000-000000000004"),
			}),
			"gist_write_failed",
		);
		expect(journal.pending.size).toBe(0);
	});

	it("fails verification when an existing backup changes during commit", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
			"subman.v1.backup.json": "original V1 bytes",
		});
		gateway.afterPatch = (files) => {
			files["subman.v1.backup.json"] = "tampered";
		};
		const { core, journal } = coordinator(gateway);
		await expectCode(
			core.mutate({
				githubToken: TOKEN,
				gistId: GIST_ID,
				mutation: replaceNodeMutation("50000000-0000-4000-8000-000000000005"),
			}),
			"write_verification_failed",
		);
		expect(journal.pending.size).toBe(1);
	});

	it("rejects extra fields in a persisted result", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core, journal } = coordinator(gateway);
		const input = {
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation("50000000-0000-4000-8000-000000000006"),
		};
		await core.mutate(input);
		const row = journal.processed.get(input.mutation.mutationId);
		if (!row) throw new Error("Expected processed mutation");
		row.resultJson = JSON.stringify({
			...JSON.parse(row.resultJson),
			githubToken: TOKEN,
		});

		await expectCode(core.mutate(input), "invalid_journal_record");
	});

	it("never persists or returns the GitHub token", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core, journal } = coordinator(gateway);
		const result = await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: replaceNodeMutation("50000000-0000-4000-8000-000000000003"),
		});
		const persisted = JSON.stringify({
			pending: [...journal.pending.values()],
			processed: [...journal.processed.values()],
		});
		expect(persisted).not.toContain(TOKEN);
		expect(JSON.stringify(result)).not.toContain(TOKEN);
		expect(gateway.files["subman.json"] ?? "").not.toContain(TOKEN);
	});
});

describe("Workspace coordinator mixed mutations", () => {
	it("serializes output deletion and clears published metadata", async () => {
		const publishedDocument = document();
		const publishedTarget = publishedDocument.data.publishTargets[0];
		if (!publishedTarget) throw new Error("Expected publish target fixture");
		publishedDocument.data.publishTargets[0] = {
			...publishedTarget,
			lastPublishedAt: T0,
			lastPublishedUrl: "https://example.com/aggregate.txt",
		};
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(publishedDocument),
			"aggregate.txt": "published",
		});
		const { core } = coordinator(gateway);
		const result = await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: mutation(
				"60000000-0000-4000-8000-000000000000",
				1,
				"output.delete",
				{ fileName: "aggregate.txt" },
			),
		});

		expect(gateway.files["aggregate.txt"]).toBe(undefined);
		expect(result.document.revision).toBe(2);
		expect(result.document.data.publishTargets[0]?.lastPublishedAt).toBeNull();
		expect(result.document.data.publishTargets[0]?.lastPublishedUrl).toBeNull();
	});

	it("preserves publication output before a Server API node mutation", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core } = coordinator(gateway);
		await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: mutation(
				"60000000-0000-4000-8000-000000000001",
				1,
				"aggregate.publish",
				{
					targetId: "target-1",
					output: { fileName: "aggregate.txt", content: "published" },
				},
			),
		});
		const result = await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: mutation(
				"60000000-0000-4000-8000-000000000002",
				2,
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
				"server-api",
			),
		});

		expect(gateway.files["aggregate.txt"]).toBe("published");
		expect(result.document.data.nodes.map((item) => item.id)).toContain(
			"node-2",
		);
		expect(result.document.data.publishTargets[0]?.lastPublishedAt).toBe(T1);
	});

	it("preserves client export output before a browser node deletion", async () => {
		const gateway = new MemoryGateway({
			"subman.json": serializeWorkspaceDocumentV2(document()),
		});
		const { core } = coordinator(gateway);
		await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: mutation(
				"70000000-0000-4000-8000-000000000001",
				1,
				"client-export.publish",
				{
					profileId: "export-1",
					output: { fileName: "client.json", content: "{}" },
				},
			),
		});
		const result = await core.mutate({
			githubToken: TOKEN,
			gistId: GIST_ID,
			mutation: mutation(
				"70000000-0000-4000-8000-000000000002",
				2,
				"node.delete",
				{ id: "node-1" },
			),
		});

		expect(gateway.files["client.json"]).toBe("{}");
		expect(result.document.tombstones.nodes[0]?.id).toBe("node-1");
		expect(result.document.data.clientExports[0]?.lastPublishedAt).toBe(T1);
	});
});
