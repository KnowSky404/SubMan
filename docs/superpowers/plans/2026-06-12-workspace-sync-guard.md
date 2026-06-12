# Workspace Sync Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual workspace Push Local detect remote changes before overwriting and offer pull, merge, or force-push only when needed.

**Architecture:** Add a shared `sync-guard` module that classifies remote/local/baseline state and exposes baseline-aware merge behavior. Wire the Auth page manual push flow to read remote first, block unsafe overwrites, and show a review panel for Pull Remote, Merge & Save, or Force Push. Keep auto-sync behavior unchanged except for reusing the shared merge helper.

**Tech Stack:** SvelteKit, Svelte 5, TypeScript, Bun test, GitHub Gist REST API through existing `src/lib/gist.ts`.

---

## File Structure

- Create `src/lib/sync-guard.ts`: pure sync decision and baseline-aware merge helpers.
- Modify `src/lib/sync.ts`: import shared merge helper instead of keeping a private copy.
- Create `src/lib/sync-guard.test.ts`: unit tests for push decision and merge behavior.
- Modify `src/routes/auth/+page.svelte`: safe manual push flow, divergence review panel, force-push handler.
- Modify `src/routes/auth/page-source.test.ts`: page-source assertions for the new review state and Force Push wiring.
- Modify `src/lib/i18n.ts`: Chinese translations for the new Auth page copy.
- Modify `README.md` and `README.en.md`: document that manual Push Local now checks remote changes first and only Force Push overwrites after divergence.

---

### Task 1: Extract Baseline-Aware Sync Guard

**Files:**
- Create: `src/lib/sync-guard.ts`
- Modify: `src/lib/sync.ts`
- Test: `src/lib/sync-guard.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sync-guard.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { AppState, NodeItem } from "$lib/models";
import { getSyncStateSignature } from "$lib/serialization";
import { defaultState } from "$lib/stores/app";
import {
	decideManualPush,
	mergeSyncStateFromBaseline,
} from "$lib/sync-guard";

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
		...defaultState,
		activeGistId: "gist-1",
		activeGistFile: "subman.json",
		lastUpdated: "2026-06-12T00:00:00.000Z",
		...overrides,
	};
}

test("manual push is already synced when remote matches local", () => {
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

test("manual push is safe when remote still matches the saved baseline", () => {
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

test("manual push is blocked when remote changed after the saved baseline", () => {
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

test("baseline merge preserves remote deletions when local only has the old copy", () => {
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

	expect(merged.nodes.map((item) => item.id).sort()).toEqual([
		"kept",
		"local",
	]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/lib/sync-guard.test.ts
```

Expected: FAIL because `$lib/sync-guard` does not exist.

- [ ] **Step 3: Create the sync guard implementation**

Create `src/lib/sync-guard.ts`:

