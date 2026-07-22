import * as bunTest from "bun:test";
import { get } from "svelte/store";
import type { AppState, NodeItem } from "$lib/models";

type MockedFunction<T extends (...args: never[]) => unknown> = T & {
	mock: { calls: unknown[][] };
	mockClear: () => void;
	mockResolvedValueOnce: (value: unknown) => void;
};

const { expect, test } = bunTest;
const bun = bunTest as unknown as {
	afterEach: (callback: () => void | Promise<void>) => void;
	mock: (<T extends (...args: never[]) => unknown>(
		callback: T,
	) => MockedFunction<T>) & {
		module: (specifier: string, factory: () => unknown) => void;
	};
};
const { afterEach, mock } = bun;
const mockModule = bun.mock.module;

const storage = new Map<string, string>();
const listeners = new Map<string, Set<(event: Event) => void>>();
const createGist = mock(async () => ({ id: "gist-1" }));
const getGist = mock(async () => ({ id: "gist-1" }));
let onUpdateGist: (() => void | Promise<void>) | null = null;
const updateGist = mock(async () => {
	await onUpdateGist?.();
	return { id: "gist-1" };
});
const getGistFileContent = mock(async () => "");
const listGists = mock(async () => []);
const toStableGistRawUrl = mock(
	(rawUrl?: string | null) => rawUrl ?? undefined,
);

mockModule("$app/environment", () => ({
	browser: true,
}));

mockModule("$lib/gist", () => ({
	createGist,
	getGist,
	listGists,
	toStableGistRawUrl,
	updateGist,
	getGistFileContent,
}));

Object.defineProperty(globalThis, "localStorage", {
	value: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			storage.set(key, value);
		},
		removeItem: (key: string) => {
			storage.delete(key);
		},
		clear: () => {
			storage.clear();
		},
	},
	configurable: true,
});

Object.defineProperty(globalThis, "window", {
	value: {
		addEventListener: (
			type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener !== "function") return;
			const typeListeners = listeners.get(type) ?? new Set();
			typeListeners.add(listener);
			listeners.set(type, typeListeners);
		},
		removeEventListener: (
			type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener !== "function") return;
			listeners.get(type)?.delete(listener);
		},
		dispatchEvent: (event: Event) => {
			for (const listener of listeners.get(event.type) ?? []) {
				listener(event);
			}
			return true;
		},
	},
	configurable: true,
});

function node(id: string, updatedAt: string): NodeItem {
	return {
		id,
		name: id,
		type: "vless",
		raw: `${id}-raw`,
		tags: [],
		enabled: true,
		updatedAt,
		source: "single",
	};
}

async function baseState(overrides: Partial<AppState> = {}): Promise<AppState> {
	const { defaultState } = await import("$lib/stores/app");
	return {
		...defaultState,
		activeGistId: "gist-1",
		activeGistFile: "subman.json",
		lastUpdated: "2026-05-01T00:00:00.000Z",
		...overrides,
	};
}

async function flushTimers(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(async () => {
	const { appState, defaultState } = await import("$lib/stores/app");
	const { authState } = await import("$lib/stores/auth");
	storage.clear();
	listeners.clear();
	createGist.mockClear();
	getGist.mockClear();
	updateGist.mockClear();
	getGistFileContent.mockClear();
	listGists.mockClear();
	toStableGistRawUrl.mockClear();
	onUpdateGist = null;
	appState.set(defaultState);
	authState.set({ token: null, lastLoginAt: null });
});

function setBaseline(
	setSyncBaseline: (baseline: string, state?: AppState) => void,
	getSyncStateSignature: (state: AppState) => string,
	state: AppState,
): void {
	setSyncBaseline(getSyncStateSignature(state), state);
}

function getSavedState(): AppState {
	const payload = updateGist.mock.calls[0]?.[1] as {
		files: Record<string, { content: string }>;
	};
	const saved = JSON.parse(payload.files["subman.json"].content) as {
		data: AppState;
	};
	return saved.data;
}

test("auto-sync merges remote changes before writing when remote diverged from baseline", async () => {
	const [
		{ appState },
		{ authState },
		{ exportSyncState, getSyncStateSignature },
		{ setSyncBaseline, startAutoSync },
	] = await Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/serialization"),
		import("$lib/sync"),
	]);

	const baselineState = await baseState();
	const remoteState = await baseState({
		nodes: [node("remote-node", "2026-05-02T00:00:00.000Z")],
		lastUpdated: "2026-05-02T00:00:00.000Z",
	});
	const localState = await baseState({
		nodes: [node("local-node", "2026-05-03T00:00:00.000Z")],
		lastUpdated: "2026-05-03T00:00:00.000Z",
	});

	setBaseline(setSyncBaseline, getSyncStateSignature, baselineState);
	getGistFileContent.mockResolvedValueOnce(exportSyncState(remoteState));
	authState.set({ token: "token-1", lastLoginAt: "2026-05-01T00:00:00.000Z" });

	const stop = startAutoSync(0);
	appState.set(localState);
	await flushTimers();
	stop();

	expect(updateGist.mock.calls.length).toBe(1);
	expect(
		getSavedState()
			.nodes.map((item) => item.id)
			.sort(),
	).toEqual(["local-node", "remote-node"]);
});

