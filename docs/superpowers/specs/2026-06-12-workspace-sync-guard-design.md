# Workspace Sync Guard Design

## Context

SubMan stores all workspace data in one GitHub Workspace Gist file,
`subman.json`. GitHub exposes a Gist-level `updated_at` and revision history,
but not reliable per-file `created_at` or `updated_at` metadata. The current
SubMan data model already has item-level `updatedAt` fields for nodes,
subscriptions, aggregate rules, publish targets, and client export profiles.

Auto-sync already protects normal browser edits better than a timestamp-only
model: it stores a local sync baseline, reads the remote `subman.json` before
writing, and performs a three-way merge when the remote state changed since the
baseline. The weak point is manual sync. Manual Push Local is an explicit
overwrite action, so it still depends on the user remembering whether the remote
workspace changed elsewhere.

## Goals

- Make manual Push Local safe by default.
- Detect remote divergence before manual overwrites.
- Offer merge, pull, or force-push only when remote and local differ.
- Keep auto-sync's existing baseline-based three-way merge behavior.
- Show clearer sync status so the user can see when the last sync happened and
  which file was involved.
- Use SubMan-owned signatures and baselines as the source of truth instead of
  relying on Gist file timestamps.

## Non-Goals

- Do not build a full Git clone, rebase, or commit browser.
- Do not split workspace data into multiple config files in this iteration.
- Do not change the public Gist layout or require a second Gist.
- Do not make force-push impossible; keep it available as an explicit override.
- Do not add `createdAt` fields to every existing resource unless a later
  migration needs them for a separate feature.

## Architecture

Add a small sync guard layer around manual workspace actions. The guard reads
the remote `subman.json`, imports it into `AppState`, computes the same stable
sync signature used by auto-sync, and compares it to the locally saved baseline
signature.

The decision matrix is:

- Remote signature equals local state signature: update the local baseline and
  report "already in sync".
- Remote signature equals saved baseline signature: Push Local can write safely
  because the remote has not changed since the last known sync point.
- Remote signature differs from saved baseline: block the direct push and show a
  remote-change review state with Merge & Save, Pull Remote, and Force Push.
- Remote content is missing or invalid: keep the existing error path and do not
  overwrite automatically.

The implementation should reuse the existing `getSyncStateSignature`,
`setSyncBaseline`, `mergeSyncState`, and auto-sync merge helpers where possible.
If the baseline-aware merge helper needs to be shared with the Auth page, move
it into a focused library module instead of duplicating merge logic.

## UX

The Auth page keeps the current manual controls, but Push Local no longer writes
immediately when the remote changed since the saved baseline.

When remote divergence is detected, the page shows a compact review panel:

- Pull Remote: replace the local view with remote state and update the baseline.
- Merge & Save: merge local and remote state, write the merged result to
  `subman.json`, update local state, and update the baseline.
- Force Push: after confirmation, overwrite remote with current local state.

The panel copy should make the risk explicit without over-explaining Git:
"Remote workspace changed since your last sync. Choose how to continue."

The existing sync status block should continue to show last success or failure.
If needed, extend the status message to identify manual push, manual pull, or
manual merge so the user can distinguish background sync from manual actions.

## Data Flow

### Safe Manual Push

1. User clicks Push Local.
2. SubMan reads the current active workspace file from the Gist.
3. SubMan imports the remote state and computes its signature.
4. If remote matches local, update baseline and show "already in sync".
5. If remote matches baseline, write local state to the Gist and update
   baseline.
6. If remote differs from baseline, store the remote state in page state and
   show the review panel without writing.

### Merge & Save

1. User chooses Merge & Save from the review panel.
2. SubMan merges local and remote state using the saved baseline when available.
3. SubMan writes the merged payload to the Gist.
4. SubMan replaces local state with the merged state.
5. SubMan updates the baseline signature and baseline state.

### Force Push

1. User chooses Force Push from the review panel.
2. SubMan asks for confirmation that remote changes will be overwritten.
3. SubMan writes the current local state to the Gist.
4. SubMan updates the baseline signature and baseline state.

## Error Handling

- If reading the remote file fails, Push Local must not write a replacement.
- If remote JSON import fails, show an error and keep existing local data.
- If writing the merged or forced state fails, keep the review panel open so the
  user can retry after fixing token or network issues.
- If local edits happen while the review panel is open, merge and force-push
  should use the current local state at click time, not the state captured when
  the panel opened.

## Testing

Add focused tests around the shared sync-guard logic:

- Push is allowed when remote signature equals baseline.
- Push is blocked when remote signature differs from baseline.
- Matching remote/local states are treated as already synced.
- Merge preserves remote deletions when the local side only has the old
  baseline copy.
- Force push writes only after an explicit action.

Add an Auth page source test for the new remote-change review state and
Force Push action wiring. Run `bun test`, `bun run check`, and `bun run build`
before considering the feature complete.
