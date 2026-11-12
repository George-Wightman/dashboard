// Stocks for Claude (docs/superpowers/specs/2026-11-12-stocks-design.md): the `stocks` read, the
// routine's compact `stocks brief-input`, and `stocks-write`, which merges into stocks/desk.json in
// the private sync repo with the caps the design sets. The planner owns stocks/market.json.

import { MARKET_PATH, DESK_PATH, LENSES, TIERS, validDesk, validMarket, lensesFor, verdict, notesFor, stocksView } from '../js/stocks.js';
import { daysBetween, shortWeekday, shortDate } from '../js/dates.js';

export const CAPS = { daily: 8, weekly: 15, happened: 3, coming: 3, look: 2, notesPerSubject: 5, runs: 60 };
const LETTER = { green: 'g', amber: 'a', red: 'r', grey: '-' };
const NAME = { g: 'green', a: 'amber', r: 'red', '-': 'grey' };

export const emptyDesk = () => ({ v: 1, symbols: {}, tiers: {}, themes: [], theses: {}, lensNotes: {}, events: [], brief: null, notes: [], shortlist: [], insider: {}, alert: null, meta: { runs: [] } });

const londonDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
const dayOf = (iso) => String(iso ?? '').slice(0, 10);
const gbp = (x) => (x == null ? '—' : `£${Math.round(x).toLocaleString('en-GB')}`);
const pctTxt = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;
const dotsOf = (ticker, market, desk) => { const l = lensesFor(ticker, market, desk); return LENSES.map((k) => LETTER[l[k].dot]).join(''); };

export async function readStocks(files) {
  const parse = async (path, valid) => {
    const f = await files.read(path);
    if (!f) return null;
    let doc;
    try { doc = JSON.parse(f.text); } catch { throw new Error(`${path} in the sync repo isn't JSON`); }
    if (!valid(doc)) throw new Error(`${path} in the sync repo is malformed`);
    return doc;
  };
  return { market: await parse(MARKET_PATH, validMarket), desk: await parse(DESK_PATH, validDesk) };
}

function holdings(market, desk) {
  const symbols = desk?.symbols ?? {};
  return (market?.positions?.list ?? []).map((p) => ({ ...p, ticker: symbols[p.t212]?.ticker ?? null }));
}