test("auto-sync keeps remote deletions when merging from the saved baseline", async () => {
	const [
		{ appState },
		{ authState },
		{ exportSyncState, getSyncStateSignature },
		{ setSyncBaseline, startAutoSync },
	] = await Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/serialization"),
		import("$lib/sync"),
	]);

	const baselineState = await baseState({
		nodes: [
			node("kept-node", "2026-05-01T00:00:00.000Z"),
			node("deleted-remotely", "2026-05-01T00:00:00.000Z"),
		],
	});
	const remoteState = await baseState({
		nodes: [node("kept-node", "2026-05-01T00:00:00.000Z")],
		lastUpdated: "2026-05-02T00:00:00.000Z",
	});
	const localState = await baseState({
		nodes: [
			node("kept-node", "2026-05-01T00:00:00.000Z"),
			node("deleted-remotely", "2026-05-01T00:00:00.000Z"),
			node("local-node", "2026-05-03T00:00:00.000Z"),
		],
		lastUpdated: "2026-05-03T00:00:00.000Z",
	});

	setBaseline(setSyncBaseline, getSyncStateSignature, baselineState);
	getGistFileContent.mockResolvedValueOnce(exportSyncState(remoteState));
	authState.set({ token: "token-1", lastLoginAt: "2026-05-01T00:00:00.000Z" });

	const stop = startAutoSync(0);
	appState.set(localState);
	await flushTimers();
	stop();

	expect(updateGist.mock.calls.length).toBe(1);
	expect(
		getSavedState()
			.nodes.map((item) => item.id)
			.sort(),
	).toEqual(["kept-node", "local-node"]);
});

test("auto-sync uses a baseline saved after auto-sync has started", async () => {
	const [
		{ appState },
		{ authState },
		{ exportSyncState, getSyncStateSignature },
		{ setSyncBaseline, startAutoSync },
	] = await Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/serialization"),
		import("$lib/sync"),
	]);

	const baselineState = await baseState({
		nodes: [
			node("kept-node", "2026-05-01T00:00:00.000Z"),
			node("deleted-remotely", "2026-05-01T00:00:00.000Z"),
		],
	});
	const remoteState = await baseState({
		nodes: [node("kept-node", "2026-05-01T00:00:00.000Z")],
		lastUpdated: "2026-05-02T00:00:00.000Z",
	});
	const localState = await baseState({
		nodes: [
			node("kept-node", "2026-05-01T00:00:00.000Z"),
			node("deleted-remotely", "2026-05-01T00:00:00.000Z"),
			node("local-node", "2026-05-03T00:00:00.000Z"),
		],
		lastUpdated: "2026-05-03T00:00:00.000Z",
	});

	const stop = startAutoSync(0);
	setBaseline(setSyncBaseline, getSyncStateSignature, baselineState);
	getGistFileContent.mockResolvedValueOnce(exportSyncState(remoteState));
	authState.set({ token: "token-1", lastLoginAt: "2026-05-01T00:00:00.000Z" });
	appState.set(localState);
	await flushTimers();
	stop();

	expect(updateGist.mock.calls.length).toBe(1);
	expect(
		getSavedState()
			.nodes.map((item) => item.id)
			.sort(),
	).toEqual(["kept-node", "local-node"]);
});

test("auto-sync does not overwrite local edits made while a merge sync is in flight", async () => {
	const [
		{ appState },
		{ authState },
		{ exportSyncState, getSyncStateSignature },
		{ setSyncBaseline, startAutoSync },
	] = await Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/serialization"),
		import("$lib/sync"),
	]);

	const baselineState = await baseState();
	const remoteState = await baseState({
		nodes: [node("remote-node", "2026-05-02T00:00:00.000Z")],
		lastUpdated: "2026-05-02T00:00:00.000Z",
	});
	const firstLocalState = await baseState({
		nodes: [node("first-local-node", "2026-05-03T00:00:00.000Z")],
		lastUpdated: "2026-05-03T00:00:00.000Z",
	});
	const interveningLocalState = await baseState({
		nodes: [
			node("first-local-node", "2026-05-03T00:00:00.000Z"),
			node("intervening-local-node", "2026-05-04T00:00:00.000Z"),
		],
		lastUpdated: "2026-05-04T00:00:00.000Z",
	});

	setBaseline(setSyncBaseline, getSyncStateSignature, baselineState);
	getGistFileContent.mockResolvedValueOnce(exportSyncState(remoteState));
	authState.set({ token: "token-1", lastLoginAt: "2026-05-01T00:00:00.000Z" });
	onUpdateGist = () => {
		appState.set(interveningLocalState);
	};

	const stop = startAutoSync(0);
	appState.set(firstLocalState);
	await flushTimers();
	stop();

	const currentState = get(appState);
	expect(currentState?.nodes.map((item) => item.id).sort()).toEqual([
		"first-local-node",
		"intervening-local-node",
		"remote-node",
	]);
});
