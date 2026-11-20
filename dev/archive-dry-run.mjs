// The archive's dry run (docs/superpowers/specs/2026-11-20-archive-design.md): the planner's weekly cut
// on a copy of data.json, with nothing written anywhere. Prints what data.json and each archive file
// would weigh, and checks that nothing is lost.
//
//   node dev/archive-dry-run.mjs <a copy of data.json> [today as YYYY-MM-DD]
//
// Exits 1 if a check fails.

import { readFileSync } from 'node:fs';
import { mergeDocs, sameDoc } from '../js/merge.js';
import { isDoc, stableStringify, MAPS } from '../js/doc.js';
import { recordContent } from '../js/record.js';
import { logicalDay } from '../js/dates.js';
import { archiveCut, coldRecords, yearDoc, slimDoc } from '../js/archive.js';

const [file, todayArg] = process.argv.slice(2);
if (!file) {
  console.log('Usage: node dev/archive-dry-run.mjs <a copy of data.json> [YYYY-MM-DD]');
  process.exit(2);
}
const original = JSON.parse(readFileSync(file, 'utf8'));
if (!isDoc(original)) {
  console.log("That file isn't a dashboard document.");
  process.exit(2);
}

const kb = (v) => `${(Buffer.byteLength(JSON.stringify(v)) / 1024).toFixed(0)} KB`;
const today = todayArg ?? logicalDay(new Date(), 4);
const cut = archiveCut(today);

// As every client holds it after this change: merged, so the change log's snapshots have lost their stamps.
const whole = mergeDocs(original, null);
const { years, count } = coldRecords(whole, null, cut);
const files = Object.fromEntries(Object.keys(years).sort().map((y) => [y, mergeDocs(yearDoc(years[y]), null)]));
let archive = null;
for (const doc of Object.values(files)) archive = archive ? mergeDocs(archive, doc) : doc;
const slim = slimDoc(whole, archive);

console.log(`Today ${today}; records about days before ${cut} move.`);
console.log(`data.json now:                ${kb(original)}`);
console.log(`  with snapshot stamps gone:  ${kb(whole)}`);
console.log(`  and the archive cut:        ${kb(slim)}`);
for (const [y, doc] of Object.entries(files)) console.log(`archive/${y}.json:            ${kb(doc)}`);
const byMap = {};
for (const recs of Object.values(years)) for (const [map, r] of Object.entries(recs)) byMap[map] = (byMap[map] ?? 0) + Object.keys(r).length;
console.log(`Moving ${count} records:`, byMap);

let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed = true;
};

// 1. data.json plus the archive is the whole, record for record.
const back = archive ? mergeDocs(slim, archive) : slim;
const lost = [];
for (const map of MAPS) {
  const ids = new Set([...Object.keys(whole[map] ?? {}), ...Object.keys(back[map] ?? {})]);
  for (const id of ids) {
    if (stableStringify(recordContent(whole[map]?.[id] ?? null)) !== stableStringify(recordContent(back[map]?.[id] ?? null))) lost.push(`${map} ${id}`);
  }
}
check('the slim file and the archive together hold every record, unchanged', !lost.length, lost.slice(0, 5).join(', '));

// 2. The original merged back (an old app's push) leaves nothing extra in the slim file.
check('an old full copy merged back is left out again', sameDoc(slimDoc(mergeDocs(slim, original), archive), slim));

// 3. Every archive file is an ordinary document.
check('every archive file is a dashboard document', Object.values(files).every(isDoc));

process.exit(failed ? 1 : 0);