```ts
import { mergeSyncState } from "$lib/merge";
import type { AppState } from "$lib/models";
import { getSyncStateSignature } from "$lib/serialization";

export type ManualPushDecisionAction =
	| "already-synced"
	| "safe-push"
	| "remote-changed";

export type ManualPushDecision = {
	action: ManualPushDecisionAction;
	localSignature: string;
	remoteSignature: string;
};

export function decideManualPush({
	local,
	remote,
	baselineSignature,
}: {
	local: AppState;
	remote: AppState;
	baselineSignature: string;
}): ManualPushDecision {
	const localSignature = getSyncStateSignature(local);
	const remoteSignature = getSyncStateSignature(remote);

	if (remoteSignature === localSignature) {
		return { action: "already-synced", localSignature, remoteSignature };
	}

	if (remoteSignature === baselineSignature) {
		return { action: "safe-push", localSignature, remoteSignature };
	}

	return { action: "remote-changed", localSignature, remoteSignature };
}

function mergeItemsByBaseline<T extends { id: string; updatedAt: string }>(
	localItems: T[],
	remoteItems: T[],
	baselineItems: T[],
): T[] {
	const localById = new Map(localItems.map((item) => [item.id, item]));
	const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
	const baselineById = new Map(baselineItems.map((item) => [item.id, item]));
	const ids = new Set([
		...localById.keys(),
		...remoteById.keys(),
		...baselineById.keys(),
	]);
	const merged: T[] = [];

	for (const id of ids) {
		const localItem = localById.get(id);
		const remoteItem = remoteById.get(id);
		const baselineItem = baselineById.get(id);

		if (!baselineItem) {
			if (localItem && remoteItem) {
				merged.push(
					Date.parse(remoteItem.updatedAt) >= Date.parse(localItem.updatedAt)
						? remoteItem
						: localItem,
				);
			} else if (localItem) {
				merged.push(localItem);
			} else if (remoteItem) {
				merged.push(remoteItem);
			}
			continue;
		}

		if (!localItem && !remoteItem) {
			continue;
		}

		const localChanged =
			Boolean(localItem) &&
			JSON.stringify(localItem) !== JSON.stringify(baselineItem);
		const remoteChanged =
			Boolean(remoteItem) &&
			JSON.stringify(remoteItem) !== JSON.stringify(baselineItem);

		if (!localItem && remoteItem) {
			if (remoteChanged) {
				merged.push(remoteItem);
			}
			continue;
		}

		if (localItem && !remoteItem) {
			if (localChanged) {
				merged.push(localItem);
			}
			continue;
		}

		if (localItem && remoteItem && localChanged && !remoteChanged) {
			merged.push(localItem);
			continue;
		}

		if (localItem && remoteItem && remoteChanged && !localChanged) {
			merged.push(remoteItem);
			continue;
		}

		if (localItem && remoteItem) {
			merged.push(
				Date.parse(remoteItem.updatedAt) >= Date.parse(localItem.updatedAt)
					? remoteItem
					: localItem,
			);
		}
	}

	return merged;
}

export function mergeSyncStateFromBaseline(
	local: AppState,
	remote: AppState,
	baseline: AppState | null,
): AppState {
	if (!baseline) {
		return {
			...local,
			...mergeSyncState(local, remote),
		};
	}

	return {
		...local,
		nodes: mergeItemsByBaseline(local.nodes, remote.nodes, baseline.nodes),
		subscriptions: mergeItemsByBaseline(
			local.subscriptions,
			remote.subscriptions,
			baseline.subscriptions,
		),
		aggregates: mergeItemsByBaseline(
			local.aggregates,
			remote.aggregates,
			baseline.aggregates,
		),
		publishTargets: mergeItemsByBaseline(
			local.publishTargets,
			remote.publishTargets,
			baseline.publishTargets,
		),
		clientExports: mergeItemsByBaseline(
			local.clientExports ?? [],
			remote.clientExports ?? [],
			baseline.clientExports ?? [],
		),
	};
}
```

- [ ] **Step 4: Replace the private auto-sync helper**

Modify `src/lib/sync.ts`:

```ts
import { getGistFileContent, updateGist } from "$lib/gist";
import { mergeSyncStateFromBaseline } from "$lib/sync-guard";
```

Remove the existing private `mergeItemsByBaseline` and `mergeSyncStateFromBaseline` functions from `src/lib/sync.ts`.

Update the no-baseline branch in `runSync()` from:

```ts
stateToSave = baselineState
	? mergeSyncStateFromBaseline(syncStartState, remoteState, baselineState)
	: {
			...syncStartState,
			...mergeSyncState(syncStartState, remoteState),
		};
```

to:

```ts
stateToSave = mergeSyncStateFromBaseline(
	syncStartState,
	remoteState,
	baselineState,
);
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test src/lib/sync-guard.test.ts src/lib/sync.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sync-guard.ts src/lib/sync-guard.test.ts src/lib/sync.ts
git commit -m "feat: add workspace sync guard"
```

---

### Task 2: Wire Safe Manual Push in Auth Page

