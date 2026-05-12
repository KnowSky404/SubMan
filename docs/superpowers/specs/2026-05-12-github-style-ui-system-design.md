# GitHub-Style UI System Refresh for SubMan

## Overview
SubMan already uses a GitHub-like palette, Octicons, and repository-style framing, but several interaction patterns still feel like a generic admin dashboard. This design keeps the product optimized for SubMan's workflow while aligning the component language with GitHub: compact toolbars, grouped buttons, stable list actions, denser forms, restrained labels, and clearer panel structure.

The goal is not a pixel-for-pixel GitHub clone. The goal is to make common workflows feel closer to GitHub's repository, gist, issue-list, and settings interfaces while preserving SubMan's direct management flow.

## Scope

### In Scope
- Global component classes in [`src/app.css`](/root/Clouds/SubMan/src/app.css)
- Global repository shell in [`src/routes/+layout.svelte`](/root/Clouds/SubMan/src/routes/+layout.svelte)
- Main workspace pages:
  - [`src/routes/+page.svelte`](/root/Clouds/SubMan/src/routes/+page.svelte)
  - [`src/routes/nodes/+page.svelte`](/root/Clouds/SubMan/src/routes/nodes/+page.svelte)
  - [`src/routes/aggregate/+page.svelte`](/root/Clouds/SubMan/src/routes/aggregate/+page.svelte)
  - [`src/routes/gists/+page.svelte`](/root/Clouds/SubMan/src/routes/gists/+page.svelte)
  - [`src/routes/auth/+page.svelte`](/root/Clouds/SubMan/src/routes/auth/+page.svelte)
- Source-level tests that assert key structural conventions for the refreshed UI

### Out of Scope
- Data model changes
- GitHub API behavior changes
- New UI framework or heavy component library
- Marketing-style home page redesign
- Pixel-perfect GitHub recreation

## Design Direction

### Global Component Language
Add a small set of reusable CSS primitives that map to GitHub interaction patterns:

- `gh-toolbar`: a compact horizontal control strip with wrapping behavior on small screens.
- `gh-btn-group`: adjacent buttons share borders and read as one action cluster.
- `gh-action-list`: row and menu action styling for icon-heavy controls.
- `gh-filter-bar`: tab, search, status filter, and primary action alignment.
- `gh-section`: settings-style sections with title, description, body, and footer.
- `gh-counter`: compact count badges used inside tabs and headers.
- `gh-label`: restrained protocol/tag labels that do not visually compete with primary content.
- `gh-dropdown-menu`: GitHub-like floating menu panels for multi-select and quick actions.

Existing `gh-btn`, `gh-box`, `gh-input`, `gh-select`, `gh-tabs`, and `gh-underlinenav` remain, but their spacing, hover, active, disabled, and focus states should become more consistent.

### Buttons and Actions
Buttons should follow GitHub's visual hierarchy:

- Primary action: one green button per local task area when possible.
- Secondary actions: gray buttons, grouped when shown side by side.
- Destructive actions: restrained red text/border by default, stronger only on hover or confirmation.
- Icon-only actions: stable square dimensions, consistent tooltip/title/aria labels, and no layout shift.
- Row actions: visible enough to be discoverable, but visually subordinate to row content.

This replaces the current mixture of isolated buttons, hover-only buttons, and select-like buttons used as menus.

### Lists
Nodes, subscriptions, gist files, and preview results should use a consistent GitHub list pattern:

- A header row describes the list and its visible result count.
- A filter/action bar sits above the list, not as a separate unrelated block.
- Each row has a clear primary link/title, compact metadata below, labels beside the title, and actions aligned to the right.
- Rows keep stable height and spacing when actions appear.
- Empty states use GitHub-style blankslates with one clear next action.

### Forms
Forms should feel like GitHub settings and repository forms:

- Section titles are smaller and denser than page headings.
- Help text is muted and close to the field it explains.
- Submit/cancel controls live in a footer band when the form is boxed.
- Boolean options use compact checkbox rows.
- Multi-select menus use dropdown panels with search, select-visible action, and checkboxes.

## Page-Level Design

### Layout Shell
The dark top bar, repository identity bar, and underline navigation stay in place. Refinements focus on polish:

- Header controls use button-group and icon-button conventions.
- Workspace status uses a compact label/counter style rather than large chip clusters.
- The repository shell should not add decorative card nesting.

### Overview
The overview remains a dashboard, but the cards should read more like GitHub summary boxes:

- Keep "At a glance", "Workflow", and "Current state".
- Reduce oversized icon tiles.
- Use compact counters and row-based summaries.
- Keep the right sidebar for "About" and workspace status, but reduce visual weight.

### Nodes
Nodes is the highest-value interaction page and should get the strongest UI lift:

- Use a single filter bar containing the Nodes/Subscriptions tabs, search input, status select, and `New resource` primary button.
- Tabs show compact counters with `gh-counter`.
- The add panel uses a boxed form with tabs and a GitHub-style footer.
- List rows use stable actions: edit, copy, preview where applicable, delete grouped on the right.
- Enabled/disabled toggles use a compact checkbox-like control, not a custom colored square that reads differently across pages.
- Protocol and tag displays use `gh-label` instead of heavy pill badges.
- Inline editors use a nested form band inside the row, with a compact footer and no unrelated card styling.

### Aggregate
Aggregate should behave like a GitHub settings page with a functional builder:

- Main rule editor remains the primary column.
- Publish settings remain a right sidebar.
- Rule selector and new-rule action use a compact toolbar in the panel header.
- Source node/subscription selectors use `gh-dropdown-menu` and consistent action rows.
- Protocol filters use segmented buttons or labels that look selectable but not like primary actions.
- Preview results use a list pattern with drag handle, protocol label, name, and copy action.
- Save, preview, and delete controls live in a panel footer with clear hierarchy.

### Gists
Gists should feel closer to a gist/repository file list:

- Workspace metadata becomes a compact sidebar section.
- File list row layout keeps filename as primary content, kind label, size, and a right-aligned button group.
- Raw URL is shown as muted monospace metadata.
- Config file is visually distinguished without oversized badges.

### Settings
Settings should follow GitHub settings section conventions:

- GitHub Workspace and Data Management become `gh-section` blocks.
- Connection status is shown with a state label in the section header.
- Token entry uses an input plus grouped actions.
- Connected state shows gist id, pull, and disconnect in a compact row.
- Conflict resolution remains prominent but uses GitHub-style warning colors and action cards.

## Testing Strategy
Because this is mostly Svelte markup and CSS, tests should focus on stable source conventions rather than brittle visual snapshots:

- Add/update source tests to assert the new component primitives are present in key pages.
- Check that Nodes uses a unified filter bar and grouped row actions.
- Check that Aggregate uses dropdown-menu primitives for source selectors and a footer action area.
- Check that Settings uses section primitives for workspace and data management.
- Run the existing Bun test suite or focused source tests.
- Run Svelte checking/build verification before completion.

Manual verification should cover:

- Desktop and mobile layouts for Nodes, Aggregate, Gists, and Settings.
- Light and dark theme contrast.
- Long node names, raw URLs, tags, and gist raw links.
- Hover/focus/disabled states for primary, secondary, destructive, and icon buttons.

## Success Criteria
- The UI reads as GitHub-inspired in interaction and density, not only in color.
- Buttons and row actions are consistent across pages.
- Nodes and Gists lists feel like GitHub file/issue lists.
- Aggregate and Settings feel like GitHub form/settings pages.
- No business logic behavior changes are introduced.
- Existing source and Svelte checks pass after implementation.
