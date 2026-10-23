import { describe, expect, it } from "bun:test";
import type { AppState, NodeItem } from "$lib/models";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import { parseWorkspaceMutation } from "$lib/workspace-mutation";
import {
	createEmptyWorkspacePersistenceRecord,
	InMemoryWorkspacePersistence,
	WorkspaceConcurrentUpdateError,
	workspaceDispatcherLeaseName,
} from "$lib/workspace-persistence";
import { createWorkspaceSettingsController } from "$lib/workspace-settings-controller";
import {
	createDefaultWorkspaceSyncStatus,
	transitionWorkspaceSyncState,
	type WorkspaceSyncEvent,
} from "$lib/workspace-sync-state-machine";
import {
	createWorkspaceV2LocalState,
	hydrateAppStateFromWorkspaceDocument,
} from "$lib/workspace-v2-state";

const NOW = "2026-07-23T12:00:00.000Z";
const GIST_ID = "settings-gist";
const WORKSPACE_ID = `gist:${GIST_ID}`;
const MUTATION_ID = "90000000-0000-4000-8000-000000000001";

function node(id: string, name = id): NodeItem {
	return {
		id,
		name,
		type: "vless",
		raw: `vless://${id}`,
		tags: [],
		enabled: true,
		updatedAt: NOW,
		source: "single",
	};
}

function document(revision = 0, nodes: NodeItem[] = []): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: WORKSPACE_ID,
		revision,
		updatedAt: NOW,
		lastMutationId: null,
		data: {
			nodes,
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
		tombstones: {
			nodes: [],
			subscriptions: [],
			aggregates: [],
			publishTargets: [],
			clientExports: [],
		},
	};
}

function state(documentValue = document()): AppState {
	return hydrateAppStateFromWorkspaceDocument(
		createDefaultWorkspaceState(NOW),
		documentValue,
		GIST_ID,
	);
}

function queuedPersistence(): InMemoryWorkspacePersistence {
	const record = createEmptyWorkspacePersistenceRecord();
	record.snapshot = state();
	record.binding = createWorkspaceV2LocalState(GIST_ID, {
		baseline: document(),
		syncMode: "automatic",
	});
	record.workspaces[WORKSPACE_ID] = {
		workspaceId: WORKSPACE_ID,
		mutations: [
			parseWorkspaceMutation({
				mutationId: MUTATION_ID,
				workspaceId: WORKSPACE_ID,
				expectedRevision: 0,
				source: "browser",
				createdAt: NOW,
				kind: "workspace.reconcile",
				payload: { baselineRevision: 0, data: document().data },
			}),
		],
		delivery: {
			retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
			blocked: null,
			deadLetters: [],
		},
	};
	return new InMemoryWorkspacePersistence(record);
}

function controller(
	persistence: InMemoryWorkspacePersistence,
	initialState = state(),
	fetchImpl?: typeof fetch,
) {
	let current = initialState;
	const events: WorkspaceSyncEvent[] = [];
	return {
		controller: createWorkspaceSettingsController({
			persistence,
			fetchImpl,
			getState: () => current,
			setState: (next) => {
				current = next;
			},
			dispatchSyncEvent: (event) => {
				events.push(event);
				return true;
			},
		}),
		state: () => current,
		events,
	};
}

async function captureError(operation: Promise<unknown>): Promise<unknown> {
	try {
		await operation;
		return null;
	} catch (error) {
		return error;
	}
}

async function expectRejection(
	operation: Promise<unknown>,
	message: string,
): Promise<void> {
	const failure = await captureError(operation);
	expect(failure instanceof Error ? failure.message : "").toBe(message);
}

