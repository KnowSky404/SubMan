import { writable } from "svelte/store";
import { browser } from "$app/environment";
import {
	defaultAuthState,
	loadAuthStateFromStorage,
	persistAuthStateToStorage,
} from "$lib/auth-storage";
import type { AuthState } from "$lib/models";

export { defaultAuthState } from "$lib/auth-storage";

function loadInitialState(): AuthState {
	if (!browser) return { ...defaultAuthState };
	return loadAuthStateFromStorage(localStorage, sessionStorage);
}

export const authState = writable<AuthState>(loadInitialState());

export function setToken(
	token: string | null,
	options: { remember?: boolean; now?: () => string } = {},
): void {
	authState.update((state) => {
		const normalized = token?.trim() || null;
		const next: AuthState = {
			...state,
			token: normalized,
			lastLoginAt: normalized
				? state.token === normalized && state.lastLoginAt
					? state.lastLoginAt
					: (options.now ?? (() => new Date().toISOString()))()
				: state.lastLoginAt,
			persistence: options.remember ? "persistent" : "session",
			migratedLegacyToken: false,
		};
		if (browser) persistAuthStateToStorage(next, localStorage, sessionStorage);
		return next;
	});
}

export function clearAuth(): void {
	if (browser) {
		persistAuthStateToStorage(defaultAuthState, localStorage, sessionStorage);
	}
	authState.set({ ...defaultAuthState });
}
