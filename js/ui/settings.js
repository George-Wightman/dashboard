// Settings: which version this is at the top, then sync, the day, Gemini, notifications, the look, Claude
// (everything Claude steers, js/ui/claude.js) and backups,
// each folded away showing what it's set to (they're set once and rarely touched). Settings are
// device-local and never synced.

import { h } from './dom.js';
import { hebrewKeys } from '../gemini.js';
import { LOOK_CHOICES, LOOKS } from '../look.js';
import { hourLabel } from '../dates.js';
import { versionStatus, recentChanges, buildStamp, HISTORY_URL } from '../version.js';
import { claudePanel, claudeSummary } from './claude.js';
import { pushState, turnOn, turnOff } from '../push-client.js';

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

const PUSH_WORDS = {
  unsupported: ['not available', "This browser can't show notifications from the dashboard."],
  waiting: ['setting up', 'The calendar planner sets notifications up on its next run. Come back in ten minutes.'],
  blocked: ['blocked', "Notifications are blocked for this site. Allow them in the browser's site settings, then come back here."],
  off: ['off on this device', 'Off on this device.'],
  on: ['on for this device', 'On for this device.'],
};

// Notifications: whether this device gets check-in pings, and the one button to change it. The
// state takes a moment to read (the browser's own subscription), so it fills itself in.
function notificationsGroup(ctx) {
  const now = h('span', { class: 'muted' }, ' · checking');
  const line = h('p', { class: 'note' }, 'Checking this device…');
  const error = h('p', { class: 'error', role: 'status' });
  const buttons = h('div', { class: 'buttons' });
  const show = async () => {
    const state = await pushState(ctx);
    if (!line.isConnected && !now.isConnected) return;
    now.textContent = ` · ${PUSH_WORDS[state][0]}`;
    line.textContent = PUSH_WORDS[state][1];
    const act = (label, fn) => h('button', { class: 'btn', type: 'button', onclick: async () => {
      error.textContent = '';
      try { await fn(ctx); } catch (e) { error.textContent = e.message; }
      show();
    } }, label);
    buttons.replaceChildren(...(state === 'off' ? [act('Turn on', turnOn)] : state === 'on' ? [act('Turn off', turnOff)] : []));
  };
  show();
  return h('details', { class: 'group' }, h('summary', {}, 'Notifications', now), line, buttons, error,
    h('p', { class: 'note' }, "When a task's calendar block ends and it isn't ticked, this device is asked what happened: at most four a day, and never at night. Tapping it opens the question. Your Pixel Watch shows what the phone shows."));
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
  const hebrewRepo = h('input', { type: 'text', name: 'hebrewRepo', value: s.hebrewRepo, placeholder: 'George-Wightman/hebrew-reader-sync', autocomplete: 'off', spellcheck: 'false' });
  // Same reasoning as the sync token above: the live value only, never an attribute.
  const hebrewToken = h('input', { type: 'password', name: 'hebrewToken', autocomplete: 'new-password', spellcheck: 'false' });
  hebrewToken.value = s.hebrewToken ?? '';
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
  const geminiWhich = s.geminiKey ? 'own key' : hebrewFound ? "the Hebrew app's key" : 'no key';
  const hebrewSyncSet = !!(s.hebrewRepo && s.hebrewToken);
  const hebrewProblem = ctx.hebrewSyncProblem();
  const hebrewStatus = ctx.hebrewStatus();
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
    const hebrewRepoValue = hebrewRepo.value.trim();
    if (hebrewRepoValue && !/^[\w.-]+\/[\w.-]+$/.test(hebrewRepoValue)) {
      refuse(hebrewRepo, 'The repo should look like owner/name.');
      return;
    }
    store.updateSettings({
      repo: repoValue, token: token.value.trim(), dayStartHour: hour,
      geminiKey: geminiKey.value.trim(), checkinHour: checkin,
      look: LOOKS.includes(look.value) ? look.value : 'auto',
      hebrewRepo: hebrewRepoValue, hebrewToken: hebrewToken.value.trim(),
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
    group('Hebrew progress', hebrewSyncSet ? `${s.hebrewRepo}, key saved` : 'not set up', !hebrewSyncSet || !!hebrewProblem,
      h('label', { class: 'field' }, h('span', {}, 'Sync repo'), hebrewRepo),
      h('label', { class: 'field' }, h('span', {}, 'GitHub access key'), hebrewToken),
      h('p', { class: 'note' }, "A fine-grained token with Contents read on the Hebrew app's own sync repo. Read-only: the dashboard never writes to it. Once set, a goal, a daily habit, three weekly targets (learning time, speaking practice, words said live) and a ladder of milestones appear under Hebrew, filled in from its real practice numbers."),
      hebrewProblem ? h('p', { class: 'error' }, `Last sync failed: ${hebrewProblem}`) : null,
      hebrewSyncSet && hebrewStatus.words != null
        ? h('p', { class: 'note' }, [
          hebrewStatus.strong != null ? `${hebrewStatus.strong} words held strong` : null,
          hebrewStatus.live != null ? `${hebrewStatus.live} said live` : null,
          hebrewStatus.gold != null ? `${hebrewStatus.gold} nodes perfected` : null,
          `${hebrewStatus.words} in the library`,
        ].filter(Boolean).join(' · ') + (hebrewStatus.at ? `, last synced ${hebrewStatus.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '') + '.')
        : null,
      h('div', { class: 'buttons' },
        h('button', { class: 'btn', type: 'button', onclick: () => { ctx.hebrewSyncNow(); dialog.close(); } }, 'Sync now'))),
    group('The day', `starts at ${hourLabel(s.dayStartHour)}`, false,
      h('label', { class: 'field' }, h('span', {}, 'The day starts at (hour, 0–12)'), dayStart),
      h('p', { class: 'note' }, 'Anything done before this hour counts as the day before.')),
    group('Gemini', geminiWhich, false,
      h('label', { class: 'field' }, h('span', {}, 'Gemini API key (optional)'), geminiKey),
      h('p', { class: 'note' }, `Leave blank to use the Hebrew app's key on this device.${hebrewFound ? ' One was found here.' : ' None was found here.'}`),
      h('p', { class: 'note' }, "Gemini tidies what you say in a check-in into a short note for Claude. It's sent your answer and the task's name; on Google's free tier they may use it to improve their products. Without a key your words are kept as they are.")),
    notificationsGroup(ctx),
    group('Look', `${lookName}, evening from ${hourLabel(s.checkinHour)}`, false,
      h('label', { class: 'field' }, h('span', {}, 'Look'), look),
      h('label', { class: 'field' }, h('span', {}, 'Evening from (hour, 12–23)'), checkinHour),
      h('p', { class: 'note' }, 'Following the day, the Night look starts at this hour.')),
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
