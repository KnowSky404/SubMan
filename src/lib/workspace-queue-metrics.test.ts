import { describe, expect, it } from "bun:test";
import type { WorkspaceMutation } from "$lib/workspace-mutation";
import {
	createEmptyWorkspacePersistenceRecord,
	type PersistedWorkspaceQueue,
	type WorkspaceBlockedMutationMetadata,
	type WorkspaceDeadLetterMetadata,
	type WorkspacePersistenceRecord,
} from "$lib/workspace-persistence";
import { deriveWorkspaceQueueMetrics } from "$lib/workspace-queue-metrics";
import { createWorkspaceV2LocalState } from "$lib/workspace-v2-state";

const ACTIVE_GIST_ID = "active-gist";
const ACTIVE_WORKSPACE_ID = `gist:${ACTIVE_GIST_ID}`;
const ORPHAN_WORKSPACE_ID = "gist:orphan-gist";
const NOW = "2026-07-29T00:00:00.000Z";

function mutation(
	workspaceId: string,
	mutationId: string,
	expectedRevision = 0,
): WorkspaceMutation {
	return {
		mutationId,
		workspaceId,
		expectedRevision,
		source: "browser",
		createdAt: NOW,
		kind: "node.delete",
		payload: { id: `node-${mutationId}` },
	};
}

function blocked(mutationId: string): WorkspaceBlockedMutationMetadata {
	return {
		mutationId,
		kind: "node.delete",
		code: "duplicate_node_raw",
		disposition: "domain-conflict",
		messageKey: "workspace.domain-conflict",
		createdAt: NOW,
		blockedAt: NOW,
	};
}

function deadLetter(mutationId: string): WorkspaceDeadLetterMetadata {
	return { ...blocked(mutationId), payloadBytes: 128 };
}

function queue(
	workspaceId: string,
	options: {
		mutations?: WorkspaceMutation[];
		blocked?: WorkspaceBlockedMutationMetadata | null;
		deadLetters?: WorkspaceDeadLetterMetadata[];
	} = {},
): PersistedWorkspaceQueue {
	return {
		workspaceId,
		mutations: options.mutations ?? [],
		delivery: {
			retry: { attempt: 0, nextAttemptAt: null, lastErrorCode: null },
			blocked: options.blocked ?? null,
			deadLetters: options.deadLetters ?? [],
		},
	};
}

function record(
	workspaces: Record<string, PersistedWorkspaceQueue>,
): WorkspacePersistenceRecord {
	const value = createEmptyWorkspacePersistenceRecord();
	value.binding = createWorkspaceV2LocalState(ACTIVE_GIST_ID);
	value.workspaces = workspaces;
	return value;
}

