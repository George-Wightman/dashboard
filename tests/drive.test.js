// Drive: the files behind a finished task — the debriefs and reflections George writes with Claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drivePaths, readArtefacts, htmlText } from '../planner/drive.js';

const RP2 = 'Operation HALYARD. Pack: Job Search/IDADP/Practice/RP2_HALYARD/RP2_HALYARD_pack.html. 40 min prep, 30 min meeting in Claude voice mode (paste ASSESSOR_BRIEF.txt unread), feedback, two reflection lines.';
const WALK = 'First thing. Default: wall-jump loop, ~18 min / 0.8mi - https://maps.app.goo.gl/hGFtCWhnud2EkrQ97. Feeling good: https://github.com/George/dashboard/blob/main/README.md';

test('drivePaths: the Drive paths in a note, and not the web addresses', () => {
  assert.deepEqual(drivePaths(RP2), ['Job Search/IDADP/Practice/RP2_HALYARD/RP2_HALYARD_pack.html']);
  assert.deepEqual(drivePaths(WALK), []);
  assert.deepEqual(drivePaths('Two: PhD/Chapter 2/draft.md and Job Search/NatCen/notes'), ['PhD/Chapter 2/draft.md', 'Job Search/NatCen/notes']);
  assert.deepEqual(drivePaths(''), []);
  assert.deepEqual(drivePaths(undefined), []);
});

test('htmlText: a page as plain text', () => {
  assert.equal(htmlText('<html><head><style>p{}</style><script>x()</script></head><body><h1>Brief</h1><p>Fish &amp; chips&nbsp;&lt;3</p></body></html>'), 'Brief Fish & chips <3');
});

// ---- A Drive in memory ---------------------------------------------------------------------------

const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
let fileId = 0;
function file(name, text, updated, mime = 'text/plain') {
  const id = `f${++fileId}`;
  return { getId: () => id, getName: () => name, getLastUpdated: () => new Date(updated), getMimeType: () => mime, getBlob: () => ({ getDataAsString: () => text }) };
}
function folder(name, children = [], files = []) {
  return {
    getName: () => name,
    getFoldersByName: (n) => iter(children.filter((c) => c.getName() === n)),
    getFiles: () => iter(files),
  };
}

const NOW = new Date('2026-09-24T19:30:00Z');
function drive() {
  const rp3 = folder('RP3_MILLRACE', [], [
    file('RP3_debrief.md', '# RP3 debrief\nRecommendation came late again.', '2026-09-24T19:20:00Z'),
    file('RP3_MILLRACE_pack.html', '<h1>MILLRACE</h1><p>Your task: advise the Director.</p>', '2026-09-23T10:00:00Z', 'text/html'),
    file('ASSESSOR_BRIEF.txt', 'Secret brief', '2026-09-14T10:00:00Z'),
    file('chart.png', 'binary', '2026-09-24T19:00:00Z', 'image/png'),
  ]);
  const practice = folder('Practice', [rp3], [file('reflections.md', 'RP3: went well — structure. Change — lead with the answer.', '2026-09-24T19:25:00Z')]);
  const idadp = folder('IDADP', [practice]);
  const search = folder('Job Search', [idadp]);
  return { getRootFolder: () => folder('My Drive', [search], [file('hebrew-backup.json', '{}', '2026-09-24T19:00:00Z')]) };
}

test('readArtefacts: the recent text files in the task\'s folder and the one above, newest first', () => {
  const { files, problem } = readArtefacts({ DriveApp: drive(), paths: ['Job Search/IDADP/Practice/RP3_MILLRACE/RP3_MILLRACE_pack.html'], now: NOW });
  assert.equal(problem, null);
  assert.deepEqual(files.map((f) => f.name), ['reflections.md', 'RP3_debrief.md', 'RP3_MILLRACE_pack.html']);
  assert.match(files[1].text, /Recommendation came late again/);
  assert.equal(files[2].text, 'MILLRACE Your task: advise the Director.');
  assert.equal(files[0].path, 'Job Search/IDADP/Practice/reflections.md');
  assert.equal(files[1].modified, '2026-09-24T19:20:00.000Z');
});

test('readArtefacts: a path found inside a longer phrase, caps, and nothing from My Drive itself', () => {
  const { files } = readArtefacts({ DriveApp: drive(), paths: ['Open Job Search/IDADP/Practice'], now: NOW, maxChars: 30 });
  assert.deepEqual(files.map((f) => f.name), ['reflections.md']);
  assert.equal(files[0].text.length, 30);
  const top = readArtefacts({ DriveApp: drive(), paths: ['Job Search/IDADP/Practice'], now: NOW });
  assert.ok(!top.files.some((f) => f.name === 'hebrew-backup.json'));
});

test('readArtefacts: a missing folder is nothing, and Drive refusing is a problem, never a throw', () => {
  assert.deepEqual(readArtefacts({ DriveApp: drive(), paths: ['Job Search/Nowhere/At all'], now: NOW }), { files: [], problem: null });
  const refusing = { getRootFolder: () => { throw new Error('You do not have permission to call DriveApp.getRootFolder'); } };
  const r = readArtefacts({ DriveApp: refusing, paths: ['Job Search/IDADP/Practice'], now: NOW });
  assert.deepEqual(r.files, []);
  assert.match(r.problem, /permission/);
  assert.deepEqual(readArtefacts({ DriveApp: null, paths: ['a/b/c'], now: NOW }), { files: [], problem: 'Drive is not connected to the planner yet' });
});
