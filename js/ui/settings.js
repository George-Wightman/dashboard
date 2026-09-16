// Settings: which version this is at the top, then sync, the day, the coach, the look, Claude
// (everything Claude steers, js/ui/claude.js) and backups,
// each folded away showing what it's set to (they're set once and rarely touched). Settings are
// device-local and never synced.

import { h } from './dom.js';
import { hebrewKeys } from '../gemini.js';
import { LOOK_CHOICES, LOOKS } from '../look.js';
import { hourLabel } from '../dates.js';
import { versionStatus, recentChanges, buildStamp, HISTORY_URL } from '../version.js';
import { claudePanel, claudeSummary } from './claude.js';

// The Version section: filled in once the site and GitHub have answered. Asked fresh every time
// ⚙ opens, so "up to date" is about now, not about when the page was opened.
function versionSection(ctx) {
  const line = h('p', { class: 'version-line' }, 'Checking for a newer version…');
  const reload = h('div', { class: 'buttons', hidden: true },
    h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      if (await ctx.applyUpdate() === false) {
        line.textContent = ctx.updater.state().error;
        line.className = 'version-line error';
      }
    } }, 'Reload to update'));
  const list = h('ul');
  const changes = h('details', { class: 'changes', hidden: true }, h('summary', {}, 'Recent changes'), list,
    h('a', { href: HISTORY_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Full history on GitHub ↗'));

  Promise.all([ctx.updater.check({ gap: 0 }), recentChanges().catch(() => null)]).then(([state, commits]) => {
    if (!line.isConnected) return;
    const status = versionStatus({ ...state, newest: commits?.[0]?.date ?? null, online: navigator.onLine });
    line.textContent = state.error || (status.kind === 'update' && !state.ready
      ? 'A newer version is available, but its complete download has not finished. Try Reload to update.' : status.text);
    line.className = `version-line ${status.kind}`;
    reload.hidden = status.kind !== 'update';
    if (!commits?.length) return;
    // A change is on this device once a build at least as new as it is running here.
    list.replaceChildren(...commits.map((c) => {
      const missing = state.running && c.date > state.running;
      return h('li', { class: missing ? 'missing' : null },
        h('span', {}, c.title),
        h('span', { class: 'muted' }, missing ? `${buildStamp(c.date)} · not here yet` : buildStamp(c.date)));
    }));
    changes.hidden = false;
  });

  return h('section', { class: 'version' }, h('h3', {}, 'Version'), line, reload, changes);
}

// One folded group: its name, what it's set to now, and its fields.
const group = (name, now, open, ...body) => h('details', { class: 'group', open },
  h('summary', {}, name, h('span', { class: 'muted' }, ` · ${now}`)), ...body);

export function openSettings(ctx) {
  const { store } = ctx;
  const dialog = document.getElementById('settings');
  const s = store.settings();

  const repo = h('input', { type: 'text', name: 'repo', value: s.repo, placeholder: 'George-Wightman/dashboard-sync', autocomplete: 'off', spellcheck: 'false' });
  // The token goes in as the field's live value, never as an attribute, so it can't end up in the
  // page's markup; as a password field it never shows on screen either. 'new-password' tells the
  // browser this isn't a sign-in, so it stops offering saved logins on the repo field.
  const token = h('input', { type: 'password', name: 'token', autocomplete: 'new-password', spellcheck: 'false' });
  token.value = s.token ?? '';
  const dayStart = h('input', { type: 'number', name: 'dayStartHour', min: 0, max: 12, step: 1, value: s.dayStartHour });
  // The Gemini key goes in as the field's live value, never as an attribute, so it can't end up in
  // the page's markup; as a password field it never shows on screen either.
  const geminiKey = h('input', { type: 'password', name: 'geminiKey', autocomplete: 'off', spellcheck: 'false' });
  geminiKey.value = s.geminiKey ?? '';
  const checkinHour = h('input', { type: 'number', name: 'checkinHour', min: 12, max: 23, step: 1, value: s.checkinHour });
  const look = h('select', { name: 'look' },
    LOOK_CHOICES.map(([value, label]) => h('option', { value, selected: s.look === value }, label)));
  // Whether the Hebrew app has saved a key on this device (same origin, same localStorage). Only
  // the fact is shown, never the key.
  const hebrewFound = hebrewKeys(localStorage).length > 0;
  const status = h('div', { class: 'error', role: 'status' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const problem = ctx.syncProblem();
  const syncStatus = problem ? h('p', { class: 'error' }, `Last sync failed: ${problem}`) : null;
  // Folded, nothing in the sync group takes the focus when ⚙ opens, which is what used to bring
  // up the browser's saved-password list every time. It opens by itself when sync isn't set up
  // yet or is failing.
  const syncSet = !!(s.repo && s.token);
  const coachKey = s.geminiKey ? 'own key' : hebrewFound ? "the Hebrew app's key" : 'no key';
  const lookName = (LOOK_CHOICES.find(([value]) => value === s.look)?.[1] ?? '').split(' (')[0];

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

  // A refused save unfolds the group the field is in, so what it's about is on screen.
  function refuse(field, message) {
    field.closest('details').open = true;
    field.focus();
    status.textContent = message;
  }

  function save(e) {
    e.preventDefault();
    const hour = Number(dayStart.value);
    if (!(Number.isInteger(hour) && hour >= 0 && hour <= 12)) {
      refuse(dayStart, 'The day start must be a whole hour from 0 to 12.');
      return;
    }
    const checkin = Number(checkinHour.value); // an empty box is 0, so it fails too
    if (!(Number.isInteger(checkin) && checkin >= 12 && checkin <= 23)) {
      refuse(checkinHour, 'The check-in hour must be a whole hour from 12 to 23.');
      return;
    }
    const repoValue = repo.value.trim();
    if (repoValue && !/^[\w.-]+\/[\w.-]+$/.test(repoValue)) {
      refuse(repo, 'The repo should look like owner/name.');
      return;
    }
    store.updateSettings({
      repo: repoValue, token: token.value.trim(), dayStartHour: hour,
      geminiKey: geminiKey.value.trim(), checkinHour: checkin,
      look: LOOKS.includes(look.value) ? look.value : 'auto',
    });
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
    syncStatus,
    versionSection(ctx),
    group('GitHub sync', syncSet ? `${s.repo}, key saved` : 'not set up', !syncSet || !!problem,
      h('label', { class: 'field' }, h('span', {}, 'Sync repo'), repo),
      h('label', { class: 'field' }, h('span', {}, 'GitHub access key'), token),
      h('p', { class: 'note' }, 'A fine-grained token with Contents read and write on the sync repo only. It stays on this device and is never synced.'),
      h('div', { class: 'buttons' },
        h('button', { class: 'btn', type: 'button', onclick: () => { ctx.syncNow(); dialog.close(); } }, 'Sync now'))),
    group('The day', `starts at ${hourLabel(s.dayStartHour)}`, false,
      h('label', { class: 'field' }, h('span', {}, 'The day starts at (hour, 0–12)'), dayStart),
      h('p', { class: 'note' }, 'Anything done before this hour counts as the day before.')),
    group('Coach', `${coachKey}, evening from ${hourLabel(s.checkinHour)}`, false,
      h('label', { class: 'field' }, h('span', {}, 'Gemini API key (optional)'), geminiKey),
      h('p', { class: 'note' }, `Leave blank to use the Hebrew app's key on this device.${hebrewFound ? ' One was found here.' : ' None was found here.'}`),
      h('label', { class: 'field' }, h('span', {}, 'The evening conversation from (hour, 12–23)'), checkinHour),
      h('p', { class: 'note' }, "The Coach opens a conversation in the morning (7–12), the afternoon (2–5, only if something slipped) and the evening. Conversations and goal shaping send a summary of your list to Google. On Google's free tier they may use it to improve their products.")),
    group('Look', lookName, false,
      h('label', { class: 'field' }, h('span', {}, 'Look'), look)),
    group('Claude', claudeSummary(store.doc(), store.today(), new Date()), false,
      h('p', { class: 'note' }, 'Everything Claude steers for you. Ask Claude to change any of it; Undo is under Changes.'),
      claudePanel(ctx)),
    group('Backups', 'export, or merge one in', false,
      h('div', { class: 'buttons' },
        h('button', { class: 'btn', type: 'button', onclick: exportBackup }, 'Export backup'),
        h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Import backup…'),
        file)),
    status,
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'))));
  dialog.showModal();
}
