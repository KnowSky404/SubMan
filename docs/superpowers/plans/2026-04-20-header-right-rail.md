# Header Right Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the global header stats into a dedicated right rail and widen the shared page shell so content areas use more horizontal space.

**Architecture:** Keep the existing two-tier global shell, but split the white repository bar into a left metadata column and a right utility rail. Update the shared shell width in `src/app.css` so the improvement applies consistently across pages. Validate the structural change with a source-based test before implementing the layout.

**Tech Stack:** Svelte 5, TypeScript, Bun test, Tailwind utility classes plus shared CSS in `src/app.css`.

---

### Task 1: Lock the Expected Header Structure

**Files:**
- Modify: `src/routes/layout-source.test.ts`
- Test: `src/routes/layout-source.test.ts`

- [ ] **Step 1: Write the failing source test**

```typescript
test("repo header renders stats in a dedicated right rail", () => {
	expect(layoutSource).toContain('class="app-repo-side"');
	expect(layoutSource).toContain('class="app-repo-side-meta"');
	expect(layoutSource).toContain('class="app-repo-tools app-repo-tools-stack"');
	expect(layoutSource).not.toContain('<div class="flex min-w-0 flex-col gap-2">\\n\\t\\t\\t\\t\\t<div class="app-repo-title">');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test src/routes/layout-source.test.ts`
Expected: FAIL because the new right-rail containers are not present in `src/routes/+layout.svelte`

- [ ] **Step 3: Commit**

```bash
git add src/routes/layout-source.test.ts
git commit -m "test: capture right-rail header layout"
```

---

### Task 2: Implement the Header Layout

**Files:**
- Modify: `src/routes/+layout.svelte`
- Modify: `src/app.css`
- Test: `src/routes/layout-source.test.ts`

- [ ] **Step 1: Move header stats into a right-side layout container**

```svelte
<div class="app-repo-meta">
	<div class="app-repo-main">
		<!-- title and workspace metadata -->
	</div>

	<div class="app-repo-side">
		<div class="app-repo-side-meta">
			<div class="gh-page-meta">
				<!-- nodes / rules / live links -->
			</div>
		</div>

		<div class="app-repo-tools app-repo-tools-stack">
			<a href="/auth" class={cn("gh-btn", !isWorkspaceConnected && "gh-btn-primary")}>
				{isWorkspaceConnected ? $t("Manage Workspace") : $t("Setup GitHub")}
			</a>
		</div>
	</div>
</div>
```

- [ ] **Step 2: Widen the shared shell and add responsive right-rail styles**

```css
.app-header-inner,
.app-repo-inner,
.app-main-container {
	@apply mx-auto w-full max-w-[92rem] px-4 sm:px-6 lg:px-8;
}

.app-repo-main {
	@apply flex min-w-0 flex-1 flex-col gap-2;
}

.app-repo-side {
	@apply flex w-full flex-col gap-3 lg:w-auto lg:min-w-[17rem] lg:items-end;
}

.app-repo-side-meta {
	@apply flex w-full justify-start lg:justify-end;
}

.app-repo-tools-stack {
	@apply w-full justify-start lg:w-auto lg:justify-end;
}
```

- [ ] **Step 3: Run the focused layout test and verify it passes**

Run: `bun test src/routes/layout-source.test.ts`
Expected: PASS

- [ ] **Step 4: Run type checking for the updated shell**

Run: `bun run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/+layout.svelte src/app.css src/routes/layout-source.test.ts
git commit -m "feat: move header stats into right rail"
```
