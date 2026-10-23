# Exports Gist Live Link Design

## Context

The Exports page already generates sing-box client configs from Aggregate rules
and can publish the generated JSON into the active Workspace Gist. The current
UI makes this behavior hard to discover: profiles only show a delete action, and
the published raw URL is saved in state but not presented like the Aggregate
page's live link.

sing-box graphical clients support remote profiles imported from a URL. The
published Gist raw URL should therefore be presented as a remote profile URL for
compatible clients, while avoiding language that implies every `sing-box run`
CLI flow can read a URL directly.

## Goals

- Add an explicit Edit action for export profiles.
- Keep the existing row-click profile selection behavior.
- Show a Publish to Gist area on the Exports page.
- Show the selected profile's published raw URL as a Live Link.
- Let users copy the published remote profile URL after publishing or when
  selecting an already-published profile.
- Keep publishing scoped to the active Workspace Gist and continue writing
  `subman.json` with the updated profile metadata.

## Non-Goals

- Do not change the `ClientExportProfile` data model.
- Do not change sing-box config generation.
- Do not add remote-profile URL scheme generation in this iteration.
- Do not support a separate export Gist outside the active Workspace Gist.

## UX

Each profile row will include an Edit button next to Delete. Edit selects the
profile and scrolls or points users toward the existing detail form implicitly by
making the selected row visibly active.

The right-side summary column will include a Publish to Gist box. It contains:

- Publish button, or a Connect to Publish link when GitHub is not connected.
- The selected output filename.
- A short note that the raw URL can be used as a remote profile URL in
  compatible sing-box clients.
- A Live Link block with the last published raw URL and a Copy button.

The existing header Publish button can remain as a shortcut, but the sidebar
box is the primary discoverable publishing surface.

## Testing

Update `src/routes/exports/page-source.test.ts` to assert that the Exports page
contains:

- explicit Edit profile action text and handler wiring,
- Publish to Gist UI,
- Live Link UI,
- remote profile URL copy behavior,
- selected profile `lastPublishedUrl` display.

Run the page source test first to verify it fails, then implement the page
changes and run the relevant tests plus the build.
