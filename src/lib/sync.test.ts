import * as bunTest from "bun:test";
import { get } from "svelte/store";
import type { AppState, GistMeta, NodeItem } from "$lib/models";
import {
	createSyncBaselineEnvelope,
	hydrateWorkspaceState,
} from "$lib/workspace-data";
import type {
	WorkspaceTransactionInput,
	WorkspaceTransactionResult,
} from "$lib/workspace-transaction";

const { expect, test } = bunTest;
const { afterEach, mock } = bunTest as unknown as {
	afterEach: (callback: () => void | Promise<void>) => void;
	mock: { module: (specifier: string, factory: () => unknown) => void };
};

const storage = new Map<string, string>();
const listeners = new Map<string, Set<(event: Event) => void>>();

mock.module("$app/environment", () => ({ browser: true }));

Object.defineProperty(globalThis, "localStorage", {
	value: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
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
			const registered = listeners.get(type) ?? new Set();
			registered.add(listener);
			listeners.set(type, registered);
		},
		removeEventListener: (
			type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener === "function") listeners.get(type)?.delete(listener);
		},
		dispatchEvent: (event: Event) => {
			for (const listener of listeners.get(event.type) ?? []) listener(event);
			return true;
		},
	},
	configurable: true,
});

Object.defineProperty(globalThis, "BroadcastChannel", {
	value: undefined,
	configurable: true,
});

function node(id: string, updatedAt = "2026-07-22T00:00:00.000Z"): NodeItem {
	return {
		id,
		name: id,
		type: "vless",
		raw: `vless://${id}`,
		tags: [],
		enabled: true,
		updatedAt,
		source: "single",
	};
}

async function state(overrides: Partial<AppState> = {}): Promise<AppState> {
	const { defaultState } = await import("$lib/stores/app");
	return hydrateWorkspaceState(
		{
			...defaultState,
			lastUpdated: "2026-07-22T00:00:00.000Z",
			...overrides,
		},
		"gist-1",
		"subman.json",
	);
}

function gist(): GistMeta {
	return {
		id: "gist-1",
		description: "SubMan-Data",
		files: [],
		updatedAt: "2026-07-22T00:00:00.000Z",
		url: "https://gist.github.com/gist-1",
	};
}

async function flushTimers(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(async () => {
	const [{ appState, defaultState }, { authState }] = await Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
	]);
	storage.clear();
	listeners.clear();
	appState.set(defaultState);
	authState.set({ token: null, lastLoginAt: null });
});

test("stores one identity-bound baseline envelope and clears all sync state", async () => {
	const {
		isSyncPaused,
		readSyncBaselineEnvelope,
		resetWorkspaceSyncState,
		setSyncBaseline,
		setSyncPausedConflict,
	} = await import("$lib/sync");
	const baselineState = await state({ nodes: [node("baseline")] });

	setSyncBaseline(baselineState, "gist-1", "subman.json");
	setSyncPausedConflict(true);

	expect(readSyncBaselineEnvelope()?.gistId).toBe("gist-1");
	expect(readSyncBaselineEnvelope()?.fileName).toBe("subman.json");
	expect(isSyncPaused()).toBe(true);

	resetWorkspaceSyncState();

	expect(readSyncBaselineEnvelope()).toBeNull();
	expect(isSyncPaused()).toBe(false);
});

test("paused-conflict prevents automatic workspace writes", async () => {
	const [{ appState }, { authState }, sync] = await Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/sync"),
	]);
	const calls: WorkspaceTransactionInput[] = [];
	const runTransaction = async (input: WorkspaceTransactionInput) => {
		calls.push(input);
		throw new Error("should not run");
	};

	sync.setSyncPausedConflict(true);
	authState.set({ token: "token", lastLoginAt: null });
	const stop = sync.startAutoSync(0, { runTransaction });
	appState.set(await state({ nodes: [node("local")] }));
	await flushTimers();
	stop();

	expect(calls).toHaveLength(0);
});

