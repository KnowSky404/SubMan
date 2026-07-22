import type { AppState } from "$lib/models";
import type { SyncBaselineEnvelope } from "$lib/workspace-data";

const CHANNEL_NAME = "subman:workspace:v1";
const FALLBACK_EVENT = "subman:workspace-message";

export type WorkspaceEvent = {
	type:
		| "transaction-result"
		| "reset"
		| "paused-conflict"
		| "mutation-queue-changed";
	gistId: string | null;
	fileName: string | null;
	mutationId?: string;
	queueAction?: "enqueued" | "removed";
	state?: AppState;
	baseline?: SyncBaselineEnvelope;
	status?: "already-synced" | "committed" | "conflict";
};

export function broadcastWorkspaceEvent(event: WorkspaceEvent): void {
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent<WorkspaceEvent>(FALLBACK_EVENT, { detail: event }),
		);
	}

	if (typeof BroadcastChannel === "undefined") return;
	try {
		const channel = new BroadcastChannel(CHANNEL_NAME);
		channel.postMessage(event);
		channel.close();
	} catch {
		// Same-tab events above remain available when the channel is unsupported.
	}
}

export function subscribeWorkspaceEvents(
	listener: (event: WorkspaceEvent) => void,
): () => void {
	const handleFallback = (event: Event) => {
		listener((event as CustomEvent<WorkspaceEvent>).detail);
	};
	if (typeof window !== "undefined") {
		window.addEventListener(FALLBACK_EVENT, handleFallback);
	}

	let channel: BroadcastChannel | null = null;
	if (typeof BroadcastChannel !== "undefined") {
		try {
			channel = new BroadcastChannel(CHANNEL_NAME);
			channel.addEventListener("message", (event) => listener(event.data));
		} catch {
			channel = null;
		}
	}

	return () => {
		if (typeof window !== "undefined") {
			window.removeEventListener(FALLBACK_EVENT, handleFallback);
		}
		channel?.close();
	};
}
