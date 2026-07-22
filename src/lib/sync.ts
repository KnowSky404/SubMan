import { get } from "svelte/store";
import { browser } from "$app/environment";
import type { AppState } from "$lib/models";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import {
	createSyncBaselineEnvelope,
	getWorkspaceSignature,
	isTrustedSyncBaseline,
	mergeWorkspaceStateFromBaseline,
	type SyncBaselineEnvelope,
	WORKSPACE_FILE,
} from "$lib/workspace-data";
import {
	broadcastWorkspaceEvent,
	subscribeWorkspaceEvents,
} from "$lib/workspace-events";
import {
	runWorkspaceTransaction,
	type WorkspaceTransactionInput,
	type WorkspaceTransactionResult,
} from "$lib/workspace-transaction";

const DEFAULT_DELAY = 1200;
const BASELINE_ENVELOPE_KEY = "subman:sync:baseline-envelope:v1";
const SYNC_MODE_KEY = "subman:sync:mode:v1";
const AUTO_SYNC_STATUS_KEY = "subman:sync:last-status:v1";
const AUTO_SYNC_STATUS_EVENT = "subman:auto-sync-status";

export type AutoSyncStatus = {
	status: "idle" | "syncing" | "success" | "error";
	gistId: string | null;
	lastAttemptAt: string | null;
	lastSuccessAt: string | null;
	lastErrorAt: string | null;
	lastErrorMessage: string | null;
	lastSyncedFile: string | null;
};

type AutoSyncRunner = (
	input: WorkspaceTransactionInput,
) => Promise<WorkspaceTransactionResult>;

const defaultAutoSyncStatus: AutoSyncStatus = {
	status: "idle",
	gistId: null,
	lastAttemptAt: null,
	lastSuccessAt: null,
	lastErrorAt: null,
	lastErrorMessage: null,
	lastSyncedFile: null,
};

function persistBaselineEnvelope(envelope: SyncBaselineEnvelope | null): void {
	if (!browser) return;
	if (envelope) {
		localStorage.setItem(BASELINE_ENVELOPE_KEY, JSON.stringify(envelope));
	} else {
		localStorage.removeItem(BASELINE_ENVELOPE_KEY);
	}
}

export function readSyncBaselineEnvelope(): SyncBaselineEnvelope | null {
	if (!browser) return null;
	const raw = localStorage.getItem(BASELINE_ENVELOPE_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as SyncBaselineEnvelope;
		return isTrustedSyncBaseline(parsed, parsed.gistId, parsed.fileName)
			? parsed
			: null;
	} catch {
		return null;
	}
}

export function setSyncBaseline(
	state: AppState,
	gistId: string,
	fileName?: string,
): void;
export function setSyncBaseline(signature: string, state?: AppState): void;
export function setSyncBaseline(
	stateOrSignature: AppState | string,
	gistIdOrState?: string | AppState,
	fileName = WORKSPACE_FILE,
): void {
	const state =
		typeof stateOrSignature === "string" ? gistIdOrState : stateOrSignature;
	if (!state || typeof state === "string") return;
	const gistId =
		typeof stateOrSignature === "string"
			? state.activeGistId
			: typeof gistIdOrState === "string"
				? gistIdOrState
				: state.activeGistId;
	if (!gistId) return;
	const envelope = createSyncBaselineEnvelope(
		state,
		gistId,
		fileName || state.activeGistFile || WORKSPACE_FILE,
	);
	persistBaselineEnvelope(envelope);
	setSyncPausedConflict(false);
	broadcastWorkspaceEvent({
		type: "transaction-result",
		gistId,
		fileName: envelope.fileName,
		state: envelope.state,
		baseline: envelope,
		status: "already-synced",
	});
}

export function readSyncBaseline(): string {
	return readSyncBaselineEnvelope()?.signature ?? "";
}

export function readSyncBaselineState(): AppState | null {
	return readSyncBaselineEnvelope()?.state ?? null;
}

export function isSyncPaused(): boolean {
	return browser && localStorage.getItem(SYNC_MODE_KEY) === "paused-conflict";
}

export function setSyncPausedConflict(paused: boolean): void {
	if (!browser) return;
	if (paused) {
		localStorage.setItem(SYNC_MODE_KEY, "paused-conflict");
		broadcastWorkspaceEvent({
			type: "paused-conflict",
			gistId: null,
			fileName: null,
		});
	} else {
		localStorage.removeItem(SYNC_MODE_KEY);
	}
}

export function resetWorkspaceSyncState(): void {
	if (!browser) return;
	localStorage.removeItem(BASELINE_ENVELOPE_KEY);
	localStorage.removeItem(SYNC_MODE_KEY);
	localStorage.removeItem(AUTO_SYNC_STATUS_KEY);
	window.dispatchEvent(
		new CustomEvent<AutoSyncStatus>(AUTO_SYNC_STATUS_EVENT, {
			detail: { ...defaultAutoSyncStatus },
		}),
	);
	broadcastWorkspaceEvent({
		type: "reset",
		gistId: null,
		fileName: null,
	});
}

