// Boot: one store, one render loop, the header, sync, and the day rollover.

import { createStore, DATA_KEY } from './data.js';
import { askGemini, geminiKeys, hebrewKeys } from './gemini.js';
import { longDate } from './dates.js';
import { dayCompletion, dayScore } from './schedule.js';
import { ensureCommitment } from './commit.js';
import { createGitHubClient, syncOnce, createSyncScheduler, mergeStoredEvents } from './sync.js';
import { syncHebrewProgress } from './hebrewSync.js';
import { renderToday } from './ui/today.js';
import { openTaskCard } from './ui/agenda.js';
import { renderSide, WIDGET_IDS, setArranging } from './ui/widgets.js';
import { openEditor } from './ui/edit.js';
import { openSettings } from './ui/settings.js';
import { checkinState, openCheckin } from './ui/checkin.js';
import { paintBig } from './ui/big.js';
import { resolveLook, THEME_COLORS } from './look.js';
import { LAYOUT_KEY, loadLayout, saveLayout, normalizeLayout } from './layout.js';
import { readLastSynced, writeLastSynced, waitingFlags, APP_VERSION } from './flags.js';
import { openFlagPanel } from './ui/flags.js';
import { createUpdater, runningBuild, IDLE_CHECK_GAP } from './version.js';
import { h } from './ui/dom.js';
import { plannerNotes, staleSince, visibleNotes, briefFor, offLine } from './calendar.js';
import { LOGOS } from './ui/sources.js';

const store = createStore({ storage: localStorage });
const ui = {
  noteFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false, closeEditor: null,
  // The widget opened big (js/ui/big.js): its registry entry, or null.
  big: null,
  // Arrange mode (js/ui/widgets.js): toggled by #arrange-button, Escape, or Done.
  arranging: false,
  // The check-in card's page-only state (js/ui/checkin.js): what's typed or said, so a re-render
  // never loses it.
  checkin: checkinState(),
};
const sync = { state: 'off', at: null, error: null };
// The read-only pull from the Hebrew app's own sync file (js/hebrewSync.js): a separate repo and
// token from the main sync above, so its own state and words-known count for ⚙ to show.
const hebrew = { state: 'off', at: null, error: null, words: null, strong: null, live: null, gold: null };

// The widget arrangement (js/layout.js): kept on this device, never synced. A window at least
// 1500px wide shows two widget columns (the same media query as styles.css), a smaller one one.
const WIDE = matchMedia('(min-width: 1500px)');
let layout = loadLayout(localStorage, WIDGET_IDS);

// Canned Gemini for local testing: only on localhost, only with ?fakegemini (or =<mode>). In
// fake mode the real keys are never read, and dev/fake-gemini.js answers instead of Google (the
// check-in summaries, js/ui/checkin.js).
const params = new URLSearchParams(location.search);
const FAKE = (['localhost', '127.0.0.1'].includes(location.hostname) && params.has('fakegemini'))
  ? (params.get('fakegemini') || 'ok') : null;

// Updates (js/version.js): the build this page was served, checked against the site on open, on
// focus and every ten minutes. A newer one is cached whole, then offered in the header and in ⚙.
// Read once, now: with no date on the page, document.lastModified is "the time you asked".
const updater = createUpdater({
  running: runningBuild(document.lastModified, performance.timeOrigin),
  worker: navigator.serviceWorker ?? null,
  onReady: () => renderHeader(),
});

