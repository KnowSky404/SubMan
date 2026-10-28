# Changelog

English | [简体中文](Changelog.zh-CN.md)

Record meaningful product, maintenance, and migration changes here, newest first.
Update both languages in the same commit. Entries describe repository changes;
production deployment and real-provider acceptance require separate evidence.

## Unreleased

### 2026-10-28 - Primer interface and interaction system

- Unified the six routes around the approved GitHub-style concepts: white/dark
  main canvases, clearer page headings, open filter bars, one resource heading
  band, content-sized overview columns, and consistent editor/publication layouts.
- Added shared dialogs, copy acknowledgement, asynchronous action feedback,
  animated navigation, disclosure and surface transitions, and reduced-motion
  handling. Mobile editors use accessible bottom sheets with fixed action footers.
- Kept cloud confirmation authoritative: pending, retrying, blocked, and uncertain
  results retain drafts; only confirmed remote commits receive success feedback.
- Fixed automatic theme resolution before first paint and when the system
  preference changes, while keeping explicit light/dark preferences authoritative.
- Preserved the public API, Workspace schema, persistence, and delivery protocol.


### 2026-10-27 - UI hierarchy and interaction polish

- Separated the linked brand toolbar from navigation, aligned the header with the
  page, and added visible cloud status, accessible tooltips, keyboard theme controls,
  and a navigation overflow control on narrow screens.
- Restored primary-button emphasis in dark mode and readable list metadata;
  removed duplicate node actions/status, fixed search spacing and filtered empty
  states, enlarged touch actions, and made available Gist filenames real links.
- Adapted the overview to recent resources and confirmed publication metadata;
  retained empty-workspace onboarding. Grouped advanced rule options and explained
  save, preview, target, and publication prerequisites without changing cloud writes.
- Completed Chinese labels on these surfaces and localized resource timestamps;
  kept browser test fixtures reusable and screenshots isolated per test.


### 2026-10-26 - Simplified application chrome

- Replaced header status badges, Gist ID, and setup button with a compact status
  icon, theme control, and GitHub link; retained accessible labels, hover text,
  pending/error indicators, and the repair shortcut.
- Removed repeated page descriptions and summary badges, overview status panels,
  the Gist information sidebar, and the export summary card. Kept actionable
  warnings, publication links, and counts beside the relevant lists.
- Made overview counts navigable and kept the header on one row on small screens.

### 2026-10-26 - Worktree and PR development workflow

- Adopted FlareMail's task isolation, current-head Codex review, rebase merge,
  main verification/sync, and merged worktree/branch cleanup conventions.
- Added a PR template and bilingual workflow instructions, including conditional
  remote branch deletion and rebase-aware integration checks.
- Kept SubMan's CI, Bun version, and publication/deployment authorization rules;
  repository instructions do not configure GitHub review integrations or rulesets.

### 2026-10-26 - API and sing-box-vps compatibility review

- Clarified tiered Gist discovery and nonempty PATCH inputs in OpenAPI and the
  bilingual API and agent references; added a PATCH schema contract check.
- Documented the explicit-ID requirement for object tags whose labels normalize
  to empty IDs; string tags remain the recommended caller format.
- Rechecked sing-box-vps `9bac47e` against SubMan `ed6fa5a`; documented its
  nonportable response-header parser alongside key, tag, and expected-Gist gaps,
  with mock-based adaptation acceptance criteria.
- Linked the integration guide from both READMEs and aligned operations and
  deployment checklists with the documentation gate. Runtime API behavior is unchanged.

### 2026-10-23 - Repository and documentation cleanup

- Shortened the English and Chinese READMEs; moved detailed usage and development
  instructions into the bilingual Wiki.
- Added generated Wiki pages, language navigation, and local documentation checks.
- Standardized `DESIGN.md`, kept `AGENTS.md` as the project agent entry, and removed
  duplicate agent files and the obsolete root log.
- Archived dated designs and plans under `docs/archive/`; moved brand source artwork
  out of the production static directory.
- Removed unused manual-sync, timestamp-merge, and legacy browser-mutation modules,
  their obsolete tests, the empty library barrel, and the unused Lucide dependency.

## Earlier development milestones

- [Single cloud source](https://github.com/KnowSky404/SubMan/commit/9c5ab76): one
  device binding, fresh cloud reads, immediate revisioned delivery, and cloud-confirmed saves.
- [API key preservation](https://github.com/KnowSky404/SubMan/commit/7a5cb8f): preserved
  external node keys and aligned the public integration contract.

The former root log described the initial browser-focused prototype: GitHub Gist
storage, node/subscription aggregation, renaming and filtering, Svelte, Tailwind,
and Bun. It was a project brief rather than release history. The current product
also uses a Cloudflare Worker and Durable Object; the old brief is retained in Git history.
