import { get } from "svelte/store";
import { getGist } from "$lib/gist";
import type { AppState } from "$lib/models";
import {
	type BrowserWorkspaceSnapshot,
	commitQueuedBrowserWorkspaceMutation,
	readBrowserWorkspaceSnapshot,
} from "$lib/workspace-browser-session-v2";
import {
	type WorkspaceCloudStatus,
	workspaceCloudStatus,
} from "$lib/workspace-cloud-status";
import type { BrowserWorkspacePersistence } from "$lib/workspace-persistence";
import { getBrowserWorkspacePersistence } from "$lib/workspace-persistence-browser";
import { createWorkspaceSettingsController } from "$lib/workspace-settings-controller";

type CloudWorkspaceSessionDependencies = {
	getState: () => AppState;
	setState: (state: AppState) => void;
	getToken: () => string | null;
	persistence?: BrowserWorkspacePersistence;
	fetchImpl?: typeof fetch;
	setStatus?: (status: WorkspaceCloudStatus) => void;
	readCloudSnapshot?: (
		token: string,
		gistId: string,
		current: AppState,
	) => Promise<BrowserWorkspaceSnapshot>;
};

const PENDING_MESSAGE =
	"Cloud synchronization is pending. Retry after the connection is restored.";
const RETAINED_CHANGES_MESSAGE =
	"Retained changes require Reload from Cloud before editing.";
const LOAD_FAILED_MESSAGE =
	"Unable to load cloud data. Check your token and connection, then retry.";
const MIGRATION_MESSAGE = "Upgrade this Workspace to continue.";

export function createCloudWorkspaceSession(
	dependencies: CloudWorkspaceSessionDependencies,
) {
	let generation = 0;
	const setStatus = dependencies.setStatus ?? workspaceCloudStatus.set;

	function cancelCloudWorkspaceLoad(): void {
		generation += 1;
		setStatus({ phase: "disconnected", message: null });
	}

	async function refreshCloudWorkspace(token: string): Promise<boolean> {
		if (!token) {
			cancelCloudWorkspaceLoad();
			return false;
		}
		const requestGeneration = ++generation;
		function isCurrent(): boolean {
			if (requestGeneration !== generation) return false;
			if (dependencies.getToken() === token) return true;
			cancelCloudWorkspaceLoad();
			return false;
		}
		if (!isCurrent()) return false;
		setStatus({ phase: "loading", message: null });
		const publishState = (state: AppState): void => {
			if (isCurrent()) dependencies.setState(state);
		};
		const deliverWithCurrentSession: typeof fetch = (input, init) => {
			if (!isCurrent()) {
				return Promise.reject(new Error("Cloud session is no longer active."));
			}
			return (dependencies.fetchImpl ?? fetch)(input, init);
		};
		const controller = createWorkspaceSettingsController({
			persistence: dependencies.persistence,
			getState: dependencies.getState,
			setState: publishState,
			fetchImpl: dependencies.fetchImpl,
		});
		try {
			let view = await controller.initialize();
			if (!isCurrent()) return false;
			const gistId =
				view.record.binding?.gistId ?? view.record.snapshot?.activeGistId;
			if (!gistId) {
				setStatus({ phase: "disconnected", message: null });
				return false;
			}
			const workspaceId = `gist:${gistId}`;
			const persistence =
				dependencies.persistence ?? getBrowserWorkspacePersistence();
			const queue = view.record.workspaces[workspaceId];
			if (queue?.mutations.length) {
				if (view.record.binding?.syncMode !== "automatic") {
					setStatus({ phase: "error", message: RETAINED_CHANGES_MESSAGE });
					return false;
				}
				if (queue.delivery.blocked?.disposition === "auth-required") {
					await persistence.resumeWorkspaceAfterAuth(workspaceId);
					if (!isCurrent()) return false;
				}
				const target = queue.mutations.at(-1);
				if (!target) throw new Error(PENDING_MESSAGE);
				const result = await commitQueuedBrowserWorkspaceMutation(
					{ token, mutationId: target.mutationId },
					{
						persistence,
						getState: dependencies.getState,
						setState: publishState,
						fetchImpl: deliverWithCurrentSession,
					},
				);
				if (!isCurrent()) return false;
				if (result.status !== "remote-committed") {
					setStatus({ phase: "error", message: PENDING_MESSAGE });
					return false;
				}
				view = await controller.refresh();
				if (!isCurrent()) return false;
				if (view.record.binding?.workspaceId !== workspaceId) {
					throw new Error(LOAD_FAILED_MESSAGE);
				}
			}
			const readCloudSnapshot =
				dependencies.readCloudSnapshot ??
				(async (currentToken, currentGistId, current) => {
					const gist = await getGist(currentToken, currentGistId);
					return readBrowserWorkspaceSnapshot(currentToken, gist, current);
				});
			const snapshot = await readCloudSnapshot(
				token,
				gistId,
				dependencies.getState(),
			);
			if (!isCurrent()) return false;
			if (snapshot.origin !== "v2") {
				setStatus({ phase: "error", message: MIGRATION_MESSAGE });
				return false;
			}
			await controller.refreshCloud(snapshot, gistId);
			if (!isCurrent()) return false;
			setStatus({ phase: "ready", message: null });
			return true;
		} catch {
			if (isCurrent()) {
				setStatus({ phase: "error", message: LOAD_FAILED_MESSAGE });
			}
			return false;
		}
	}

	return { refreshCloudWorkspace, cancelCloudWorkspaceLoad };
}

let productionSession: ReturnType<typeof createCloudWorkspaceSession> | null =
	null;
let productionSessionPromise: Promise<
	ReturnType<typeof createCloudWorkspaceSession>
> | null = null;
let productionGeneration = 0;

async function getProductionSession() {
	productionSessionPromise ??= Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
	]).then(([{ appState }, { authState }]) => {
		productionSession = createCloudWorkspaceSession({
			getState: () => get(appState),
			setState: (state) => appState.set(state),
			getToken: () => get(authState).token,
		});
		return productionSession;
	});
	return productionSessionPromise;
}

export async function refreshCloudWorkspace(token: string): Promise<boolean> {
	const requestGeneration = ++productionGeneration;
	const session = await getProductionSession();
	if (requestGeneration !== productionGeneration) return false;
	return session.refreshCloudWorkspace(token);
}

export function cancelCloudWorkspaceLoad(): void {
	productionGeneration += 1;
	productionSession?.cancelCloudWorkspaceLoad();
	workspaceCloudStatus.set({ phase: "disconnected", message: null });
}
