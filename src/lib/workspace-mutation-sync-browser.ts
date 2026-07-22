import { get } from "svelte/store";
import { browser } from "$app/environment";
import type { AppState } from "$lib/models";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { subscribeWorkspaceEvents } from "$lib/workspace-events";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import {
	applyCommittedWorkspaceEvent,
	deliverQueuedWorkspaceMutation,
} from "$lib/workspace-mutation-sync";
import {
	type WorkspaceV2LocalState,
	WorkspaceV2StateStore,
} from "$lib/workspace-v2-state";

export function startWorkspaceMutationSync(
	options: {
		enabled?: boolean;
		delayMs?: number;
		retryDelayMs?: number;
		queue?: WorkspaceMutationQueue;
		stateStore?: WorkspaceV2StateStore;
		fetchImpl?: typeof fetch;
	} = {},
): () => void {
	if (!(options.enabled ?? browser)) return () => {};
	const queue = options.queue ?? new WorkspaceMutationQueue();
	const stateStore = options.stateStore ?? new WorkspaceV2StateStore();
	const delayMs = options.delayMs ?? 250;
	const retryDelayMs = options.retryDelayMs ?? 5_000;
	let githubToken: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let running = false;
	let stopped = false;

	const dependencies = () => ({
		queue,
		stateStore,
		githubToken,
		getState: () => get(appState),
		setState: (state: AppState) => appState.set(state),
		fetchImpl: options.fetchImpl,
	});

	function schedule(delay = delayMs): void {
		if (stopped || running || timer) return;
		let binding: WorkspaceV2LocalState | null;
		let hasPending = false;
		try {
			binding = stateStore.read();
			hasPending = Boolean(binding && queue.peek(binding.workspaceId));
		} catch {
			return;
		}
		if (
			!githubToken ||
			!binding ||
			binding.syncMode !== "automatic" ||
			!hasPending
		) {
			return;
		}
		timer = setTimeout(run, delay);
	}

	async function run(): Promise<void> {
		timer = null;
		if (stopped || running) return;
		running = true;
		let nextDelay: number | null = null;
		try {
			const result = await deliverQueuedWorkspaceMutation(dependencies());
			if (result.status === "committed") nextDelay = 0;
			if (result.status === "retryable-error") nextDelay = retryDelayMs;
		} catch {
			nextDelay = retryDelayMs;
		} finally {
			running = false;
			if (nextDelay !== null) schedule(nextDelay);
		}
	}

	const authUnsub = authState.subscribe((state) => {
		githubToken = state.token;
		if (!githubToken && timer) {
			clearTimeout(timer);
			timer = null;
		}
		schedule();
	});
	const eventsUnsub = subscribeWorkspaceEvents((event) => {
		if (event.type === "workspace-v2-committed") {
			applyCommittedWorkspaceEvent(event, dependencies());
		}
		if (
			event.type === "mutation-queue-changed" ||
			event.type === "workspace-v2-committed"
		) {
			schedule();
		}
	});
	schedule();

	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
		authUnsub();
		eventsUnsub();
	};
}