// The routine's one read: what's held, what changed, what's due, and what to search, capped.
export function briefInput(market, desk, today, kind = 'daily') {
  const cap = kind === 'weekly' ? CAPS.weekly : CAPS.daily;
  const out = [`Stocks brief input — ${kind} run, ${shortWeekday(today)} ${shortDate(today)}. Search cap: ${cap}.`];
  const held = holdings(market, desk);
  const tierOf = (t) => desk?.tiers?.[t] ?? null;
  out.push('Holdings (ticker, tier, lenses T P H E R as g/a/r/-, verdict, value):');
  for (const h of held.filter((x) => x.ticker && tierOf(x.ticker)).sort((a, b) => (b.valueGbp ?? 0) - (a.valueGbp ?? 0))) {
    const tier = tierOf(h.ticker);
    out.push(`  ${h.ticker} ${tier} ${dotsOf(h.ticker, market, desk)} ${verdict(lensesFor(h.ticker, market, desk), tier) ?? '—'} ${gbp(h.valueGbp)}`);
  }
  const fresh = held.filter((x) => !x.ticker || !tierOf(x.ticker));
  if (fresh.length) out.push(`New holdings needing a tier and thesis: ${fresh.map((x) => x.ticker ?? x.t212).join(', ')}`);

  const last = desk?.meta?.lastDots ?? {};
  const triggers = [];
  for (const h of held.filter((x) => x.ticker && tierOf(x.ticker) === 'watched')) {
    const t = h.ticker;
    const why = [];
    const l = market?.lenses?.[t];
    if (l && l.sigma > 0 && Math.abs(l.moveToday) > 2 * l.sigma) why.push(`moved ${pctTxt(l.moveToday)} (${(Math.abs(l.moveToday) / l.sigma).toFixed(1)}σ)`);
    for (const e of (desk?.events ?? []).filter((x) => x.ticker === t)) {
      const d = daysBetween(today, e.day);
      if (e.kind === 'results' && Math.abs(d) <= 2) why.push(d === 0 ? 'results today' : d > 0 ? `results in ${d} day${d === 1 ? '' : 's'}` : `results ${-d} day${d === -1 ? '' : 's'} ago`);
      else if (d === 0) why.push(`${e.kind} today: ${e.text}`);
    }
    const now = dotsOf(t, market, desk);
    if (last[t]) LENSES.forEach((k, i) => { if (last[t][i] !== now[i]) why.push(`${k} ${NAME[last[t][i]]}→${NAME[now[i]]}`); });
    const n = notesFor(t, desk);
    if (n.next?.due && n.next.due <= today) why.push(`your note: ${n.next.text}`);
    if (!n.lastLooked) why.push('never looked at');
    else if (daysBetween(n.lastLooked, today) >= 7) why.push(`last looked ${daysBetween(n.lastLooked, today)} days ago`);
    if (why.length) triggers.push({ t, why, value: h.valueGbp ?? 0, looked: n.lastLooked ?? '' });
  }
  triggers.sort((a, b) => b.value - a.value || (a.looked < b.looked ? -1 : 1));
  const take = triggers.slice(0, cap);
  const skip = triggers.slice(cap);
  out.push(take.length ? `Search these, in order: ${take.map((x) => `${x.t} (${x.why.join('; ')})`).join(' · ')}` : 'Search these: nothing triggered. Write a quiet brief.');
  if (skip.length) out.push(`Skip (over the cap; note them in the run record): ${skip.map((x) => x.t).join(', ')}`);

  const themes = [...(desk?.themes ?? [])].filter((t) => t.holdings.some((k) => tierOf(k) !== 'pie'))
    .map((t) => ({ t, at: notesFor(`theme:${t.id}`, desk).lastLooked ?? '' })).sort((a, b) => (a.at < b.at ? -1 : 1));
  const themeCount = kind === 'weekly' ? 3 : 2;
  if (themes.length) out.push(`Themes to search (oldest first, take ${themeCount}): ${themes.slice(0, themeCount).map(({ t }) => `${t.name} [theme:${t.id}]${t.interests?.length ? ` incl. interests ${t.interests.join(', ')}` : ''}`).join(' · ')}`);

  const coming = (desk?.events ?? []).filter((e) => e.day >= today && daysBetween(today, e.day) <= 7).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (coming.length) out.push(`Coming up (7 days): ${coming.map((e) => `${shortWeekday(e.day)} ${shortDate(e.day)} ${e.text}`).join(' · ')}`);
  const due = (desk?.notes ?? []).filter((n) => n.kind === 'next' && !n.closed && n.due && n.due <= today && !n.subject.match(/^[A-Z0-9.]+$/));
  if (due.length) out.push(`Your other due notes: ${due.map((n) => `${n.subject}: ${n.text}`).join(' · ')}`);
  for (const t of Object.keys(desk?.theses ?? {}).filter((k) => desk.theses[k].watch?.length)) out.push(`  Watch for ${t}: ${desk.theses[t].watch.join('; ')}`);
  if (desk?.alert) out.push(`Current alert (${dayOf(desk.alert.at)}): ${desk.alert.text}`);
  const lastRun = (desk?.meta?.runs ?? []).at(-1);
  if (lastRun) out.push(`Last run: ${lastRun.at} (${lastRun.kind}, ${lastRun.searches} searches)`);
  if (market?.positions?.error) out.push(`Holdings note: ${market.positions.error}`);
  return out;
}

const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const keyed = (base, patch) => {
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch ?? {})) { if (v === null) delete out[k]; else out[k] = v; }
  return out;
};

