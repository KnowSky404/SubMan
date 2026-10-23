import { writable } from "svelte/store";

export type WorkspaceCloudStatus = {
	phase: "disconnected" | "loading" | "ready" | "error";
	message: string | null;
};

export const workspaceCloudStatus = writable<WorkspaceCloudStatus>({
	phase: "disconnected",
	message: null,
});
