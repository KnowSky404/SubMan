import { get } from "svelte/store";
import { browser } from "$app/environment";
import { getGistFileContent, updateGist } from "$lib/gist";
import {
	exportSyncState,
	getSyncStateSignature,
	importState,
} from "$lib/serialization";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { mergeSyncStateFromBaseline } from "$lib/sync-guard";
import type { AppState } from "$lib/models";

const DEFAULT_DELAY = 1200;
const BASELINE_KEY = "subman:sync:baseline";
const BASELINE_STATE_KEY = "subman:sync:baseline-state";
const BASELINE_EVENT = "subman:sync:baseline";
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

type SyncBaselineEvent = {
	baseline: string;
	state: AppState | null;
};

const defaultAutoSyncStatus: AutoSyncStatus = {
	status: "idle",
	gistId: null,
	lastAttemptAt: null,
	lastSuccessAt: null,
	lastErrorAt: null,
	lastErrorMessage: null,
	lastSyncedFile: null,
};

function readBaseline(): string {
	if (!browser) {
		return "";
	}
	return localStorage.getItem(BASELINE_KEY) ?? "";
}

function writeBaseline(baseline: string): void {
	if (!browser) {
		return;
	}
	localStorage.setItem(BASELINE_KEY, baseline);
}

function readBaselineState(): AppState | null {
	if (!browser) {
		return null;
	}

	const raw = localStorage.getItem(BASELINE_STATE_KEY);
	if (!raw) {
		return null;
	}

	try {
		return importState(raw);
	} catch {
		return null;
	}
}

function writeBaselineState(state: AppState): void {
	if (!browser) {
		return;
	}
	localStorage.setItem(BASELINE_STATE_KEY, exportSyncState(state));
}

export function readAutoSyncStatus(): AutoSyncStatus {
	if (!browser) {
		return defaultAutoSyncStatus;
	}

	const raw = localStorage.getItem(AUTO_SYNC_STATUS_KEY);
	if (!raw) {
		return defaultAutoSyncStatus;
	}

	try {
		const parsed = JSON.parse(raw) as Partial<AutoSyncStatus>;
		return {
			...defaultAutoSyncStatus,
			...parsed,
		};
	} catch {
		return defaultAutoSyncStatus;
	}
}

function writeAutoSyncStatus(next: AutoSyncStatus): void {
	if (!browser) {
		return;
	}

	localStorage.setItem(AUTO_SYNC_STATUS_KEY, JSON.stringify(next));
	window.dispatchEvent(
		new CustomEvent<AutoSyncStatus>(AUTO_SYNC_STATUS_EVENT, { detail: next }),
	);
}

function dispatchBaselineEvent(baseline: string, state: AppState | null): void {
	if (!browser) {
		return;
	}
	window.dispatchEvent(
		new CustomEvent<SyncBaselineEvent>(BASELINE_EVENT, {
			detail: { baseline, state },
		}),
	);
}

export function getAutoSyncStatusEventName(): string {
	return AUTO_SYNC_STATUS_EVENT;
}

export function setSyncBaseline(baseline: string, state?: AppState): void {
	writeBaseline(baseline);
	if (state) {
		writeBaselineState(state);
	}
	dispatchBaselineEvent(baseline, state ?? readBaselineState());
}

export function startAutoSync(delayMs: number = DEFAULT_DELAY): () => void {
	if (!browser) {
		return () => {};
	}

	let token: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let syncing = false;
	let pending = false;
	let lastSignature = readBaseline();
	let baselineState = readBaselineState();
	let latestState = get(appState);
	let lastStatus = readAutoSyncStatus();

	const authUnsub = authState.subscribe((state) => {
		token = state.token;
	});

	const handleBaselineChange = (event: Event) => {
		const detail = (event as CustomEvent<SyncBaselineEvent>).detail;
		lastSignature = detail.baseline;
		baselineState = detail.state;
	};
	window.addEventListener(BASELINE_EVENT, handleBaselineChange);

	const appUnsub = appState.subscribe((state) => {
		latestState = state;
		if (!token || !state.activeGistId) {
			return;
		}
		schedule();
	});

	function updateStatus(next: Partial<AutoSyncStatus>) {
		lastStatus = {
			...lastStatus,
			...next,
		};
		writeAutoSyncStatus(lastStatus);
	}

	function schedule() {
		if (syncing) {
			pending = true;
			return;
		}
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(runSync, delayMs);
	}

	async function runSync() {
		if (!token || !latestState.activeGistId) {
			return;
		}

		const syncStartState = latestState;
		const syncStartGistId: string = latestState.activeGistId;
		const signature = getSyncStateSignature(syncStartState);
		if (signature === lastSignature) {
			return;
		}

		syncing = true;
		const attemptedAt = new Date().toISOString();
		const syncedFile = syncStartState.activeGistFile || "subman.json";
		updateStatus({
			status: "syncing",
			gistId: syncStartGistId,
			lastAttemptAt: attemptedAt,
			lastSyncedFile: syncedFile,
			lastErrorMessage: null,
		});
		try {
			let stateToSave = syncStartState;
			let signatureToSave = signature;
			const remoteContent = await getGistFileContent(
				token,
				syncStartGistId,
				syncedFile,
			);
			const remoteState = importState(remoteContent);
			const remoteSignature = getSyncStateSignature(remoteState);

			if (remoteSignature === signature) {
				lastSignature = signature;
				writeBaseline(signature);
				writeBaselineState(syncStartState);
				baselineState = syncStartState;
				updateStatus({
					status: "success",
					gistId: syncStartGistId,
					lastSuccessAt: attemptedAt,
					lastErrorMessage: null,
					lastSyncedFile: syncedFile,
				});
				return;
			}

			if (remoteSignature !== lastSignature) {
				stateToSave = mergeSyncStateFromBaseline(
					syncStartState,
					remoteState,
					baselineState,
				);
				stateToSave = {
					...stateToSave,
					activeGistId: syncStartGistId,
					activeGistFile: syncedFile,
				};
				signatureToSave = getSyncStateSignature(stateToSave);
			}

			const payload = exportSyncState(stateToSave);
			await updateGist(token, {
				gistId: syncStartGistId,
				files: {
					[syncedFile]: { content: payload },
				},
			});
			lastSignature = signatureToSave;
			writeBaseline(signatureToSave);
			writeBaselineState(stateToSave);
			baselineState = stateToSave;
			if (stateToSave !== syncStartState && latestState === syncStartState) {
				latestState = stateToSave;
				appState.set(stateToSave);
			} else if (stateToSave !== syncStartState) {
				appState.set(
					mergeSyncStateFromBaseline(latestState, stateToSave, syncStartState),
				);
			}
			updateStatus({
				status: "success",
				gistId: syncStartGistId,
				lastSuccessAt: attemptedAt,
				lastErrorMessage: null,
				lastSyncedFile: syncedFile,
			});
		} catch (err) {
			updateStatus({
				status: "error",
				gistId: latestState.activeGistId,
				lastErrorAt: attemptedAt,
				lastErrorMessage:
					err instanceof Error ? err.message : "Auto sync failed",
				lastSyncedFile: syncedFile,
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
		window.removeEventListener(BASELINE_EVENT, handleBaselineChange);
		authUnsub();
		appUnsub();
		if (timer) {
			clearTimeout(timer);
		}
	};
}
