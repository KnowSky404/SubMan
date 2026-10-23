# One Cloud Workspace

## Product Contract

Cloud `subman.json` is the sole business authority. A device has one Gist
binding. Remove Workspace lists/switching, local business mode, manual sync,
local push/merge/force overwrite, bind-only, and business JSON backup/restore.
Keep node/subscription URI import, generated output preview/download, and safe
technical diagnostics; these are separate from business snapshot restoration.

## Connection And Reads

Initial connection may use an explicit Gist ID. If discovery finds multiple
candidates, require the original ID without selecting, creating, or modifying a
candidate. Once bound, startup, login, and token replacement retain the same
Gist. A failed original-Gist lookup must not create or select another one.

Load the latest cloud document before enabling business pages. Historical manual
bindings become automatic only after successful safe cloud validation. A new
bootstrap initializes empty cloud business data rather than uploading old cache.
V1 uses an explicit preview and source-hash-checked migration, preserving the
original Gist, exact immutable backup, output bytes, and publication metadata.

## Writes And Results

An action requires a token, a ready cloud session, and an initialized automatic
binding. Unresolved pending work or active repair evidence blocks further edits.
Retained manual or conflict-paused queues require confirmed cloud reload; never
automatically publish a historical local reconcile while upgrading the browser.
One transaction persists the cache plus mutation identity and payload before
memory changes. Send immediately, retain the same mutation ID and timestamp
across the existing bounded concurrent-update replay, and await cloud delivery.

Only `remote-committed` reports success and finalizes a draft. Queued, peer-owned,
retrying, blocked, and uncertain results preserve the request and draft and never
become local business success. Logout stops subsequent delivery without deleting
the binding or journal. Token replacement resumes eligible original requests.

## Recovery And Compatibility

Keep IndexedDB v1 as technical cache, delivery journal, lease, migration, and
recovery storage. Preserve historical orphan queues and safe inspection. They do
not authorize switching or automatic delivery to a different Gist. Both rebind
and repair transactions reject replacing an active binding with another identity.

A safe cloud refresh compares the expected snapshot, binding, and complete queue
transactionally. A concurrent edit must reject refresh instead of being dropped.
Revision conflict recovery offers confirmation to discard the complete pending
queue and reload the original cloud document. Reapply a desired edit against
that revision. Keep tombstones, version checks, processed mutation identity, and
all existing coordinator write boundaries.

The public Server API is unchanged and discovers its target independently. The
revisioned browser mutation route remains internal. Historical offline audit and
V1 conversion tools remain operator artifacts; they do not create a business
JSON import path or authorize remote recovery writes.

## Verification

Cover competing first bindings, reconnect identity, cloud startup freshness,
manual-to-automatic transition, no offline/local CRUD, held cloud confirmation,
original-ID retry/reload, pending-submit rejection, auth replacement/logout,
conflict whole-queue reload, and historical queue retention. Use synthetic
fixtures and mocked GitHub transport for unit, Worker, and browser evidence.
