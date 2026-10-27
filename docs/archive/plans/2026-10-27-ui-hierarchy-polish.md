# UI hierarchy and interaction polish

## Scope and isolation

- Worktree: `/root/Clouds/SubMan-ui-polish`
- Branch: `feat/ui-hierarchy-polish`
- Base: `e015b6f650abfe8c3aa89cbf9c741495f783e465`
- Preserve the existing Primer palette, Svelte architecture, single cloud binding,
  persistence boundary, and cloud-confirmed operation semantics.
- Local implementation and commit are authorized. Remote publication, merging,
  Wiki publication, and production deployment require separate authorization.

## Implementation

1. Separate the brand toolbar and navigation with distinct surfaces and borders.
   Align both with the content, enlarge the home-linked brand, surface connection
   and pending states as text, and make overflowing navigation discoverable.
2. Provide shared, viewport-aware tooltips for icon actions with hover, keyboard
   focus, Escape dismissal, and cleanup. Complete theme-menu keyboard behavior.
3. Restore dark primary-button emphasis, readable metadata, useful row hover and
   focus states, search-icon spacing, larger touch controls, distinct filtered
   empty states, and honest file-link affordances. Remove duplicate list actions
   and status metadata without hiding the cloud confirmation state.
4. Adapt the overview to existing data with recent resources and publication
   targets. Derive published URLs and dates from the confirmed binding baseline;
   retain onboarding for empty workspaces and avoid a new activity storage path.
5. Group aggregation inputs into sources and optional advanced configuration.
   Keep existing non-default configuration discoverable, preserve drafts and
   protocol behavior, and explain saved rules, targets, and publication prerequisites.
6. Update both Wiki changelogs and verify the final patch before an atomic
   Conventional Commit.

## Validation

- Bun 1.3.14; independent dependencies, generated output, Worker state, browser
  contexts, and development ports in this worktree.
- Run docs checks, unit tests, Svelte/Worker type checks, lint, production build,
  and affected Worker/browser checks. Use local mock Gists only.
- Browser plugin is unavailable; use Playwright Chromium. Verify all six routes,
  light/dark themes, English/Chinese, desktop/mobile, tooltip hover/focus/Escape,
  navigation overflow, theme keyboard interaction, search reset, file links,
  overview states, and advanced configuration visibility.
- Inspect screenshots and console output. Record outcomes and limitations in the
  handoff; retain the task worktree for review and any later authorized PR.

## Execution record

- Implemented all six steps with the existing design tokens and Octicons. Added
  no dependency, business storage, public API, or cloud mutation behavior.
- Passed 679 unit tests, documentation validation (37 bilingual pages), Svelte and
  Worker type checks (zero errors/warnings), lint, production builds, eight local
  Cloudflare integration tests, the sing-box 1.14 check (15 generated outbounds),
  and the local deployment-bundle dry run.
- Passed the full 56-case Playwright suite with one worker, matching CI. After
  the final tooltip-listener cleanup, the eight UI cases and two settings cases
  passed again. The five migration variants passed after fixing a test-only race
  between checking readiness and interacting with a disappearing migration panel.
- Exploratory parallel runs exposed timing-sensitive existing delivery cases;
  isolated checks passed on both the original baseline and the task branch.
  Production delivery and migration behavior was preserved.
- Inspected all six routes at 1440px and narrow layouts at 390px and 320px, in
  light/dark themes and English/Chinese. Browser console checks found no app
  errors or warnings; no page overflow or framework error overlay was observed.
- Temporary browser artifacts and logs are outside the source worktree in
  `/tmp/subman-ui-polish-qa`. Real GitHub Gists and production were not accessed.
- Delivery remains a local task commit and retained worktree. Push, PR review,
  merge, main sync, and merged-branch cleanup have not been authorized.
