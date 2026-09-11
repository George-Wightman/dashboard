// Boot: one store, one render loop, the header, sync, and the day rollover.

import { createStore, DATA_KEY } from './data.js';
import { askGemini, geminiKeys } from './gemini.js';
import { longDate } from './dates.js';
import { dayCompletion } from './schedule.js';
import { createGitHubClient, syncOnce, createSyncScheduler } from './sync.js';
import { renderToday, initAddBox } from './ui/today.js';
import { renderSide } from './ui/side.js';
import { openEditor } from './ui/edit.js';
import { openSettings } from './ui/settings.js';
import { checkinNow } from './ui/coach.js';

const store = createStore({ storage: localStorage });
const ui = {
  entriesFor: null, amountFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false, closeEditor: null,
  // The Coach panel's page-only state (js/ui/coach.js). Typed text lives here, not only in the
  // textareas, so a re-render never loses it.
  coach: {
    busy: '', error: '', answers: [], notNow: '', feedbackOpen: true,
    shapeOpen: false, shapeText: '', shapeBusy: false, shapeError: '',
    digestOpen: false, digestBusy: false, digestError: '', digestTried: false,
  },
};
const sync = { state: 'off', at: null, error: null };

// Canned Gemini for local testing: only on localhost, only with ?fakegemini (or =<mode>). In
// fake mode the real keys are never read, and dev/fake-gemini.js answers instead of Google.
const params = new URLSearchParams(location.search);
const FAKE = (['localhost', '127.0.0.1'].includes(location.hostname) && params.has('fakegemini'))
  ? (params.get('fakegemini') || 'ok') : null;

const ctx = {
  store,
  ui,
  render,
  openEditor: (opts) => openEditor(ctx, opts),
  openSettings: () => openSettings(ctx),
  syncNow: () => scheduler.now(),
  syncProblem: () => (sync.state === 'failing' ? sync.error : ''),
  coach: {
    fake: FAKE,
    // Every key to try, in order: the one in ⚙, then the Hebrew app's on this device.
    keys: () => (FAKE ? (FAKE === 'nokey' ? [] : ['fake-key']) : geminiKeys(store.settings(), localStorage)),
    async ask({ system, prompt }) {
      // The fake module is only ever loaded in fake mode; otherwise askGemini uses the real fetch.
      const fetch = FAKE ? (await import('../dev/fake-gemini.js')).fakeGeminiFetch(FAKE) : undefined;
      return askGemini({ keys: ctx.coach.keys(), system, prompt, fetch });
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

function renderHeader() {
  const today = store.today();
  document.getElementById('date').textContent = longDate(today);
  const { done, total } = dayCompletion(store.doc(), today);
  document.getElementById('count').textContent = total ? `${done} of ${total} done` : '';
  document.title = total ? `Today · ${done}/${total}` : 'Today';

  const warning = document.getElementById('save-warning');
  const problem = store.saveError() ? "Couldn't save on this device. Export a backup from settings." : store.loadError();
  warning.hidden = !problem;
  warning.textContent = problem ?? '';

  const status = document.getElementById('sync-status');
  const [text, title] = syncLabel();
  status.textContent = text;
  status.title = title;
  status.classList.toggle('sync-failing', sync.state === 'failing');
}

// The check-in state the Coach panel last showed; the minute tick repaints when it changes.
let shownCheckin = null;

function render() {
  renderHeader();
  renderToday(ctx);
  renderSide(ctx);
  shownCheckin = checkinNow(ctx);
}

// A storage-event save held back while typing/editing (see below), absorbed as soon as a sync
// is allowed to run rather than being lost.
let pendingStored = null;

async function runSync() {
  if (pendingStored) {
    store.absorbStored(pendingStored);
    pendingStored = null;
  }
  const { token, repo } = store.settings();
  if (!token || !repo) { sync.state = 'off'; renderHeader(); return; }
  if (!navigator.onLine) { sync.state = 'offline'; renderHeader(); return; }
  sync.state = 'syncing';
  renderHeader();
  try {
    const result = await syncOnce({ store, client: createGitHubClient({ token, repo }) });
    Object.assign(sync, result.ok
      ? { state: 'ok', at: new Date(), error: null }
      : { state: 'failing', error: result.error });
  } catch (e) {
    Object.assign(sync, { state: 'failing', error: e.message });
  } finally {
    renderHeader();
  }
}

// Something half-typed must never be wiped by a sync landing and re-rendering. Only inside the
// re-rendered area (#list, #side): the add box lives outside it, so a sync there can't wipe it,
// and a half-typed task title shouldn't hold up sync all day.
function typing() {
  const el = document.activeElement;
  return !!el && el.matches('input[type=text], input:not([type]), textarea') && el.value !== ''
    && !!el.closest('#list, #side');
}

function canRun() {
  return !ui.editorDirty && !ui.amountFor && !typing();
}

const scheduler = createSyncScheduler({ run: runSync, canRun });

// The app sits open all day: when the logical day changes, rebuild.
function checkRollover() {
  const day = store.today();
  if (day !== shownDay) {
    shownDay = day;
    ui.historyDay = null;
    // Yesterday's check-in is over: its typed answers, "Not now" and last error no longer apply.
    Object.assign(ui.coach, { answers: [], notNow: '', error: '', feedbackOpen: true });
    render();
  }
}

function wake() {
  checkRollover();
  scheduler.now();
}

store.subscribe((reason) => {
  render();
  if (reason === 'local') scheduler.changed();
  // A local change has just re-rendered anyway (the edit panel is never re-rendered from here),
  // so this is a safe moment to absorb a held other-window save rather than losing it.
  if (reason === 'local' && pendingStored) { const p = pendingStored; pendingStored = null; store.absorbStored(p); }
  if (reason === 'settings') wake();
});

initAddBox(ctx);
document.getElementById('settings-button').addEventListener('click', () => ctx.openSettings());
document.getElementById('sync-status').addEventListener('click', () => (sync.state === 'failing' ? ctx.openSettings() : scheduler.now()));
window.addEventListener('focus', wake);
window.addEventListener('online', () => scheduler.now());
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
  if (e.key !== DATA_KEY || !e.newValue) return;
  // Same hold-back as the sync scheduler: absorbing another window's save must not wipe
  // something half-typed either, so queue it and let it through once a sync is allowed to run.
  if (!canRun()) { pendingStored = e.newValue; scheduler.changed(); return; }
  store.absorbStored(e.newValue);
});
// Once a minute: roll over to a new day, and repaint when the check-in state has moved on (the
// check-in hour arriving) — unless something is being typed in the column.
setInterval(() => {
  checkRollover();
  if (checkinNow(ctx) !== shownCheckin && !typing()) render();
}, 60000);

render();
scheduler.now();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
