// Boot: one store, one render loop, and the header.

import { createStore } from './data.js';
import { longDate } from './dates.js';
import { dayCompletion } from './schedule.js';
import { renderToday, initAddBox } from './ui/today.js';

const store = createStore({ storage: localStorage });
const ui = { entriesFor: null, amountFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false };
const ctx = {
  store,
  ui,
  render,
  openEditor: () => {},   // Task 12
  openSettings: () => {}, // Task 13
};

let shownDay = store.today();

function renderHeader() {
  const today = store.today();
  document.getElementById('date').textContent = longDate(today);
  const { done, total } = dayCompletion(store.doc(), today);
  document.getElementById('count').textContent = total ? `${done} of ${total} done` : '';
  document.title = total ? `Today · ${done}/${total}` : 'Today';
  const warning = document.getElementById('save-warning');
  const problem = store.saveError() ? "Couldn't save on this device — export a backup from settings" : store.loadError();
  warning.hidden = !problem;
  warning.textContent = problem ?? '';
  document.getElementById('sync-status').textContent = 'on this device';
}

function render() {
  renderHeader();
  renderToday(ctx);
}

// The app sits open all day: when the logical day changes, rebuild.
function checkRollover() {
  const day = store.today();
  if (day !== shownDay) {
    shownDay = day;
    ui.historyDay = null;
    render();
  }
}

store.subscribe(() => render());
initAddBox(ctx);
document.getElementById('settings-button').addEventListener('click', () => ctx.openSettings());
window.addEventListener('focus', checkRollover);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRollover(); });
setInterval(checkRollover, 60000);
render();