describe("Workspace settings controller", () => {
	for (const action of [
		"connect",
		"migrate",
		"bind-only",
		"use-remote",
		"use-local",
		"merge",
		"persist-snapshot",
		"reconcile",
		"pause-for-repair",
		"rebind-orphan",
		"refresh-cloud",
	] as const) {
		it(`preserves the bound Workspace and queued changes when ${action} targets another Gist`, async () => {
			const persistence = queuedPersistence();
			const setup = controller(persistence);
			await setup.controller.initialize();
			const before = await persistence.read();
			const beforeState = setup.state();
			const otherGistId = "other-settings-gist";
			const otherDocument = {
				...document(2, [node("other")]),
				workspaceId: `gist:${otherGistId}`,
			};
			const otherState = hydrateAppStateFromWorkspaceDocument(
				createDefaultWorkspaceState(NOW),
				otherDocument,
				otherGistId,
			);
			const snapshot = {
				origin: "v2" as const,
				document: otherDocument,
				state: otherState,
			};
			const conflict = setup.controller.createConflict(
				otherDocument,
				otherGistId,
			);
			let operation: Promise<unknown>;
			switch (action) {
				case "connect":
					operation = setup.controller.connect({
						token: "fixture-token",
						gistId: otherGistId,
						created: false,
						snapshot,
						previousBinding: null,
					});
					break;
				case "migrate":
					operation = setup.controller.migrateLegacy({
						token: "fixture-token",
						gistId: otherGistId,
						snapshot: {
							...snapshot,
							origin: "v1",
							legacySourceSha256: "a".repeat(64),
						},
					});
					break;
				case "bind-only":
					operation = setup.controller.bindOnly(conflict);
					break;
				case "use-remote":
				case "use-local":
				case "merge":
					operation = setup.controller.resolveConflict({
						token: "fixture-token",
						conflict,
						action:
							action === "use-remote"
								? "remote"
								: action === "use-local"
									? "local"
									: "merge",
					});
					break;
				case "persist-snapshot":
					operation = setup.controller.persistSnapshot(
						snapshot,
						otherGistId,
						"automatic",
					);
					break;
				case "reconcile":
					operation = setup.controller.reconcile({
						token: "fixture-token",
						gistId: otherGistId,
						baseline: otherDocument,
						resolvedState: otherState,
						syncMode: "automatic",
					});
					break;
				case "pause-for-repair":
					operation = setup.controller.pauseForRepair(
						otherDocument,
						otherGistId,
					);
					break;
				case "rebind-orphan":
					operation = setup.controller.rebindOrphan({
						workspaceId: `gist:${otherGistId}`,
						snapshot,
					});
					break;
				case "refresh-cloud":
					operation = setup.controller.refreshCloud(snapshot, otherGistId);
					break;
			}
			await expectRejection(
				operation,
				"This device is already connected to a Workspace. Reconnect the same Gist.",
			);
			expect(await persistence.read()).toEqual(before);
			expect(setup.state()).toEqual(beforeState);
			expect(setup.events).toEqual([]);
		});
	}

	it("reconnects the same Gist while preserving its cloud identity", async () => {
		const record = createEmptyWorkspacePersistenceRecord();
		record.snapshot = state();
		record.binding = createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(),
		});
		const persistence = new InMemoryWorkspacePersistence(record);
		const setup = controller(persistence);
		await setup.controller.initialize();

		const result = await setup.controller.connect({
			token: "fixture-token",
			gistId: GIST_ID,
			created: false,
			snapshot: { origin: "v2", document: document(), state: state() },
			previousBinding: null,
		});

		expect(result.status).toBe("synced");
		expect((await persistence.read()).binding?.workspaceId).toBe(WORKSPACE_ID);
		expect(setup.events.at(-1)?.type).toBe("WORKSPACE_BOUND");
	});

	it("checks the persisted binding when another tab connects after initialization", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const setup = controller(persistence);
		await setup.controller.initialize();
		const otherGistId = "other-settings-gist";
		const otherDocument = {
			...document(),
			workspaceId: `gist:${otherGistId}`,
		};
		const otherState = hydrateAppStateFromWorkspaceDocument(
			createDefaultWorkspaceState(NOW),
			otherDocument,
			otherGistId,
		);
		await persistence.rebindWorkspace({
			snapshot: otherState,
			binding: createWorkspaceV2LocalState(otherGistId, {
				baseline: otherDocument,
			}),
		});
		const before = await persistence.read();

		await expectRejection(
			setup.controller.connect({
				token: "fixture-token",
				gistId: GIST_ID,
				created: false,
				snapshot: { origin: "v2", document: document(), state: state() },
				previousBinding: null,
			}),
			"This device is already connected to a Workspace. Reconnect the same Gist.",
		);
		expect(await persistence.read()).toEqual(before);
	});

	it("requires a migration choice before changing a legacy Workspace or the local snapshot", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const local = state(document(0, [node("local")]));
		const setup = controller(persistence, local);
		await setup.controller.initialize();
		const before = await persistence.read();
		const remote = document(0, [node("remote")]);
		const result = await setup.controller.connect({
			token: "fixture-token",
			gistId: GIST_ID,
			created: false,
			snapshot: {
				origin: "v1",
				legacySourceSha256: "a".repeat(64),
				document: remote,
				state: state(remote),
			},
			previousBinding: null,
		});
		expect(result.status).toBe("migration-required");
		expect(await persistence.read()).toEqual(before);
		expect(setup.state()).toEqual(local);
		expect(setup.events).toEqual([]);
	});

	it("loads cloud data when a browser cache contains different business data", async () => {
		const local = state(document(0, [node("cached")]));
		const record = createEmptyWorkspacePersistenceRecord();
		record.snapshot = local;
		record.binding = createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(),
		});
		const persistence = new InMemoryWorkspacePersistence(record);
		const setup = controller(persistence, local);
		await setup.controller.initialize();
		const remote = document(3, [node("cloud")]);

		const result = await setup.controller.connect({
			token: "fixture-token",
			gistId: GIST_ID,
			created: false,
			snapshot: { origin: "v2", document: remote, state: state(remote) },
			previousBinding: setup.controller.binding(),
		});

		expect(result.status).toBe("synced");
		expect(setup.state().nodes.map((item) => item.id)).toEqual(["cloud"]);
		const stored = await persistence.read();
		expect(stored.binding?.baseline).toEqual(remote);
		expect(stored.binding?.syncMode).toBe("automatic");
		expect(stored.workspaces[WORKSPACE_ID]?.mutations ?? []).toEqual([]);
	});

	it("creates an empty cloud document without uploading old browser business data", async () => {
		const local = state(document(0, [node("cached")]));
		const persistence = new InMemoryWorkspacePersistence();
		const requests: Record<string, unknown>[] = [];
		const setup = controller(persistence, local, async (_input, init) => {
			const request = JSON.parse(String(init?.body));
			requests.push(request);
			return Response.json({
				document: {
					...document(1),
					lastMutationId: request.mutationId,
				},
				mutationId: request.mutationId,
				workspaceId: WORKSPACE_ID,
				committedRevision: 1,
				committedAt: NOW,
				receipt: { kind: request.kind },
				status: "committed",
			});
		});
		await setup.controller.initialize();

		const result = await setup.controller.connect({
			token: "fixture-token",
			gistId: GIST_ID,
			created: true,
			snapshot: { origin: "bootstrap", document: document(), state: local },
			previousBinding: null,
		});

		expect(result.status).toBe("created");
		expect("operation" in result && result.operation?.status).toBe(
			"remote-committed",
		);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.kind).toBe("workspace.reconcile");
		expect(requests[0]?.payload).toEqual({
			baselineRevision: 0,
			data: document().data,
		});
		expect(setup.state().nodes).toEqual([]);
	});

	it("preserves an edit committed by another tab while cloud data is loading", async () => {
		class ConcurrentEditPersistence extends InMemoryWorkspacePersistence {
			override async repairWorkspaceQueue(
				input: Parameters<
					InMemoryWorkspacePersistence["repairWorkspaceQueue"]
				>[0],
			): Promise<void> {
				await this.commitAutomaticAction({
					snapshot: state(document(0, [node("concurrent")])),
					binding: createWorkspaceV2LocalState(GIST_ID, {
						baseline: document(),
					}),
					mutation: parseWorkspaceMutation({
						mutationId: MUTATION_ID,
						workspaceId: WORKSPACE_ID,
						expectedRevision: 0,
						source: "browser",
						createdAt: NOW,
						kind: "workspace.reconcile",
						payload: {
							baselineRevision: 0,
							data: document(0, [node("concurrent")]).data,
						},
					}),
				});
				await super.repairWorkspaceQueue(input);
			}
		}
		const record = createEmptyWorkspacePersistenceRecord();
		record.snapshot = state();
		record.binding = createWorkspaceV2LocalState(GIST_ID, {
			baseline: document(),
		});
		const persistence = new ConcurrentEditPersistence(record);
		const setup = controller(persistence);
		await setup.controller.initialize();

		const failure = await captureError(
			setup.controller.refreshCloud(
				{ origin: "v2", document: document(1), state: state(document(1)) },
				GIST_ID,
			),
		);
		expect(failure instanceof WorkspaceConcurrentUpdateError).toBe(true);
		const stored = await persistence.read();
		expect(stored.snapshot?.nodes.map((item) => item.id)).toEqual([
			"concurrent",
		]);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations[0]?.mutationId).toBe(
			MUTATION_ID,
		);
		expect(stored.binding?.revision).toBe(0);
	});

	it("does not load a legacy cloud snapshot before explicit migration", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const setup = controller(persistence);
		await setup.controller.initialize();
		const before = await persistence.read();

		await expectRejection(
			setup.controller.refreshCloud(
				{
					origin: "v1",
					legacySourceSha256: "a".repeat(64),
					document: document(),
					state: state(),
				},
				GIST_ID,
			),
			"Upgrade this Workspace to continue.",
		);
		expect(await persistence.read()).toEqual(before);
	});

	it("rejects cloud data older than the latest confirmed revision", async () => {
		const latest = document(4, [node("latest")]);
		const record = createEmptyWorkspacePersistenceRecord();
		record.snapshot = state(latest);
		record.binding = createWorkspaceV2LocalState(GIST_ID, { baseline: latest });
		const persistence = new InMemoryWorkspacePersistence(record);
		const setup = controller(persistence, state(latest));
		await setup.controller.initialize();
		const before = await persistence.read();

		const failure = await captureError(
			setup.controller.refreshCloud(
				{
					origin: "v2",
					document: document(2, [node("stale")]),
					state: state(document(2, [node("stale")])),
				},
				GIST_ID,
			),
		);

		expect(failure instanceof WorkspaceConcurrentUpdateError).toBe(true);
		expect(await persistence.read()).toEqual(before);
		expect(setup.state().nodes.map((item) => item.id)).toEqual(["latest"]);
	});

	it("initializes from persistence and reconstructs only persisted state conflicts", async () => {
		const record = createEmptyWorkspacePersistenceRecord();
		const remote = document(1, [node("remote")]);
		const local = state(document(0, [node("local")]));
		record.snapshot = local;
		record.binding = createWorkspaceV2LocalState(GIST_ID, {
			baseline: remote,
			conflictBaseline: document(),
			syncMode: "paused-conflict",
		});
		record.workspaces[WORKSPACE_ID] = {
			workspaceId: WORKSPACE_ID,
			mutations: [
				parseWorkspaceMutation({
					mutationId: MUTATION_ID,
					workspaceId: WORKSPACE_ID,
					expectedRevision: 0,
					source: "browser",
					createdAt: NOW,
					kind: "workspace.reconcile",
					payload: {
						baselineRevision: 0,
						data: document(0, [node("local")]).data,
					},
				}),
			],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: {
					mutationId: MUTATION_ID,
					kind: "workspace.reconcile",
					code: "revision_conflict",
					disposition: "state-conflict",
					messageKey: "workspace.state-conflict",
					createdAt: NOW,
					blockedAt: NOW,
				},
				deadLetters: [],
			},
		};
		const setup = controller(new InMemoryWorkspacePersistence(record), local);
		const view = await setup.controller.initialize();
		const conflict = setup.controller.persistedConflict(view);

		expect(conflict?.gistId).toBe(GIST_ID);
		expect(conflict?.remoteState.nodes.map((item) => item.id)).toEqual([
			"remote",
		]);
		expect(conflict?.localSignature).not.toBe(conflict?.remoteSignature);

		const stateConflict = record.workspaces[WORKSPACE_ID].delivery.blocked;
		if (!stateConflict) throw new Error("Expected state conflict metadata");
		record.workspaces[WORKSPACE_ID].delivery.blocked = {
			...stateConflict,
			code: "duplicate_node_raw",
			disposition: "domain-conflict",
			messageKey: "workspace.domain-conflict",
		};
		const domainSetup = controller(
			new InMemoryWorkspacePersistence(record),
			local,
		);
		expect(
			domainSetup.controller.persistedConflict(
				await domainSetup.controller.initialize(),
			),
		).toBeNull();
	});

	it("replaces a blocked conflict queue with one current manual reconcile", async () => {
		const persistence = queuedPersistence();
		const setup = controller(persistence);
		await setup.controller.initialize();
		const lease = await persistence.acquireLease({
			name: workspaceDispatcherLeaseName(WORKSPACE_ID),
			ownerId: "bind-only-test",
			now: Date.now(),
			ttlMs: 30_000,
		});
		if (!lease.acquired) throw new Error("Expected test lease");
		const fence = {
			ownerId: lease.lease.ownerId,
			fencingToken: lease.lease.fencingToken,
		};
		await persistence.blockMutation(
			WORKSPACE_ID,
			{
				mutationId: MUTATION_ID,
				kind: "workspace.reconcile",
				code: "revision_conflict",
				disposition: "state-conflict",
				messageKey: "workspace.state-conflict",
				createdAt: NOW,
				blockedAt: NOW,
			},
			fence,
		);
		await persistence.setRetryMetadata(
			WORKSPACE_ID,
			MUTATION_ID,
			{
				attempt: 4,
				nextAttemptAt: Date.now() + 60_000,
				lastErrorCode: "upstream_timeout",
			},
			fence,
		);
		const conflict = setup.controller.createConflict(
			document(2, [node("remote")]),
			GIST_ID,
		);

		await setup.controller.bindOnly(conflict);

		const stored = await persistence.read();
		expect(stored.binding?.syncMode).toBe("manual");
		expect(stored.binding?.revision).toBe(2);
		expect(stored.snapshot).toEqual(setup.state());
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toHaveLength(1);
		expect(
			stored.workspaces[WORKSPACE_ID]?.mutations[0]?.expectedRevision,
		).toBe(2);
		expect(stored.workspaces[WORKSPACE_ID]?.mutations[0]?.mutationId).not.toBe(
			MUTATION_ID,
		);
		expect(stored.workspaces[WORKSPACE_ID]?.delivery.blocked).toBeNull();
		expect(stored.workspaces[WORKSPACE_ID]?.delivery.retry).toEqual({
			attempt: 0,
			nextAttemptAt: null,
			lastErrorCode: null,
		});
		expect(stored.leases).toEqual({});
		expect(setup.state().activeGistId).toBe(GIST_ID);
		expect(setup.events.at(-1)?.type).toBe("WORKSPACE_BOUND");
	});

	it("clears a stale queue when bind-only state already matches remote", async () => {
		const persistence = queuedPersistence();
		const setup = controller(persistence);
		await setup.controller.initialize();
		const conflict = setup.controller.createConflict(document(), GIST_ID);

		await setup.controller.bindOnly(conflict);

		const stored = await persistence.read();
		expect(stored.binding?.syncMode).toBe("manual");
		expect(stored.workspaces[WORKSPACE_ID]?.mutations).toEqual([]);
		expect(stored.workspaces[WORKSPACE_ID]?.delivery.blocked).toBeNull();
	});

	it("preserves pending mutations until delivery finishes before refreshing cloud data", async () => {
		const persistence = queuedPersistence();
		const setup = controller(persistence);
		await setup.controller.initialize();
		const remote = document(3, [node("remote")]);
		const before = await persistence.read();

		await expectRejection(
			setup.controller.connect({
				token: "test-token-never-sent",
				gistId: GIST_ID,
				created: false,
				snapshot: { origin: "v2", document: remote, state: state(remote) },
				previousBinding: null,
			}),
			"Pending cloud changes must finish syncing before refreshing cloud data.",
		);
		expect(await persistence.read()).toEqual(before);
		expect(setup.state().nodes).toEqual([]);
		expect(setup.events).toEqual([]);
	});

	it("requires explicit repair before replacing dead-letter evidence", async () => {
		const persistence = queuedPersistence();
		const setup = controller(persistence);
		await setup.controller.initialize();
		const lease = await persistence.acquireLease({
			name: workspaceDispatcherLeaseName(WORKSPACE_ID),
			ownerId: "dead-letter-test",
			now: Date.now(),
			ttlMs: 30_000,
		});
		if (!lease.acquired) throw new Error("Expected test lease");
		await persistence.quarantineWorkspaceQueue({
			workspaceId: WORKSPACE_ID,
			reason: "queue-corruption",
			code: "queue_corruption",
			createdAt: NOW,
			fence: {
				ownerId: lease.lease.ownerId,
				fencingToken: lease.lease.fencingToken,
			},
		});

		let failure: unknown;
		try {
			await setup.controller.connect({
				token: "test-token-never-sent",
				gistId: GIST_ID,
				created: false,
				snapshot: {
					origin: "v2",
					document: document(3, [node("remote")]),
					state: state(document(3, [node("remote")])),
				},
				previousBinding: setup.controller.binding(),
			});
		} catch (error) {
			failure = error;
		}
		expect(failure instanceof Error ? failure.message : "").toContain(
			"requires repair before connection",
		);
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.delivery.deadLetters,
		).toHaveLength(1);
	});

	it("preserves dead-letter-only orphan evidence after a validated rebind", async () => {
		const persistence = queuedPersistence();
		const lease = await persistence.acquireLease({
			name: workspaceDispatcherLeaseName(WORKSPACE_ID),
			ownerId: "orphan-rebind-test",
			now: Date.now(),
			ttlMs: 30_000,
		});
		if (!lease.acquired) throw new Error("Expected test lease");
		await persistence.quarantineWorkspaceQueue({
			workspaceId: WORKSPACE_ID,
			reason: "queue-corruption",
			code: "queue_corruption",
			createdAt: NOW,
			fence: {
				ownerId: lease.lease.ownerId,
				fencingToken: lease.lease.fencingToken,
			},
		});
		const unboundRecord = await persistence.read();
		unboundRecord.snapshot = createDefaultWorkspaceState(NOW);
		unboundRecord.binding = null;
		const setup = controller(
			new InMemoryWorkspacePersistence(unboundRecord),
			unboundRecord.snapshot,
		);
		await setup.controller.initialize();

		const view = await setup.controller.rebindOrphan({
			workspaceId: WORKSPACE_ID,
			snapshot: { origin: "v2", document: document(), state: state() },
		});

		const active = view.inspection.workspaces.find(
			(workspace) => workspace.workspaceId === WORKSPACE_ID,
		);
		expect(view.record.binding?.workspaceId).toBe(WORKSPACE_ID);
		expect(active?.active).toBe(true);
		expect(active?.mutations).toEqual([]);
		expect(active?.deadLetters).toHaveLength(1);
		expect(view.inspection.deadLetterCount).toBe(1);
		const reboundEvent = setup.events.at(-1);
		expect(reboundEvent?.type).toBe("WORKSPACE_BOUND");
		if (!reboundEvent) throw new Error("Expected Workspace rebind event");
		const transition = transitionWorkspaceSyncState(
			createDefaultWorkspaceSyncStatus(),
			reboundEvent,
		);
		expect(transition.accepted).toBe(true);
		expect(transition.state.phase).toBe("queue-repair-required");
		expect(transition.state.repairRequired).toBe(true);
		expect(transition.state.deadLetterCount).toBe(1);
	});

	it("discards a complete active queue with baseline realignment", async () => {
		const persistence = queuedPersistence();
		const setup = controller(persistence);
		await setup.controller.initialize();

		const result = await setup.controller.discardQueue(WORKSPACE_ID);

		expect(result.discardedCount).toBe(1);
		expect(result.view.inspection.totalQueueCount).toBe(0);
		expect((await persistence.read()).workspaces[WORKSPACE_ID]).toBe(undefined);
		expect(setup.events.at(-1)?.type).toBe("REPAIR_SUCCEEDED");
	});

	it("does not discard a peer edit appended while cloud reload is preparing", async () => {
		class ConcurrentDiscardPersistence extends InMemoryWorkspacePersistence {
			override async discardWorkspaceQueue(
				input: Parameters<
					InMemoryWorkspacePersistence["discardWorkspaceQueue"]
				>[0],
			): Promise<number> {
				await this.commitAutomaticAction({
					snapshot: state(),
					binding: createWorkspaceV2LocalState(GIST_ID, {
						baseline: document(),
					}),
					mutation: parseWorkspaceMutation({
						mutationId: "90000000-0000-4000-8000-000000000002",
						workspaceId: WORKSPACE_ID,
						expectedRevision: 1,
						source: "browser",
						createdAt: NOW,
						kind: "workspace.reconcile",
						payload: { baselineRevision: 1, data: document().data },
					}),
				});
				return super.discardWorkspaceQueue(input);
			}
		}
		const persistence = new ConcurrentDiscardPersistence(
			await queuedPersistence().read(),
		);
		const setup = controller(persistence);
		await setup.controller.initialize();

		const failure = await captureError(
			setup.controller.discardQueue(WORKSPACE_ID),
		);

		expect(failure instanceof WorkspaceConcurrentUpdateError).toBe(true);
		expect(
			(await persistence.read()).workspaces[WORKSPACE_ID]?.mutations,
		).toHaveLength(2);
		expect(setup.events).toEqual([]);
	});

	it("exports persisted diagnostics and disconnects with persisted metrics", async () => {
		const setup = controller(queuedPersistence());
		await setup.controller.initialize();

		const diagnostics = JSON.parse(await setup.controller.exportDiagnostics());
		setup.controller.disconnect();

		expect(diagnostics.workspace.workspaceId).toBe(WORKSPACE_ID);
		expect(diagnostics.mutations).toHaveLength(1);
		expect(JSON.stringify(diagnostics)).not.toContain("vless://");
		expect(setup.events.at(-1)?.type).toBe("AUTH_LOST");
		expect(setup.events.at(-1)?.queue?.totalQueueCount).toBe(1);
	});

	it("keeps unresolved entity merges out of the delivery path", async () => {
		const persistence = new InMemoryWorkspacePersistence();
		const local = state(document(0, [node("same", "local")]));
		const setup = controller(persistence, local);
		await setup.controller.initialize();
		const conflict = setup.controller.createConflict(
			document(1, [node("same", "remote")]),
			GIST_ID,
		);

		const result = await setup.controller.resolveConflict({
			token: "test-token-never-sent",
			conflict,
			action: "merge",
		});

		expect(result.status).toBe("needs-choice");
		expect((await persistence.read()).binding).toBeNull();
	});

	it("evaluates manual sync and repair decisions from persisted authority", async () => {
		const persistence = queuedPersistence();
		const setup = controller(persistence);
		await setup.controller.initialize();

		expect(
			setup.controller.evaluateManualPull(
				{ origin: "v2", document: document(), state: state() },
				GIST_ID,
			),
		).toEqual({ status: "already-synced" });
		expect(
			setup.controller.evaluateManualPush(
				{
					origin: "v2",
					document: document(0, [node("remote")]),
					state: state(document(0, [node("remote")])),
				},
				GIST_ID,
			),
		).toEqual({ status: "confirm-push" });
		const review = setup.controller.evaluateManualPush(
			{
				origin: "v2",
				document: document(2, [node("remote")]),
				state: state(document(2, [node("remote")])),
			},
			GIST_ID,
		);
		expect(review.status).toBe("needs-review");

		const lease = await persistence.acquireLease({
			name: workspaceDispatcherLeaseName(WORKSPACE_ID),
			ownerId: "decision-test",
			now: Date.now(),
			ttlMs: 30_000,
		});
		if (!lease.acquired) throw new Error("Expected test lease");
		await persistence.blockMutation(
			WORKSPACE_ID,
			{
				mutationId: MUTATION_ID,
				kind: "workspace.reconcile",
				code: "duplicate_node_raw",
				disposition: "domain-conflict",
				messageKey: "workspace.domain-conflict",
				createdAt: NOW,
				blockedAt: NOW,
			},
			{
				ownerId: lease.lease.ownerId,
				fencingToken: lease.lease.fencingToken,
			},
		);
		await setup.controller.refresh();
		expect(
			setup.controller.evaluateRepair(
				{ origin: "v2", document: document(), state: state() },
				GIST_ID,
			),
		).toEqual({ status: "domain-blocked" });
	});
});
