# Primer UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the full SubMan UI to a consistent GitHub Primer-style workbench without changing business logic, routes, persisted data, sync, aggregation, or export behavior.

**Architecture:** Keep the existing SvelteKit route structure and store/API calls intact. Centralize reusable Primer primitives in `src/app.css`, then update the app shell and each route page-by-page so every task is independently buildable and committable.

**Tech Stack:** SvelteKit 2, Svelte 5, Tailwind CSS v4 utility classes in CSS via `@apply`, Octicons, Bun.

---

## File Structure

- Modify `src/app.css`: Primer tokens, shared page/header/alert/list primitives, app shell tightening, responsive fixes.
- Modify `src/routes/+layout.svelte`: compact repo shell, normalized status/action controls, accessible icon-only controls.
- Modify `src/routes/+page.svelte`: Overview page header and Primer repo-overview layout.
- Modify `src/routes/nodes/+page.svelte`: page header, toolbar, resource rows, inline editor panels, subscription preview modal styling.
- Modify `src/routes/aggregate/+page.svelte`: page header, two-column rule/publish workbench, dropdown/modal/list styling cleanup.
- Modify `src/routes/exports/+page.svelte`: profile editor plus summary/preview panels using shared primitives.
- Modify `src/routes/gists/+page.svelte`: page header, workspace sidebar, repository file list styling.
- Modify `src/routes/auth/+page.svelte`: settings panels, attention conflict alert, connected/local workspace state.
- Run existing source tests and build checks after each major surface where practical.

## Shared Verification Commands

Use these commands throughout the plan:

```bash
bun run check
bun run build
```

Expected result for both commands: exit code `0`.

After all implementation tasks, run:

```bash
bun run lint
```

Expected result: exit code `0`, or only pre-existing formatting/lint findings documented before final handoff.

## Task 1: Global Primer Foundation

**Files:**
- Modify: `src/app.css`

- [ ] **Step 1: Inspect current global styles**

Run:

```bash
sed -n '1,220p' src/app.css
sed -n '220,760p' src/app.css
```

Expected: current file includes Roboto imports, a desktop html font-size bump, `gh-*` primitives, app shell classes, badges, and state classes.

- [ ] **Step 2: Remove non-spec font imports and normalize typography**

In `src/app.css`, remove these imports:

```css
@import url("https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.2.10/latin.css");
@import url("https://cdn.jsdelivr.net/npm/@fontsource/roboto-mono@5.2.9/latin.css");
```

Set the theme fonts to the design spec:

```css
--font-sans:
	-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial,
	sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
--font-mono:
	ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
	"Liberation Mono", monospace;
```

Remove the `@media (min-width: 1024px)` block that changes `html` to `15px`.

- [ ] **Step 3: Add shared Primer primitives**

Add or update classes in `src/app.css` so route pages can share them:

```css
.gh-page {
	@apply flex flex-col gap-4 pb-10;
}

.gh-page-header {
	@apply flex flex-col gap-3 border-b border-border-default pb-4 lg:flex-row lg:items-end lg:justify-between;
}

.gh-page-heading {
	@apply min-w-0 space-y-1;
}

.gh-page-title {
	@apply text-2xl font-semibold leading-tight text-fg-default;
}

.gh-page-subtitle {
	@apply max-w-3xl text-sm text-fg-muted;
}

.gh-page-actions {
	@apply flex flex-wrap items-center gap-2;
}

.gh-page-meta {
	@apply flex flex-wrap items-center gap-2 text-xs text-fg-muted;
}

.gh-page-meta-item {
	@apply inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border-default bg-canvas-default px-2.5 py-1;
}

.gh-alert {
	@apply flex items-start gap-3 rounded-md border px-4 py-3 text-sm;
}

.gh-alert-attention {
	border-color: color-mix(in srgb, var(--attention-emphasis) 35%, var(--border-default));
	background: color-mix(in srgb, var(--attention-emphasis) 10%, var(--canvas-default));
	color: var(--fg-default);
}

.gh-alert-danger {
	border-color: color-mix(in srgb, var(--danger-emphasis) 35%, var(--border-default));
	background: color-mix(in srgb, var(--danger-emphasis) 8%, var(--canvas-default));
	color: var(--fg-default);
}

.gh-alert-success {
	border-color: color-mix(in srgb, var(--success-emphasis) 35%, var(--border-default));
	background: color-mix(in srgb, var(--success-emphasis) 8%, var(--canvas-default));
	color: var(--fg-default);
}

.gh-inset-panel {
	@apply rounded-md border border-border-default bg-canvas-subtle p-4;
}

.gh-code-block {
	@apply overflow-auto rounded-md border border-border-default bg-canvas-subtle p-3 font-mono text-xs text-fg-default;
}

.gh-layout-sidebar {
	@apply grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_296px];
}

.gh-layout-main {
	@apply flex min-w-0 flex-col gap-4;
}

.gh-layout-aside {
	@apply flex min-w-0 flex-col gap-4;
}
```