// Merges a patch from a chat or the routine into the desk. Throws, naming the cap, when a patch
// goes over one. `now` stamps notes, the alert and the run.
export function mergeDesk(desk, patch, now) {
  const d = structuredClone(desk ?? emptyDesk());
  const at = now.toISOString();
  if (patch.brief !== undefined) {
    const b = patch.brief;
    if (b) {
      need((b.happened ?? []).length <= CAPS.happened, `What happened holds at most ${CAPS.happened} items`);
      need((b.coming ?? []).length <= CAPS.coming, `Coming up holds at most ${CAPS.coming} items`);
      need((b.look ?? []).length <= CAPS.look, `Worth a look holds at most ${CAPS.look} items`);
    }
    d.brief = b ? { at, verdict: 'Nothing that changes your view today.', happened: [], coming: [], look: [], payday: null, ...b } : null;
  }
  if (patch.symbols) {
    for (const s of Object.values(patch.symbols)) {
      if (s === null) continue;
      need(s.ticker && (s.yahoo || s.stooq), 'A symbol needs its ticker and a yahoo or stooq code for its price');
      need(['USD', 'EUR', 'GBP', 'GBp'].includes(s.ccy), 'A symbol needs ccy: USD, EUR, GBP, or GBp for a London price in pence');
    }
  }
  for (const part of ['symbols', 'theses', 'insider']) if (patch[part]) d[part] = keyed(d[part], patch[part]);
  if (patch.tiers) {
    for (const v of Object.values(patch.tiers)) need(v === null || TIERS.includes(v), `A tier is one of ${TIERS.join(', ')}`);
    d.tiers = keyed(d.tiers, patch.tiers);
  }
  if (patch.lensNotes) {
    d.lensNotes = d.lensNotes ?? {};
    for (const [t, v] of Object.entries(patch.lensNotes)) {
      if (v === null) { delete d.lensNotes[t]; continue; }
      d.lensNotes[t] = { ...(d.lensNotes[t] ?? {}) };
      for (const [k, l] of Object.entries(v)) { if (l === null) delete d.lensNotes[t][k]; else d.lensNotes[t][k] = { at, ...l }; }
    }
  }
  if (patch.themes) {
    for (const t of patch.themes) {
      const i = d.themes.findIndex((x) => x.id === t.id);
      if (t.remove) { if (i >= 0) d.themes.splice(i, 1); continue; }
      const theme = { holdings: [], also: [], interests: [], ...(i >= 0 ? d.themes[i] : {}), ...t };
      if (i >= 0) d.themes[i] = theme; else d.themes.push(theme);
    }
  }
  if (patch.shortlist) {
    for (const s of patch.shortlist) {
      const i = d.shortlist.findIndex((x) => x.ticker === s.ticker);
      if (i >= 0) d.shortlist[i] = { ...d.shortlist[i], ...s }; else d.shortlist.push({ status: 'watching', why: null, ...s });
    }
  }
  if (patch.events) {
    d.events = d.events ?? [];
    const key = (e) => `${e.day}|${e.ticker ?? e.theme ?? ''}|${e.kind}`;
    for (const e of patch.events) {
      const i = d.events.findIndex((x) => key(x) === key(e));
      if (e.remove) { if (i >= 0) d.events.splice(i, 1); continue; }
      const ev = { ticker: null, theme: null, kind: 'other', ...e };
      if (i >= 0) d.events[i] = ev; else d.events.push(ev);
    }
    const cutoff = new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10);
    d.events = d.events.filter((e) => e.day >= cutoff);
  }
  if (patch.notes) {
    for (const n of patch.notes) {
      need(n.subject && ['looked', 'thinking', 'next'].includes(n.kind) && n.text, 'A note needs a subject, a kind (looked, thinking or next) and text');
      if (n.answers) for (const x of d.notes) if (x.subject === n.subject && x.kind === 'next' && x.at === n.answers) x.closed = true;
      const { answers, ...rest } = n;
      d.notes.push({ at, due: null, closed: false, ...rest });
    }
  }
  if (patch.fold) {
    for (const f of patch.fold) {
      const mine = d.notes.filter((n) => n.subject === f.subject).sort((a, b) => (a.at < b.at ? 1 : -1));
      const keep = new Set(mine.slice(0, 2));
      const gone = mine.filter((n) => !keep.has(n) && !(n.kind === 'next' && !n.closed));
      if (!gone.length) continue;
      d.notes = d.notes.filter((n) => !gone.includes(n));
      d.notes.push({ at, subject: f.subject, kind: 'summary', text: f.text, due: null, closed: false });
    }
  }
  // At most five notes a subject: the oldest go first, but an open next note is never dropped.
  const openNext = (n) => n.kind === 'next' && !n.closed;
  const bySubject = new Map();
  for (const n of [...d.notes].filter((x) => !openNext(x)).sort((a, b) => (a.at < b.at ? 1 : -1))) {
    const list = bySubject.get(n.subject) ?? [];
    list.push(n);
    bySubject.set(n.subject, list);
  }
  d.notes = d.notes.filter((n) => {
    if (openNext(n)) return true;
    const room = CAPS.notesPerSubject - d.notes.filter((x) => x.subject === n.subject && openNext(x)).length;
    return bySubject.get(n.subject).indexOf(n) < Math.max(room, 1);
  });
  if (patch.alert !== undefined) {
    if (patch.alert) {
      need(!(d.alert?.at && londonDay(new Date(d.alert.at)) === londonDay(now) && d.alert.id !== patch.alert.id), 'There is already an alert today: one alert a day at most');
      d.alert = { ticker: null, ...patch.alert, at };
    } else d.alert = null;
  }
  if (patch.run) {
    d.meta.runs.push({ looked: [], skipped: [], tokens: null, pct: null, ...patch.run, at });
    d.meta.runs = d.meta.runs.slice(-CAPS.runs);
  }
  return d;
}

