import type { AuthState } from "$lib/models";

export const LEGACY_AUTH_STORAGE_KEY = "subman:auth:v1";
export const SESSION_AUTH_STORAGE_KEY = "subman:auth:session:v2";
export const PERSISTENT_AUTH_STORAGE_KEY = "subman:auth:v2";

type AuthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type AuthStorageEnvelope = {
	version: 2;
	token: string;
	lastLoginAt: string | null;
};

export const defaultAuthState: AuthState = {
	token: null,
	lastLoginAt: null,
	persistence: "session",
	migratedLegacyToken: false,
};

function parseEnvelope(raw: string | null): AuthStorageEnvelope | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (
			value.version !== 2 ||
			typeof value.token !== "string" ||
			value.token.length === 0 ||
			(value.lastLoginAt !== null && typeof value.lastLoginAt !== "string")
		) {
			return null;
		}
		return {
			version: 2,
			token: value.token,
			lastLoginAt: value.lastLoginAt as string | null,
		};
	} catch {
		return null;
	}
}

function parseLegacyState(raw: string | null): AuthStorageEnvelope | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (typeof value.token !== "string" || value.token.length === 0)
			return null;
		return {
			version: 2,
			token: value.token,
			lastLoginAt:
				typeof value.lastLoginAt === "string" ? value.lastLoginAt : null,
		};
	} catch {
		return null;
	}
}

function serializeEnvelope(state: AuthState): string | null {
	if (!state.token) return null;
	return JSON.stringify({
		version: 2,
		token: state.token,
		lastLoginAt: state.lastLoginAt,
	} satisfies AuthStorageEnvelope);
}

export function loadAuthStateFromStorage(
	persistentStorage: AuthStorage,
	sessionStorageValue: AuthStorage,
): AuthState {
	const session = parseEnvelope(
		sessionStorageValue.getItem(SESSION_AUTH_STORAGE_KEY),
	);
	if (session) {
		return {
			token: session.token,
			lastLoginAt: session.lastLoginAt,
			persistence: "session",
			migratedLegacyToken: false,
		};
	}

	const persistent = parseEnvelope(
		persistentStorage.getItem(PERSISTENT_AUTH_STORAGE_KEY),
	);
	if (persistent) {
		return {
			token: persistent.token,
			lastLoginAt: persistent.lastLoginAt,
			persistence: "persistent",
			migratedLegacyToken: false,
		};
	}

	const legacy = parseLegacyState(
		persistentStorage.getItem(LEGACY_AUTH_STORAGE_KEY),
	);
	if (!legacy) return { ...defaultAuthState };

	const migrated: AuthState = {
		token: legacy.token,
		lastLoginAt: legacy.lastLoginAt,
		persistence: "session",
		migratedLegacyToken: true,
	};
	sessionStorageValue.setItem(
		SESSION_AUTH_STORAGE_KEY,
		serializeEnvelope(migrated) ?? "",
	);
	persistentStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
	return migrated;
}

export function persistAuthStateToStorage(
	state: AuthState,
	persistentStorage: AuthStorage,
	sessionStorageValue: AuthStorage,
): void {
	persistentStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
	const serialized = serializeEnvelope(state);
	if (!serialized) {
		persistentStorage.removeItem(PERSISTENT_AUTH_STORAGE_KEY);
		sessionStorageValue.removeItem(SESSION_AUTH_STORAGE_KEY);
		return;
	}

	if (state.persistence === "persistent") {
		persistentStorage.setItem(PERSISTENT_AUTH_STORAGE_KEY, serialized);
		sessionStorageValue.removeItem(SESSION_AUTH_STORAGE_KEY);
		return;
	}

	sessionStorageValue.setItem(SESSION_AUTH_STORAGE_KEY, serialized);
	persistentStorage.removeItem(PERSISTENT_AUTH_STORAGE_KEY);
}
