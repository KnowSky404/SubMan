# GitHub-Style UI System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh SubMan's UI so it uses GitHub-like interaction patterns, component density, button grouping, list rows, and settings forms while preserving the existing SubMan workflows.

**Architecture:** Add reusable GitHub-style primitives in `src/app.css`, then apply them across the Svelte route pages. Use source tests to lock in the new structural conventions without brittle visual snapshots.

**Tech Stack:** SvelteKit, Tailwind CSS via `@apply`, Bun test runner, existing Octicon component and app stores.

---

## File Structure

- Modify `src/app.css`: add reusable primitives (`gh-toolbar`, `gh-filter-bar`, `gh-btn-group`, `gh-counter`, `gh-label`, `gh-dropdown-menu`, `gh-section`, action-row helpers) and refine existing button/list states.
- Modify `src/routes/+layout.svelte`: tighten header controls with button/action primitives while keeping existing data flow.
- Modify `src/routes/+page.svelte`: make overview summary boxes denser and more GitHub-like.
- Modify `src/routes/nodes/+page.svelte`: convert tabs/search/status/new-action into one filter bar; normalize list rows, labels, toggles, and row actions.
- Modify `src/routes/aggregate/+page.svelte`: apply settings-form layout, dropdown-menu primitives, footer actions, and preview list polish.
- Modify `src/routes/gists/+page.svelte`: apply file-list and button-group conventions.
- Modify `src/routes/auth/+page.svelte`: convert workspace/data areas into settings-style sections.
- Modify source tests:
  - `src/routes/nodes/page-source.test.ts`
  - `src/routes/gists/page-source.test.ts`
  - `src/routes/auth/page-source.test.ts`
  - Add `src/routes/aggregate/page-source.test.ts`
  - Optionally extend `src/routes/layout-source.test.ts`

## Task 1: Add Global UI Primitives

**Files:**
- Modify: `src/app.css`
- Test: no dedicated failing test for CSS-only primitives; later source tests assert usage in route files.

- [ ] **Step 1: Add the CSS primitives**

Add these classes near the existing `gh-btn`, `gh-tabs`, `gh-page-header`, and list primitives in `src/app.css`:

```css
.gh-toolbar {
	@apply flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between;
}

.gh-toolbar-group {
	@apply flex min-w-0 flex-wrap items-center gap-2;
}

.gh-filter-bar {
	@apply flex flex-col gap-3 rounded-md border border-border-default bg-canvas-default p-3 sm:flex-row sm:items-center sm:justify-between;
	box-shadow: var(--shadow-sm);
}

.gh-filter-controls {
	@apply flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center;
}

.gh-btn-group {
	@apply inline-flex items-center;
}

.gh-btn-group > .gh-btn {
	@apply rounded-none;
}

.gh-btn-group > .gh-btn:first-child {
	@apply rounded-l-md;
}

.gh-btn-group > .gh-btn:last-child {
	@apply rounded-r-md;
}

.gh-btn-group > .gh-btn + .gh-btn {
	margin-left: -1px;
}

.gh-counter {
	@apply inline-flex min-w-5 items-center justify-center rounded-full border border-border-default bg-canvas-subtle px-1.5 py-0.5 text-[11px] font-medium leading-none text-fg-muted;
}

.gh-label {
	@apply inline-flex items-center gap-1 rounded-md border border-border-default bg-canvas-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-fg-muted;
}

.gh-label-muted {
	@apply normal-case font-medium;
}

.gh-dropdown-menu {
	@apply absolute z-[120] mt-1 overflow-hidden rounded-md border border-border-default bg-canvas-default shadow-[var(--shadow-medium)];
}

.gh-dropdown-header {
	@apply border-b border-border-default bg-canvas-subtle p-2;
}

.gh-dropdown-body {
	@apply max-h-[400px] overflow-y-auto p-1;
}

.gh-dropdown-item {
	@apply flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors;
}

.gh-dropdown-item:hover {
	background: var(--canvas-subtle);
}

.gh-row-main {
	@apply flex min-w-0 items-start gap-3;
}

.gh-row-title {
	@apply min-w-0 truncate text-left text-sm font-semibold text-accent-fg;
}

.gh-row-title:hover {
	@apply underline;
}

.gh-row-actions {
	@apply flex shrink-0 items-center justify-start gap-0 sm:justify-self-end;
}

.gh-section {
	@apply rounded-md border border-border-default bg-canvas-default;
	box-shadow: var(--shadow-sm);
}

.gh-section-header {
	@apply flex flex-col gap-2 border-b border-border-default bg-canvas-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between;
}

.gh-section-title {
	@apply flex items-center gap-2 text-sm font-semibold;
}

.gh-section-description {
	@apply text-xs text-fg-muted;
}

.gh-section-body {
	@apply flex flex-col gap-4 p-4;
}

.gh-section-footer {
	@apply flex flex-col gap-2 border-t border-border-default bg-canvas-subtle p-4 sm:flex-row sm:items-center sm:justify-end;
}

.gh-checkbox-row {
	@apply flex items-start gap-2 rounded-md border border-border-default bg-canvas-subtle p-2.5;
}
```