const ctx = {
  store,
  ui,
  render,
  updater,
  applyUpdate: () => updater.apply(() => location.reload()),
  openEditor: (opts) => openEditor(ctx, opts),
  openSettings: () => openSettings(ctx),
  syncNow: () => scheduler.now(),
  syncProblem: () => (sync.state === 'failing' ? sync.error : ''),
  hebrewSyncNow: () => scheduler.now(),
  hebrewSyncProblem: () => (hebrew.state === 'failing' ? hebrew.error : ''),
  hebrewStatus: () => ({ words: hebrew.words, at: hebrew.at }),
  // Whether sync is actually set up (never true in fake mode, which never syncs), and when it
  // last succeeded (js/flags.js): together these decide the ⚑'s teal "waiting" state.
  syncOn: () => !FAKE && !!store.settings().token && !!store.settings().repo,
  lastSynced: () => readLastSynced(localStorage),
  // What the app was doing right now, for the ⚑ panel (js/ui/flags.js) to capture the instant it
  // opens (js/flags.js's flagContext reads exactly this shape).
  flagState: () => ({
    now: new Date(),
    today: store.today(),
    settings: store.settings(),
    look: document.documentElement.dataset.theme,
    window: { width: innerWidth, height: innerHeight },
    columns: ctx.columnCount(),
    layout: ctx.layout(),
    arranging: ui.arranging,
    day: dayCompletion(store.doc(), store.today()),
    expandedGoals: ui.expandedGoals.size,
    historyDay: ui.historyDay,
    checkin: { error: ui.checkin.error },
    sync: { state: sync.state, error: sync.error, lastSynced: readLastSynced(localStorage) },
    hebrewKey: hebrewKeys(localStorage).length > 0,
    version: APP_VERSION,
    userAgent: navigator.userAgent,
  }),
  whenIdle,
  // The widget arrangement, how many widget columns show, and every change to it: normalised,
  // saved on this device, drawn (js/ui/widgets.js).
  layout: () => layout,
  columnCount: () => (WIDE.matches ? 2 : 1),
  setLayout(next) {
    layout = normalizeLayout(next, WIDGET_IDS);
    saveLayout(localStorage, layout);
    render();
  },
  // Gemini, for tidying a check-in's answer into a short note (js/ui/checkin.js).
  gemini: {
    fake: FAKE,
    // Every key to try, in order: the one in ⚙, then the Hebrew app's on this device.
    keys: () => (FAKE ? (FAKE === 'nokey' ? [] : ['fake-key']) : geminiKeys(store.settings(), localStorage)),
    async ask({ system, prompt }) {
      // The fake module is only ever loaded in fake mode; otherwise askGemini uses the real fetch.
      const fetch = FAKE ? (await import('../dev/fake-gemini.js')).fakeGeminiFetch(FAKE) : undefined;
      return askGemini({ keys: ctx.gemini.keys(), system, prompt, fetch });
    },
  },
};

let shownDay = store.today();

