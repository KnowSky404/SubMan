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