- [ ] **Step 2: Refine existing button/list states**

In `src/app.css`, update existing primitives as follows:

```css
.gh-btn {
	@apply inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border-default px-3 py-1.5 text-sm font-medium text-fg-default transition-colors disabled:cursor-not-allowed disabled:opacity-60;
	background: linear-gradient(180deg, #f6f8fa 0%, #f3f4f6 100%);
	box-shadow: var(--shadow-sm);
}

.gh-btn:active {
	background: var(--canvas-inset);
}

.gh-btn-primary:active {
	background: color-mix(in srgb, var(--success-emphasis) 80%, black);
}

.gh-box-row {
	@apply border-b border-border-default px-4 py-3 last:border-b-0;
}
```

- [ ] **Step 3: Run formatting/checking for CSS syntax**

Run: `bun run check`

Expected: command exits 0, or if unrelated existing warnings appear, no syntax error from `src/app.css`.

- [ ] **Step 4: Commit**

```bash
git add src/app.css
git commit -m "style: add github ui primitives"
```

## Task 2: Refresh Nodes Page Structure

**Files:**
- Modify: `src/routes/nodes/page-source.test.ts`
- Modify: `src/routes/nodes/+page.svelte`

- [ ] **Step 1: Write source tests for Nodes UI structure**

Append these tests to `src/routes/nodes/page-source.test.ts`:

```ts
test("nodes page uses a unified github-style filter bar", () => {
	expect(nodesPageSource).toContain('class="gh-filter-bar"');
	expect(nodesPageSource).toContain('class="gh-filter-controls"');
	expect(nodesPageSource).toContain('class="gh-counter"');
	expect(nodesPageSource).toContain("gh-btn-group");
});

test("nodes page uses stable list row primitives", () => {
	expect(nodesPageSource).toContain("gh-row-main");
	expect(nodesPageSource).toContain("gh-row-title");
	expect(nodesPageSource).toContain("gh-row-actions");
	expect(nodesPageSource).toContain("gh-label");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun test src/routes/nodes/page-source.test.ts`

Expected: FAIL because `gh-filter-bar`, `gh-row-main`, `gh-row-title`, or `gh-row-actions` are not yet present.

- [ ] **Step 3: Update the page header action**

In `src/routes/nodes/+page.svelte`, remove the standalone `New Resource` button from the page header. Keep the title, subtitle, and metadata.

- [ ] **Step 4: Replace the filter block**

Replace the block currently introduced by `<!-- Filter Bar -->` with:

```svelte
	<div class="gh-filter-bar">
		<div class="gh-filter-controls">
			<div class="gh-tabs w-full sm:w-auto">
				<button type="button" class={cn("gh-tab", activeTab === "nodes" && "gh-tab-active")} on:click={() => { activeTab = "nodes"; expandedId = null; }}>
					<Octicon icon={server} className="h-4 w-4" />
					{$t("Nodes")}
					<span class="gh-counter">{$appState.nodes.length}</span>
				</button>
				<button type="button" class={cn("gh-tab", activeTab === "subscriptions" && "gh-tab-active")} on:click={() => { activeTab = "subscriptions"; expandedId = null; }}>
					<Octicon icon={link} className="h-4 w-4" />
					{$t("Subscriptions")}
					<span class="gh-counter">{$appState.subscriptions.length}</span>
				</button>
			</div>

			<div class="relative min-w-0 flex-1 sm:max-w-xs">
				<Octicon icon={search} className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
				<label class="sr-only" for={addFormIds.filterQuery}>{$t("Filter resources")}</label>
				<input id={addFormIds.filterQuery} class="gh-input h-8 pl-9" placeholder={$t("Filter resources...")} bind:value={searchQuery} />
			</div>
			<label class="sr-only" for={addFormIds.filterStatus}>{$t("Filter status")}</label>
			<select id={addFormIds.filterStatus} class="gh-select w-full sm:w-32" bind:value={filterStatus}>
				<option value="all">{$t("All")}</option>
				<option value="enabled">{$t("Enabled")}</option>
				<option value="disabled">{$t("Disabled")}</option>
			</select>
		</div>

		<button type="button" class="gh-btn gh-btn-primary shrink-0" on:click={() => (isAddModalOpen = !isAddModalOpen)}>
			<Octicon icon={plus} className="h-4 w-4" />
			{$t("New Resource")}
		</button>
	</div>
```