**Files:**
- Modify: `src/routes/auth/+page.svelte`
- Modify: `src/routes/auth/page-source.test.ts`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Write failing page-source assertions**

Append to `src/routes/auth/page-source.test.ts`:

```ts
test("auth page blocks stale manual push behind a remote-change review", () => {
	expect(authPageSource).toContain("manualPushReview");
	expect(authPageSource).toContain("decideManualPush");
	expect(authPageSource).toContain("handleManualForcePush");
	expect(authPageSource).toContain('$t("Remote workspace changed since your last sync. Choose how to continue.")');
	expect(authPageSource).toContain('$t("Force Push")');
	expect(authPageSource).toContain("handleManualPushReview('merge')");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/routes/auth/page-source.test.ts
```

Expected: FAIL because the Auth page does not contain the new review state.

- [ ] **Step 3: Import sync guard helpers**

Modify the import section in `src/routes/auth/+page.svelte`:

```ts
import { decideManualPush, mergeSyncStateFromBaseline } from "$lib/sync-guard";
import { readSyncBaseline, readSyncBaselineState, setSyncBaseline } from "$lib/sync";
```

Remove the old import:

```ts
import { mergeSyncState } from "$lib/merge";
```

- [ ] **Step 4: Export baseline readers from sync**

Modify `src/lib/sync.ts` so these functions are exported:

```ts
export function readSyncBaseline(): string {
	return readBaseline();
}

export function readSyncBaselineState(): AppState | null {
	return readBaselineState();
}
```

Place them after `setSyncBaseline()`.

- [ ] **Step 5: Add manual push review state**

In `src/routes/auth/+page.svelte`, below the existing `conflict` variable, add:

```ts
let manualPushReview: {
	gistId: string;
	remoteState: AppState;
	remoteSignature: string;
	localSignature: string;
} | null = null;
```

Clear this state in `handleTokenSave()`, `handleTokenClear()`, and after successful conflict resolution:

```ts
manualPushReview = null;
```

- [ ] **Step 6: Replace manual push behavior**

Replace `handleManualPush()` with:

```ts
async function handleManualPush() {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	const syncedFile = $appState.activeGistFile || WORKSPACE_FILE;
	if (!token || !gistId) return;

	workspaceBusy = true;
	try {
		const remoteContent = await getGistFileContent(token, gistId, syncedFile);
		const remoteState = importState(remoteContent);
		const decision = decideManualPush({
			local: $appState,
			remote: remoteState,
			baselineSignature: readSyncBaseline(),
		});

		if (decision.action === "already-synced") {
			setSyncBaseline(decision.remoteSignature, remoteState);
			manualPushReview = null;
			setStatus($t("Already in sync"), "info");
			return;
		}

		if (decision.action === "remote-changed") {
			manualPushReview = {
				gistId,
				remoteState,
				remoteSignature: decision.remoteSignature,
				localSignature: decision.localSignature,
			};
			setStatus($t("Remote workspace changed since your last sync."), "info");
			return;
		}

		const confirmed = await requestConfirm({
			title: $t("Sync Update"),
			message: $t("Overwrite remote workspace data with current local state?"),
			confirmText: $t("Push Local"),
		});
		if (!confirmed) return;

		const localPayload = exportSyncState($appState);
		await updateGist(token, {
			gistId,
			files: { [syncedFile]: { content: localPayload } },
		});
		setSyncBaseline(decision.localSignature, $appState);
		manualPushReview = null;
		setStatus($t("Pushed successfully"), "success");
	} catch (err) {
		setStatus($t("Push failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}
```

- [ ] **Step 7: Add review action handlers**

Add below `handleManualPush()`:

