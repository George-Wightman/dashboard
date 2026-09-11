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
  const problem = ctx.syncProblem();
  const syncStatus = problem ? h('p', { class: 'error' }, `Last sync failed: ${problem}`) : null;

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
    syncStatus,
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
