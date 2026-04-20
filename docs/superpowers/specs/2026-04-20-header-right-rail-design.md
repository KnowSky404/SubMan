# Header Right Rail Layout for SubMan

## Overview
This design rebalances the global repository header so the `nodes / rules / live links` summary no longer competes with the title block for horizontal space. The goal is to move those summary chips into a dedicated right-side rail, reduce crowding in the center of the header, and make the page body feel wider without changing the overall information architecture.

## Architecture

### Header Structure
The global repository header in [`src/routes/+layout.svelte`](/root/Clouds/SubMan/src/routes/+layout.svelte) will keep the existing two-tier layout:

1. The dark top bar remains unchanged except for preserving existing controls.
2. The white repository bar is split into two clear columns on desktop:
   - Left column: project title, visibility badge, workspace/local state, active gist identifier
   - Right column: summary stats (`nodes`, `rules`, `live links`) and the workspace management button

This keeps the title column readable and moves the compact, glanceable metrics into a right rail where they do not reduce the usable width of the title area.

### Responsive Behavior
Desktop and tablet widths should render the stats as a compact block in the right rail. Smaller screens should collapse the layout back into a stacked flow so the title information remains readable and no chip group becomes horizontally cramped.

The responsive rule is:
- Desktop: two-column header with right rail stats
- Mobile: stacked layout with stats below the title block and above the action button if needed

### Width Adjustment
The shared container width in [`src/app.css`](/root/Clouds/SubMan/src/app.css) will be widened one step so the main content column gains more horizontal room across the application. This is intentionally small in scope: widen the existing shared layout shell rather than introducing page-specific width rules.

## Component Changes

### `src/routes/+layout.svelte`
- Move the `gh-page-meta` stat group out of the left metadata stack
- Add a dedicated right-rail container for:
  - `gh-page-meta`
  - `Manage Workspace` / `Setup GitHub` button
- Preserve existing derived values such as `livePublishCount` and workspace connection state

### `src/app.css`
- Update the shared max-width used by `.app-header-inner`, `.app-repo-inner`, and `.app-main-container`
- Add or adjust layout rules for the repository metadata area so the right rail has a stable width on larger screens and wraps cleanly on smaller screens
- Keep the visual language aligned with the current GitHub-inspired shell

## Testing Strategy
- Add a source-layout test in [`src/routes/layout-source.test.ts`](/root/Clouds/SubMan/src/routes/layout-source.test.ts) that verifies the stat group is rendered in a dedicated right-rail container rather than inside the left metadata column
- Run the focused Bun source test
- Run Svelte type checking to catch layout or class-name regressions

## Success Criteria
- The repository header no longer places `nodes / rules / live links` under the title block on desktop
- The stats appear in a right-side cluster together with the workspace action button
- The shared page shell is visibly wider than before
- Mobile layout still stacks cleanly without overlapping or compressed controls
