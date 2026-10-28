# Primer interface and interaction system

## Isolation and approved references

- Worktree: `/root/Clouds/SubMan-premium-ui`
- Branch: `feat/primer-interaction-system`
- Base: `4e01863dd5f9f378ec035099d26049ae86c2f6ca`
- The user approved all six routes and subtle, perceptible interaction motion.
- Approved planning artwork, generated with the built-in image tool:
  [nodes](../../assets/ui/2026-10-28/nodes-concept.png),
  [aggregation](../../assets/ui/2026-10-28/aggregate-concept.png), and
  [mobile editing](../../assets/ui/2026-10-28/mobile-edit-concept.png).
- The mobile drag handle is intentionally omitted, as approved. Demo records
  in the artwork are not application defaults or a source of business data.
- Local implementation, verification, and atomic commits are authorized.
  Remote publication, merging, Wiki publication, and deployment remain separate.

## Extracted design system

- Main backgrounds: true white `#ffffff`, dark `#0d1117`; subtle surface
  `#f6f8fa` / `#161b22`; neutral border `#d0d7de` / `#30363d`.
- Retain existing blue links, green primary actions, coral active underlines,
  semantic attention/danger colors, and first-paint theme behavior.
- System sans and local CJK fallbacks; monospace for URI/configuration content.
  Strong page headings, 18px resource titles, readable 12-14px metadata,
  consistent 40px desktop controls, and 44px narrow-screen touch targets.
- Restrained 6px controls and 8px dialog geometry; 12px top sheet corners.
  Use fine rules for lists and form groups and reserve elevation for overlays.
- Existing Octicons supply navigation, status, search, chevrons, edit, copy,
  delete, preview, publication, and dismiss actions. The existing brand is reused.
- Existing shared components and new page header, dialog, action button, copy
  button, and operation feedback primitives own repeated behavior.
- Native Svelte/HTML/CSS render every control and string. Artwork is reference
  evidence only; no generated UI bitmap appears in the product.

## Content and interaction inventory

- Keep navigation meaning: Overview, Nodes, Aggregate, Exports, Gists, Settings.
  Keep connected, pending, loading, and repair status visible and truthful.
- Nodes retain source tabs, filtering, creation, import, enable, edit, preview,
  copy, and delete. Header copy: "Manage nodes and subscription sources."
- Aggregation retains all source/rule fields, advanced options, preview and
  sorting, target CRUD, publication, and save-and-publish. Header copy:
  "Combine sources, preview rules, and publish output."
- Exports retain profile CRUD, preview generation, copy/download, publication,
  and confirmed remote links. Gists retain safe file ownership/deletion rules.
  Settings retain authentication, migration preview/confirmation, and recovery.
- Cloud gating, Workspace identity, mutation IDs, revisions, journaling, and
  confirmed publication baselines continue through the existing boundaries.
- Shared operation feedback is derived in the presenter. Button busy state
  prevents duplicate submission; pending/attention never imply remote success.
- Dialogs trap/restore focus, make background content inert, lock scrolling,
  and expose keyboard and visible close actions. Menus retain keyboard behavior.
- Reduced motion removes decorative transitions and movement while retaining
  state text and progress meaning. Rapid interactions cancel obsolete animation.

## Validation

Use Bun 1.3.14 and isolated dependencies, output, local Worker state, browser
contexts, and ports. Browser plugin is absent; use Playwright Chromium.
Validate all six routes, both themes/languages, native concept sizes, desktop,
tablet, 390px/320px layouts, normal/reduced motion, and slow/error/confirmed
cloud states. No production credentials or real Gists are used. The completed
execution evidence follows.

## Implementation and local verification

The implementation uses shared native Svelte components and actions. No runtime
dependency was added. The public API, Workspace document, storage boundaries,
mutation protocol, and credential handling are unchanged. Automatic theme mode
now applies the resolved palette both before first paint and after an OS theme
change; the first-paint nonce and response security headers remain intact.

All commands use Bun 1.3.14 in the isolated worktree. Local Workers and browser
fixtures use temporary state and synthetic Gist responses. Wrangler deployment
validation is a dry run; no production deployment or real-provider write occurs.

