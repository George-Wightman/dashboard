// Read-only pull from the Hebrew app's own sync file (same shape of GitHub-file sync as js/sync.js,
// a different repo): a gzip+base64 snapshot of its localStorage. The only key that matters here is
// hvr_stats, its day-by-day practice numbers — seconds practiced, sessions, spoken reps and their
// accuracy, and the running size of its vocabulary library. Applied as amount/done logs against
// three fixed records (a goal, a habit and two weekly targets, created once and left alone after),
// so the app's existing weekly-target bars and streaks (js/schedule.js, js/ui/today.js) show real
// progress without any new UI. Never writes back to the Hebrew app's repo.

export const HEBREW_IDS = { goal: 'hebrew-goal', habit: 'hebrew-habit', minutes: 'hebrew-minutes', spoken: 'hebrew-spoken' };

// Created once, however they're since renamed, retargeted or archived: this only fills in what's
// missing, it never resets an existing record.
export function ensureHebrewGoal(store, { minutesTarget = 90, spokenTarget = 40 } = {}) {
  const doc = store.doc();
  if (!doc.goals[HEBREW_IDS.goal]) {
    store.addGoal({ id: HEBREW_IDS.goal, title: 'Hold a 10-minute conversation in Hebrew', source: 'hebrew' });
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
}

// The envelope's `body` is gzip, then base64. DecompressionStream is a Web Streams API standard,
// available in the browser and in Node, so this needs no bundled inflate library.
async function gunzipBase64(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

// The envelope's `keys` map mirrors the Hebrew app's localStorage: every value is itself a JSON
// string. Only hvr_stats is read; everything else (its SRS schedule, vocabulary bank, curriculum
// scores) is left alone — there's no goal here that needs them yet.
async function readDailyStats(envelope) {
  if (envelope?.enc !== 'gzip' || typeof envelope.body !== 'string') throw new Error("Not a Hebrew app sync file");
  const { keys } = JSON.parse(await gunzipBase64(envelope.body));
  const raw = keys?.hvr_stats;
  return raw ? JSON.parse(raw) : {};
}

// One log per day per metric, at a deterministic id: re-applying the same day's numbers is a
// no-op (store.putLog only writes when something actually changed), and a day whose numbers rise
// as the Hebrew app is used later that day just overwrites the same log with the larger total.
function applyDailyStats(store, stats) {
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
}

// The vocabulary library size on the latest day that reports one, for a status line — there's no
// weekly target for this, it's just shown, so it isn't logged as an amount anywhere.
function latestWords(stats) {
  const days = Object.keys(stats).sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const lib = stats[days[i]].lib;
    if (typeof lib === 'number') return lib;
  }
  return null;
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
  let stats;
  try {
    stats = await readDailyStats(remote.doc);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  ensureHebrewGoal(store);
  applyDailyStats(store, stats);
  return { ok: true, words: latestWords(stats) };
}
