import * as bunTest from "bun:test";
import type { AppState, NodeItem } from "$lib/models";

const { expect, test } = bunTest;
const bun = bunTest as unknown as {
	mock: {
		module: (specifier: string, factory: () => unknown) => void;
	};
};

bun.mock.module("$app/environment", () => ({
	browser: false,
}));

async function loadModules() {
	const [{ getSyncStateSignature }, syncGuard] = await Promise.all([
		import("$lib/serialization"),
		import("$lib/sync-guard"),
	]);
	return { getSyncStateSignature, ...syncGuard };
}

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

function state(overrides: Partial<AppState> = {}): AppState {
	return {
		nodes: [],
		subscriptions: [],
		aggregates: [],
		publishTargets: [],
		clientExports: [],
		gists: [],
		activeGistId: "gist-1",
		activeGistFile: "subman.json",
		lastUpdated: "2026-06-12T00:00:00.000Z",
		...overrides,
	};
}

test("manual push is already synced when remote matches local", async () => {
	const { decideManualPush, getSyncStateSignature } = await loadModules();
	const local = state({ nodes: [node("same", "2026-06-12T00:00:00.000Z")] });
	const remote = state({ nodes: [node("same", "2026-06-12T00:00:00.000Z")] });
	const result = decideManualPush({
		local,
		remote,
		baselineSignature: "",
	});

	expect(result.action).toBe("already-synced");
	expect(result.localSignature).toBe(getSyncStateSignature(local));
	expect(result.remoteSignature).toBe(getSyncStateSignature(remote));
});

test("manual push is safe when remote still matches the saved baseline", async () => {
	const { decideManualPush, getSyncStateSignature } = await loadModules();
	const baseline = state();
	const local = state({ nodes: [node("local", "2026-06-12T01:00:00.000Z")] });
	const remote = state();
	const result = decideManualPush({
		local,
		remote,
		baselineSignature: getSyncStateSignature(baseline),
	});

	expect(result.action).toBe("safe-push");
});

test("manual push is blocked when remote changed after the saved baseline", async () => {
	const { decideManualPush, getSyncStateSignature } = await loadModules();
	const baseline = state();
	const local = state({ nodes: [node("local", "2026-06-12T01:00:00.000Z")] });
	const remote = state({ nodes: [node("remote", "2026-06-12T02:00:00.000Z")] });
	const result = decideManualPush({
		local,
		remote,
		baselineSignature: getSyncStateSignature(baseline),
	});

	expect(result.action).toBe("remote-changed");
});

test("baseline merge preserves remote deletions when local only has the old copy", async () => {
	const { mergeSyncStateFromBaseline } = await loadModules();
	const baseline = state({
		nodes: [
			node("kept", "2026-06-12T00:00:00.000Z"),
			node("deleted-remotely", "2026-06-12T00:00:00.000Z"),
		],
	});
	const local = state({
		nodes: [
			node("kept", "2026-06-12T00:00:00.000Z"),
			node("deleted-remotely", "2026-06-12T00:00:00.000Z"),
			node("local", "2026-06-12T01:00:00.000Z"),
		],
	});
	const remote = state({
		nodes: [node("kept", "2026-06-12T00:00:00.000Z")],
	});

	const merged = mergeSyncStateFromBaseline(local, remote, baseline);

	expect(merged.nodes.map((item) => item.id).sort()).toEqual(["kept", "local"]);
});

test("setup merge trusts a baseline only for the same workspace file", async () => {
	const { selectTrustedSyncBaseline } = await loadModules();
	const baseline = state({
		activeGistId: "gist-1",
		activeGistFile: "subman.json",
	});

	expect(selectTrustedSyncBaseline(baseline, "gist-1", "subman.json")).toBe(
		baseline,
	);
	expect(
		selectTrustedSyncBaseline(baseline, "gist-2", "subman.json"),
	).toBeNull();
	expect(
		selectTrustedSyncBaseline(baseline, "gist-1", "alternate.json"),
	).toBeNull();
	expect(selectTrustedSyncBaseline(null, "gist-1", "subman.json")).toBeNull();
});
