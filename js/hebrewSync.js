// Read-only pull from the Hebrew app's own sync file (same shape of GitHub-file sync as js/sync.js,
// a different repo): a gzip+base64 snapshot of its localStorage. Applied as amount/done logs and
// milestone ticks against fixed records (a goal, a habit, three weekly targets and a ladder of
// milestones, created once and left alone after), so the app's existing weekly-target bars and
// streaks (js/schedule.js, js/ui/today.js) show real progress without any new UI. Never writes
// back to the Hebrew app's repo.
//
// WHICH OF ITS KEYS ARE READ, AND WHY THOSE. The Hebrew app's library size (hvr_stats[day].lib) is
// the obvious number and the wrong one: it counts every entry, drilled or not — 103 of 241 were in
// the "new" band on the last snapshot anyone checked — and it grows from seeds and imports, with
// each entry carrying its own inflections nested inside it. So the ladder is built from the four
// things the app knows that can't be padded:
//
//   hvr_stats[day].bands.strong  words the SRS has watched him hold for weeks AND that he has been
//                                accurate on recently — the app's own hardest band.
//   hvr_coachlanded              { word: lastLandedTs } — every word said live, unprompted and
//                                correctly, in a coach conversation. The app's own ledger.
//   hvr_pathscores               { nodeId: { lesson: { pct, ts, gold } } }. Lesson 99 is the coach
//                                graduation; `gold` is stamped there when every word a node
//                                teaches is SRS-ready AND has been said live. "Nodes perfected".
//   hvr_stats                    the per-day practice numbers: sec, sessions, spoken.
//
// Coach transcripts (hvr_coach, hvr_convo) are deliberately device-local in that app and never
// reach the file, so conversations can be counted by their outcome but never by their number.

export const HEBREW_IDS = {
  goal: 'hebrew-goal', habit: 'hebrew-habit', minutes: 'hebrew-minutes', spoken: 'hebrew-spoken', live: 'hebrew-live',
};

const OLD_GOAL_TITLE = 'Hold a 10-minute conversation in Hebrew';
// The lesson slot the Hebrew app files a node's coach graduation under, and where it stamps the
// flag saying that node has been perfected.
const COACH_LESSON = '99';

// How a calibrated step reads once it carries a real number, and how it reads before then. Each
// `add` in the ladder below is "this many more than he had the day the goal started", so no step
// can arrive already passed — see calibrate().
const TRACKS = {
  strong: { title: (n) => `Hold ${n} Hebrew words strong`, pending: (n) => `Hold ${n} more Hebrew words strong` },
  live: { title: (n) => `Say ${n} Hebrew words live in conversation`, pending: (n) => `Say ${n} more Hebrew words live in conversation` },
  gold: { title: (n) => `Perfect ${n} nodes on the Hebrew path`, pending: (n) => `Perfect ${n} more nodes on the Hebrew path` },
  days: { title: (n) => `Practise Hebrew on ${n} different days`, pending: (n) => `Practise Hebrew on ${n} more days` },
};

const step = (id, kind, add) => ({ id, title: TRACKS[kind].pending(add), auto: { kind, add } });