describe("deriveWorkspaceQueueMetrics", () => {
	const cases: Array<{
		name: string;
		record: WorkspacePersistenceRecord;
		expected: ReturnType<typeof deriveWorkspaceQueueMetrics>;
	}> = [
		{
			name: "active pending only",
			record: record({
				[ACTIVE_WORKSPACE_ID]: queue(ACTIVE_WORKSPACE_ID, {
					mutations: [mutation(ACTIVE_WORKSPACE_ID, "active-pending")],
				}),
			}),
			expected: {
				activeQueueCount: 1,
				totalQueueCount: 1,
				orphanedWorkspaceCount: 0,
				blockedMutationCount: 0,
				deadLetterCount: 0,
			},
		},
		{
			name: "active blocked only",
			record: record({
				[ACTIVE_WORKSPACE_ID]: queue(ACTIVE_WORKSPACE_ID, {
					blocked: blocked("active-blocked"),
				}),
			}),
			expected: {
				activeQueueCount: 0,
				totalQueueCount: 0,
				orphanedWorkspaceCount: 0,
				blockedMutationCount: 1,
				deadLetterCount: 0,
			},
		},
		{
			name: "active dead-letter only",
			record: record({
				[ACTIVE_WORKSPACE_ID]: queue(ACTIVE_WORKSPACE_ID, {
					deadLetters: [deadLetter("active-dead")],
				}),
			}),
			expected: {
				activeQueueCount: 0,
				totalQueueCount: 0,
				orphanedWorkspaceCount: 0,
				blockedMutationCount: 0,
				deadLetterCount: 1,
			},
		},
		{
			name: "orphan pending only",
			record: record({
				[ORPHAN_WORKSPACE_ID]: queue(ORPHAN_WORKSPACE_ID, {
					mutations: [mutation(ORPHAN_WORKSPACE_ID, "orphan-pending")],
				}),
			}),
			expected: {
				activeQueueCount: 0,
				totalQueueCount: 1,
				orphanedWorkspaceCount: 1,
				blockedMutationCount: 0,
				deadLetterCount: 0,
			},
		},
		{
			name: "orphan blocked only",
			record: record({
				[ORPHAN_WORKSPACE_ID]: queue(ORPHAN_WORKSPACE_ID, {
					blocked: blocked("orphan-blocked"),
				}),
			}),
			expected: {
				activeQueueCount: 0,
				totalQueueCount: 0,
				orphanedWorkspaceCount: 1,
				blockedMutationCount: 1,
				deadLetterCount: 0,
			},
		},
		{
			name: "orphan dead-letter only",
			record: record({
				[ORPHAN_WORKSPACE_ID]: queue(ORPHAN_WORKSPACE_ID, {
					deadLetters: [deadLetter("orphan-dead")],
				}),
			}),
			expected: {
				activeQueueCount: 0,
				totalQueueCount: 0,
				orphanedWorkspaceCount: 1,
				blockedMutationCount: 0,
				deadLetterCount: 1,
			},
		},
	];

	for (const testCase of cases) {
		it(testCase.name, () => {
			expect(deriveWorkspaceQueueMetrics(testCase.record)).toEqual(
				testCase.expected,
			);
		});
	}

	it("derives all metrics consistently for mixed Workspace evidence", () => {
		const emptyWorkspaceId = "gist:empty-orphan";
		const orphanBlockedId = "gist:orphan-blocked";
		const orphanDeadId = "gist:orphan-dead";
		const value = record({
			[ACTIVE_WORKSPACE_ID]: queue(ACTIVE_WORKSPACE_ID, {
				mutations: [
					mutation(ACTIVE_WORKSPACE_ID, "active-1"),
					mutation(ACTIVE_WORKSPACE_ID, "active-2", 1),
				],
				blocked: blocked("active-1"),
				deadLetters: [deadLetter("active-dead")],
			}),
			[ORPHAN_WORKSPACE_ID]: queue(ORPHAN_WORKSPACE_ID, {
				mutations: [mutation(ORPHAN_WORKSPACE_ID, "orphan-1")],
			}),
			[orphanBlockedId]: queue(orphanBlockedId, {
				blocked: blocked("orphan-blocked"),
			}),
			[orphanDeadId]: queue(orphanDeadId, {
				deadLetters: [deadLetter("orphan-dead-1"), deadLetter("orphan-dead-2")],
			}),
			[emptyWorkspaceId]: queue(emptyWorkspaceId),
		});

		expect(deriveWorkspaceQueueMetrics(value)).toEqual({
			activeQueueCount: 2,
			totalQueueCount: 3,
			orphanedWorkspaceCount: 3,
			blockedMutationCount: 2,
			deadLetterCount: 3,
		});
	});

	it("uses an explicit active Workspace instead of the record binding", () => {
		const value = record({
			[ACTIVE_WORKSPACE_ID]: queue(ACTIVE_WORKSPACE_ID, {
				deadLetters: [deadLetter("bound-dead")],
			}),
			[ORPHAN_WORKSPACE_ID]: queue(ORPHAN_WORKSPACE_ID, {
				mutations: [mutation(ORPHAN_WORKSPACE_ID, "selected-pending")],
			}),
		});

		expect(deriveWorkspaceQueueMetrics(value, ORPHAN_WORKSPACE_ID)).toEqual({
			activeQueueCount: 1,
			totalQueueCount: 1,
			orphanedWorkspaceCount: 1,
			blockedMutationCount: 0,
			deadLetterCount: 1,
		});
	});
});