- [ ] **Step 5: Update node rows**

In the node list row, use:

```svelte
<div class={cn("gh-box-row group flex flex-col gap-0", !node.enabled && "opacity-70")}>
	<div class="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1.7fr)_140px_auto] sm:items-start sm:gap-4">
		<div class="gh-row-main">
			<button type="button" class={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border", node.enabled ? "border-[color:var(--success-emphasis)] bg-[color:var(--success-emphasis)] text-white" : "border-border-default bg-canvas-default")} on:click={() => toggleEnabled(node.id, "node")} aria-label={$t(node.enabled ? "Disable node" : "Enable node")}>
				{#if node.enabled}<Octicon icon={check} className="h-3.5 w-3.5" />{/if}
			</button>
			<div class="flex min-w-0 flex-col gap-1">
				<div class="flex min-w-0 flex-wrap items-center gap-2">
					<button type="button" class="gh-row-title" on:click={() => startEditNode(node)}>{node.name}</button>
					<span class="gh-label">{node.type}</span>
					<span class={cn("gh-label gh-label-muted", node.enabled && "badge-success")}>{node.enabled ? $t("Enabled") : $t("Disabled")}</span>
				</div>
				<div class="gh-list-meta">
					<span>{$t("Updated {time}", { time: formatUpdatedAt(node.updatedAt) })}</span>
					<span>{$t("Source: {source}", { source: node.source })}</span>
					<span>{$t("{count} tags", { count: node.tags.length })}</span>
				</div>
				<code class="gh-list-meta-code">{node.raw}</code>
				{#if node.tags.length > 0}
					<div class="flex flex-wrap gap-1">
						{#each node.tags as nodeTag}
							<span class="gh-label gh-label-muted"><Octicon icon={tagIcon} className="h-3 w-3" />{nodeTag.label}</span>
						{/each}
					</div>
				{/if}
			</div>
		</div>
		<div class="gh-list-meta sm:block">
			<span>{$t("Type: {type}", { type: node.type.toUpperCase() })}</span>
			<span>{$t(node.enabled ? "Enabled" : "Disabled")}</span>
		</div>
		<div class="gh-row-actions gh-btn-group">
			<button type="button" class="gh-btn gh-btn-sm" on:click={() => startEditNode(node)} aria-label={$t("Edit node")} title={$t("Edit node")}><Octicon icon={pencil} className="h-3.5 w-3.5" /></button>
			<button type="button" class="gh-btn gh-btn-sm" on:click={() => copy(node.raw)} aria-label={$t("Copy URI")} title={$t("Copy URI")}><Octicon icon={copyIcon} className="h-3.5 w-3.5" /></button>
			<button type="button" class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => remove(node.id, "node", node.name)} aria-label={$t("Delete node")} title={$t("Delete node")}><Octicon icon={trash} className="h-3.5 w-3.5" /></button>
		</div>
	</div>
</div>
```

Keep the existing inline editor block immediately below the row content.

- [ ] **Step 6: Update subscription rows**

Apply the same `gh-row-main`, `gh-row-title`, `gh-label`, `gh-row-actions`, and `gh-btn-group` pattern to the subscription rows. Include preview, edit, copy, and delete buttons in the grouped actions.

- [ ] **Step 7: Run the focused test to verify it passes**

Run: `bun test src/routes/nodes/page-source.test.ts`

Expected: PASS.

- [ ] **Step 8: Run Svelte check**

Run: `bun run check`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/routes/nodes/page-source.test.ts src/routes/nodes/+page.svelte
git commit -m "style: refresh nodes github list UI"
```

## Task 3: Refresh Aggregate Builder

**Files:**
- Create: `src/routes/aggregate/page-source.test.ts`
- Modify: `src/routes/aggregate/+page.svelte`

- [ ] **Step 1: Write source tests for Aggregate UI structure**

Create `src/routes/aggregate/page-source.test.ts`:

```ts
// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const aggregatePageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("aggregate page uses github-style dropdown menus for source selectors", () => {
	expect(aggregatePageSource).toContain("gh-dropdown-menu");
	expect(aggregatePageSource).toContain("gh-dropdown-header");
	expect(aggregatePageSource).toContain("gh-dropdown-body");
	expect(aggregatePageSource).toContain("gh-dropdown-item");
});

