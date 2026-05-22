# Primer UI Redesign Design

## Scope

Refactor the full SubMan user interface to follow the current GitHub Primer-style design system in `design.md`.

This work covers the app shell and all visible routes:

- Overview (`/`)
- Nodes (`/nodes`)
- Aggregate (`/aggregate`)
- Exports (`/exports`)
- Gists (`/gists`)
- Settings/Auth (`/auth`)

The redesign is limited to UI structure, component reuse, visual styling, responsive behavior, and interaction states. It must not change routes, persisted data shape, Gist workspace behavior, sync semantics, aggregation behavior, export generation, or API contracts.

## Design Direction

Use a Primer-native workbench model. The application should feel like a compact GitHub repository tool: practical, information-dense, accessible, and consistent.

The existing top repository masthead and underline navigation remain the app shell pattern, but they should be tighter and more uniform. Workspace state, theme controls, GitHub links, page actions, resource lists, settings panels, modals, dropdowns, and empty states should all use a shared Primer token and component language.

## Global Design System

Update the global UI foundation to match `design.md`.

- Use the system sans font stack from `design.md`; remove Roboto and Roboto Mono external imports.
- Keep the app at a stable 14px base size across breakpoints.
- Use the documented light and dark tokens for canvas, foreground, muted text, borders, accent, success, attention, and danger.
- Prefer 1px borders and subtle shadows over large elevation.
- Use 6px as the default radius. Larger radii should be rare and intentional.
- Keep letter spacing at `0` except for existing small uppercase labels where Primer-like metadata treatment needs it.
- Normalize buttons, icon buttons, tabs, selects, inputs, textareas, checkboxes, labels, counters, alerts, dropdowns, empty states, rows, and boxes under reusable `gh-*` classes.
- Make all focus states visible with an accent focus ring.
- Preserve Octicons as the icon family.

## App Shell

The shell should keep a repository-style hierarchy:

- Masthead with owner/repo identity, visibility label, workspace status, setup/manage workspace action, theme menu, and GitHub project link.
- Underline navigation with Overview, Nodes, Aggregate, Exports, Gists, and Settings.
- Main content constrained to the existing wide workbench width.

Changes:

- Compress masthead spacing so the first content area appears sooner.
- Make status labels and workspace id display use consistent Primer label/counter styles.
- Use icon-only buttons only for clearly recognizable actions, with accessible labels and titles where useful.
- Keep mobile navigation horizontally scrollable rather than replacing it with a hidden menu.

## Shared Page Pattern

Each route should follow a common structure:

- Page header with title, concise description, and optional metadata counters.
- Primary action placed in the header or first toolbar.
- Main content built from Primer boxes, rows, lists, and settings panels.
- Optional sidebar only when it adds durable status or context.

The page header should be implemented as shared markup/style rather than repeated one-off layouts where practical.

## Overview Page

Overview should act as a repository overview and operational summary.

Structure:

- Main column with workspace activity metrics, next actions, and publish status.
- Sidebar with workspace mode, enabled source counts, live link count, and sync readiness.

Style:

- Keep the current information content, but reduce visual variation between metric cards and normal boxes.
- Metrics should be compact and scannable, not decorative dashboard tiles.
- Next actions should read as a simple ordered workflow list with Primer links.

## Nodes Page

Nodes should become a resource management list.

Structure:

- Page header with resource counts and a New Resource primary action.
- Toolbar with Nodes/Subscriptions tabs, search, status filter, and add action.
- Resource list in GitHub issue/file-list style.
- Inline edit panels should be inset under the active row.
- Subscription preview should remain a modal/panel with Primer list styling.

Behavior:

- Keep add, batch import, edit, enable/disable, copy, delete, and preview behavior unchanged.
- Preserve current filters and active tab state behavior.
- Empty states should provide a single clear action.

## Aggregate Page

Aggregate should be a two-column workflow for rule definition and publish/preview context.

Structure:

- Page header with rule and target counts plus workspace status.
- Left/main column for Rule Definition.
- Right column for Preview, Publish Target, and publish state.
- Rule picker and multi-select menus should use consistent dropdown primitives.
- Protocol filters should use segmented Primer buttons.
- Preview rows should remain draggable and look like ordered list rows.

Behavior:

- Keep rule save, preview generation, drag ordering, publish target save, publish, copy, and built-in region rule insertion unchanged.
- Keep all current validation and toast behavior.

## Exports Page

Exports should become a profile editor plus generated config preview.

Structure:

- Page header with profile count and selected profile metadata.
- Profile selection and creation controls in a compact toolbar.
- Main editor panel for profile fields.
- Preview panel for generated JSON, counts, warnings, and errors.

Style:

- Warnings and errors use Primer alert/list styles.
- JSON preview uses monospace code blocks with stable height and wrapping rules.
- Publish/copy/download actions use consistent button groups.

Behavior:

- Keep profile creation, profile save, preview refresh, copy, download, and publish behavior unchanged.

## Gists Page

Gists should remain close to a GitHub repository file list.

Structure:

- Page header with active workspace status and file count.
- Sidebar for active gist id and GitHub link.
- Main file list with columns for name, kind, size, and actions.

Style:

- Workspace file should be visually marked as protected/config.
- Published files should use muted labels.
- Raw URL display should be compact and truncating.

Behavior:

- Keep refresh, copy raw URL, open raw URL, and delete file behavior unchanged.
- Keep `subman.json` protected from deletion.

## Settings/Auth Page

Settings should look like GitHub settings panels.

Structure:

- Conflict resolution alert appears first when active.
- GitHub Workspace panel for token entry or connected workspace controls.
- Data Management panel for import/export JSON.

Style:

- Conflict UI uses attention colors from tokens, not ad hoc orange classes.
- Connected workspace state uses success styling.
- Disconnect and destructive actions use danger styling.
- Data textarea uses monospace control styling.

Behavior:

- Keep token save, workspace ensure, conflict resolution choices, manual pull, manual push, disconnect, export, import, and copy behavior unchanged.

## Responsive Behavior

- Mobile uses a single-column layout on every page.
- Toolbars wrap cleanly without clipping controls.
- Lists collapse from column headers into stacked row metadata.
- Sidebar content moves below main content on small screens unless the route already has a better order.
- Text inside buttons, counters, labels, and rows must not overflow their containers.
- Long IDs, raw URLs, and proxy URIs must truncate or wrap inside code containers without pushing layout wider.

## Accessibility

- Preserve semantic buttons, links, labels, and inputs.
- Ensure icon-only controls have accessible names.
- Keep visible focus states on controls, menus, tabs, and links.
- Use `aria-current` for active navigation and selected tabs where appropriate.
- Preserve modal backdrop close behavior and confirm dialog roles.

## Testing And Verification

Run the existing test suite and source tests after implementation.

Required local verification:

- `bun run build`
- Existing route/source tests through the repository's configured test command.
- Browser verification at desktop and mobile widths for all six routes.
- Confirm no console errors during route navigation.
- Check light and dark themes.
- Exercise at least one core interaction per route:
  - Overview navigation link
  - Nodes tab/filter/add panel open
  - Aggregate rule picker or source menu open
  - Exports preview action
  - Gists refresh empty/loaded state where possible
  - Settings token/data panel controls

## Out Of Scope

- Business logic rewrites.
- Data model migrations.
- New routes.
- New cloud/GitHub API behavior.
- New subscription parsing or aggregation features.
- New dependency additions unless implementation discovers an existing UI dependency is missing and necessary.