export function readAutoSyncStatus(): AutoSyncStatus {
	if (!browser) return { ...defaultAutoSyncStatus };
	const raw = localStorage.getItem(AUTO_SYNC_STATUS_KEY);
	if (!raw) return { ...defaultAutoSyncStatus };
	try {
		return {
			...defaultAutoSyncStatus,
			...(JSON.parse(raw) as Partial<AutoSyncStatus>),
		};
	} catch {
		return { ...defaultAutoSyncStatus };
	}
}

function writeAutoSyncStatus(status: AutoSyncStatus): void {
	if (!browser) return;
	localStorage.setItem(AUTO_SYNC_STATUS_KEY, JSON.stringify(status));
	window.dispatchEvent(
		new CustomEvent<AutoSyncStatus>(AUTO_SYNC_STATUS_EVENT, {
			detail: status,
		}),
	);
}

export function getAutoSyncStatusEventName(): string {
	return AUTO_SYNC_STATUS_EVENT;
}

export function startAutoSync(
	delayMs: number = DEFAULT_DELAY,
	options: { runTransaction?: AutoSyncRunner } = {},
): () => void {
	if (!browser) return () => {};

	const runTransaction = options.runTransaction ?? runWorkspaceTransaction;
	let token: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let syncing = false;
	let pending = false;
	let generation = 0;
	let authInitialized = false;
	let latestState = get(appState);
	let baseline = readSyncBaselineEnvelope();
	let lastStatus = readAutoSyncStatus();

	function clearPending(): void {
		pending = false;
		if (timer) clearTimeout(timer);
		timer = null;
	}

	function updateStatus(next: Partial<AutoSyncStatus>): void {
		lastStatus = { ...lastStatus, ...next };
		writeAutoSyncStatus(lastStatus);
	}

	function canSync(): boolean {
		const gistId = latestState.activeGistId;
		const fileName = latestState.activeGistFile || WORKSPACE_FILE;
		return Boolean(
			token &&
				gistId &&
				!isSyncPaused() &&
				isTrustedSyncBaseline(baseline, gistId, fileName) &&
				getWorkspaceSignature(latestState) !== baseline?.signature,
		);
	}

	function schedule(): void {
		if (!canSync()) return;
		if (syncing) {
			pending = true;
			return;
		}
		if (timer) clearTimeout(timer);
		timer = setTimeout(runSync, delayMs);
	}

	const authUnsub = authState.subscribe((state) => {
		const tokenChanged = authInitialized && state.token !== token;
		token = state.token;
		authInitialized = true;
		if (tokenChanged) {
			generation += 1;
			baseline = null;
			resetWorkspaceSyncState();
		}
		if (!token) clearPending();
		else schedule();
	});

	const appUnsub = appState.subscribe((state) => {
		latestState = state;
		schedule();
	});

	const eventsUnsub = subscribeWorkspaceEvents((event) => {
		if (event.type === "reset") {
			generation += 1;
			baseline = null;
			lastStatus = { ...defaultAutoSyncStatus };
			clearPending();
			return;
		}
		if (event.type === "paused-conflict") {
			generation += 1;
			clearPending();
			return;
		}
		if (!event.baseline) return;

		const previous = baseline;
		baseline = event.baseline;
		persistBaselineEnvelope(event.baseline);
		if (
			event.state &&
			latestState.activeGistId === event.gistId &&
			previous &&
			getWorkspaceSignature(latestState) === previous.signature
		) {
			latestState = event.state;
			appState.set(event.state);
		}
	});

	async function runSync(): Promise<void> {
		timer = null;
		if (!canSync() || !token || !latestState.activeGistId || !baseline) return;

		const syncStartState = latestState;
		const gistId = syncStartState.activeGistId;
		if (!gistId) return;
		const fileName = syncStartState.activeGistFile || WORKSPACE_FILE;
		const syncGeneration = generation;
		const syncToken = token;
		const attemptedAt = new Date().toISOString();
		syncing = true;
		updateStatus({
			status: "syncing",
			gistId,
			lastAttemptAt: attemptedAt,
			lastSyncedFile: fileName,
			lastErrorMessage: null,
		});

		try {
			const result = await runTransaction({
				token: syncToken,
				gistId,
				fileName,
				localState: syncStartState,
				baseline,
			});
			if (
				generation !== syncGeneration ||
				token !== syncToken ||
				isSyncPaused()
			) {
				return;
			}
			baseline = result.baseline;
			persistBaselineEnvelope(result.baseline);

			if (latestState === syncStartState) {
				latestState = result.state;
				appState.set(result.state);
			} else {
				const merged = mergeWorkspaceStateFromBaseline(
					latestState,
					result.state,
					syncStartState,
				);
				latestState = merged;
				appState.set(merged);
			}
			updateStatus({
				status: "success",
				gistId,
				lastSuccessAt: attemptedAt,
				lastErrorMessage: null,
				lastSyncedFile: fileName,
			});
		} catch (error) {
			if (generation !== syncGeneration || token !== syncToken) return;
			updateStatus({
				status: "error",
				gistId,
				lastErrorAt: attemptedAt,
				lastErrorMessage:
					error instanceof Error ? error.message : "Auto sync failed",
				lastSyncedFile: fileName,
			});
		} finally {
			syncing = false;
			if (pending) {
				pending = false;
				schedule();
			}
		}
	}

	return () => {
		clearPending();
		eventsUnsub();
		authUnsub();
		appUnsub();
	};
}
