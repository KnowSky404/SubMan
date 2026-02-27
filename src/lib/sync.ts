import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { appState } from '$lib/stores/app';
import { authState } from '$lib/stores/auth';
import { updateGist } from '$lib/gist';
import { exportSyncState } from '$lib/serialization';

const DEFAULT_DELAY = 1200;
const BASELINE_KEY = 'subman:sync:baseline';

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
		try {
			await updateGist(token, {
				gistId: latestState.activeGistId,
				files: {
					[(latestState.activeGistFile || 'subman.json')]: { content: payload }
				}
			});
			lastPayload = payload;
			writeBaseline(payload);
		} catch {
			// Swallow sync errors; UI can surface later if needed.
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