function syncLabel() {
  switch (sync.state) {
    case 'off': return ['on this device', 'Sync is off. Add a repo and an access key in settings.'];
    case 'syncing': return ['syncing…', ''];
    case 'offline': return ['offline', "Can't reach GitHub. Working on this device."];
    case 'failing': return ['sync failing', `${sync.error ?? ''} — click for details`];
    default: return [`synced ${sync.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'Click to sync now'];
  }
}

// The planner's notes under the date (js/calendar.js), each hidden with × on this device until the
// next day. Kept as "<day>|<note>"; only today's are kept.
const NOTES_HIDDEN_KEY = 'dash_notes_hidden';

function hiddenNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_HIDDEN_KEY)) ?? []; } catch { return []; }
}

function hideNote(day, text) {
  const keep = hiddenNotes().filter((k) => k.startsWith(`${day}|`));
  try { localStorage.setItem(NOTES_HIDDEN_KEY, JSON.stringify([...keep, `${day}|${text}`])); } catch { /* best effort */ }
  renderHeader();
}

function renderHeader() {
  const today = store.today();
  document.getElementById('date').textContent = longDate(today);
  const { done, total, pushed } = dayScore(store.doc(), today);
  document.getElementById('count').textContent = total ? `${done} of ${total} done${pushed.length ? ` · ${pushed.length} pushed` : ''}` : '';
  document.title = total ? `Today · ${done}/${total}` : 'Today';

  const warning = document.getElementById('save-warning');
  const problem = store.saveError() ? "Couldn't save on this device. Export a backup from settings." : store.loadError();
  warning.hidden = !problem;
  warning.textContent = problem ?? '';
  document.getElementById('update-ready').hidden = !updater.state().ready;
  document.getElementById('update-ready').title = updater.state().error ?? 'Reload into the downloaded update';

  // Under the date: Claude's brief, any time off today, then the planner's latest notes — each hidden with × for the rest of the day on this device.
  // The × leads each line, so it sits in the same place however long the note is.
  const notes = visibleNotes(plannerNotes(store.doc(), today), hiddenNotes(), today);
  const hidden = new Set(hiddenNotes());
  const shown = (text) => text && !hidden.has(`${today}|${text}`);
  const brief = briefFor(store.doc(), today);
  const off = offLine(store.doc(), today);
  const line = (cls, text, lead = null, action = null) => h('p', { class: cls },
    h('button', { class: 'link hide-note', type: 'button', title: 'Hide this note', 'aria-label': `Hide: ${text}`, onclick: () => hideNote(today, text) }, '×'),
    lead,
    h('span', {}, text),
    action);
  const mark = (logo, label) => {
    const el = h('span', { class: 'src', title: label, role: 'img', 'aria-label': label });
    el.innerHTML = LOGOS[logo]; // a fixed string from js/ui/sources.js, never data
    return el;
  };
  const notesEl = document.getElementById('planner-notes');
  notesEl.replaceChildren(...[
    shown(brief) ? line('brief', brief, mark('claude', 'From Claude')) : null,
    shown(off) ? line('off', off) : null,
    ...notes.map((text) => line('', text)),
  ].filter(Boolean));
  notesEl.hidden = !notesEl.children.length;
  const stale = staleSince(store.doc(), new Date());
  const plannerWarning = document.getElementById('planner-warning');
  plannerWarning.hidden = !stale;
  plannerWarning.textContent = stale ? `calendar planner hasn't run since ${stale}` : '';

  const status = document.getElementById('sync-status');
  const [text, title] = syncLabel();
  status.textContent = text;
  status.title = title;
  status.classList.toggle('sync-failing', sync.state === 'failing');

  document.getElementById('flag-button').classList.toggle(
    'waiting', ctx.syncOn() && waitingFlags(store.doc(), ctx.lastSynced()).length > 0);

  const arrangeButton = document.getElementById('arrange-button');
  arrangeButton.textContent = ui.arranging ? 'Done' : 'Arrange';
  arrangeButton.setAttribute('aria-pressed', String(ui.arranging));
  document.querySelector('.today').classList.toggle('arranging', ui.arranging);
  document.getElementById('arrange-note').hidden = !ui.arranging;
  // pointer-events: none (styles.css) dims the list to the mouse while arranging;
  // inert keeps Tab off them too, and comes off again as soon as render() runs with Arrange off.
  document.getElementById('list').inert = ui.arranging;
}

// The look (js/look.js): data-theme on <html>, and the title bar's colour. index.html's inline
// script has already set both before the first paint; this keeps them right as the hours pass,
// on focus, and whenever ⚙ changes. Only touches the page when something actually changes.
function applyLook() {
  const look = resolveLook(new Date(), store.settings());
  const root = document.documentElement;
  if (root.dataset.theme !== look) root.dataset.theme = look;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.getAttribute('content') !== THEME_COLORS[look]) meta.setAttribute('content', THEME_COLORS[look]);
}

function render() {
  renderHeader();
  renderToday(ctx);
  renderSide(ctx);
  paintBig(ctx);
  if (!ui.openedLinkedTask && params.has('task') && store.doc().items[params.get('task')]) {
    ui.openedLinkedTask = true;
    queueMicrotask(() => openTaskCard(ctx, params.get('task')));
  }
}

// A storage-event save held back while typing/editing (see below), absorbed as soon as a sync
// is allowed to run rather than being lost.
let pendingStored = null;

async function runSync() {
  if (pendingStored) {
    store.absorbStored(pendingStored);
    pendingStored = null;
  }
  // Fake mode never contacts GitHub: it's local-only, testing Gemini, not sync.
  if (FAKE) { sync.state = 'off'; renderHeader(); return; }
  const { token, repo } = store.settings();
  if (!token || !repo) { sync.state = 'off'; renderHeader(); return; }
  if (!navigator.onLine) { sync.state = 'offline'; renderHeader(); return; }
  sync.state = 'syncing';
  renderHeader();
  try {
    // Recorded before the request, so a flag saved while this sync is still in flight still
    // counts as "waiting" (js/flags.js's waitingFlags).
    const started = new Date().toISOString();
    const result = await syncOnce({ store, client: createGitHubClient({ token, repo }) });
    Object.assign(sync, result.ok
      ? { state: 'ok', at: new Date(), error: null }
      : { state: 'failing', error: result.error });
    if (result.ok) writeLastSynced(localStorage, started);
    return result;
  } catch (e) {
    Object.assign(sync, { state: 'failing', error: e.message });
    return { ok: false, error: e.message };
  } finally {
    renderHeader();
  }
}

// Read-only, so no conflicts and no push: just fetch, apply, and remember whether it worked. Runs
// alongside the main sync above (same schedule), but never blocks or is blocked by it.
async function runHebrewSync() {
  const { hebrewRepo, hebrewToken } = store.settings();
  if (FAKE || !hebrewRepo || !hebrewToken) { hebrew.state = 'off'; return; }
  if (!navigator.onLine) { hebrew.state = 'offline'; return; }
  hebrew.state = 'syncing';
  try {
    const result = await syncHebrewProgress({ store, client: createGitHubClient({ token: hebrewToken, repo: hebrewRepo, path: 'progress.json' }) });
    Object.assign(hebrew, result.ok
      ? {
        state: 'ok', at: new Date(), error: null, words: result.words ?? hebrew.words,
        strong: result.strong ?? hebrew.strong, live: result.live ?? hebrew.live, gold: result.gold ?? hebrew.gold,
      }
      : { state: 'failing', error: result.error });
  } catch (e) {
    Object.assign(hebrew, { state: 'failing', error: e.message });
  }
}

// Something half-typed must never be wiped by a sync landing and re-rendering. Only inside the
// re-rendered areas (#list, #under, #side) — the check-in box included.
function typing() {
  const el = document.activeElement;
  return !!el && el.matches('input[type=text], input:not([type]), textarea') && el.value !== ''
    && !!el.closest('#list, #under, #side');
}

function canRun() {
  return !ui.editorDirty && !typing();
}

// A promise that resolves once nothing is being typed or edited — immediately if canRun() is
// already true, otherwise re-checked every 400ms. A check-in's summary lands only after this, so a
// background Gemini reply can never wipe a half-typed goal amount, milestone or Today input.
function whenIdle() {
  return new Promise((resolve) => {
    const check = () => {
      if (canRun()) resolve();
      else setTimeout(check, 400);
    };
    check();
  });
}

const scheduler = createSyncScheduler({
  run: async () => {
    // Hebrew first: a goal or target it creates on its first run then rides along on this same
    // pass's push to the main sync repo, rather than waiting for the next one.
    await runHebrewSync();
    return runSync();
  },
  canRun,
  canPoll: () => ctx.syncOn() && !document.hidden && navigator.onLine !== false,
});

// The app sits open all day: when the logical day changes, rebuild.
function checkRollover() {
  const day = store.today();
  if (day !== shownDay) {
    shownDay = day;
    ui.historyDay = null;
    // A new day: yesterday's check-in drafts no longer apply.
    ui.checkin = checkinState();
    render();
  }
}

function wake() {
  applyLook();
  checkRollover();
  scheduler.now();
  updater.check();
}

// The day's list locks at 11:00 (js/commit.js): checked after every change and once a minute.
function lockDay() {
  try { ensureCommitment(store, store.today(), new Date()); } catch { /* the planner locks it too */ }
}

store.subscribe((reason) => {
  queueMicrotask(lockDay);
  // A request may have started before typing began. Gate the redraw when it
  // finishes too; the saved data can safely advance while an input stays put.
  if (reason === 'sync' && !canRun()) { renderHeader(); whenIdle().then(render); }
  else render();
  if (reason === 'local') scheduler.changed();
  // A local change has just re-rendered anyway (the edit panel is never re-rendered from here),
  // so this is a safe moment to absorb a held other-window save rather than losing it.
  if (reason === 'local' && pendingStored) { const p = pendingStored; pendingStored = null; store.absorbStored(p); }
  if (reason === 'settings') wake();
});

document.getElementById('settings-button').addEventListener('click', () => ctx.openSettings());
document.getElementById('sync-status').addEventListener('click', () => (sync.state === 'failing' ? ctx.openSettings() : scheduler.now()));
document.getElementById('flag-button').addEventListener('click', () => openFlagPanel(ctx));
document.getElementById('arrange-button').addEventListener('click', () => setArranging(ctx, !ui.arranging));
document.getElementById('update-ready').addEventListener('click', () => ctx.applyUpdate());
// Escape leaves Arrange mode, unless a dialog or the edit panel is using it for something else.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !ui.arranging) return;
  if (document.querySelector('dialog[open]')) return;
  if (!document.getElementById('editor').hidden) return;
  setArranging(ctx, false);
});
// A click off a menu closes it, as Escape does. A modal (Settings, Flags, a task card, a widget
// opened big) closes when the click lands on its backdrop, outside the box. The edit panel closes on a
// press anywhere outside it, unless something in it has been changed and not saved; an open note
// under a row closes too.
document.addEventListener('click', (e) => {
  const dlg = e.target instanceof HTMLDialogElement && e.target.open ? e.target : null;
  if (!dlg) return;
  const r = dlg.getBoundingClientRect();
  const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  if (outside && (e.clientX || e.clientY)) dlg.close();
});
document.addEventListener('click', (e) => {
  if (ui.noteFor && !e.target.closest?.('.note-mark, .note-row')) { ui.noteFor = null; render(); }
});
document.addEventListener('pointerdown', (e) => {
  const editor = document.getElementById('editor');
  if (!editor.hidden && !ui.editorDirty && !editor.contains(e.target) && !e.target.closest?.('dialog')) ui.closeEditor?.();
});
window.addEventListener('focus', wake);
window.addEventListener('online', () => scheduler.now());
// Crossing 1500px changes the number of widget columns: redrawn once nothing is being typed
// (until then the old columns stay on screen, every widget still showing, in the same order).
WIDE.addEventListener('change', () => { whenIdle().then(render); });
// The page may never come back (backgrounded tab killed, tab closed): a held other-window save
// must be absorbed here unconditionally, not left for `now()` to reschedule and never run.
function absorbPending() {
  if (!pendingStored) return;
  const p = pendingStored;
  pendingStored = null;
  store.absorbStored(p);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { absorbPending(); scheduler.flush(); }
  else wake();
});
window.addEventListener('pagehide', () => { absorbPending(); scheduler.flush(); });
window.addEventListener('storage', (e) => {
  // Another window on this device rearranged the widgets: follow it, once nothing is being typed.
  if (e.key === LAYOUT_KEY) {
    layout = loadLayout(localStorage, WIDGET_IDS);
    whenIdle().then(render);
    return;
  }
  if (e.key !== DATA_KEY || !e.newValue) return;
  // Same hold-back as the sync scheduler: absorbing another window's save must not wipe
  // something half-typed either, so queue it and let it through once a sync is allowed to run.
  if (!canRun()) { pendingStored = mergeStoredEvents(pendingStored, e.newValue); scheduler.changed(); return; }
  store.absorbStored(e.newValue);
});
// Once a minute: roll over to a new day and lock the day's list when it's time. The update check
// only actually asks the site every ten minutes.
setInterval(() => {
  applyLook();
  checkRollover();
  lockDay();
  if (!document.hidden) updater.check({ gap: IDLE_CHECK_GAP });
  scheduler.poll().catch(() => {});
}, 60000);

applyLook();
// The retired Coach's conversations lose their messages after 30 days, as they always did.
store.pruneTalks(30);
store.pruneChanges();
render();
scheduler.now();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // A tapped notification with the app already open: sw.js asks this page to show that check-in.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'open-checkin') return;
    const id = new URL(e.data.url, location.href).searchParams.get('checkin');
    if (id) openCheckin(ctx, id);
  });
}
// Opened from a notification: straight to the check-in it was about, then tidy the address.
if (params.has('checkin')) {
  const id = params.get('checkin');
  const url = new URL(location.href);
  url.searchParams.delete('checkin');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  openCheckin(ctx, id);
}
updater.check();
