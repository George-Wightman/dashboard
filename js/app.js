// Boot: one store, one render loop, the header, sync, and the day rollover.

import { createStore, DATA_KEY } from './data.js';
import { askGemini, talkGemini, geminiKeys, hebrewKeys } from './gemini.js';
import { longDate, weekStart } from './dates.js';
import { dayCompletion } from './schedule.js';
import { digestDue } from './coach.js';
import { createGitHubClient, syncOnce, createSyncScheduler, mergeStoredEvents } from './sync.js';
import { renderToday, initAddBox } from './ui/today.js';
import { renderSide, WIDGET_IDS, setArranging } from './ui/widgets.js';
import { openEditor } from './ui/edit.js';
import { openSettings } from './ui/settings.js';
import { talkNow, writeDigest, openMoment, openCoachSheet, paintCoachSheet } from './ui/coach.js';
import { openerDue, waitingOpener, TALK_KEEP_DAYS } from './talk.js';
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
  entriesFor: null, amountFor: null, noteFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false, closeEditor: null,
  // Arrange mode (js/ui/widgets.js): toggled by #arrange-button, Escape, or Done.
  arranging: false,
  // The Coach panel's page-only state (js/ui/coach.js). Typed text lives here, not only in the
  // textareas, so a re-render never loses it. `talk` is the conversation on show, `tried` the
  // moments this page has already asked Gemini to open ("day|slot"), `sheet` the phone sheet.
  coach: {
    talk: null, draft: '', talkBusy: '', talkError: '', editing: null, sheet: false, tried: {},
    shapeOpen: false, shapeText: '', shapeBusy: false, shapeError: '',
    digestOpen: false, digestBusy: false, digestError: '', digestTried: false,
    collapsedEntries: new Set(),
  },
};
const sync = { state: 'off', at: null, error: null };

// The widget arrangement (js/layout.js): kept on this device, never synced. A window at least
// 1500px wide shows two widget columns (the same media query as styles.css), a smaller one one.
const WIDE = matchMedia('(min-width: 1500px)');
let layout = loadLayout(localStorage, WIDGET_IDS);

