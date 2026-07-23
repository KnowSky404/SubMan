import type { AppState } from "$lib/models";
import { getWorkspaceBusinessData } from "$lib/workspace-data";
import {
	parseWorkspaceMutation,
	type WorkspaceMutation,
} from "$lib/workspace-mutation";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import { WorkspaceV2StateStore } from "$lib/workspace-v2-state";

export type BrowserMutationDraft = {
	kind: WorkspaceMutation["kind"];
	payload: unknown;
};

export type BrowserMutationEnqueueResult =
	| { status: "local-only" | "manual" | "paused-conflict" | "uninitialized" }
	| { status: "queued"; mutation: WorkspaceMutation };

const VALIDATION_MUTATION_ID = "00000000-0000-4000-8000-000000000000";
const VALIDATION_TIMESTAMP = "2000-01-01T00:00:00.000Z";

function validateDraft(
	draft: BrowserMutationDraft,
	workspaceId: string,
	expectedRevision: number,
): void {
	parseWorkspaceMutation({
		mutationId: VALIDATION_MUTATION_ID,
		workspaceId,
		expectedRevision,
		source: "browser",
		createdAt: VALIDATION_TIMESTAMP,
		kind: draft.kind,
		payload: draft.payload,
	});
}

export function validateAutomaticWorkspaceMutationDraft(
	draft: BrowserMutationDraft,
	options: { stateStore?: WorkspaceV2StateStore } = {},
): void {
	const binding = (options.stateStore ?? new WorkspaceV2StateStore()).read();
	if (
		!binding ||
		binding.revision === null ||
		binding.baseline === null ||
		binding.syncMode !== "automatic"
	) {
		return;
	}
	validateDraft(draft, binding.workspaceId, binding.revision);
}

export function validateAutomaticWorkspaceReconcile(
	state: AppState,
	options: { stateStore?: WorkspaceV2StateStore } = {},
): void {
	const stateStore = options.stateStore ?? new WorkspaceV2StateStore();
	const binding = stateStore.read();
	if (
		!binding ||
		binding.revision === null ||
		binding.baseline === null ||
		binding.syncMode !== "automatic"
	) {
		return;
	}
	validateDraft(
		{
			kind: "workspace.reconcile",
			payload: {
				baselineRevision: binding.revision,
				data: getWorkspaceBusinessData(state),
			},
		},
		binding.workspaceId,
		binding.revision,
	);
}

export async function enqueueAutomaticWorkspaceMutation(
	draft: BrowserMutationDraft,
	options: {
		stateStore?: WorkspaceV2StateStore;
		queue?: WorkspaceMutationQueue;
		mutationId?: () => string;
		now?: () => string;
	} = {},
): Promise<BrowserMutationEnqueueResult> {
	const binding = (options.stateStore ?? new WorkspaceV2StateStore()).read();
	if (!binding) return { status: "local-only" };
	if (binding.revision === null || binding.baseline === null) {
		return { status: "uninitialized" };
	}
	if (binding.syncMode === "manual") return { status: "manual" };
	if (binding.syncMode === "paused-conflict") {
		return { status: "paused-conflict" };
	}

	const mutationId = (options.mutationId ?? crypto.randomUUID)();
	const createdAt = (options.now ?? (() => new Date().toISOString()))();
	const queue = options.queue ?? new WorkspaceMutationQueue();
	const mutation = await queue.enqueueNext(
		binding.workspaceId,
		binding.revision,
		(expectedRevision) =>
			parseWorkspaceMutation({
				mutationId,
				workspaceId: binding.workspaceId,
				expectedRevision,
				source: "browser",
				createdAt,
				kind: draft.kind,
				payload: draft.payload,
			}),
	);
	return { status: "queued", mutation };
}

export async function enqueueAutomaticWorkspaceReconcile(
	state: AppState,
	options: Parameters<typeof enqueueAutomaticWorkspaceMutation>[1] = {},
): Promise<BrowserMutationEnqueueResult> {
	const stateStore = options.stateStore ?? new WorkspaceV2StateStore();
	const binding = stateStore.read();
	if (!binding || binding.revision === null) return { status: "local-only" };
	return enqueueAutomaticWorkspaceMutation(
		{
			kind: "workspace.reconcile",
			payload: {
				baselineRevision: binding.revision,
				data: getWorkspaceBusinessData(state),
			},
		},
		{ ...options, stateStore },
	);
}
