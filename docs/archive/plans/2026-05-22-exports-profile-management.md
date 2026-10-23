# Exports Profile Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-page Profiles management surface to Exports so users can view, select, create, and delete client export profiles.

**Architecture:** Keep the feature inside `src/routes/exports/+page.svelte`. Replace the profile-selector-only UI with a Primer-style profile list that drives the existing selected-profile draft form, preview, and publish flow. Store changes through the existing `appState` helpers and confirmation/toast stores.

**Tech Stack:** SvelteKit, Svelte stores, Bun tests, existing GitHub Primer-like CSS utilities.

---

## File Structure

- Modify `src/routes/exports/+page.svelte`: profile list UI, create gating, delete handler, stale preview clearing.
- Modify `src/routes/exports/page-source.test.ts`: source-level assertions for the management surface and delete flow.
- Modify `src/lib/i18n.ts`: add Chinese translations for new visible strings if needed.

## Task 1: Add Source Test Coverage

**Files:**
- Modify: `src/routes/exports/page-source.test.ts`

- [ ] **Step 1: Add failing assertions for profile management**

Add a new test after the existing behavior test:

```ts
test("exports page exposes profile management actions", () => {
	expect(exportsPageSource).toContain("Profiles");
	expect(exportsPageSource).toContain("removeClientExport");
	expect(exportsPageSource).toContain("requestConfirm");
	expect(exportsPageSource).toContain("deleteProfile");
	expect(exportsPageSource).toContain("Delete Profile");
	expect(exportsPageSource).toContain("Delete export profile");
	expect(exportsPageSource).not.toContain(
		"$appState.clientExports.length === 0 && !!firstRule",
	);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
bun test src/routes/exports/page-source.test.ts
```

Expected: FAIL because `removeClientExport`, `requestConfirm`, and delete UI are not implemented yet.

- [ ] **Step 3: Commit only if this test-only step is kept separate**

If implementing in strict TDD commits:

```bash
git add src/routes/exports/page-source.test.ts
git commit -m "Test exports profile management surface"
```

## Task 2: Implement Profile List and Delete Flow

**Files:**
- Modify: `src/routes/exports/+page.svelte`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Update imports**

Change the exports page imports so they include confirmation, delete helper, utility class merging, and the trash icon:

```ts
import { copy, download, fileCode, trash, upload } from "$lib/octicons";
import {
	appState,
	removeClientExport,
	upsertClientExport,
} from "$lib/stores/app";
import { requestConfirm } from "$lib/stores/confirm";
import { cn } from "$lib/utils/cn";
```

- [ ] **Step 2: Replace create gating and add preview clearing**

Replace:

```ts
$: canCreateProfile = $appState.clientExports.length === 0 && !!firstRule;
```

with:

```ts
$: canCreateProfile = !!firstRule;
```

Add:

```ts
function clearPreview(): void {
	previewContent = "";
	previewSignature = "";
	previewWarnings = [];
	previewErrors = [];
	totalLines = 0;
	outboundCount = 0;
	skippedCount = 0;
}
```

- [ ] **Step 3: Add helpers for list display and selection**

Add these helpers near the existing profile helpers:

```ts
function getProfileRuleName(profile: ClientExportProfile): string {
	return (
		$appState.aggregates.find((rule) => rule.id === profile.ruleId)?.name ||
		$t("Missing Aggregate rule")
	);
}

function selectProfile(profileId: string): void {
	if (selectedProfileId === profileId) return;
	selectedProfileId = profileId;
	clearPreview();
}
```

- [ ] **Step 4: Clear preview after create and save**

Update `createProfile` and `saveProfile` so both call `clearPreview()` after syncing the selected profile:

```ts
	upsertClientExport(profile);
	selectedProfileId = profile.id;
	syncDraftFromProfile(profile);
	clearPreview();
```

and:

```ts
	upsertClientExport(nextProfile);
	selectedProfileId = nextProfile.id;
	syncDraftFromProfile(nextProfile);
	clearPreview();
```

- [ ] **Step 5: Add deleteProfile**

Add:

```ts
async function deleteProfile(profile: ClientExportProfile): Promise<void> {
	const confirmed = await requestConfirm({
		title: $t("Delete Profile"),
		message: $t("Delete export profile {name}?", { name: profile.name }),
		confirmText: $t("Delete"),
		danger: true,
	});
	if (!confirmed) return;

	removeClientExport(profile.id);
	if (selectedProfileId === profile.id) {
		selectedProfileId = "";
	}
	clearPreview();
	showToast($t("Deleted export profile"), "success");
}
```

- [ ] **Step 6: Replace selector block with Profiles list**

Replace the `Export Profile` `GitHubSelect` block with a list:

```svelte
{#if $appState.clientExports.length > 0}
	<div class="overflow-hidden rounded-md border border-border-default">
		<div class="gh-list-header hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
			<span>{$t("Profiles")}</span>
			<span>{$t("Source Aggregate Rule")}</span>
			<span class="text-right">{$t("Actions")}</span>
		</div>
		{#each $appState.clientExports as profile}
			<div
				class={cn(
					"gh-box-row group",
					profile.id === selectedProfileId && "bg-accent-subtle",
				)}
			>
				<div class="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
					<button
						type="button"
						class="gh-row-main min-w-0 text-left"
						on:click={() => selectProfile(profile.id)}
					>
						<Octicon icon={fileCode} className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
						<span class="min-w-0 space-y-1">
							<span class="gh-row-title block truncate">{profile.name}</span>
							<span class="gh-list-meta-code block truncate">{profile.fileName}</span>
						</span>
					</button>
					<div class="min-w-0 text-sm text-fg-muted">
						{getProfileRuleName(profile)}
					</div>
					<div class="flex justify-end">
						<button
							type="button"
							class="gh-btn gh-btn-sm gh-btn-danger"
							on:click={() => deleteProfile(profile)}
							aria-label={$t("Delete export profile")}
						>
							<Octicon icon={trash} className="h-3.5 w-3.5" />
							{$t("Delete")}
						</button>
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}
```

- [ ] **Step 7: Make New profile visible whenever it can be used**

Keep the no-aggregate alert. Show `New profile` whenever `canCreateProfile` is true, including when profiles already exist:

```svelte
{#if $appState.aggregates.length === 0}
	<div class="gh-alert gh-alert-attention">
		<span>{$t("Create an Aggregate rule before exporting.")}</span>
	</div>
{:else}
	<button class="gh-btn gh-btn-primary self-start" type="button" on:click={createProfile}>
		{$t("New profile")}
	</button>
{/if}
```

- [ ] **Step 8: Add translations**

In `src/lib/i18n.ts`, add these entries to `zhCN`:

```ts
Profiles: "配置",
"Missing Aggregate rule": "缺失聚合规则",
"Delete Profile": "删除配置",
"Delete export profile": "删除导出配置",
"Delete export profile {name}?": "删除导出配置 {name}？",
"Deleted export profile": "已删除导出配置",
```

- [ ] **Step 9: Run targeted test**

Run:

```bash
bun test src/routes/exports/page-source.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit implementation**

```bash
git add src/routes/exports/+page.svelte src/routes/exports/page-source.test.ts src/lib/i18n.ts
git commit -m "Add exports profile management"
```

## Task 3: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run the test suite**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
bun run build
```

Expected: SvelteKit build completes successfully.

- [ ] **Step 3: Commit any required test/build fixes**

If fixes are required:

```bash
git add <changed-files>
git commit -m "Fix exports profile management verification"
```
