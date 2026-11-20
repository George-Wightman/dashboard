// The planner's weekly archive step (js/archive.js; docs/superpowers/specs/2026-11-20-archive-design.md).
// The planner is the only writer of the archive's files. Once a week, records about days before the cut
// go into archive/<year>.json, each file is read back by the sha GitHub gives it, and only then does the
// pointer name it. The run's own save then leaves those records out of data.json (js/sync.js).
//
// NOTHING MAY BE LOST, so a year whose write or read-back fails keeps its old sha in the pointer (its
// records stay in data.json), `through` stays where it was, and the step tries again an hour later.
// Never throws: a failure is a sentence in the pointer's lastError, which ⚙ shows.

import { ARCHIVE_ID, archiveCut, archiveFiles, coldRecords, covered, yearDoc } from '../js/archive.js';
import { mergeDocs } from '../js/merge.js';
import { emptyDoc, isDoc } from '../js/doc.js';

const RETRY_MS = 60 * 60000;

// `loader` is the run's archive loader (it already holds the files the pointer names), `clientFor(path)`
// a GitHub client for one file in the sync repo, `readBlob(sha)` a file's text by its sha.
export async function runArchive({ store, loader, clientFor, readBlob, today, now }) {
  const prev = store.doc().calendar?.[ARCHIVE_ID];
  const live = prev?.status === 'active' ? prev : null;
  const cut = archiveCut(today);
  const waiting = !(typeof live?.through === 'string' && live.through >= cut);
  const resting = !!live?.lastError && now.getTime() - Date.parse(live.lastRun ?? '') < RETRY_MS;
  if (!waiting || resting) return { ran: false, moved: 0, error: null };

  const errors = [];
  let moved = 0;
  const files = { ...(archiveFiles(store.doc()) ?? {}) };
  try {
    const archive = Object.keys(files).length ? (await loader.load(files, readBlob)).doc : null;
    const { years } = coldRecords(store.doc(), archive, cut);
    for (const year of Object.keys(years).sort()) {
      const records = years[year];
      try {
        const client = clientFor(`archive/${year}.json`);
        const got = await client.get();
        if (got && !isDoc(got.doc)) throw new Error(`archive/${year}.json isn't a dashboard document`);
        const sha = await client.put(mergeDocs(got?.doc ?? emptyDoc(), yearDoc(records)), got?.sha);
        if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error(`GitHub gave archive/${year}.json no sha`);
        const text = await readBlob(sha);
        let back = null;
        try { back = JSON.parse(text); } catch { back = null; }
        if (!isDoc(back)) throw new Error(`archive/${year}.json read back as something else`);
        let n = 0;
        for (const [map, recs] of Object.entries(records)) {
          for (const [id, rec] of Object.entries(recs)) {
            if (!covered(map, rec, back[map]?.[id])) throw new Error(`archive/${year}.json read back without ${map} ${id}`);
            n++;
          }
        }
        files[year] = sha;
        loader.prime(sha, text);
        moved += n;
      } catch (e) {
        errors.push(`${year}: ${e?.message ?? e}`);
      }
    }
  } catch (e) {
    errors.push(e?.message ?? String(e));
  }
  const lastError = errors.length ? `The archive couldn't be written, so those records stay in data.json (${errors.join('; ')})` : null;
  store.putCalendar(ARCHIVE_ID, {
    files, through: errors.length ? (live?.through ?? null) : cut, lastRun: now.toISOString(), lastError, moved,
  }, 'planner');
  return { ran: true, moved, error: lastError };
}
