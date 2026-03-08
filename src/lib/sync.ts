import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { appState } from '$lib/stores/app';
import { authState } from '$lib/stores/auth';
import { updateGist } from '$lib/gist';
import { exportSyncState } from '$lib/serialization';

const DEFAULT_DELAY = 1200;
const BASELINE_KEY = 'subman:sync:baseline';
const AUTO_SYNC_STATUS_KEY = 'subman:sync:last-status:v1';
const AUTO_SYNC_STATUS_EVENT = 'subman:auto-sync-status';

export type AutoSyncStatus = {
	status: 'idle' | 'syncing' | 'success' | 'error';
	gistId: string | null;
	lastAttemptAt: string | null;
	lastSuccessAt: string | null;
	lastErrorAt: string | null;
	lastErrorMessage: string | null;
	lastSyncedFile: string | null;
};

const defaultAutoSyncStatus: AutoSyncStatus = {
	status: 'idle',
	gistId: null,
	lastAttemptAt: null,
	lastSuccessAt: null,
	lastErrorAt: null,
	lastErrorMessage: null,
	lastSyncedFile: null
};

function readBaseline(): string {
	if (!browser) {
		return '';
	}
	return localStorage.getItem(BASELINE_KEY) ?? '';
}

function writeBaseline(payload: string): void {
	if (!browser) {
		return;
	}
	localStorage.setItem(BASELINE_KEY, payload);
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
			...parsed
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
	window.dispatchEvent(new CustomEvent<AutoSyncStatus>(AUTO_SYNC_STATUS_EVENT, { detail: next }));
}

export function getAutoSyncStatusEventName(): string {
	return AUTO_SYNC_STATUS_EVENT;
}

export function setSyncBaseline(payload: string): void {
	writeBaseline(payload);
}

export function startAutoSync(delayMs: number = DEFAULT_DELAY): () => void {
	if (!browser) {
		return () => {};
	}

	let token: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let syncing = false;
	let pending = false;
	let lastPayload = readBaseline();
	let latestState = get(appState);
	let lastStatus = readAutoSyncStatus();

	const authUnsub = authState.subscribe((state) => {
		token = state.token;
	});

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
			...next
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

		const payload = exportSyncState(latestState);
		if (payload === lastPayload) {
			return;
		}

		syncing = true;
		const attemptedAt = new Date().toISOString();
		const syncedFile = latestState.activeGistFile || 'subman.json';
		updateStatus({
			status: 'syncing',
			gistId: latestState.activeGistId,
			lastAttemptAt: attemptedAt,
			lastSyncedFile: syncedFile,
			lastErrorMessage: null
		});
		try {
			await updateGist(token, {
				gistId: latestState.activeGistId,
				files: {
					[syncedFile]: { content: payload }
				}
			});
			lastPayload = payload;
			writeBaseline(payload);
			updateStatus({
				status: 'success',
				gistId: latestState.activeGistId,
				lastSuccessAt: attemptedAt,
				lastErrorMessage: null,
				lastSyncedFile: syncedFile
			});
		} catch (err) {
			updateStatus({
				status: 'error',
				gistId: latestState.activeGistId,
				lastErrorAt: attemptedAt,
				lastErrorMessage: err instanceof Error ? err.message : 'Auto sync failed',
				lastSyncedFile: syncedFile
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
		authUnsub();
		appUnsub();
		if (timer) {
			clearTimeout(timer);
		}
	};
}
