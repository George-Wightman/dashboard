import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greeting, headerModel, syncLabel } from '../js/header.js';
import { emptyDoc } from '../js/doc.js';

test('the greeting follows the hour', () => {
  assert.equal(greeting(new Date(2026, 9, 20, 7, 40)), 'Morning, George.');
  assert.equal(greeting(new Date(2026, 9, 20, 12, 0)), 'Afternoon, George.');
  assert.equal(greeting(new Date(2026, 9, 20, 17, 0)), 'Evening, George.');
});

test('the sync label is the one the classic header shows', () => {
  assert.deepEqual(syncLabel({ state: 'off' }), ['on this device', 'Sync is off. Add a repo and an access key in settings.']);
  assert.equal(syncLabel({ state: 'failing', error: 'GitHub 500' })[0], 'sync failing');
});

test('the brief, time off and notes, minus the ones hidden today; warnings in order', () => {
  const doc = emptyDoc();
  doc.journal['brief:2026-10-20'] = { id: 'brief:2026-10-20', kind: 'brief', day: '2026-10-20', text: 'Legs tonight.', status: 'active' };
  const m = headerModel({ doc, today: '2026-10-20', now: new Date(2026, 9, 20, 10, 20), hiddenNotes: [], saveProblem: "Couldn't save on this device." });
  assert.equal(m.brief, 'Legs tonight.');
  assert.equal(m.warnings[0], "Couldn't save on this device.");
  const hidden = headerModel({ doc, today: '2026-10-20', now: new Date(2026, 9, 20, 10, 20), hiddenNotes: ['2026-10-20|Legs tonight.'], saveProblem: null });
  assert.equal(hidden.brief, null);
  assert.deepEqual(hidden.warnings, []);
});