// The stages on the way, in the order they should come up. The four automatic tracks are
// interleaved with the five conversations, which only George can vouch for and so stay plain
// checkboxes. Their ids are the ones the first ladder used, so anything already ticked stays so.
export const HEBREW_LADDER = [
  { id: 'hebrew-ms-talk-hello', title: 'Greet her and introduce myself in Hebrew' },
  step('hebrew-ms-live-1', 'live', 25),
  step('hebrew-ms-gold-1', 'gold', 3),
  step('hebrew-ms-strong-1', 'strong', 50),
  { id: 'hebrew-ms-talk-1', title: 'Have a 1-minute exchange with her in Hebrew (how was your day)' },
  step('hebrew-ms-practised-1', 'days', 30),
  step('hebrew-ms-live-2', 'live', 75),
  step('hebrew-ms-gold-2', 'gold', 10),
  step('hebrew-ms-strong-2', 'strong', 150),
  { id: 'hebrew-ms-talk-3', title: 'Have a 3-minute chat with her in Hebrew, no English' },
  step('hebrew-ms-practised-2', 'days', 90),
  step('hebrew-ms-live-3', 'live', 200),
  step('hebrew-ms-gold-3', 'gold', 25),
  step('hebrew-ms-strong-3', 'strong', 300),
  { id: 'hebrew-ms-talk-5', title: 'Have a 5-minute chat with her in Hebrew about anything' },
  step('hebrew-ms-practised-3', 'days', 180),
  step('hebrew-ms-live-4', 'live', 400),
  step('hebrew-ms-gold-4', 'gold', 50),
  step('hebrew-ms-strong-4', 'strong', 600),
  { id: 'hebrew-ms-talk-10', title: 'Hold a 10-minute conversation in Hebrew' },
];

// Every word-count and day-count step the first two ladders used. Both counted the library, which
// is the number this file no longer trusts; version 3 replaces them with the four tracks above.
const RETIRED = [
  'hebrew-ms-words-50', 'hebrew-ms-words-100', 'hebrew-ms-words-250', 'hebrew-ms-words-500',
  'hebrew-ms-words-750', 'hebrew-ms-words-1000', 'hebrew-ms-words-1500', 'hebrew-ms-words-2000',
  'hebrew-ms-words-3000', 'hebrew-ms-days-7', 'hebrew-ms-days-30', 'hebrew-ms-days-45',
  'hebrew-ms-days-60', 'hebrew-ms-days-90', 'hebrew-ms-days-120', 'hebrew-ms-days-180',
];
const LADDER_VERSION = 3;

// Created once, however they're since renamed, retargeted or archived: this only fills in what's
// missing, it never resets an existing record. The exceptions are the goal's old title, renamed
// to plain "Hebrew" if (and only if) it's still exactly what this file first gave it, and a
// one-time move to the current ladder (retire the library-counting steps, put the rest in order),
// marked on the goal so it never runs again and never undoes edits made after it.
export function ensureHebrewGoal(store, { minutesTarget = 90, spokenTarget = 40, liveTarget = 15 } = {}) {
  const doc = store.doc();
  if (!doc.goals[HEBREW_IDS.goal]) {
    store.addGoal({ id: HEBREW_IDS.goal, title: 'Hebrew', source: 'hebrew' });
  } else if (doc.goals[HEBREW_IDS.goal].title === OLD_GOAL_TITLE) {
    store.updateGoal(HEBREW_IDS.goal, { title: 'Hebrew' });
  }
  const migrating = doc.goals[HEBREW_IDS.goal].ladderVersion !== LADDER_VERSION;
  HEBREW_LADDER.forEach(({ id, title, auto }, i) => {
    if (!doc.milestones[id]) store.addMilestone(HEBREW_IDS.goal, title, { id, auto, order: i + 1, source: 'hebrew' });
    else if (migrating) store.updateMilestone(id, { order: i + 1 });
  });
  if (migrating) {
    for (const id of RETIRED) if (doc.milestones[id]?.status === 'active') store.archiveMilestone(id);
    store.updateGoal(HEBREW_IDS.goal, { ladderVersion: LADDER_VERSION });
  }
  if (!doc.items[HEBREW_IDS.habit]) {
    store.addItem({
      id: HEBREW_IDS.habit, type: 'habit', title: 'Hebrew practice', area: 'Hebrew',
      goalId: HEBREW_IDS.goal, repeat: { kind: 'daily' }, source: 'hebrew',
    });
  }
  if (!doc.items[HEBREW_IDS.minutes]) {
    store.addItem({
      id: HEBREW_IDS.minutes, type: 'quota', title: 'Hebrew learning time', area: 'Hebrew',
      goalId: HEBREW_IDS.goal, target: minutesTarget, unit: 'minutes', source: 'hebrew',
    });
  }
  if (!doc.items[HEBREW_IDS.spoken]) {
    store.addItem({
      id: HEBREW_IDS.spoken, type: 'quota', title: 'Hebrew speaking practice', area: 'Hebrew',
      goalId: HEBREW_IDS.goal, target: spokenTarget, unit: 'count', unitLabel: 'reps spoken', source: 'hebrew',
    });
  }
  if (!doc.items[HEBREW_IDS.live]) {
    store.addItem({
      id: HEBREW_IDS.live, type: 'quota', title: 'Hebrew words said live', area: 'Hebrew',
      goalId: HEBREW_IDS.goal, target: liveTarget, unit: 'count', unitLabel: 'words live', source: 'hebrew',
    });
  }
}

