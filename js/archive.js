// The archive (docs/superpowers/specs/2026-11-20-archive-design.md): a slim synced file, a full copy
// everywhere.
//
// data.json was 1.4 MB on 20 Nov 2026, and over 1 MB every read of it takes two requests. Nothing about
// a past day ever left it. Now records about days more than four or five weeks back live in yearly
// files beside it (archive/2025.json, archive/2026.json), written once a week by the planner
// (planner/archive.js), and data.json leaves out what they hold.
//
// EVERY PLACE THAT OPENS THE DOCUMENT STILL GETS ALL OF IT. A device keeps its whole copy and merges the
// archive in; the planner, the widgets and Claude's tool read data.json and the archive files together.
// So no streak, goal total, PR or past day changes, and no writer that makes a record by a fixed id
// (Hevy ticks, Hebrew day logs) can miss an archived one and write a fresh copy that beats it. Only what
// is WRITTEN to data.json changes: slimDoc, below, before every push.
//
// The pointer, calendar['archive:status'], names each year's file by its git blob sha: a content hash,
// so `files` names exactly one version of each, and every client given the same document leaves out
// exactly the same records. No clock is involved.

import { MAPS, emptyDoc, isDoc, stableStringify } from './doc.js';
import { mergeDocs, mergeOne } from './merge.js';
import { recordContent } from './record.js';
import { addDays, weekStart } from './dates.js';

export const ARCHIVE_ID = 'archive:status';
// The cut is the Monday of this week less this many days: records about days before it move, once a
// week, so data.json holds the last four to five weeks. Nothing on screen depends on it.
export const ARCHIVE_DAYS = 28;

const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const day = (v) => (isDay(v) ? v : null);
const gone = (r) => r.status === 'archived' || r.status === 'dismissed';

export function archiveCut(today) {
  return addDays(weekStart(today), -ARCHIVE_DAYS);
}

// WHAT MAKES A RECORD COLD: the day it is about, not when it was last touched (on 20 Nov nearly
// everything had been touched within the month). Null for a record that never moves: anything live
// (an active habit, a weekly target, an open flag, settings and statuses, the map's claims), and the
// change log, which expires on its own. Getting this slightly wrong is harmless: every client still
// sees every record, and one that moves and is then edited comes back into data.json (covered, below).
const CALENDAR_DAYS = /^(hours|work|eu|commit|closed|count|conflict):/;
export function aboutDay(map, id, rec) {
  if (!rec || typeof rec !== 'object') return null;
  switch (map) {
    case 'items':
      if (gone(rec)) return day(rec.archivedOn);
      return rec.status === 'active' && rec.type === 'task' ? day(rec.date) : null;
    case 'goals':
    case 'milestones':
      return gone(rec) ? day(rec.archivedOn) : null;
    case 'flags':
      return rec.status === 'active' ? null : day(rec.archivedOn);
    case 'logs':
    case 'journal':
      return day(rec.day);
    case 'gym':
      return /^(w|h|back):/.test(id) ? day(rec.day) : null;
    case 'meals':
      return rec.kind === 'meal' ? day(rec.day) : null;
    case 'game':
      return id.startsWith('day:') ? day(rec.day) : null;
    case 'calendar':
      if (CALENDAR_DAYS.test(id)) return day(rec.day);
      if (id.startsWith('off:')) return day(String(rec.end ?? rec.start ?? '').slice(0, 10));
      if (id.startsWith('payslip:')) return day(rec.to);
      return null;
    default:
      return null;
  }
}

// The year files the pointer names, { '2026': '<sha>' }, or null when there are none. A malformed entry
// is left out, which only keeps its records in data.json.
export function archiveFiles(doc) {
  const p = doc?.calendar?.[ARCHIVE_ID];
  if (!p || p.status !== 'active' || !p.files || typeof p.files !== 'object' || Array.isArray(p.files)) return null;
  const out = {};
  for (const year of Object.keys(p.files).sort()) {
    const sha = p.files[year];
    if (/^\d{4}$/.test(year) && typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) out[year] = sha;
  }
  return Object.keys(out).length ? out : null;
}

// COVERED: the archive holds a version of this record, and merging this copy into it changes nothing
// about its content. Only then is the record left out of data.json, so:
// - nothing leaves before the archive (as named by its hash, which is only named once it was read back)
//   holds it;
// - an older copy (an old app, an offline phone) is covered, so it can't come back;
// - a newer edit isn't, so it goes back into data.json, reaches every device, and moves again at the
//   next weekly run.
export function covered(map, rec, archived) {
  if (!rec || typeof rec !== 'object' || !archived || typeof archived !== 'object') return false;
  return stableStringify(recordContent(mergeOne(map, archived, rec)))
    === stableStringify(recordContent(mergeOne(map, archived, archived)));
}