| Check | Result |
| --- | --- |
| `bun run docs:check` | 37 Wiki pages; paired languages and local links valid |
| `bun test` | 678 passed; 3,073 assertions |
| `bun run test:sing-box` | 15 generated outbounds valid with sing-box 1.14.0 |
| `bun run check` | No Svelte/type warnings or errors; Worker types reproducible |
| `bun run lint` | 203 files checked without fixes |
| `bun run build` | Production Worker and browser bundles built |
| `bun run test:cf` | 8 local Worker integration tests passed |
| `bun run deploy:check` | Wrangler 4.127.0 dry run completed |
| `bun run test:e2e` with isolated local Worker configuration | 63 Chromium tests passed |
| Responsive visual matrix | 96 views passed: six routes, two themes, two languages, four widths |

Browser verification uses installed Playwright Chromium because the Browser
plugin is unavailable. Its server lifecycle owns a local compiled Worker on
port 8467 and stops it after each run. Soft keyboard sizing is simulated through
VisualViewport events; physical iOS/Android keyboards and Safari/Firefox are
outside this local evidence.

The responsive matrix covers 1440px, 768px, 390px, and 320px. Browser evidence:

| Rendered check | Result |
| --- | --- |
| Page identity | All six final URLs and document titles match their routes after cloud readiness |
| Meaningful content | Route headings and the seeded business/settings content are present |
| Framework overlay | No development error overlay appears |
| Console health | No page errors or relevant console warnings/errors in the 96-view matrix |
| Screenshots | Desktop, narrow layouts, both themes, native reference sizes, edit and pending states captured and inspected |
| Interaction proof | Clipboard success/failure, held cloud confirmation, retry drafts, keyboard/focus, nested menu Escape, mobile scroll/keyboard sizing, rapid disclosure and theme preference tests pass |

The edit flow opens a resource, changes a draft, submits once, and holds the
mocked mutation response. The editor and loading action stay visible without a
success notice. Releasing cloud confirmation finalizes the draft and closes the
editor. Retryable delivery instead keeps the draft and pending presentation.
The clipboard flow shows its check only after a successful write and reports a
failed write without showing success.

The temporary Playwright configurations use the repository's `test:e2e` script
with `--config /tmp/subman-premium-ui-qa/playwright.theme.config.mts` for the
full suite and `--config /tmp/subman-premium-ui-qa/playwright.visual.config.mts`
for screenshots and geometry checks. Final visual checks also verify file
header/row column alignment and the rule picker's single-line desktop actions.

## Reference comparison

Compare the approved artwork directly with rendered screenshots at 1505x1045
(nodes), 1504x1045 (aggregation), and 390x844 (mobile editing). Generated artwork
supplies visual direction; controls, text, and business state remain native UI.

| Comparison point | Implemented result |
| --- | --- |
| Canvas and palette | White/dark main canvas, subtle masthead and list headings, fine neutral rules, blue links, green primary actions, coral active line |
| Shell and hierarchy | Two horizontal header bands, shared gutters, strong page heading and short description, actions in the same working context |
| Nodes list | Open filters, one heading band with enable meaning and counts, 18px resource names, readable metadata, aligned persistent row actions |
| Aggregation | Editor and preview share one surface; a 320px publication rail keeps target settings, publication actions, and confirmed output together |
| Controls and typography | 40px desktop controls, 44px mobile targets, restrained geometry, system sans/CJK fallbacks and monospace URI content |
| Mobile editing | Bottom sheet, focused first field, scrollable content, fixed footer, safe-area and VisualViewport sizing, background scroll lock and focus restoration |
| Feedback and motion | Sliding active line, short route/surface/disclosure motion, clipboard acknowledgement, truthful asynchronous action states, reduced-motion support |

Intentional differences from artwork:

- Keep actual timestamps, region flags, publication prerequisites, and existing
  rule/target deletion controls. Demo values do not replace application data.
- Use platform system fonts and existing Octicons. CJK glyph shapes and text
  metrics therefore differ from the raster concepts.
- Omit the approved decorative sheet drag handle. No drag-to-dismiss behavior
  is implied.
- At widths of 360px or less, move the project GitHub action beside navigation
  overflow to preserve the brand and connection controls without overlap.
- Retain a selectable full publication URI with visual ellipsis and a copy
  action. Confirmed publication metadata comes from the cloud baseline.

Temporary QA logs and screenshots remain under `/tmp/subman-premium-ui-qa` and
`/tmp/subman-premium-*.log`. Only the approved source artwork is versioned.
