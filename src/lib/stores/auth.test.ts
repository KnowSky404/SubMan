import { describe, expect, it } from "bun:test";
import {
	LEGACY_AUTH_STORAGE_KEY,
	loadAuthStateFromStorage,
	PERSISTENT_AUTH_STORAGE_KEY,
	persistAuthStateToStorage,
	SESSION_AUTH_STORAGE_KEY,
} from "$lib/auth-storage";
import type { AuthState } from "$lib/models";

class MemoryStorage {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}
}

class ThrowingSessionStorage extends MemoryStorage {
	override setItem(): void {
		throw new Error("storage unavailable");
	}
}

const sessionState: AuthState = {
	token: "secret-token",
	lastLoginAt: "2026-07-23T00:00:00.000Z",
	persistence: "session",
	migratedLegacyToken: false,
};

describe("auth token storage", () => {
	it("stores tokens in session storage by default", () => {
		const persistent = new MemoryStorage();
		const session = new MemoryStorage();
		persistAuthStateToStorage(sessionState, persistent, session);

		expect(session.getItem(SESSION_AUTH_STORAGE_KEY)).toContain("secret-token");
		expect(persistent.getItem(PERSISTENT_AUTH_STORAGE_KEY)).toBeNull();
	});

	it("persists only after explicit remember opt-in", () => {
		const persistent = new MemoryStorage();
		const session = new MemoryStorage();
		persistAuthStateToStorage(
			{ ...sessionState, persistence: "persistent" },
			persistent,
			session,
		);

		expect(persistent.getItem(PERSISTENT_AUTH_STORAGE_KEY)).toContain(
			"secret-token",
		);
		expect(session.getItem(SESSION_AUTH_STORAGE_KEY)).toBeNull();
	});

	it("moves a legacy local token into the current session", () => {
		const persistent = new MemoryStorage();
		const session = new MemoryStorage();
		persistent.setItem(
			LEGACY_AUTH_STORAGE_KEY,
			JSON.stringify({
				token: "legacy-token",
				lastLoginAt: "2026-07-22T00:00:00.000Z",
			}),
		);

		const loaded = loadAuthStateFromStorage(persistent, session);

		expect(loaded).toEqual({
			token: "legacy-token",
			lastLoginAt: "2026-07-22T00:00:00.000Z",
			persistence: "session",
			migratedLegacyToken: true,
		});
		expect(persistent.getItem(LEGACY_AUTH_STORAGE_KEY)).toBeNull();
		expect(session.getItem(SESSION_AUTH_STORAGE_KEY)).toContain("legacy-token");
	});

	it("clears session, persistent, and legacy token storage", () => {
		const persistent = new MemoryStorage();
		const session = new MemoryStorage();
		persistent.setItem(LEGACY_AUTH_STORAGE_KEY, "legacy");
		persistent.setItem(PERSISTENT_AUTH_STORAGE_KEY, "persistent");
		session.setItem(SESSION_AUTH_STORAGE_KEY, "session");

		persistAuthStateToStorage(
			{ ...sessionState, token: null },
			persistent,
			session,
		);

		expect(persistent.values.size).toBe(0);
		expect(session.values.size).toBe(0);
	});

	it("does not delete a legacy token when session migration cannot persist", () => {
		const persistent = new MemoryStorage();
		const session = new ThrowingSessionStorage();
		const legacy = JSON.stringify({ token: "legacy-token" });
		persistent.setItem(LEGACY_AUTH_STORAGE_KEY, legacy);

		expect(() => loadAuthStateFromStorage(persistent, session)).toThrow(
			"storage unavailable",
		);
		expect(persistent.getItem(LEGACY_AUTH_STORAGE_KEY)).toBe(legacy);
	});

	it("prefers the current session when both versioned envelopes exist", () => {
		const persistent = new MemoryStorage();
		const session = new MemoryStorage();
		persistAuthStateToStorage(
			{ ...sessionState, token: "persistent", persistence: "persistent" },
			persistent,
			session,
		);
		session.setItem(
			SESSION_AUTH_STORAGE_KEY,
			JSON.stringify({
				version: 2,
				token: "session",
				lastLoginAt: sessionState.lastLoginAt,
			}),
		);

		expect(loadAuthStateFromStorage(persistent, session).token).toBe("session");
	});
});