// The envelope's `body` is gzip, then base64. DecompressionStream is a Web Streams API standard,
// available in the browser and in Node, so this needs no bundled inflate library.
async function gunzipBase64(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

// The envelope's `keys` map mirrors the Hebrew app's localStorage: every value is itself a JSON
// string. A key that is missing (a Hebrew app older than the feature that writes it) or unreadable
// reads as empty rather than failing the sync — the rest of the snapshot is still worth applying.
async function readSnapshot(envelope) {
  if (envelope?.enc !== 'gzip' || typeof envelope.body !== 'string') throw new Error("Not a Hebrew app sync file");
  const { keys } = JSON.parse(await gunzipBase64(envelope.body));
  const read = (name) => {
    try {
      const value = JSON.parse(keys?.[name] ?? 'null');
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  };
  return { stats: read('hvr_stats'), landed: read('hvr_coachlanded'), pathscores: read('hvr_pathscores') };
}

// The day a millisecond timestamp falls on WHERE HE IS, not in UTC: an evening session in a
// timezone ahead of UTC would otherwise be filed under the previous day. The Hebrew app writes its
// own day keys the same way.
function localDay(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// What the ladder is measured in. Each is a plain count of something the Hebrew app has already
// decided — none of them is re-derived here, so none can drift from what its own screens say.
function metricsOf({ stats, landed, pathscores }) {
  const days = Object.keys(stats).sort();
  let strong = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const bands = stats[days[i]]?.bands;
    if (bands && typeof bands.strong === 'number') { strong = bands.strong; break; }
  }
  return {
    strong,
    live: Object.keys(landed).length,
    gold: Object.values(pathscores).filter((node) => node?.[COACH_LESSON]?.gold === true).length,
    days: days.filter((day) => stats[day]?.sessions > 0).length,
  };
}

// The library size on the latest day that reports one. Shown in Settings beside the honest
// numbers, never used as a target — see the note at the top of this file.
function latestWords(stats) {
  const days = Object.keys(stats).sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const lib = stats[days[i]].lib;
    if (typeof lib === 'number') return lib;
  }
  return null;
}

// WHERE THE LADDER STARTS COUNTING FROM. A step created as "+50 strong words" becomes an ordinary
// fixed target the first time real numbers arrive: 50 above where he stood that day. That is the
// whole reason the ladder is written in `add` rather than in absolute numbers — the first two
// versions guessed at absolute ones and half the rungs ticked themselves on arrival, because he
// was already a long way into the app.
//
// Once. The baseline is stamped on the goal, and a calibrated step carries a plain `n` from then
// on, so retargeting one by hand afterwards sticks.
function calibrate(store, metrics) {
  const doc = store.doc();
  if (doc.goals[HEBREW_IDS.goal]?.hebrewBaseline) return;
  for (const m of Object.values(doc.milestones)) {
    if (m.goalId !== HEBREW_IDS.goal || m.status !== 'active' || !m.auto) continue;
    const { kind, add } = m.auto;
    if (!(add > 0) || !TRACKS[kind]) continue;
    const n = (metrics[kind] ?? 0) + add;
    store.updateMilestone(m.id, { auto: { kind, n }, title: TRACKS[kind].title(n) });
  }
  store.updateGoal(HEBREW_IDS.goal, { hebrewBaseline: { ...metrics, at: store.today() } });
}

// One log per day per metric, at a deterministic id: re-applying the same day's numbers is a
// no-op (store.putLog only writes when something actually changed), and a day whose numbers rise
// as the Hebrew app is used later that day just overwrites the same log with the larger total.
function applyDailyStats(store, { stats, landed }) {
  const doc = store.doc();
  const today = store.today();
  const active = (id) => doc.items[id]?.status === 'active';
  for (const [day, s] of Object.entries(stats)) {
    if (day > today) continue;
    if (active(HEBREW_IDS.minutes) && s.sec > 0) {
      // To one decimal minute, never rounded down to zero for a short burst under 30 seconds.
      const minutes = Math.round((s.sec / 60) * 10) / 10;
      store.putLog(`hebrew:min:${day}`, { itemId: HEBREW_IDS.minutes, kind: 'amount', amount: minutes, day, source: 'hebrew' });
    }
    if (active(HEBREW_IDS.spoken) && s.spoken > 0) {
      store.putLog(`hebrew:spoken:${day}`, { itemId: HEBREW_IDS.spoken, kind: 'amount', amount: s.spoken, day, source: 'hebrew' });
    }
    if (active(HEBREW_IDS.habit) && s.sessions > 0) {
      store.putLog(`hebrew:done:${day}`, { itemId: HEBREW_IDS.habit, kind: 'done', day, source: 'hebrew' });
    }
  }
  // Distinct words landed live on each day. The Hebrew app keeps only the LAST time it heard each
  // word, so a word said again in a later week moves with it and an earlier week's bar can fall
  // slightly on a re-sync. The weekly bar reads "words you said live that week", which stays true
  // under that rule; the milestones count the ledger as a whole, which is exact either way.
  if (active(HEBREW_IDS.live)) {
    const byDay = {};
    for (const ts of Object.values(landed)) {
      const day = typeof ts === 'number' ? localDay(ts) : null;
      if (day && day <= today) byDay[day] = (byDay[day] ?? 0) + 1;
    }
    for (const [day, n] of Object.entries(byDay)) {
      store.putLog(`hebrew:live:${day}`, { itemId: HEBREW_IDS.live, kind: 'amount', amount: n, day, source: 'hebrew' });
    }
  }
}

// Ticks any auto milestone whose rule has been reached. One-way: a milestone once ticked stays
// ticked (a count that later falls, or one unticked by hand, isn't fought), and an archived one is
// never touched. A step still carrying `add` has not been calibrated yet and so has no target to
// meet; it is skipped rather than compared against nothing.
function applyAutoMilestones(store, metrics) {
  for (const m of Object.values(store.doc().milestones)) {
    if (m.goalId !== HEBREW_IDS.goal || m.status !== 'active' || m.done || !m.auto) continue;
    const { kind, n } = m.auto;
    if (!(n > 0)) continue;
    if ((metrics[kind] ?? 0) >= n) store.updateMilestone(m.id, { done: true });
  }
}

// Fetch, parse and apply once. Like js/sync.js's syncOnce, this never throws: every failure comes
// back as { ok: false, error }. No file yet is not a failure — there's nothing to apply yet.
export async function syncHebrewProgress({ store, client }) {
  let remote;
  try {
    remote = await client.get();
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!remote) return { ok: true, words: null };
  let snapshot;
  try {
    snapshot = await readSnapshot(remote.doc);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  ensureHebrewGoal(store);
  const metrics = metricsOf(snapshot);
  // A file with no practice history at all can't say where he stands, and calibrating the ladder
  // against zero would recreate exactly the too-easy rungs this version exists to fix. Wait for a
  // snapshot with something in it.
  if (Object.keys(snapshot.stats).length) calibrate(store, metrics);
  applyDailyStats(store, snapshot);
  applyAutoMilestones(store, metrics);
  return { ok: true, words: latestWords(snapshot.stats), ...metrics };
}
