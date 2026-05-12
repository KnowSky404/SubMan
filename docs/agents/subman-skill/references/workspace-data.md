# SubMan Workspace Data Reference

## Workspace Identity

SubMan stores data in a fixed GitHub Workspace Gist:

- Description: `SubMan-Data`
- Config file: `subman.json`

All workspace files should stay in this gist. Aggregate outputs are published as
additional files in the same workspace gist.

## Modes

- Local mode: no GitHub token; app data is stored in localStorage.
- Workspace mode: token plus active gist id; data syncs to the workspace gist.
- Server API mode: Cloudflare Worker uses `GITHUB_TOKEN` from secrets to mutate
  the same workspace gist.

## Conflict Handling

The `/auth` flow supports:

- Local overwrites remote.
- Remote overwrites local.
- Merge then save.
- Bind only.

Do not remove these choices when changing sync or auth behavior.

## Protected Files

`subman.json` is the workspace config file and should be protected from UI file
deletion. Gists page cleanup should target generated output files, not the
config file.

## Data Shape

The full serialized state follows `AppState` in `src/lib/models.ts`:

- `nodes`
- `subscriptions`
- `aggregates`
- `publishTargets`
- `gists`
- `activeGistId`
- `activeGistFile`
- `lastUpdated`

Server API writes read the current serialized state, mutate node data, and write
the complete state back to `subman.json`.

## Stability Rules

- Preserve `activeGistFile` as `subman.json` unless deliberately migrating data.
- Keep publish target file names stable when stable subscription links matter.
- If a publish target file is renamed, the old raw URL is no longer the same
  stable output. Existing UI behavior prompts for cleanup strategy.