If a class already exists, merge rather than duplicate it.

- [ ] **Step 4: Normalize badges, labels, state, and app shell spacing**

Update the existing badge/state/app shell CSS to:

```css
.badge,
.gh-counter {
	@apply inline-flex min-h-5 items-center justify-center rounded-full border border-border-default bg-canvas-subtle px-2 text-[11px] font-medium leading-none text-fg-muted;
}

.gh-label {
	@apply inline-flex min-h-5 items-center gap-1 rounded-md border border-border-default bg-canvas-subtle px-1.5 text-[11px] font-medium leading-none text-fg-muted;
}

.State {
	@apply inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-white;
}

.app-repo-meta {
	@apply mx-auto flex w-full flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8;
}

.app-repo-title {
	@apply flex min-w-0 flex-wrap items-center gap-1.5 text-xl leading-7;
}

.app-main-container {
	@apply flex-1 py-5;
}
```

Preserve dark-mode token behavior and existing class names used by routes.

- [ ] **Step 5: Run checks**

Run:

```bash
bun run check
```

Expected: exit code `0`.

- [ ] **Step 6: Commit global foundation**

Run:

```bash
git add src/app.css
git commit -m "Refine Primer UI foundation"
```

Expected: commit succeeds.

## Task 2: App Shell And Overview

**Files:**
- Modify: `src/routes/+layout.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/app.css`

- [ ] **Step 1: Tighten layout shell markup**

In `src/routes/+layout.svelte`, keep all imports, reactive declarations, and handlers. Update only classes/markup around existing controls:

- Keep `app-repo-shell`, `app-repo-masthead`, `app-repo-meta`, and underline nav.
- Use `gh-label gh-label-muted` for `Public`.
- Use `gh-btn gh-btn-sm` and `gh-btn gh-btn-primary gh-btn-sm` for workspace action instead of `app-repo-action-button`.
- Keep theme and GitHub icon buttons icon-only with `aria-label`.
- Keep active nav logic unchanged.

- [ ] **Step 2: Add an Overview page header**

At the top of `src/routes/+page.svelte`, wrap content in:

```svelte
<div class="gh-page">
	<header class="gh-page-header">
		<div class="gh-page-heading">
			<h1 class="gh-page-title">{$t("Overview")}</h1>
			<p class="gh-page-subtitle">
				{$t("Manage proxy sources, aggregate rules, client exports, and workspace publishing from one gist-backed workbench.")}
			</p>
			<div class="gh-page-meta">
				<span class={cn("gh-page-meta-item", isConnected && "badge-success")}>
					{isConnected ? $t("Workspace connected") : $t("Local-only")}
				</span>
				<span class="gh-page-meta-item">{$t("{count} live links", { count: publishTargetCount })}</span>
			</div>
		</div>
		<div class="gh-page-actions">
			<a href="/nodes" class="gh-btn gh-btn-primary">
				<Octicon icon={server} className="h-4 w-4" />
				{$t("Manage Sources")}
			</a>
		</div>
	</header>
	...
</div>
```

Keep the existing metrics, next actions, publish status, and sidebar content below this header.

- [ ] **Step 3: Normalize Overview boxes**

