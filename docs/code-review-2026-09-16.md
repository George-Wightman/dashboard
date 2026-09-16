# Dashboard code and architecture review — 16 September 2026

Reviewed local commit `78c28f5`. No application code was changed.

This is the original review, before implementation. Fixes and validation are recorded in
[`reliability-fixes-2026-09-16.md`](reliability-fixes-2026-09-16.md).

The architecture is appropriate for a personal, offline dashboard: plain modules, a shared store, pure scheduling logic, and adapters around external services. The main weaknesses are at the boundaries between devices, cached releases, and external systems. Those weaknesses can lose edits, break loading, or leave the calendar different from what the dashboard reports.

`npm test` passed: **519 tests, 0 failures**, using Node v24.19.0. Additional isolated reproductions used synthetic data and the repository's fakes; no live calendar, sync repository, API key, or personal data was accessed. Browser layout, accessibility, deployed behaviour, and account configuration were not validated in this review.

## Findings, in recommended fix order

### 1. P1 — Planner state can exceed Apps Script's storage limit

**Location:** `planner/gas.js:198–200`.

The planner serializes the entire planning window into one Script Property, `DAYS`. Google documents a **9 KB per-value limit** in its [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

**Reproduction:** five daily habits, each in a separate area, with UUID-length IDs and the default seven-day horizon produced 35 events and a **10,053-byte** `DAYS` value. Enforcing the documented limit in the existing fake Properties service caused `run()` to return `failed` **after all 35 calendar events had been created**, with zero dashboard writes.

**Impact:** an ordinary-sized schedule can repeatedly fail to save its state and dashboard status. Calendar changes happen before the failure, making recovery harder and the UI stale. The current fake property store accepts arbitrarily large values, so the test suite misses this.

**Fix:** store compact state by day or in bounded chunks, validate size before calendar mutations, and test against the real per-value limit. Also bound `TAGGED`, which is another growing single property.

### 2. P1 — Concurrent edits to different fields silently overwrite one another

**Location:** `js/merge.js:7–14`, `js/merge.js:47`.

Merge chooses one entire record using its `updated` timestamp. Deterministic convergence does not mean every edit is preserved.

**Reproduction:** starting from the same task, device A renamed it at 10:00, while device B changed its date at 10:01. The merged result kept the new date but restored the original title, losing A's rename. This can also happen between the browser, Claude, and automatic area tagging.

**Impact:** successful sync can silently undo user work. Conversation messages are stored as an array within one journal record, so overlapping conversation changes have the same structural risk. A device clock ahead of other writers can also dominate later real-world edits.

**Fix:** introduce field-level versions or a three-way merge with explicit conflicts. Store conversation messages independently if they must merge without losing either side. At minimum, preserve and expose conflicting revisions. Adjust the README's “never loses anything” claim.

### 3. P1 — Invalid records pass document validation and can crash the app

**Location:** `js/doc.js:22–26`, `js/data.js:49–60`, `js/sync.js:89–103`.

`isDoc()` checks that maps are objects, but does not validate their records. Local loading is weaker still: any top-level object is accepted and given missing maps.

**Reproduction:** `isDoc({schema: 1, items: {broken: null}})` returns `true`. Passing the merged result to `dayCompletion()` throws `Cannot read properties of null (reading 'status')`.

**Impact:** a malformed backup or sync document can be persisted and then break rendering. Reloading loads the same bad data. Types, dates, required fields, record IDs, and supported schema versions are not consistently checked at these entry points. This is a reliability finding, not evidence of a code-execution exploit.

**Fix:** validate individual records and supported schema versions before persistence; use the same validation for local load, import, and sync. Preserve the last valid document, quarantine invalid input, and make readers resilient to unusable records. Centralize mutation validation too: `updateItem()` currently bypasses the checks used by `addItem()`.

### 4. P2 — Calendar replacements are not safe when only some actions succeed

**Location:** `planner/plan.js:194–201`, `planner/gas.js:144–157`, `planner/gas.js:198–200`.

Converting a rough event to an exact one emits a delete followed by an insert. The executor catches each error and continues, so a failed delete does not prevent its replacement from being inserted. The stored day records describe the intended result rather than all surviving calendar events.

**Reproduction:** create a daily habit, run at 08:00, then run at 20:00 while making deletion of its day-after-tomorrow rough block fail. The calendar retained the rough block and gained an exact block with the same planning key. The dashboard recorded one block. The next run returned `ok` while two calendar copies remained.

**Impact:** duplicate bookings and a misleading recovery status.

**Fix:** model dependent replacements explicitly, record confirmed outcomes, and reconcile duplicate planning keys on subsequent runs. Test failures separately for insert, patch, and delete, including what the *next* run does.

### 5. P2 — Activating the service worker deletes other apps' caches

**Location:** `sw.js:37–40`.

The activation handler deletes every cache except `dash-v9`. Cache storage is shared within an origin; a worker's path scope does not make this cache enumeration app-specific. The README explicitly says the Hebrew app shares this app's origin. See the [CacheStorage API](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage).

**Reproduction:** invoking the actual activation handler with cache names `dash-v8`, `dash-v9`, and `hebrew-v1` deleted both `dash-v8` and `hebrew-v1`.

**Impact:** installing or updating the dashboard can remove another app's offline assets. This does not delete its localStorage data.

**Fix:** give dashboard caches a unique namespace and delete only obsolete caches in that namespace. Read through the selected dashboard cache rather than the global `caches.match()` search.

### 6. P2 — Background cache refresh can leave a mixture of releases

**Location:** `sw.js:53–58`.

Although explicit shell refresh uses `addAll()`, every normal request independently fetches and overwrites a file in the active cache. These writes are not an atomic release update.

**Reproduction:** using the actual fetch handler, allow the new `app.js` request to succeed and make the `data.js` request fail. The cache ends with new `app.js` and old `data.js`. A subsequent offline load can consume that mixture.

**Impact:** deployments that change module interfaces can break an otherwise working offline installation. The all-or-nothing shell refresh does not protect this separate update path.

**Fix:** cache immutable releases, download and verify an entire new release into a separate cache, and switch versions together. Do not independently overwrite modules in the active release.

### 7. P2 — An idle open dashboard does not periodically pull external changes

**Location:** `js/app.js:369–376`, `js/app.js:434–440`.

Sync runs on opening, focus/visibility, connectivity changes, local edits, and manual sync. The minute interval handles the date, coach, and app updates, but does not poll dashboard data.

**Impact:** if the dashboard remains open and untouched, changes from Claude, the phone, Hevy, or the planner can stay invisible until another sync trigger. The header can also report a stale planner based on an old local heartbeat.

**Fix:** add a modest visible-page polling interval with backoff, while retaining the existing edit protections. Distinguish “last checked” from “last changed”. This finding is based on code-path inspection rather than a timed browser test.

### 8. P2 — A stalled GitHub request blocks subsequent sync attempts

**Location:** `js/sync.js:53`, `js/sync.js:59`, `js/sync.js:68–72`, `js/sync.js:129–135`.

GitHub requests have no application timeout. The scheduler retains its `running` flag until the awaited run settles; new requests only set `again`.

**Impact:** while a connection remains stalled, manual sync and later edits cannot start a replacement attempt, and the UI can remain on “syncing…”. The Gemini client already has timeout handling, but GitHub sync does not.

**Fix:** add a bounded request timeout with cancellation, release the scheduler on timeout, and retry with backoff. Handle the ambiguous outcome of a timed-out PUT by fetching the current remote state before retrying. This finding is based on code-path inspection.

## Structure assessment

| Layer | Assessment |
| --- | --- |
| `js/doc.js`, `data.js`, `merge.js` | Good shared foundation, but validation and conflict semantics need strengthening. |
| `js/schedule.js`, `calendar.js`, `gym.js` | Pure calculations make this layer understandable and testable. |
| `js/app.js`, `js/ui/` | UI modules are reasonably separated; boot orchestration and coach UI each carry many responsibilities. Full redraws make focus and in-flight updates harder to reason about. |
| `claude/` | Reusing the app's store and merge avoids a separate interpretation of the data. Change records and cautious Undo are useful. |
| `planner/` | Separation between pure planning and service adapters is strong. The missing piece is reliable reconciliation after partial external writes. |
| `tests/` | Substantial unit coverage and useful fakes, including a check that the committed planner bundle matches source. Browser behaviour and realistic external limits are weaker areas. |

I would retain the plain JavaScript approach. A framework rewrite would not address the principal failures identified here. First establish stronger contracts for records, conflicts, release updates, and external side effects; then split large modules where those boundaries become clear.

## Broader risks and test gaps

- **Security boundary:** GitHub and Gemini credentials are stored in origin-wide localStorage, and the app intentionally shares a Gemini key with another app. Code running under the same origin can read these credentials. The DOM helper uses text insertion for ordinary content, which is a good defence against HTML injection; this review found no demonstrated injection exploit. A dedicated origin would isolate the dashboard from neighbouring apps.
- **Privileged automatic updates:** `planner/apps-script/Code.gs:13` executes downloaded JavaScript with the script's calendar permissions and access to its properties. `claude/skill/run.sh` similarly runs code updated from `main` with the sync credential. These are deliberate trust decisions, but a bad public-repo deployment affects privileged integrations immediately. Consider a verified, pinned release with a straightforward rollback.
- **Growing document:** every store commit serializes the full document to localStorage. Logs and tombstones accumulate; coach changes copy records into the change log. Snapshot pruning exists, but `pruneChanges()` is called by the Claude push path rather than regular browser maintenance. Add representative long-history and storage-quota checks before the data grows much further.
- **Tests sometimes verify source text rather than behaviour:** examples include `tests/flags-ui.test.js` and `tests/changes-ui.test.js`. Regex assertions confirm that code fragments exist, but cannot establish that controls work, drafts survive async redraws, or keyboard interaction is usable.
- **No checked-in CI workflow was found.** The planner bundle freshness test is valuable, but depends on someone running the tests. Add a CI check for the suite and generated bundle before publishing.
- **Documentation has drifted:** the README's coach description largely describes the older question-and-answer flow, while the implementation supports conversations and direct changes through tools. Keep capability, privacy, setup, and recovery documentation aligned with the current app.

## Suggested sequence

1. Address planner storage limits, invalid-document handling, and edit conflicts.
2. Make calendar operations recoverable and service-worker updates isolated and consistent.
3. Add sync polling/timeouts and small browser tests for offline loading, updating, editing during sync, and recovery.
4. Add CI and document the trust model and restore procedure.

The passing suite is a useful foundation. The next tests should target failures at system boundaries, especially recovery after an interrupted operation, rather than adding more assertions that expected source code is present.