```ts
async function handleManualPushReview(action: "remote" | "merge" | "force") {
	if (!manualPushReview || !$authState.token) return;

	if (action === "remote") {
		const confirmed = await requestConfirm({
			title: $t("Sync Update"),
			message: $t("Remote data is different. Overwrite local with remote?"),
			confirmText: $t("Pull Remote"),
		});
		if (!confirmed) return;
		setLocalStateAndBaseline(manualPushReview.remoteState, manualPushReview.gistId);
		manualPushReview = null;
		setStatus($t("Pulled successfully"), "success");
		return;
	}

	if (action === "force") {
		await handleManualForcePush();
		return;
	}

	const confirmed = await requestConfirm({
		title: $t("Sync Update"),
		message: $t("Merge local and remote data, then save the merged state?"),
		confirmText: $t("Merge & Save"),
	});
	if (!confirmed) return;

	workspaceBusy = true;
	try {
		const syncedFile = $appState.activeGistFile || WORKSPACE_FILE;
		const mergedState = {
			...mergeSyncStateFromBaseline(
				$appState,
				manualPushReview.remoteState,
				readSyncBaselineState(),
			),
			activeGistId: manualPushReview.gistId,
			activeGistFile: syncedFile,
		};
		await updateGist($authState.token, {
			gistId: manualPushReview.gistId,
			files: { [syncedFile]: { content: exportSyncState(mergedState) } },
		});
		setLocalStateAndBaseline(mergedState, manualPushReview.gistId);
		manualPushReview = null;
		setStatus($t("Merged data saved."), "success");
	} catch (err) {
		setStatus($t("Resolution failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}

async function handleManualForcePush() {
	if (!manualPushReview || !$authState.token) return;
	const confirmed = await requestConfirm({
		title: $t("Sync Update"),
		message: $t("Force push will overwrite remote workspace changes. Continue?"),
		confirmText: $t("Force Push"),
	});
	if (!confirmed) return;

	workspaceBusy = true;
	try {
		const syncedFile = $appState.activeGistFile || WORKSPACE_FILE;
		const localSignature = getSyncStateSignature($appState);
		await updateGist($authState.token, {
			gistId: manualPushReview.gistId,
			files: { [syncedFile]: { content: exportSyncState($appState) } },
		});
		setSyncBaseline(localSignature, $appState);
		manualPushReview = null;
		setStatus($t("Pushed successfully"), "success");
	} catch (err) {
		setStatus($t("Push failed"), "error");
	} finally {
		workspaceBusy = false;
	}
}
```

- [ ] **Step 8: Update setup conflict merge to use the shared helper**

In `handleResolveConflict("merge")`, replace the merge block with:

```ts
const mergedState = {
	...mergeSyncStateFromBaseline(
		$appState,
		currentConflict.remoteState,
		readSyncBaselineState(),
	),
	activeGistId: currentConflict.gistId,
	activeGistFile: $appState.activeGistFile || WORKSPACE_FILE,
};
```

- [ ] **Step 9: Add the review panel markup**

In `src/routes/auth/+page.svelte`, after the existing conflict section and before the GitHub Connection section, add:

```svelte
{#if manualPushReview}
	<section class="gh-alert gh-alert-attention" transition:slide>
		<Octicon icon={alert} className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--attention-emphasis)]" />
		<div class="min-w-0 flex-1 space-y-3">
			<div>
				<h2 class="text-sm font-semibold">{$t("Remote Change Detected")}</h2>
				<p class="text-sm text-fg-muted">
					{$t("Remote workspace changed since your last sync. Choose how to continue.")}
				</p>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={() => handleManualPushReview('remote')}>
					<Octicon icon={arrowDown} className="h-5 w-5 text-accent-fg" />
					<span class="font-semibold">{$t("Pull Remote")}</span>
					<span class="gh-form-caption">{$t("Replace local state")}</span>
				</button>
				<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={() => handleManualPushReview('merge')}>
					<Octicon icon={sync} className="h-5 w-5 text-fg-muted" />
					<span class="font-semibold">{$t("Merge & Save")}</span>
					<span class="gh-form-caption">{$t("Merge Both States")}</span>
				</button>
				<button class="gh-btn flex h-auto flex-col items-center gap-2 py-4" on:click={() => handleManualPushReview('force')}>
					<Octicon icon={arrowUp} className="h-5 w-5 text-[color:var(--danger-emphasis)]" />
					<span class="font-semibold">{$t("Force Push")}</span>
					<span class="gh-form-caption">{$t("Overwrite remote changes")}</span>
				</button>
			</div>
		</div>
	</section>
{/if}
```

