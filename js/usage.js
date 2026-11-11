// How the app itself gets used: counts only, per device per day. Opens and minutes on screen, where
// an open came from (a widget, a notification), which tiles were opened big, taps by control, errors,
// and how long a sync takes. Kept on the device as it happens (USAGE_KEY) and written into the
// synced document at most every three hours (and yesterday's on the next open), one record per device per week
// (calendar['usage:<device>:<monday>']), so Claude can read it back (`usage`). Never a title, never
// anything typed: a tap is named by the part of the screen and the control's own class.

import { weekStart, addDays } from './dates.js';

export const USAGE_KEY = 'dash_usage';
export const DEVICE_KEY = 'dash_device';
export const USAGE_PREFIX = 'usage:';
export const FLUSH_GAP_MS = 3 * 60 * 60 * 1000;
export const USAGE_KEEP_WEEKS = 16;
const MAX_KEYS = 80; // distinct names in one group on one day
const MAX_ERRORS = 12;

const GROUPS = ['from', 'big', 'taps', 'errors', 'hours'];

export const emptyDay = () => ({ opens: 0, sec: 0, from: {}, big: {}, taps: {}, errors: {}, hours: {}, sync: { n: 0, fail: 0, ms: 0, maxMs: 0, kb: 0 } });

export const usageId = (device, day) => `${USAGE_PREFIX}${device}:${weekStart(day)}`;

const clean = (text, max = 32) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);

// What a tap was on: "<where>/<control>". `el` is the thing clicked (anything with closest()).
// Where is the dialog, tile or part of the page it sits in; the control is its data-use, else its
// first class, else its tag. Null when the click wasn't on a control.
export function tapName(el) {
  const control = el?.closest?.('button, a, input, select, textarea, summary, [role=button], [data-use]');
  if (!control) return null;
  const dialog = control.closest('dialog[id]');
  const tile = control.closest('[data-tile]');
  const where = dialog ? dialog.id
    : tile ? `tile-${tile.dataset?.tile ?? tile.getAttribute?.('data-tile')}`
      : control.closest('#timeline') ? 'today'
        : control.closest('#dl-sky') ? 'sky'
          : control.closest('#editor') ? 'editor'
            : control.closest('#list, #under, #side') ? 'classic' : 'page';
  const cls = String(control.getAttribute?.('class') ?? '').trim().split(/\s+/).find((c) => c && c !== 'link' && c !== 'icon' && c !== 'dl-btn');
  const tag = String(control.tagName ?? 'control').toLowerCase();
  const what = control.dataset?.use || cls || (tag === 'input' ? `input-${control.type || 'text'}` : tag);
  return `${clean(where)}/${clean(what)}`;
}

// An error as one short line: the message, and the file and line it came from.
export function errorName(message, source = '', line = null) {
  const file = String(source ?? '').split('/').pop().split('?')[0];
  return `${String(message ?? 'error').replace(/\s+/g, ' ').slice(0, 90)}${file ? ` @${file}${line ? `:${line}` : ''}` : ''}`;
}

function read(storage) {
  try {
    const s = JSON.parse(storage.getItem(USAGE_KEY));
    if (s && typeof s === 'object' && s.days && typeof s.days === 'object') return { days: s.days, flushedAt: Number(s.flushedAt) || 0, dirty: !!s.dirty };
  } catch { /* start again */ }
  return { days: {}, flushedAt: 0, dirty: false };
}

// This device's name in the record ids: a few random letters, made once. `kind` says what it is.
export function deviceOf(storage, { touch = false, newId = () => Math.random().toString(36).slice(2, 8) } = {}) {
  let id = null;
  try { id = storage.getItem(DEVICE_KEY); } catch { /* none */ }
  if (!id || !/^[a-z0-9]{4,12}$/.test(id)) {
    id = clean(newId(), 12) || 'device';
    try { storage.setItem(DEVICE_KEY, id); } catch { /* this visit only */ }
  }
  return { id, kind: touch ? 'phone' : 'laptop' };
}

