// Boot: one store, one render loop, the header, sync, and the day rollover.

import { createStore } from './data.js';
import { longDate } from './dates.js';
import { dayCompletion } from './schedule.js';
import { createGitHubClient, syncOnce, createSyncScheduler } from './sync.js';
import { renderToday, initAddBox } from './ui/today.js';
import { renderSide } from './ui/side.js';
import { openEditor } from './ui/edit.js';
import { openSettings } from './ui/settings.js';

const store = createStore({ storage: localStorage });
const ui = { entriesFor: null, amountFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false, closeEditor: null };
const sync = { state: 'off', at: null, error: null };
const ctx = {
  store,
  ui,
  render,
  openEditor: (opts) => openEditor(ctx, opts),
  openSettings: () => openSettings(ctx),
  syncNow: () => scheduler.now(),
};

let shownDay = store.today();

function syncLabel() {
  switch (sync.state) {
    case 'off': return ['on this device', 'Sync is off. Add a repo and an access key in settings.'];
    case 'syncing': return ['syncing…', ''];
    case 'offline': return ['offline', "Can't reach GitHub. Working on this device."];
    case 'failing': return ['sync failing', sync.error ?? ''];
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

function render() {
  renderHeader();
  renderToday(ctx);
  renderSide(ctx);
}

async function runSync() {
  const { token, repo } = store.settings();
  if (!token || !repo) { sync.state = 'off'; renderHeader(); return; }
  if (!navigator.onLine) { sync.state = 'offline'; renderHeader(); return; }
  sync.state = 'syncing';
  renderHeader();
  const result = await syncOnce({ store, client: createGitHubClient({ token, repo }) });
  Object.assign(sync, result.ok
    ? { state: 'ok', at: new Date(), error: null }
    : { state: 'failing', error: result.error });
  renderHeader();
}

// Something half-typed must never be wiped by a sync landing and re-rendering.
function typing() {
  const el = document.activeElement;
  return !!el && el.matches('input[type=text], input:not([type]), textarea') && el.value !== '';
}

const scheduler = createSyncScheduler({
  run: runSync,
  canRun: () => !ui.editorDirty && !ui.amountFor && !typing(),
});

// The app sits open all day: when the logical day changes, rebuild.
function checkRollover() {
  const day = store.today();
  if (day !== shownDay) {
    shownDay = day;
    ui.historyDay = null;
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
  if (reason === 'settings') wake();
});

initAddBox(ctx);
document.getElementById('settings-button').addEventListener('click', () => ctx.openSettings());
document.getElementById('sync-status').addEventListener('click', () => scheduler.now());
window.addEventListener('focus', wake);
window.addEventListener('online', () => scheduler.now());
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
setInterval(checkRollover, 60000);

render();
scheduler.now();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