- [ ] **Step 10: Add translations**

In `src/lib/i18n.ts`, add these entries to `zhCN`:

```ts
"Remote Change Detected": "检测到远端变更",
"Remote workspace changed since your last sync.":
	"远端工作区在上次同步后发生了变化。",
"Remote workspace changed since your last sync. Choose how to continue.":
	"远端工作区在上次同步后发生了变化。请选择如何继续。",
"Force Push": "强制推送",
"Force push will overwrite remote workspace changes. Continue?":
	"强制推送会覆盖远端工作区变更。继续吗？",
"Overwrite remote changes": "覆盖远端变更",
```

- [ ] **Step 11: Run tests**

Run:

```bash
bun test src/routes/auth/page-source.test.ts src/lib/sync-guard.test.ts src/lib/sync.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/routes/auth/+page.svelte src/routes/auth/page-source.test.ts src/lib/i18n.ts src/lib/sync.ts
git commit -m "feat: guard manual workspace push"
```

---

### Task 3: Document Manual Sync Semantics

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`

- [ ] **Step 1: Update Chinese FAQ**

In `README.md`, replace the "哪些操作仍然会覆盖远端？" answer with:

```md
手动点击 Push Local / 推送本地时，SubMan 会先读取远端 `subman.json` 并和本地同步基线比较：

- 如果远端没有变化，会在确认后推送当前本地状态。
- 如果远端已经变化，不会直接覆盖，而是提示你选择 Pull Remote、Merge & Save 或 Force Push。
- 只有选择 Force Push / 强制推送，或登录冲突处理中明确选择“本地覆盖远端”，才会覆盖远端数据。

这些覆盖操作适合你确定本地数据就是最新来源时使用。
```

- [ ] **Step 2: Update English FAQ**

In `README.en.md`, replace the "Which actions still overwrite the remote workspace?" answer with:

```md
When you click Manual Push Local, SubMan first reads the remote `subman.json`
and compares it with the saved local sync baseline:

- If the remote file has not changed, SubMan pushes the current local state
  after confirmation.
- If the remote file changed, SubMan does not overwrite it immediately. It asks
  you to choose Pull Remote, Merge & Save, or Force Push.
- Only Force Push, or the setup conflict option to overwrite remote with local,
  overwrites remote data after divergence is detected.

Use overwrite actions when you know the local data is the source of truth.
```

- [ ] **Step 3: Run a documentation diff check**

Run:

```bash
git diff -- README.md README.en.md
```

Expected: only the manual sync FAQ wording changes.

- [ ] **Step 4: Commit**

```bash
git add README.md README.en.md
git commit -m "docs: clarify guarded manual sync"
```

---

### Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run full test suite**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 2: Run Svelte check**

Run:

```bash
bun run check
```

Expected: PASS with no Svelte or TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
bun run build
```

Expected: PASS and Vite/SvelteKit build completes.

- [ ] **Step 4: Inspect final status**

Run:

```bash
git status --short
git log --oneline -4
```

Expected: clean working tree, with commits for design, sync guard, Auth page guard, and docs.

---

## Self-Review Notes

- Spec coverage: the plan covers safe manual push, divergence detection, merge/pull/force choices, shared baseline-aware merge, clearer UI status, tests, and README FAQ updates.
- Scope kept tight: no Gist commit browser, no multi-file workspace split, no new `createdAt` migration.
- Type consistency: `ManualPushDecision`, `decideManualPush`, `mergeSyncStateFromBaseline`, `manualPushReview`, and `handleManualForcePush` are defined before use.