export function createUsage({ storage, device, today, now = () => Date.now() }) {
  let state = read(storage);
  let visibleSince = null;
  let hiddenAt = 0;

  const save = () => { try { storage.setItem(USAGE_KEY, JSON.stringify(state)); } catch { /* counts are best effort */ } };
  const day = () => {
    const d = today();
    state.days[d] ||= emptyDay();
    for (const g of GROUPS) state.days[d][g] ||= {};
    state.days[d].sync ||= emptyDay().sync;
    return state.days[d];
  };
  const touch = () => { state.dirty = true; save(); };

  function count(group, key, n = 1) {
    if (!GROUPS.includes(group) || !key) return;
    const map = day()[group];
    const max = group === 'errors' ? MAX_ERRORS : MAX_KEYS;
    const name = Object.hasOwn(map, key) || Object.keys(map).length < max ? key : 'other';
    map[name] = (map[name] ?? 0) + n;
    touch();
  }

  // Time on screen: from coming into view to leaving it, added to the day it ended on.
  function settle() {
    if (visibleSince == null) return;
    const sec = Math.round((now() - visibleSince) / 1000);
    visibleSince = now();
    if (sec > 0 && sec < 6 * 3600) { day().sec += sec; touch(); }
  }

  return {
    device,
    count,
    // The page came into view. A return within half a minute is the same visit.
    visible({ from = null, hour = null, size = null } = {}) {
      if (visibleSince != null) return;
      visibleSince = now();
      if (now() - hiddenAt < 30000 && !from) return;
      const d = day();
      d.opens += 1;
      if (size) { d.w = size.width; d.h = size.height; }
      touch();
      count('from', from ?? 'direct');
      if (hour != null) count('hours', String(hour).padStart(2, '0'));
    },
    hidden() {
      settle();
      visibleSince = null;
      hiddenAt = now();
    },
    tick: settle,
    tap(el) { const name = tapName(el); if (name) count('taps', name); },
    big(id) { count('big', clean(id)); },
    error(message, source, line) { count('errors', errorName(message, source, line)); },
    synced({ ok, ms, kb }) {
      const s = day().sync;
      s.n += 1;
      if (!ok) s.fail += 1;
      if (Number.isFinite(ms)) { s.ms += Math.round(ms); s.maxMs = Math.max(s.maxMs, Math.round(ms)); }
      if (Number.isFinite(kb) && kb > 0) s.kb = Math.round(kb);
      touch();
    },
    pending: () => state.dirty,
    days: () => structuredClone(state.days),

    // Into the synced document: each week's days into that week's record, beside what it already
    // holds. Not more often than every three hours unless forced, or an earlier day is still waiting,
    // so using the app never makes it sync more. Returns how many records it wrote.
    flush(store, { force = false, extra = null } = {}) {
      settle();
      if (!state.dirty) return 0;
      const t = today();
      const waiting = Object.keys(state.days).some((d) => d < t);
      if (!force && !waiting && now() - state.flushedAt < FLUSH_GAP_MS) return 0;
      const weeks = {};
      for (const [d, counts] of Object.entries(state.days)) (weeks[usageId(device.id, d)] ||= {})[d] = counts;
      let wrote = 0;
      for (const [id, days] of Object.entries(weeks)) {
        const existing = store.doc().calendar?.[id];
        const fields = { device: device.kind, week: id.slice(-10), days: { ...(existing?.days ?? {}), ...days }, ...(extra ?? {}) };
        if (store.putCalendar(id, fields, 'me').changed) wrote++;
      }
      // Earlier weeks are in the document now; this week's days stay, to be added to.
      const monday = weekStart(t);
      state.days = Object.fromEntries(Object.entries(state.days).filter(([d]) => d >= monday));
      state.flushedAt = now();
      state.dirty = false;
      save();
      return wrote;
    },
  };
}

// ---- Reading it back (Claude's `usage` read; pure) ----

const sum = (list, f) => list.reduce((a, x) => a + (f(x) || 0), 0);
const addInto = (into, map) => { for (const [k, n] of Object.entries(map ?? {})) into[k] = (into[k] ?? 0) + n; return into; };
const top = (map, n = 8) => Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

