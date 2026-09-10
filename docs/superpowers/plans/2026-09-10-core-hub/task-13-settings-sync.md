# Task 13: Settings, sync wiring, rollover

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Create: `js/ui/settings.js`
- Modify: `js/app.js` (replaced in full)

**Interfaces:**
- Consumes: `createGitHubClient`, `syncOnce`, `createSyncScheduler` (`js/sync.js`); store
  `settings()`, `updateSettings()`, `exportJson()`, `importJson()`, `saveError()`; everything
  `js/app.js` already wires (Tasks 9, 11, 12).
- Produces:
  - `openSettings(ctx)` — a modal `<dialog>`: sync repo (`owner/name`), GitHub access key
    (password field), the hour the day starts (0–12), Save/Cancel; then *Sync now*,
    *Export backup* (downloads `dashboard-backup-<day>.json`), *Import backup…* (file picker,
    merged in with the normal merge rules).
  - `ctx.syncNow()` — run a sync immediately.
  - The header's sync status: *on this device* (no repo or key) · *syncing…* · *synced HH:MM* ·
    *offline* · *sync failing* (red; the reason is in the tooltip). Clicking it syncs now.
  - Sync triggers: on open; when the window regains focus or becomes visible; when the network
    comes back; 5 seconds after the last local change; *Sync now*; clicking the status.
  - Sync holds back while the edit panel has unsaved changes, while a quota's amount input is
    open, or while any text box has something typed in it. It tries again 5 seconds later.

The access key is never typed during overnight verification. The sync logic is covered by the
unit tests. George connects the real repo in the morning.

- [ ] **Step 1: Create `js/ui/settings.js`**

```js
// Settings: sync, the day boundary, and backups. Settings are device-local and never synced.

import { h } from './dom.js';

export function openSettings(ctx) {
  const { store } = ctx;
  const dialog = document.getElementById('settings');
  const s = store.settings();

  const repo = h('input', { type: 'text', name: 'repo', value: s.repo, placeholder: 'George-Wightman/dashboard-sync', spellcheck: 'false' });
  const token = h('input', { type: 'password', name: 'token', value: s.token, autocomplete: 'off', spellcheck: 'false' });
  const dayStart = h('input', { type: 'number', name: 'dayStartHour', min: 0, max: 12, step: 1, value: s.dayStartHour });
  const status = h('div', { class: 'error', role: 'status' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });

  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    if (!chosen) return;
    try {
      store.importJson(await chosen.text());
      status.textContent = 'Backup merged in.';
    } catch (e) {
      status.textContent = e.message;
    }
    file.value = '';
  });

  function save(e) {
    e.preventDefault();
    const hour = Number(dayStart.value);
    if (!(Number.isInteger(hour) && hour >= 0 && hour <= 12)) {
      status.textContent = 'The day start must be a whole hour from 0 to 12.';
      return;
    }
    const repoValue = repo.value.trim();
    if (repoValue && !/^[\w.-]+\/[\w.-]+$/.test(repoValue)) {
      status.textContent = 'The repo should look like owner/name.';
      return;
    }
    store.updateSettings({ repo: repoValue, token: token.value.trim(), dayStartHour: hour });
    dialog.close();
  }

  function exportBackup() {
    const url = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
    const link = h('a', { href: url, download: `dashboard-backup-${store.today()}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  dialog.replaceChildren(h('form', { onsubmit: save },
    h('h2', {}, 'Settings'),
    h('label', { class: 'field' }, h('span', {}, 'Sync repo'), repo),
    h('label', { class: 'field' }, h('span', {}, 'GitHub access key'), token),
    h('p', { class: 'note' }, 'A fine-grained token with Contents read and write on the sync repo only. It stays on this device and is never synced.'),
    h('label', { class: 'field' }, h('span', {}, 'The day starts at (hour, 0–12)'), dayStart),
    h('p', { class: 'note' }, 'Anything done before this hour counts as the day before.'),
    status,
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel')),
    h('hr'),
    h('div', { class: 'buttons' },
      h('button', { class: 'btn', type: 'button', onclick: () => { ctx.syncNow(); dialog.close(); } }, 'Sync now'),
      h('button', { class: 'btn', type: 'button', onclick: exportBackup }, 'Export backup'),
      h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Import backup…'),
      file)));
  dialog.showModal();
}
```

- [ ] **Step 2: Replace `js/app.js` in full**

```js
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
const ui = { entriesFor: null, amountFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false };
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
  warning.hidden = !store.saveError();
  warning.textContent = store.saveError() ? "Couldn't save on this device. Export a backup from settings." : '';

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
```

- [ ] **Step 3: Run the unit tests**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 4: Check it in the browser** (do **not** type anything into the access-key field)

With the seeded data:
- The header reads *on this device*. Hovering explains that sync is off.
- ⚙ opens Settings. Day start `13` then Save → the error shows and the dialog stays open. Repo
  `not a repo` then Save → "should look like owner/name". Cancel closes it.
- Day start `0` then Save → the header date is unchanged in the daytime. Set it back to `4`.
- *Export backup* doesn't throw (the download itself may be blocked in the Browser pane — that's fine).
- With the edit panel open and a title typed, `ui.editorDirty` holds sync back. Confirm there are no
  errors in the console.
- Reload: everything is still there. No console errors.

- [ ] **Step 5: Commit**

```bash
git add js/ui/settings.js js/app.js
git commit -m "Add settings, backup export/import, and sync wiring"
```

(End the commit message with the co-author line from the Global Constraints.)
