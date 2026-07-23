import { describe, expect, it } from "bun:test";
import type { AppState } from "$lib/models";
import type { WorkspaceDocumentV2 } from "$lib/workspace-document";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import {
	createEmptyWorkspacePersistenceRecord,
	InMemoryWorkspacePersistence,
} from "$lib/workspace-persistence";
import {
	discardInspectedWorkspaceQueue,
	rebindInspectedWorkspace,
	refreshWorkspaceQueueInspection,
	repairInspectedWorkspaceQueue,
} from "$lib/workspace-queue-inspector";
import {
	createWorkspaceV2LocalState,
	type WorkspaceV2LocalState,
} from "$lib/workspace-v2-state";

const NOW = "2026-07-23T12:00:00.000Z";
const ACTIVE_GIST_ID = "active-gist";
const ACTIVE_WORKSPACE_ID = `gist:${ACTIVE_GIST_ID}`;
const ORPHAN_GIST_ID = "orphan-gist";
const ORPHAN_WORKSPACE_ID = `gist:${ORPHAN_GIST_ID}`;

async function captureError(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (error) {
		return error as Error;
	}
	throw new Error("Expected promise to reject");
}

function document(gistId: string, revision = 0): WorkspaceDocumentV2 {
	return {
		version: 2,
		schemaVersion: 2,
		workspaceId: `gist:${gistId}`,
		revision,
		updatedAt: NOW,
		lastMutationId: null,
		data: {
			nodes: [],
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

function binding(gistId: string): WorkspaceV2LocalState {
	return createWorkspaceV2LocalState(gistId, {
		baseline: document(gistId),
		syncMode: "automatic",
	});
}

function snapshot(gistId: string): AppState {
	return {
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
		gists: [],
		activeGistId: gistId,
		activeGistFile: "subman.json",
		lastUpdated: NOW,
	};
}

function reconcile(workspaceId: string, mutationId: string): WorkspaceMutation {
	return {
		mutationId,
		workspaceId,
		expectedRevision: 0,
		source: "browser",
		createdAt: NOW,
		kind: "workspace.reconcile",
		payload: {
			baselineRevision: 0,
			data: {
				nodes: [],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			},
		},
	};
}

function persistence(): InMemoryWorkspacePersistence {
	const record = createEmptyWorkspacePersistenceRecord();
	record.snapshot = snapshot(ACTIVE_GIST_ID);
	record.binding = binding(ACTIVE_GIST_ID);
	for (const [workspaceId, mutationId] of [
		[ACTIVE_WORKSPACE_ID, "10000000-0000-4000-8000-000000000001"],
		[ORPHAN_WORKSPACE_ID, "10000000-0000-4000-8000-000000000002"],
	] as const) {
		record.workspaces[workspaceId] = {
			workspaceId,
			mutations: [reconcile(workspaceId, mutationId)],
			delivery: {
				retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
				blocked: null,
				deadLetters: [],
			},
		};
	}
	return new InMemoryWorkspacePersistence(record);
}

describe("Workspace queue inspector service", () => {
	it("refreshes grouped active and orphan queue inspection", async () => {
		const inspection = await refreshWorkspaceQueueInspection(persistence());

		expect(inspection.activeWorkspaceId).toBe(ACTIVE_WORKSPACE_ID);
		expect(inspection.activeQueueCount).toBe(1);
		expect(inspection.totalQueueCount).toBe(2);
		expect(inspection.orphanedWorkspaceCount).toBe(1);
		expect(
			inspection.workspaces.map(({ workspaceId, active }) => ({
				workspaceId,
				active,
			})),
		).toEqual([
			{ workspaceId: ACTIVE_WORKSPACE_ID, active: true },
			{ workspaceId: ORPHAN_WORKSPACE_ID, active: false },
		]);
	});

	it("discards whole orphan and active queues and refreshes counts", async () => {
		const store = persistence();
		const orphanResult = await discardInspectedWorkspaceQueue(store, {
			workspaceId: ORPHAN_WORKSPACE_ID,
		});
		expect(orphanResult.discardedCount).toBe(1);
		expect(orphanResult.inspection.totalQueueCount).toBe(1);
		expect(orphanResult.inspection.orphanedWorkspaceCount).toBe(0);

		expect(
			(
				await captureError(
					discardInspectedWorkspaceQueue(store, {
						workspaceId: ACTIVE_WORKSPACE_ID,
					}),
				)
			).message,
		).toContain("baseline realignment");
		const activeResult = await discardInspectedWorkspaceQueue(store, {
			workspaceId: ACTIVE_WORKSPACE_ID,
			realignment: {
				snapshot: snapshot(ACTIVE_GIST_ID),
				binding: binding(ACTIVE_GIST_ID),
			},
		});
		expect(activeResult.discardedCount).toBe(1);
		expect(activeResult.inspection.totalQueueCount).toBe(0);
	});

	it("rejects mismatched identities before rebind or repair", async () => {
		const store = persistence();
		expect(
			(
				await captureError(
					rebindInspectedWorkspace(store, {
						workspaceId: ACTIVE_WORKSPACE_ID,
						snapshot: snapshot(ORPHAN_GIST_ID),
						binding: binding(ORPHAN_GIST_ID),
					}),
				)
			).message,
		).toContain("identity does not match");
		expect(
			(
				await captureError(
					repairInspectedWorkspaceQueue(store, {
						workspaceId: ACTIVE_WORKSPACE_ID,
						snapshot: snapshot(ORPHAN_GIST_ID),
						binding: binding(ORPHAN_GIST_ID),
						mutations: [],
					}),
				)
			).message,
		).toContain("identity does not match");
		expect((await store.read()).binding?.workspaceId).toBe(ACTIVE_WORKSPACE_ID);
	});

	it("rebinds and repairs an explicitly selected Workspace", async () => {
		const store = persistence();
		const rebound = await rebindInspectedWorkspace(store, {
			workspaceId: ORPHAN_WORKSPACE_ID,
			snapshot: snapshot(ORPHAN_GIST_ID),
			binding: binding(ORPHAN_GIST_ID),
		});
		expect(rebound.activeWorkspaceId).toBe(ORPHAN_WORKSPACE_ID);
		expect(
			rebound.workspaces.find(
				(workspace) => workspace.workspaceId === ORPHAN_WORKSPACE_ID,
			)?.active,
		).toBe(true);

		const repairedMutation = reconcile(
			ORPHAN_WORKSPACE_ID,
			"10000000-0000-4000-8000-000000000003",
		);
		const repaired = await repairInspectedWorkspaceQueue(store, {
			workspaceId: ORPHAN_WORKSPACE_ID,
			snapshot: snapshot(ORPHAN_GIST_ID),
			binding: binding(ORPHAN_GIST_ID),
			mutations: [repairedMutation],
		});
		expect(repaired.activeQueueCount).toBe(1);
		const repairedHead = repaired.workspaces.find(
			(workspace) => workspace.active,
		)?.mutations[0];
		expect(repairedHead?.mutationId).toBe(repairedMutation.mutationId);
		expect(repairedHead?.expectedRevision).toBe(0);
	});
});
