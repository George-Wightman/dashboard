// Records as the tool shows them to Claude: a short id (the first 8 characters of a random id; a
// readable id such as 'checkin:2026-09-13' in full), and finding a record again from one.

import { MAPS } from '../js/doc.js';

const RANDOM = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

export const shortId = (id) => (RANDOM.test(id) ? id.slice(0, 8) : id);

// The one record in `maps` whose id is `ref`, or starts with it. A leading # is ignored. Throws a
// sentence Claude can act on when there is none, or more than one.
export function resolveId(doc, ref, maps = MAPS) {
  const key = String(ref ?? '').trim().replace(/^#/, '');
  if (key.length < 4) throw new Error(`"${ref}" is too short to be an id — use the id the tool shows`);
  const found = [];
  for (const map of maps) {
    for (const id of Object.keys(doc[map] ?? {})) {
      if (id === key) return { map, id, rec: doc[map][id] };
      if (id.startsWith(key)) found.push({ map, id, rec: doc[map][id] });
    }
  }
  if (found.length === 1) return found[0];
  if (!found.length) throw new Error(`Nothing has the id ${key}`);
  throw new Error(`${key} matches ${found.length} records — use more of the id`);
}