export async function writeStocks(files, text, now = new Date()) {
  let patch;
  try { patch = JSON.parse(text); } catch { throw new Error('stocks-write needs a JSON file'); }
  const { market, desk } = await readStocks(files);
  const merged = mergeDesk(desk, patch, now);
  // What the lenses looked like at this write, so the next brief-input can say what changed.
  merged.meta.lastDots = Object.fromEntries(Object.keys(merged.tiers).map((t) => [t, dotsOf(t, market, merged)]));
  need(validDesk(merged), "That doesn't fit stocks/desk.json (see reference stocks)");
  await files.write(DESK_PATH, `${JSON.stringify(merged)}\n`, 'stocks: desk');
  const parts = Object.keys(patch).filter((k) => patch[k] !== undefined);
  return `Saved stocks/desk.json: ${parts.join(', ') || 'nothing'}`;
}

// The chat read.
export function stocksLines(market, desk, today) {
  if (!market && !desk) return ['No stocks files yet: the planner writes stocks/market.json once his Trading 212 key is in, and `stocks-write` starts stocks/desk.json.'];
  const v = stocksView(market, desk, today);
  const out = [`Portfolio ${gbp(v.value)} · today ${v.dayMovePct == null ? '—' : `${v.dayMovePct > 0 ? '+' : ''}${v.dayMovePct}%`} · all time ${gbp(v.allTime)}`];
  if (v.positionsNote) out.push(v.positionsNote);
  out.push(v.verdictLine);
  for (const t of v.themes) {
    out.push(`${t.name} (${t.dot})${t.reason ? ` — ${t.reason}` : ''}`);
    for (const r of t.rows) out.push(`  ${r.ticker} ${r.dots.map((x) => LETTER[x]).join('')} ${r.verdict ?? r.tier ?? ''}${r.also ? ' (watched here too)' : ''}${r.hint ? ` · ${r.hint}` : ''}${r.card.thesis ? ` · "${r.card.thesis.line}"` : ''}`);
  }
  if (v.unsorted.length) out.push(`Not sorted yet: ${v.unsorted.map((r) => r.ticker).join(', ')}`);
  if (v.coming.length) out.push(`Coming up: ${v.coming.map((c) => c.text).join(' · ')}`);
  if (v.look) out.push(`Worth a look: ${v.look.text}`);
  if (v.shortlist.length) out.push(`Shortlist: ${v.shortlist.map((s) => `${s.ticker} (${s.theme}, ${s.status}${s.sincePct != null ? `, ${s.sincePct > 0 ? '+' : ''}${s.sincePct}% since ${s.day}` : ''})`).join(' · ')}`);
  out.push(`This week: ${v.usage.runs} runs, ${v.usage.searches} searches${v.usage.tokens != null ? `, ~${Math.round(v.usage.tokens / 1000)}k tokens` : ''}${v.usage.pct != null ? `, ${v.usage.pct}% of the weekly limit` : ''}`);
  return out;
}