Replace outer `repo-overview` with `gh-page` and `repo-overview-layout` with `gh-layout-sidebar`. Keep existing `repo-*` metric classes where they already fit. Use `gh-box-header` instead of `overview-panel-header` where practical.

- [ ] **Step 4: Run checks**

Run:

```bash
bun run check
```

Expected: exit code `0`.

- [ ] **Step 5: Commit shell and overview**

Run:

```bash
git add src/routes/+layout.svelte src/routes/+page.svelte src/app.css
git commit -m "Unify app shell and overview UI"
```

Expected: commit succeeds.

## Task 3: Nodes Page

**Files:**
- Modify: `src/routes/nodes/+page.svelte`
- Modify: `src/app.css`

- [ ] **Step 1: Add Nodes page header**

Wrap page content in `gh-page`. Add a header before the add panel:

```svelte
<header class="gh-page-header">
	<div class="gh-page-heading">
		<h1 class="gh-page-title">{$t("Nodes")}</h1>
		<p class="gh-page-subtitle">
			{$t("Manage single proxy URIs and upstream subscriptions used by aggregate rules.")}
		</p>
		<div class="gh-page-meta">
			<span class="gh-page-meta-item">{$t("{count} nodes", { count: $appState.nodes.length })}</span>
			<span class="gh-page-meta-item">{$t("{count} subscriptions", { count: $appState.subscriptions.length })}</span>
			<span class="gh-page-meta-item">{$t("{count} enabled", { count: enabledNodeCount + enabledSubscriptionCount })}</span>
		</div>
	</div>
	<div class="gh-page-actions">
		<button type="button" class="gh-btn gh-btn-primary" on:click={() => (isAddModalOpen = !isAddModalOpen)}>
			<Octicon icon={plus} className="h-4 w-4" />
			{$t("New Resource")}
		</button>
	</div>
</header>
```

Remove the duplicate primary action from the filter bar or change it to a secondary compact button if needed for mobile ergonomics.

- [ ] **Step 2: Convert add panel to a settings-style box**

Keep `isAddModalOpen`, `addMode`, and `handleAdd` unchanged. Update the add panel to use:

- `gh-box !overflow-visible`
- `gh-box-header`
- `gh-section-body`
- `gh-section-footer`
- `gh-tab` buttons for Single Entry and Batch Import

Use `gh-form-label` for labels and keep all input IDs unchanged.

- [ ] **Step 3: Normalize resource list rows**

Keep the list logic and handlers unchanged. Update row styling so both node and subscription rows use:

- `gh-box-row`
- `gh-row-main`
- `gh-list-meta`
- `gh-list-meta-code`
- `gh-row-actions gh-btn-group`
- `gh-inset-panel` for inline editors

Replace uppercase label classes such as `text-xs uppercase tracking-wide` with `gh-form-label` unless they are metadata labels.

- [ ] **Step 4: Normalize subscription preview modal**

Keep preview loading/copy behavior unchanged. Use:

- `gh-box`
- `gh-box-header`
- `gh-section-body`
- `gh-section-footer`
- `gh-alert gh-alert-danger` for error state
- `gh-list-meta-code` for raw URI rows

- [ ] **Step 5: Run focused source test and check**

Run:

