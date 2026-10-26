# Changelog

English | [简体中文](Changelog.zh-CN.md)

Record meaningful product, maintenance, and migration changes here, newest first.
Update both languages in the same commit. Entries describe repository changes;
production deployment and real-provider acceptance require separate evidence.

## Unreleased

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