test("automatic sync delegates to the transaction with a trusted envelope", async () => {
	const [{ appState }, { authState }, sync] = await Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/sync"),
	]);
	const baselineState = await state();
	const localState = await state({ nodes: [node("local")] });
	const committedState = await state({
		nodes: [node("local"), node("remote")],
	});
	const calls: WorkspaceTransactionInput[] = [];
	const runTransaction = async (
		input: WorkspaceTransactionInput,
	): Promise<WorkspaceTransactionResult> => {
		calls.push(input);
		return {
			status: "committed",
			gist: gist(),
			state: committedState,
			baseline: createSyncBaselineEnvelope(
				committedState,
				"gist-1",
				"subman.json",
			),
			attempts: 1,
		};
	};

	sync.setSyncBaseline(baselineState, "gist-1", "subman.json");
	authState.set({ token: "token", lastLoginAt: null });
	const stop = sync.startAutoSync(0, { runTransaction });
	appState.set(localState);
	await flushTimers();
	stop();

	expect(calls).toHaveLength(1);
	expect(calls[0]?.baseline?.gistId).toBe("gist-1");
	expect(
		get(appState)
			.nodes.map((item) => item.id)
			.sort(),
	).toEqual(["local", "remote"]);
	expect(sync.readSyncBaselineEnvelope()?.signature).toBe(
		createSyncBaselineEnvelope(committedState, "gist-1", "subman.json")
			.signature,
	);
});

test("automatic sync preserves edits made while the transaction is in flight", async () => {
	const [{ appState }, { authState }, sync] = await Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/sync"),
	]);
	const baselineState = await state();
	const firstLocal = await state({ nodes: [node("first-local")] });
	const intervening = await state({
		nodes: [node("first-local"), node("intervening-local")],
	});
	const committed = await state({
		nodes: [node("first-local"), node("remote")],
	});
	const converged = await state({
		nodes: [node("first-local"), node("intervening-local"), node("remote")],
	});
	let calls = 0;
	const runTransaction = async (): Promise<WorkspaceTransactionResult> => {
		calls += 1;
		if (calls === 1) appState.set(intervening);
		const resultState = calls === 1 ? committed : converged;
		return {
			status: "committed",
			gist: gist(),
			state: resultState,
			baseline: createSyncBaselineEnvelope(
				resultState,
				"gist-1",
				"subman.json",
			),
			attempts: 1,
		};
	};

	sync.setSyncBaseline(baselineState, "gist-1", "subman.json");
	authState.set({ token: "token", lastLoginAt: null });
	const stop = sync.startAutoSync(0, { runTransaction });
	appState.set(firstLocal);
	await new Promise((resolve) => setTimeout(resolve, 20));
	stop();

	expect(calls).toBeGreaterThan(0);
	expect(
		get(appState)
			.nodes.map((item) => item.id)
			.sort(),
	).toEqual(["first-local", "intervening-local", "remote"]);
});

test("reset invalidates an automatic sync result already in flight", async () => {
	const [{ appState }, { authState }, sync] = await Promise.all([
		import("$lib/stores/app"),
		import("$lib/stores/auth"),
		import("$lib/sync"),
	]);
	const baselineState = await state();
	const localState = await state({ nodes: [node("local")] });
	const staleCommittedState = await state({ nodes: [node("stale-remote")] });
	let resolveTransaction!: (result: WorkspaceTransactionResult) => void;
	let markTransactionStarted!: () => void;
	const transactionStarted = new Promise<void>((resolve) => {
		markTransactionStarted = resolve;
	});
	const runTransaction = () =>
		new Promise<WorkspaceTransactionResult>((resolveResult) => {
			resolveTransaction = resolveResult;
			markTransactionStarted();
		});

	sync.setSyncBaseline(baselineState, "gist-1", "subman.json");
	authState.set({ token: "token", lastLoginAt: null });
	const stop = sync.startAutoSync(0, { runTransaction });
	appState.set(localState);

	await transactionStarted;
	sync.resetWorkspaceSyncState();
	resolveTransaction({
		status: "committed",
		gist: gist(),
		state: staleCommittedState,
		baseline: createSyncBaselineEnvelope(
			staleCommittedState,
			"gist-1",
			"subman.json",
		),
		attempts: 1,
	});
	await flushTimers();
	stop();

	expect(sync.readSyncBaselineEnvelope()).toBeNull();
	expect(sync.readAutoSyncStatus().status).toBe("idle");
	expect(get(appState).nodes.map((item) => item.id)).toEqual(["local"]);
});
