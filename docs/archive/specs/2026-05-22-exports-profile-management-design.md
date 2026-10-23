# Exports Profile Management Design

## Context

The Exports page already stores multiple client export profiles in
`appState.clientExports`, and the page header shows the profile count. The UI
only exposes those profiles through a compact selector inside the sing-box
client form. Once at least one profile exists, the current `New profile` action
also disappears because profile creation is gated on `clientExports.length ===
0`.

This creates a mismatch between the data model and the page experience: users
can see that profiles exist, but there is no obvious place to browse or manage
them, and there is no UI path to create a second profile.

## Goals

- Make existing export profiles visible and selectable from the Exports page.
- Allow users to create additional profiles whenever at least one Aggregate
  rule exists.
- Allow users to delete profiles with confirmation.
- Keep preview, copy, download, and publish behavior scoped to the selected
  profile.
- Keep the feature inside the Exports page instead of adding a new route.

## Non-Goals

- Do not add a separate `/exports/profiles` route.
- Do not change the `ClientExportProfile` data model.
- Do not change generated sing-box config behavior.
- Do not add profile duplication or bulk actions in this iteration.

## UX Design

The Exports page will replace the current profile selector-first experience
with an in-page Profiles management area using the existing GitHub Primer-like
visual system.

The sing-box client section will contain a Profiles list and the existing edit
form:

- The Profiles list shows each profile as a row with name, output file name,
  and source Aggregate rule name.
- Clicking a row selects that profile for editing and previewing.
- The selected row uses the existing accent treatment so users can see which
  profile is active.
- Each row has a delete action. Deleting requires the existing confirmation
  dialog.
- The section header or list toolbar always shows `New profile` when at least
  one Aggregate rule exists.

Empty states:

- If there are no Aggregate rules, keep the existing prompt to create one
  before exporting.
- If there are Aggregate rules but no profiles, show a concise empty state with
  `New profile` as the primary action.

The edit form remains the detail surface for the selected profile. Save,
Generate Preview, Copy, Download, and Publish continue to operate on the active
profile.

## Behavior

Profile creation:

- `New profile` creates a default sing-box client profile using the first
  Aggregate rule.
- The new profile is inserted into `clientExports`, selected immediately, and
  loaded into the draft form.
- Creation remains disabled only when there are no Aggregate rules.

Profile selection:

- If the selected profile still exists, it remains selected.
- If the selected profile is deleted or no longer exists, the page selects the
  first remaining profile.
- If no profiles remain, selection is cleared and preview state is reset.

Profile deletion:

- The delete action asks for confirmation.
- On confirmation, the profile is removed with `removeClientExport`.
- If the deleted profile was selected, the reactive selection fallback chooses
  the first remaining profile or clears selection.
- Preview content and validation state should not suggest that a deleted profile
  is still publishable.

Preview and publish:

- Preview generation continues to call `buildSingBoxClientConfig` with the
  selected profile and selected Aggregate rule.
- Publish gating remains based on token, selected profile, current preview
  signature, preview content, outbound count, and errors.
- Deleting or switching profiles invalidates stale preview state through the
  existing signature comparison and explicit clearing where needed.

## Implementation Notes

- Import and use `removeClientExport` from `src/lib/stores/app.ts`.
- Import the existing trash icon and confirmation store used elsewhere in the
  app.
- Keep changes focused in `src/routes/exports/+page.svelte` plus source tests.
- Prefer existing classes such as `gh-box-row`, `gh-row-main`, `gh-row-title`,
  `gh-list-meta`, `gh-counter`, `gh-btn`, and `gh-btn-danger` if available.
- Keep the current `GitHubSelect` for choosing the source Aggregate rule inside
  the edit form. The profile selector can be removed if the list fully replaces
  it.
- Add translation keys only for user-facing strings that are not already in
  `src/lib/i18n.ts`.

## Testing

Update `src/routes/exports/page-source.test.ts` to assert that:

- The page exposes a Profiles list or equivalent management surface.
- `New profile` is no longer gated by `clientExports.length === 0`.
- The page imports and uses `removeClientExport`.
- The page uses the confirmation dialog before deletion.
- Existing preview, copy, download, publish, workspace snapshot, and validation
  assertions still pass.

Run the existing Bun test suite after implementation.