// Canned Gemini for local testing: only on localhost, only with ?fakegemini (or =<mode>). In
// fake mode the real keys are never read, and dev/fake-gemini.js answers instead of Google.
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
    coach: {
      checkin: talkNow(ctx), busy: ui.coach.talkBusy, shapeBusy: ui.coach.shapeBusy, digestBusy: ui.coach.digestBusy,
      error: ui.coach.talkError, shapeError: ui.coach.shapeError, digestError: ui.coach.digestError,
    },
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
  coach: {
    fake: FAKE,
    // Every key to try, in order: the one in ⚙, then the Hebrew app's on this device.
    keys: () => (FAKE ? (FAKE === 'nokey' ? [] : ['fake-key']) : geminiKeys(store.settings(), localStorage)),
    async ask({ system, prompt }) {
      // The fake module is only ever loaded in fake mode; otherwise askGemini uses the real fetch.
      const fetch = FAKE ? (await import('../dev/fake-gemini.js')).fakeGeminiFetch(FAKE) : undefined;
      return askGemini({ keys: ctx.coach.keys(), system, prompt, fetch });
    },
    // A turn of a conversation, with the Coach's tools (js/gemini.js's talkGemini).
    async talk(opts) {
      const fetch = FAKE ? (await import('../dev/fake-gemini.js')).fakeGeminiFetch(FAKE) : undefined;
      return talkGemini({ keys: ctx.coach.keys(), ...opts, ...(fetch ? { fetch } : {}) });
    },
  },
  // Reply on the Coach's line under the date: its conversation, as a sheet on a phone, else the
  // panel scrolled into view with the box ready.
  openTalk(slot) {
    ui.coach.talk = slot;
    if (matchMedia('(max-width: 759px)').matches) { openCoachSheet(ctx); return; }
    render();
    const panel = document.querySelector('#side .coach');
    panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    panel?.querySelector('[data-focus^="coach-talk"]')?.focus();
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
  const { done, total } = dayCompletion(store.doc(), today);
  document.getElementById('count').textContent = total ? `${done} of ${total} done` : '';
  document.title = total ? `Today · ${done}/${total}` : 'Today';

  const warning = document.getElementById('save-warning');
  const problem = store.saveError() ? "Couldn't save on this device. Export a backup from settings." : store.loadError();
  warning.hidden = !problem;
  warning.textContent = problem ?? '';
  document.getElementById('update-ready').hidden = !updater.state().ready;
  document.getElementById('update-ready').title = updater.state().error ?? 'Reload into the downloaded update';

  // Under the date: Claude's brief, the Coach's question when one is waiting, any time off today,
  // then the planner's latest notes — each hidden with × for the rest of the day on this device.
  const notes = visibleNotes(plannerNotes(store.doc(), today), hiddenNotes(), today);
  const hidden = new Set(hiddenNotes());
  const shown = (text) => text && !hidden.has(`${today}|${text}`);
  const brief = briefFor(store.doc(), today);
  const off = offLine(store.doc(), today);
  const waiting = ctx.coach.keys().length ? waitingOpener(store.doc(), today) : null;
  const line = (cls, text, lead = null, action = null) => h('p', { class: cls },
    lead,
    h('span', {}, text),
    action,
    h('button', { class: 'link', type: 'button', title: 'Hide this note', 'aria-label': `Hide: ${text}`, onclick: () => hideNote(today, text) }, '×'));
  const mark = (logo, label) => {
    const el = h('span', { class: 'src', title: label, role: 'img', 'aria-label': label });
    el.innerHTML = LOGOS[logo]; // a fixed string from js/ui/sources.js, never data
    return el;
  };
  const reply = waiting ? h('button', { class: 'link', type: 'button', onclick: () => ctx.openTalk(waiting.slot) }, 'Reply') : null;
  const notesEl = document.getElementById('planner-notes');
  notesEl.replaceChildren(...[
    shown(brief) ? line('brief', brief, mark('claude', 'From Claude')) : null,
    waiting && shown(waiting.text) ? line('coach-line', waiting.text, mark('gemini', 'From the Coach'), reply) : null,
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
  // pointer-events: none (styles.css) dims the list and add box to the mouse while arranging;
  // inert keeps Tab off them too, and comes off again as soon as render() runs with Arrange off.
  document.getElementById('list').inert = ui.arranging;
  document.getElementById('add').inert = ui.arranging;
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

// What the Coach was doing when the page was last drawn; the minute tick repaints when it changes.
let shownTalk = null;

function render() {
  renderHeader();
  renderToday(ctx);
  renderSide(ctx);
  paintCoachSheet(ctx);
  shownTalk = talkNow(ctx);
}

// A storage-event save held back while typing/editing (see below), absorbed as soon as a sync
// is allowed to run rather than being lost.
let pendingStored = null;

async function runSync() {
  if (pendingStored) {
    store.absorbStored(pendingStored);
    pendingStored = null;
  }
  // Fake mode never contacts GitHub: it's local-only, testing the coach, not sync.
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

// Something half-typed must never be wiped by a sync landing and re-rendering. Only inside the
// re-rendered area (#list, #side): the add box lives outside it, so a sync there can't wipe it,
// and a half-typed task title shouldn't hold up sync all day. The Coach's message box doesn't count
// either: its text and caret come back after every redraw, and a reply must land while he types on.
function typing() {
  const el = document.activeElement;
  return !!el && el.matches('input[type=text], input:not([type]), textarea') && el.value !== ''
    && !!el.closest('#list, #side') && !String(el.dataset.focus ?? '').startsWith('coach-talk');
}

function canRun() {
  return !ui.editorDirty && !ui.amountFor && !typing();
}

// A promise that resolves once nothing is being typed or edited — immediately if canRun() is
// already true, otherwise re-checked every 400ms. Coach replies land only after this, so a
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

// Never synced: which Monday's digest this device last tried in the background, so re-opening
// the page on the same phone the same week doesn't spend quota on it again. Storage access is
// wrapped in try/catch — private browsing or a full localStorage must not break the check.
const DIGEST_TRIED_KEY = 'dash_digest_tried';

function digestTriedMonday() {
  try { return localStorage.getItem(DIGEST_TRIED_KEY); } catch { return null; }
}

function setDigestTriedMonday(monday) {
  try { localStorage.setItem(DIGEST_TRIED_KEY, monday); } catch { /* best effort */ }
}

// Last week's digest, written in the background once a new week has started and last week had
// anything in it (digestDue). At most one attempt per device per week, whether that's this page
// sitting open all week or a fresh open on the same phone; a failure is silent and leaves the
// panel's "Write last week's digest" link (which ignores this marker) in place.
function maybeWriteDigest() {
  if (ui.coach.digestTried) return;
  if (!ctx.coach.keys().length) return;
  if (navigator.onLine === false) return;
  const monday = digestDue(store.doc(), store.today());
  if (!monday) return;
  if (digestTriedMonday() === monday) return;
  ui.coach.digestTried = true;
  setDigestTriedMonday(monday);
  writeDigest(ctx, { quiet: true });
}

// The Coach opens a conversation at its moments (js/talk.js): the morning, the afternoon when
// something slipped, the evening — once a moment a day, and only once from this page if Gemini
// can't be reached (openMoment then leaves its plain line).
function maybeOpenMoment() {
  if (!ctx.coach.keys().length || navigator.onLine === false || ui.coach.talkBusy) return;
  const today = store.today();
  const { dayStartHour, checkinHour } = store.settings();
  const slot = openerDue(store.doc(), { today, now: new Date(), dayStartHour, checkinHour });
  if (!slot || ui.coach.tried[`${today}|${slot}`]) return;
  openMoment(ctx, slot);
}

// Each sync pass (on open, on focus, after a change) is followed by the digest check and the
// Coach's moment, so what another device already wrote has been pulled in before deciding.
const scheduler = createSyncScheduler({
  run: async () => { const result = await runSync(); maybeWriteDigest(); maybeOpenMoment(); return result; },
  canRun,
  canPoll: () => ctx.syncOn() && !document.hidden && navigator.onLine !== false,
});

// The app sits open all day: when the logical day changes, rebuild.
function checkRollover() {
  const day = store.today();
  if (day !== shownDay) {
    // A new week: last week's digest is now due, even if this page already tried one last week.
    if (weekStart(day) !== weekStart(shownDay)) {
      Object.assign(ui.coach, { digestTried: false, digestError: '', digestOpen: false });
    }
    shownDay = day;
    ui.historyDay = null;
    // A new day: yesterday's conversation, its last error and the moments tried no longer apply.
    Object.assign(ui.coach, { talk: null, talkError: '', editing: null, tried: {} });
    render();
  }
}

function wake() {
  applyLook();
  checkRollover();
  scheduler.now();
  updater.check();
}

store.subscribe((reason) => {
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

initAddBox(ctx);
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
// Once a minute: roll over to a new day, open the Coach's moment when one arrives, and repaint
// when what the Coach is doing has moved on — unless something is being typed in the column. The
// update check only actually asks the site every ten minutes.
setInterval(() => {
  applyLook();
  checkRollover();
  maybeOpenMoment();
  if (talkNow(ctx) !== shownTalk && !typing()) render();
  if (!document.hidden) updater.check({ gap: IDLE_CHECK_GAP });
  scheduler.poll().catch(() => {});
}, 60000);

applyLook();
store.pruneTalks(TALK_KEEP_DAYS);
store.pruneChanges();
render();
scheduler.now();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
updater.check();
