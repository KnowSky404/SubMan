import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { AuthState } from '$lib/models';

const STORAGE_KEY = 'subman:auth:v1';

export const defaultAuthState: AuthState = {
	clientId: '',
	redirectUri: '',
	scopes: ['gist'],
	token: null,
	lastLoginAt: null
};

function loadInitialState(): AuthState {
	if (!browser) {
		return defaultAuthState;
	}

	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) {
		return defaultAuthState;
	}

	try {
		const parsed = JSON.parse(raw) as AuthState;
		return { ...defaultAuthState, ...parsed };
	} catch {
		return defaultAuthState;
	}
}

export const authState = writable<AuthState>(loadInitialState());

if (browser) {
	authState.subscribe((value) => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	});
}

export function setToken(token: string | null): void {
	authState.update((state) => ({
		...state,
		token: token && token.length > 0 ? token : null,
		lastLoginAt: token ? new Date().toISOString() : state.lastLoginAt
	}));
}

export function updateAuthConfig(config: Pick<AuthState, 'clientId' | 'redirectUri' | 'scopes'>): void {
	authState.update((state) => ({
		...state,
		...config
	}));
}