test("aggregate page uses section footer actions and grouped buttons", () => {
	expect(aggregatePageSource).toContain("gh-section-footer");
	expect(aggregatePageSource).toContain("gh-btn-group");
	expect(aggregatePageSource).toContain("gh-label");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun test src/routes/aggregate/page-source.test.ts`

Expected: FAIL because the aggregate page does not yet use these primitives.

- [ ] **Step 3: Update Rule Definition panel header**

In `src/routes/aggregate/+page.svelte`, keep the existing `gh-box` wrapper but update the header's right side to:

```svelte
<div class="gh-toolbar-group">
	<span class="gh-counter">{$appState.aggregates.length}</span>
	<select class="gh-select gh-select-sm w-48" value={editingRuleId} on:change={(e) => { const id = e.currentTarget.value; id ? loadRule($appState.aggregates.find(r => r.id === id)) : resetRuleForm(); }}>
		<option value="">+ {$t("New Rule")}</option>
		{#each $appState.aggregates as rule}<option value={rule.id}>{rule.name}</option>{/each}
	</select>
</div>
```

- [ ] **Step 4: Update source selector dropdown panels**

Replace the dropdown container class for both Nodes and Subscriptions selectors with:

```svelte
<div class="gh-dropdown-menu left-0 top-full w-full min-w-[280px]" transition:slide={{ duration: 150 }}>
	<div class="gh-dropdown-header">
```

Replace the list body class with:

```svelte
<div class="gh-dropdown-body flex flex-col gap-0.5">
```

Replace selector action rows with:

```svelte
<button type="button" class="gh-dropdown-item font-semibold text-accent-fg" on:click={selectAllNodes}>
	<Octicon icon={checklist} className="h-3.5 w-3.5" /> {$t("Select visible")}
</button>
```

For each checkbox row, use:

```svelte
<label class="gh-dropdown-item">
	<input type="checkbox" class="rounded border-border-default" checked={selectedNodeIds.includes(node.id)} on:change={() => (selectedNodeIds = toggleSelection(selectedNodeIds, node.id))} />
	<span class="min-w-0 flex-1 truncate">{node.name}</span>
	<span class="gh-label">{node.type}</span>
</label>
```

Use the same structure for subscriptions without the protocol label.

- [ ] **Step 5: Update allowed protocol controls**

Change the allowed protocol wrapper to:

```svelte
<div class="gh-btn-group flex-wrap" role="group" aria-labelledby={fieldIds.allowedTypes}>
```

Keep each protocol button as a `gh-btn gh-btn-sm`; selected items can remain `gh-btn-primary`.

- [ ] **Step 6: Update checkbox rows**

Replace both public gist and prepend-region flag checkbox containers with `gh-checkbox-row`.

- [ ] **Step 7: Update panel footer actions**

Replace the rule editor footer class with:

```svelte
<div class="gh-section-footer">
	<div class="gh-btn-group">
```

Group delete, preview, and save buttons in a button group where practical. Keep save as `gh-btn gh-btn-primary`.

- [ ] **Step 8: Update preview result rows**

Use `gh-label` for protocol labels in preview rows and keep copy as a grouped icon button when adjacent actions exist.

- [ ] **Step 9: Run focused test**

Run: `bun test src/routes/aggregate/page-source.test.ts`

Expected: PASS.

- [ ] **Step 10: Run Svelte check**

Run: `bun run check`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/routes/aggregate/page-source.test.ts src/routes/aggregate/+page.svelte
git commit -m "style: refresh aggregate github form UI"
```

## Task 4: Refresh Gists and Settings Pages

**Files:**
- Modify: `src/routes/gists/page-source.test.ts`
- Modify: `src/routes/gists/+page.svelte`
- Modify: `src/routes/auth/page-source.test.ts`
- Modify: `src/routes/auth/+page.svelte`

- [ ] **Step 1: Add source tests for Gists and Settings structure**

Append to `src/routes/gists/page-source.test.ts`:

```ts
test("gists page uses github file list action primitives", () => {
	expect(gistsPageSource).toContain("gh-row-main");
	expect(gistsPageSource).toContain("gh-row-actions");
	expect(gistsPageSource).toContain("gh-btn-group");
	expect(gistsPageSource).toContain("gh-label");
});
```

Append to `src/routes/auth/page-source.test.ts`:

```ts
test("auth page uses github settings section primitives", () => {
	expect(authPageSource).toContain("gh-section");
	expect(authPageSource).toContain("gh-section-header");
	expect(authPageSource).toContain("gh-section-body");
	expect(authPageSource).toContain("gh-section-footer");
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `bun test src/routes/gists/page-source.test.ts src/routes/auth/page-source.test.ts`

Expected: FAIL because the route pages do not yet contain all asserted primitives.

- [ ] **Step 3: Update Gists file rows**

In `src/routes/gists/+page.svelte`, update each file row to use `gh-row-main` for the filename area and `gh-row-actions gh-btn-group` for copy/open/delete actions. Use `gh-label` or `gh-label gh-label-muted` for the Config/Published kind label.

- [ ] **Step 4: Update Gists sidebar**

Change sidebar action buttons that appear together to use `gh-btn-group` where there is more than one adjacent action. Keep the Active Gist and explanatory blankslate compact.

- [ ] **Step 5: Convert Auth GitHub Workspace section**

In `src/routes/auth/+page.svelte`, replace the GitHub Workspace section shell with:

```svelte
<section class="gh-section">
	<div class="gh-section-header">
		<div>
			<h2 class="gh-section-title"><Octicon icon={markGithub} className="h-5 w-5" />{$t("GitHub Workspace")}</h2>
			<p class="gh-section-description">{$t("Stores workspace data in a private gist. Requires a classic token with gist scope.")}</p>
		</div>
		{#if $authState.token}
			<span class="State State--success"><Octicon icon={checkCircle} className="h-3 w-3" />{$t("Connected")}</span>
		{:else}
			<span class="State State--muted">{$t("Local Mode")}</span>
		{/if}
	</div>
	<div class="gh-section-body">
		<!-- existing auth body -->
	</div>
</section>
```

- [ ] **Step 6: Convert Auth Data Management section**

Use the same `gh-section`, `gh-section-header`, `gh-section-body`, and `gh-section-footer` structure for Import/Export. Put Export, Import, and Copy in a `gh-btn-group` in the footer.

- [ ] **Step 7: Run focused tests**

Run: `bun test src/routes/gists/page-source.test.ts src/routes/auth/page-source.test.ts`

Expected: PASS.

- [ ] **Step 8: Run Svelte check**

Run: `bun run check`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/routes/gists/page-source.test.ts src/routes/gists/+page.svelte src/routes/auth/page-source.test.ts src/routes/auth/+page.svelte
git commit -m "style: refresh gists and settings github UI"
```

## Task 5: Polish Layout and Overview

**Files:**
- Modify: `src/routes/layout-source.test.ts`
- Modify: `src/routes/+layout.svelte`
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Add source test for layout action primitives**

Append to `src/routes/layout-source.test.ts`:

```ts
test("layout uses github action primitives in repository header", () => {
	expect(layoutSource).toContain("gh-toolbar-group");
	expect(layoutSource).toContain("gh-counter");
	expect(layoutSource).toContain("gh-btn");
});
```

- [ ] **Step 2: Run focused test to verify it fails**

Run: `bun test src/routes/layout-source.test.ts`

Expected: FAIL if `gh-toolbar-group` or `gh-counter` are not yet used in layout.

- [ ] **Step 3: Update layout stats and action clusters**

In `src/routes/+layout.svelte`, replace the stat chips in `.app-repo-side-meta` with compact items using `gh-counter` for numbers and keep the workspace action in a `gh-toolbar-group`.

- [ ] **Step 4: Update overview summary boxes**

In `src/routes/+page.svelte`, replace heavy stat badges inside "At a glance" and "Workflow" with `gh-counter` and `gh-label` where appropriate. Reduce icon tile prominence by using smaller bordered icon containers.

- [ ] **Step 5: Run focused test**

Run: `bun test src/routes/layout-source.test.ts`

Expected: PASS.

- [ ] **Step 6: Run Svelte check**

Run: `bun run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/layout-source.test.ts src/routes/+layout.svelte src/routes/+page.svelte
git commit -m "style: polish github shell overview"
```

## Task 6: Final Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run all tests**

Run: `bun test`

Expected: PASS.

- [ ] **Step 2: Run Svelte check**

Run: `bun run check`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `bun run build`

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run: `git status --short`

Expected: only intended files changed, or clean if every task committed.

Run: `git log --oneline -6`

Expected: shows the design commit plus atomic implementation commits.

## Self-Review

- Spec coverage: global primitives are covered by Task 1; Nodes by Task 2; Aggregate by Task 3; Gists and Settings by Task 4; Layout and Overview by Task 5; verification by Task 6.
- Placeholder scan: no `TBD`, `TODO`, or vague implementation-only placeholders remain.
- Type consistency: all named CSS classes are defined in Task 1 before use in later tasks; tests assert exact class strings used by the route files.