// The document as written to data.json: the whole of it less what the archive covers. Only the archive's
// records are looked at; a map with nothing left out is the same object.
export function slimDoc(doc, archive) {
  if (!archive) return doc;
  const out = { ...doc };
  for (const map of MAPS) {
    const arch = archive[map];
    const recs = doc?.[map];
    if (!arch || !recs) continue;
    let kept = null;
    for (const [id, a] of Object.entries(arch)) {
      if (!Object.hasOwn(recs, id) || !covered(map, recs[id], a)) continue;
      kept ??= { ...recs };
      delete kept[id];
    }
    if (kept) out[map] = kept;
  }
  return out;
}

// What the weekly run moves: every record about a day before the cut that the archive doesn't already
// cover, by the year of that day. { years: { '2026': { logs: { id: rec } } }, count }.
export function coldRecords(doc, archive, cut) {
  const years = {};
  let count = 0;
  for (const map of MAPS) {
    for (const [id, rec] of Object.entries(doc?.[map] ?? {})) {
      const d = aboutDay(map, id, rec);
      if (!d || !(d < cut) || covered(map, rec, archive?.[map]?.[id])) continue;
      ((years[d.slice(0, 4)] ??= {})[map] ??= {})[id] = rec;
      count++;
    }
  }
  return { years, count };
}

// Records as an ordinary document, ready to merge into a year's file.
export function yearDoc(records = {}) {
  const doc = emptyDoc();
  for (const [map, recs] of Object.entries(records)) if (MAPS.includes(map)) doc[map] = { ...recs };
  return doc;
}

// The archive the pointer names, merged into one document. Each file is read once: from memory, then
// from `cache` (a device's IndexedDB), then from GitHub by its sha. A sha names exactly one content, so
// a cached copy is never stale; a damaged one is downloaded again. Throws when a named file can't be
// read or isn't a document, and the caller then writes nothing to data.json that round.
//
// `fresh` is true until the caller says, with merged(key), that this archive is in its store: on a
// device, the first sync after a load and whenever the pointer moves.
export function createArchiveLoader({ cache = null } = {}) {
  const texts = new Map();
  let current = null;
  let mergedKey = null;

  const parse = (text) => {
    try {
      const doc = JSON.parse(text);
      return isDoc(doc) ? doc : null;
    } catch {
      return null;
    }
  };

  async function read(year, sha, readBlob) {
    let text = texts.get(sha);
    if (typeof text !== 'string' && cache) {
      try { text = await cache.get(sha); } catch { text = undefined; }
    }
    let doc = typeof text === 'string' ? parse(text) : null;
    if (!doc) {
      text = await readBlob(sha);
      doc = typeof text === 'string' ? parse(text) : null;
      if (!doc) throw new Error(`archive/${year}.json isn't a dashboard document`);
      if (cache) { try { await cache.put(sha, text); } catch { /* read again next time */ } }
    }
    return { text, doc };
  }

  return {
    async load(files, readBlob) {
      const key = stableStringify(files);
      if (current?.key === key) return { doc: current.doc, key, fresh: key !== mergedKey };
      const next = new Map();
      let doc = null;
      for (const year of Object.keys(files).sort()) {
        const sha = files[year];
        const got = await read(year, sha, readBlob);
        next.set(sha, got.text);
        doc = mergeDocs(doc ?? got.doc, doc ? got.doc : null);
      }
      texts.clear();
      for (const [sha, text] of next) texts.set(sha, text);
      current = { key, doc: doc ?? emptyDoc() };
      if (cache?.keep) { try { await cache.keep([...next.keys()]); } catch { /* tidied next time */ } }
      return { doc: current.doc, key, fresh: key !== mergedKey };
    },
    merged(key) { mergedKey = key; },
    // A file the planner has just written and read back, so the save after it needn't download it.
    prime(sha, text) { texts.set(sha, text); },
  };
}

// A device's copies of the archive files, over an IndexedDB { get, put, del } (js/bigstore.js), keyed by
// sha, with an index so that keep() can drop the ones the pointer no longer names. Every call fails soft.
const INDEX = 'archive:index';
export function archiveCache(backend) {
  const soft = async (fn) => { try { return await fn(); } catch { return undefined; } };
  const index = async () => { const v = await backend.get(INDEX); return Array.isArray(v) ? v : []; };
  return {
    get: (sha) => soft(async () => { const v = await backend.get(`archive:${sha}`); return typeof v === 'string' ? v : undefined; }),
    put: (sha, text) => soft(async () => {
      await backend.put(`archive:${sha}`, text);
      const list = await index();
      if (!list.includes(sha)) await backend.put(INDEX, [...list, sha]);
    }),
    keep: (shas) => soft(async () => {
      const wanted = new Set(shas);
      const list = await index();
      for (const sha of list) if (!wanted.has(sha)) await backend.del(`archive:${sha}`);
      await backend.put(INDEX, list.filter((sha) => wanted.has(sha)));
    }),
  };
}