```bash
bun test src/routes/nodes/page-source.test.ts
bun run check
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit Nodes page**

Run:

```bash
git add src/routes/nodes/+page.svelte src/app.css
git commit -m "Redesign nodes resource UI"
```

Expected: commit succeeds.

## Task 4: Aggregate Page

**Files:**
- Modify: `src/routes/aggregate/+page.svelte`
- Modify: `src/app.css`

- [ ] **Step 1: Add Aggregate page header**

Wrap content in `gh-page`. Add:

```svelte
<header class="gh-page-header">
	<div class="gh-page-heading">
		<h1 class="gh-page-title">{$t("Aggregate")}</h1>
		<p class="gh-page-subtitle">
			{$t("Build source selection, filtering, rename, sorting, preview, and publish rules.")}
		</p>
		<div class="gh-page-meta">
			<span class="gh-page-meta-item">{$t("{count} rules", { count: $appState.aggregates.length })}</span>
			<span class="gh-page-meta-item">{$t("{count} targets", { count: $appState.publishTargets.length })}</span>
			<span class={cn("gh-page-meta-item", isWorkspaceConnected && "badge-success")}>
				{isWorkspaceConnected ? $t("Workspace connected") : $t("Local-only")}
			</span>
		</div>
	</div>
	<div class="gh-page-actions">
		<button type="button" class="gh-btn" on:click={buildPreview} disabled={previewLoading}>
			{#if previewLoading}<Octicon icon={sync} className="h-4 w-4 animate-spin" />{:else}<Octicon icon={eye} className="h-4 w-4" />{/if}
			{$t("Preview")}
		</button>
		<button type="button" class="gh-btn gh-btn-primary" on:click={saveRule}>
			<Octicon icon={checkCircle} className="h-4 w-4" />
			{$t("Save Rule")}
		</button>
	</div>
</header>
```

- [ ] **Step 2: Normalize two-column layout**

Replace the existing outer grid with:

```svelte
<div class="gh-layout-sidebar lg:grid-cols-[minmax(0,1fr)_340px]">
	<div class="gh-layout-main">...</div>
	<aside class="gh-layout-aside">...</aside>
</div>
```

Keep Rule Definition in the main column and Publish to Gist plus workspace blankslate in the aside.

- [ ] **Step 3: Normalize rule editor controls**

Keep all handlers and state unchanged. Update classes:

- Box: `gh-box !overflow-visible`
- Headers: `gh-box-header`
- Form body: `gh-section-body`
- Footer: `gh-section-footer`
- Labels: `gh-form-label`
- Helper text: `gh-form-caption`
- Protocol buttons: `gh-btn gh-btn-sm`, active as `gh-btn-primary`
- Checkbox rows: `gh-checkbox-row`

- [ ] **Step 4: Normalize preview and publish panels**

Update preview result rows to use `gh-box-row` or `gh-inset-panel` with stable action buttons. Replace green custom publish URL panel with `gh-alert gh-alert-success` and `gh-code-block` for the URL.

- [ ] **Step 5: Normalize region browser modal**

Keep modal behavior unchanged. Use `gh-icon-button` for close, `gh-input` for search, and 6px rounded cards instead of `rounded-lg`.

- [ ] **Step 6: Run focused source test and check**

Run:

```bash
bun test src/routes/aggregate/page-source.test.ts
bun run check
```

Expected: both commands exit `0`.

- [ ] **Step 7: Commit Aggregate page**

Run:

```bash
git add src/routes/aggregate/+page.svelte src/app.css
git commit -m "Redesign aggregate workflow UI"
```

Expected: commit succeeds.

## Task 5: Exports Page

**Files:**
- Modify: `src/routes/exports/+page.svelte`
- Modify: `src/app.css`

- [ ] **Step 1: Add Exports page header**

Wrap content in `gh-page`. Add:

```svelte
<header class="gh-page-header">
	<div class="gh-page-heading">
		<h1 class="gh-page-title">{$t("Exports")}</h1>
		<p class="gh-page-subtitle">
			{$t("Generate, inspect, download, copy, and publish sing-box client configuration profiles.")}
		</p>
		<div class="gh-page-meta">
			<span class="gh-page-meta-item">{$t("{count} profiles", { count: profileCount })}</span>
			<span class="gh-page-meta-item">{$t("{count} outbounds", { count: outboundCount })}</span>
			<span class="gh-page-meta-item">{$t("{count} warnings", { count: previewWarnings.length })}</span>
		</div>
	</div>
	<div class="gh-page-actions">
		<button class="gh-btn" type="button" on:click={copyPreview} disabled={!selectedProfile}>
			<Octicon icon={copy} className="h-4 w-4" />
			{$t("Copy")}
		</button>
		<button class="gh-btn" type="button" on:click={downloadPreview} disabled={!selectedProfile}>
			<Octicon icon={download} className="h-4 w-4" />
			{$t("Download")}
		</button>
		<button class="gh-btn gh-btn-primary" type="button" on:click={publishPreview} disabled={publishDisabled}>
			<Octicon icon={upload} className="h-4 w-4" />
			{publishing ? $t("Publishing...") : $t("Publish")}
		</button>
	</div>
</header>
```

Remove the old large section header actions to avoid duplication.

- [ ] **Step 2: Split editor and preview into workbench panels**

Use:

```svelte
<div class="gh-layout-sidebar lg:grid-cols-[minmax(0,1fr)_360px]">
	<div class="gh-layout-main">
		<section class="gh-box !overflow-visible">...</section>
		<section class="gh-box">...</section>
	</div>
	<aside class="gh-layout-aside">...</aside>
</div>
```

Put profile editor in the main column, generated JSON preview in the main column below it, and summary/warnings/errors in the aside.

- [ ] **Step 3: Normalize form labels and actions**

Use `gh-form-label`, `gh-form-caption`, `gh-checkbox-row`, `gh-section-body`, and `gh-section-footer`. Keep all input IDs and handlers unchanged.

- [ ] **Step 4: Normalize warning and error display**

Render warning and error lists with:

```svelte
{#if previewWarnings.length > 0}
	<div class="gh-alert gh-alert-attention">...</div>
{/if}
{#if previewErrors.length > 0}
	<div class="gh-alert gh-alert-danger">...</div>
{/if}
```

Use normal text colors from tokens rather than missing utility colors such as `text-attention-fg`.

- [ ] **Step 5: Run focused source test and check**

Run:

```bash
bun test src/routes/exports/page-source.test.ts
bun run check
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit Exports page**

Run:

```bash
git add src/routes/exports/+page.svelte src/app.css
git commit -m "Redesign exports profile UI"
```

Expected: commit succeeds.

## Task 6: Gists Page

**Files:**
- Modify: `src/routes/gists/+page.svelte`
- Modify: `src/app.css`

- [ ] **Step 1: Add Gists page header**

Wrap content in `gh-page`. Add:

```svelte
<header class="gh-page-header">
	<div class="gh-page-heading">
		<h1 class="gh-page-title">{$t("Gists")}</h1>
		<p class="gh-page-subtitle">
			{$t("Inspect workspace files, copy raw links, and manage published outputs in the active gist.")}
		</p>
		<div class="gh-page-meta">
			<span class="gh-page-meta-item">{$t("{count} files", { count: workspaceFileCount })}</span>
			{#if workspaceUpdatedText}
				<span class="gh-page-meta-item">{$t("Updated {time}", { time: workspaceUpdatedText })}</span>
			{/if}
		</div>
	</div>
	<div class="gh-page-actions">
		<button type="button" class="gh-btn gh-btn-primary" on:click={refreshWorkspace} disabled={loading}>
			<Octicon icon={sync} className={cn("h-4 w-4", loading && "animate-spin")} />
			{$t("Refresh")}
		</button>
	</div>
</header>
```

Remove duplicate refresh button from the file-list header or leave it as `gh-btn gh-btn-sm` only if needed.

- [ ] **Step 2: Normalize layout and sidebar**

Use `gh-layout-sidebar`. Keep active gist ID display and GitHub link in the aside. Use `gh-code-block` for the gist ID.

- [ ] **Step 3: Normalize file list**

Keep refresh/copy/open/delete behavior unchanged. Use `gh-box`, `gh-box-header`, `gh-list-header`, `gh-box-row`, `gh-row-main`, `gh-row-actions`, `gh-label`, and `badge-success`.

- [ ] **Step 4: Run focused source test and check**

Run:

```bash
bun test src/routes/gists/page-source.test.ts
bun run check
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit Gists page**

Run:

```bash
git add src/routes/gists/+page.svelte src/app.css
git commit -m "Redesign gist file UI"
```

Expected: commit succeeds.

## Task 7: Settings/Auth Page

**Files:**
- Modify: `src/routes/auth/+page.svelte`
- Modify: `src/app.css`

- [ ] **Step 1: Add Settings page header**

Wrap content in `gh-page`. Add:

```svelte
<header class="gh-page-header">
	<div class="gh-page-heading">
		<h1 class="gh-page-title">{$t("Settings")}</h1>
		<p class="gh-page-subtitle">
			{$t("Connect a GitHub Gist workspace, resolve sync conflicts, and import or export local JSON state.")}
		</p>
		<div class="gh-page-meta">
			<span class={cn("gh-page-meta-item", $authState.token && "badge-success")}>
				{$authState.token ? $t("Token active") : $t("Local mode")}
			</span>
			{#if $appState.activeGistId}
				<span class="gh-page-meta-item font-mono">{$appState.activeGistId}</span>
			{/if}
		</div>
	</div>
</header>
```

- [ ] **Step 2: Replace conflict custom orange styling**

Use:

```svelte
<section class="gh-alert gh-alert-attention" transition:slide>
	<Octicon icon={alert} className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--attention-emphasis)]" />
	<div class="min-w-0 flex-1 space-y-3">
		<div>
			<h2 class="text-sm font-semibold">{$t("Sync Conflict")}</h2>
			<p class="text-sm text-fg-muted">
				{$t("Remote and local data differ. Choose which side becomes the source of truth.")}
			</p>
		</div>
		...
	</div>
</section>
```

Keep the same three action handlers.

- [ ] **Step 3: Normalize workspace and data panels**

Use `gh-section`, `gh-section-header`, `gh-section-body`, and `gh-section-footer`. Replace custom green/orange classes with `badge-success`, `gh-alert-success`, and `gh-btn-danger`.

- [ ] **Step 4: Run focused source test and check**

Run:

```bash
bun test src/routes/auth/page-source.test.ts
bun run check
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit Settings page**

Run:

```bash
git add src/routes/auth/+page.svelte src/app.css
git commit -m "Redesign workspace settings UI"
```

Expected: commit succeeds.

## Task 8: Final Verification And Polish

**Files:**
- Modify as needed: `src/app.css`
- Modify as needed: touched route files

- [ ] **Step 1: Run full checks**

Run:

```bash
bun run check
bun run build
bun run lint
```

Expected: `check` and `build` exit `0`. `lint` exits `0`, or any findings are fixed before continuing.

- [ ] **Step 2: Start local dev server**

Run:

```bash
bun run dev -- --host 0.0.0.0
```

Expected: Vite prints a local URL, usually `http://localhost:5173/`.

- [ ] **Step 3: Browser verification**

Open these routes at desktop width and mobile width:

- `/`
- `/nodes`
- `/aggregate`
- `/exports`
- `/gists`
- `/auth`

Check:

- No horizontal overflow.
- Top nav remains usable.
- Light and dark theme controls work.
- Buttons, inputs, tabs, dropdowns, checkbox rows, modals, empty states, and toasts share the Primer look.
- Long gist IDs, raw URLs, proxy URIs, and JSON preview do not widen the page.

- [ ] **Step 4: Interaction smoke tests**

Exercise:

- Overview: click a next-action link.
- Nodes: switch tabs, type in filter, open New Resource, close it.
- Aggregate: open rule menu and one source menu, open region browser, close it.
- Exports: click Generate Preview when a profile exists or confirm empty state when not.
- Gists: click Refresh if workspace credentials exist, otherwise verify empty state.
- Settings: open token input/local data controls and verify conflict area styling if conflict state is reachable.

- [ ] **Step 5: Commit final polish**

If final verification required fixes, commit them:

```bash
git add src/app.css src/routes/+layout.svelte src/routes/+page.svelte src/routes/nodes/+page.svelte src/routes/aggregate/+page.svelte src/routes/exports/+page.svelte src/routes/gists/+page.svelte src/routes/auth/+page.svelte
git commit -m "Polish Primer UI responsiveness"
```

Expected: commit succeeds if there were changes. If there were no changes, do not create an empty commit.

## Self-Review

- Spec coverage: Tasks cover global design system, app shell, Overview, Nodes, Aggregate, Exports, Gists, Settings/Auth, responsiveness, accessibility, and verification.
- Placeholder scan: No `TBD`, `TODO`, or unbounded "implement later" steps remain.
- Type consistency: All referenced variables and handlers already exist in their route files; new class names are defined in `src/app.css`.
