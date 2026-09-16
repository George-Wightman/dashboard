# Reliability fixes — 16 September 2026

All eight findings in [the original review](code-review-2026-09-16.md) have fixes and regression coverage. This report records implementation and validation before publication. Verification used synthetic data and isolated browser storage, without accessing the live sync repository or calendars.

| Finding | Implemented change | Regression evidence |
|---|---|---|
| Planner state exceeds the Script Property limit | UTF-8 chunks below the per-value limit, alternating generations, manifest published after chunks, size preflight before calendar changes; bounded tagging history | 35 bookings under an enforced 9 KB property limit; interrupted Unicode saves retain the last complete generation |
| Concurrent edits overwrite independent fields | Per-field versions, monotonic edit timestamps, deterministic conflict resolution, message-level conversation merging and deletion markers | Rename plus reschedule through simulated GitHub; merge ordering properties; clock skew; concurrent messages and pruning |
| Malformed records crash loading | Validate known records at write, import and sync boundaries; recover valid local records and a previous copy; preserve the damaged original when storage permits | Invalid imports and remote documents leave working state intact; local recovery verified in unit tests and Edge |
| Failed calendar replacement duplicates events or misreports bookings | Replacement insertion depends on successful deletion; reconcile duplicate keys; publish confirmed event state | Failed delete and failed insert recover on a subsequent run; published bookings match actual fake-calendar events |
| Dashboard activation deletes other apps' caches | Cleanup restricted to dashboard release and legacy dashboard cache names | Neighbouring caches survive simulated activation and real Edge refresh |
| Offline app mixes code from different releases | Generate a manifest of asset hashes, verify every download before publication, pin open pages to a complete release, retain pinned releases across worker restarts | Partial downloads and mismatched hashes never become active; existing and new pages use their respective releases |
| Visible idle devices miss remote changes | Periodic idle polling with failure backoff and visibility/editing guards | Scheduler polling, backoff, pause and recovery checks |
| A stalled GitHub request freezes sync | Deadline and abort cover fetch and response-body reads; scheduler always releases its running state | Stalled network and body reads time out; a timed-out write is read back before a later sync decides whether to write |

Additional fixes preserve pending changes from multiple tabs, prevent open editors from saving untouched stale fields, defer sync redraws while typing, keep data-save errors visible when settings save successfully, and release backup storage before a quota error can block the primary save. Pruning removes retained deleted conversation text as well as visible messages. Failed offline updates keep the existing page open and show an error. Chunk splitting avoids an Apps Script service call for every character.

## Verification

- `npm run build` succeeded: planner bundle `b7f2cd40`, offline release `cbcbede5737d` with 40 assets.
- `npm test`: **542 passed, 0 failed** on Node v24.19.0, including generated-file freshness checks.
- `npm run test:browser` passed in headless Microsoft Edge with external requests blocked: startup, editing, independent edits to one task across tabs, draft preservation, cache isolation, offline reload and save, damaged-data recovery, and editing at a 390-pixel mobile viewport.
- `git diff --check` passed.
- Added a GitHub Actions workflow to run the automated suite on pushes and pull requests. The hosted workflow itself has not yet run.

## Maintenance and rollout

Run `npm run build` and `npm test` before publishing, and include `planner/planner.js` and `release.json` with the source changes. The README documents local development and the optional browser test. Once published, reload every device into the new release; the Apps Script loader and Claude command-line tool fetch published code through their existing mechanisms.

Same-field concurrent edits still resolve by timestamp with a deterministic tie-break. Nested objects and most arrays are atomic fields; conversations have their own message merge. Older clients retain whole-record merge behaviour until upgraded. Recovery copies are best effort and do not replace exported backups.

The browser GitHub timeout cannot interrupt Apps Script's synchronous `UrlFetchApp`; that environment remains governed by Apps Script execution limits. Calendar recovery was tested against injected failures in the fake services, not a live Google account. The mobile check covers viewport fit and editing in Edge, not a full accessibility or cross-browser audit.