// Every device's days in the last `days` days up to `today`: [{ id, kind, days: { day: counts } }].
export function usageByDevice(doc, today, days = 14) {
  const since = addDays(today, -(days - 1));
  const out = new Map();
  for (const [id, rec] of Object.entries(doc?.calendar ?? {})) {
    if (!id.startsWith(USAGE_PREFIX) || rec?.status !== 'active' || !rec.days) continue;
    const device = id.slice(USAGE_PREFIX.length, -11);
    const entry = out.get(device) ?? { id: device, kind: rec.device ?? 'device', days: {}, tiles: null };
    for (const [d, counts] of Object.entries(rec.days)) if (d >= since && d <= today) entry.days[d] = counts;
    if (rec.tiles && (!entry.tilesAt || rec.updated > entry.tilesAt)) { entry.tiles = rec.tiles; entry.tilesAt = rec.updated; }
    out.set(device, entry);
  }
  return [...out.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

// The picture in lines, for a chat. `tileIds` names every tile, so the ones never opened can be said.
export function usageLines(doc, today, days = 14, tileIds = []) {
  const devices = usageByDevice(doc, today, days);
  if (!devices.some((d) => Object.keys(d.days).length)) {
    return [`No usage recorded in the last ${days} days. The app starts counting once each device has reloaded into the build that has the usage log.`];
  }
  const out = [];
  for (const dev of devices) {
    const list = Object.values(dev.days);
    if (!list.length) continue;
    const opened = list.filter((d) => d.opens > 0).length;
    const opens = sum(list, (d) => d.opens);
    const minutes = Math.round(sum(list, (d) => d.sec) / 60);
    const last = list.at(-1);
    out.push(`${dev.kind} (${dev.id}): opened on ${opened} of ${days} days · ${opens} opens · ${minutes} min on screen${opened ? ` (${Math.round(minutes / opened)} a day used)` : ''}${last?.w ? ` · ${last.w}×${last.h}` : ''}`);
    const group = (g) => list.reduce((into, d) => addInto(into, d[g]), {});
    const hours = group('hours');
    if (Object.keys(hours).length) out.push(`  opened at: ${Object.entries(hours).sort((a, b) => a[0].localeCompare(b[0])).map(([hh, n]) => `${hh}h×${n}`).join(' ')}`);
    const from = group('from');
    if (Object.keys(from).length) out.push(`  came from: ${top(from).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
    const big = group('big');
    out.push(`  opened big: ${Object.keys(big).length ? top(big, 12).map(([k, n]) => `${k} ${n}`).join(' · ') : 'nothing'}`);
    const never = tileIds.filter((id) => !big[id]);
    if (tileIds.length && never.length) out.push(`  never opened big: ${never.join(', ')}`);
    if (dev.tiles?.hidden?.length) out.push(`  hidden tiles: ${dev.tiles.hidden.join(', ')}`);
    if (dev.tiles?.order?.length) out.push(`  tile order: ${dev.tiles.order.filter((id) => !dev.tiles.hidden?.includes(id)).join(', ')}`);
    const taps = group('taps');
    if (Object.keys(taps).length) out.push(`  taps: ${top(taps, 14).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
    const s = list.reduce((a, d) => ({ n: a.n + (d.sync?.n ?? 0), fail: a.fail + (d.sync?.fail ?? 0), ms: a.ms + (d.sync?.ms ?? 0), maxMs: Math.max(a.maxMs, d.sync?.maxMs ?? 0), kb: d.sync?.kb || a.kb }), { n: 0, fail: 0, ms: 0, maxMs: 0, kb: 0 });
    if (s.n) out.push(`  sync: ${s.n} runs, ${s.fail} failed · ${(s.ms / s.n / 1000).toFixed(1)} s on average, ${(s.maxMs / 1000).toFixed(1)} s at worst${s.kb ? ` · file ${s.kb} KB` : ''}`);
    const errors = group('errors');
    out.push(Object.keys(errors).length ? `  errors: ${top(errors, 6).map(([k, n]) => `${n}× ${k}`).join(' | ')}` : '  errors: none');
  }
  return out;
}
