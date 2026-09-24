// Drive, for the Mind (docs/superpowers/specs/2026-09-25-coach-mind-design.md): a task's notes name
// the folder its work lives in ("Pack: Job Search/IDADP/Practice/RP3_MILLRACE/RP3_MILLRACE_pack.html"),
// so when it's ticked the planner reads what was written there lately — the debrief, the reflections
// one level up — and the Coach can talk about how it actually went. Read-only, and only ever the
// folders a note names (never My Drive's own top level).

const SEG = "[A-Za-z0-9][A-Za-z0-9 _()&'+-]*";
const PATH = new RegExp(`${SEG}(?:/${SEG}){1,}/${SEG}(?:\\.[A-Za-z0-9]{1,5})?`, 'g');
const EXT = /\.[A-Za-z0-9]{1,5}$/;
const TEXT_NAMES = /\.(md|txt|html?|markdown)$/i;
const TEXT_TYPES = /^text\/(plain|markdown|html|x-markdown)$/;
const FILE_CHARS = 6000;
const DAY_MS = 86400000;

// The Drive paths in a note: at least three parts, and not part of a web address.
export function drivePaths(notes) {
  const text = String(notes ?? '');
  const out = [];
  for (const m of text.matchAll(PATH)) {
    const before = text[m.index - 1] ?? ' ';
    if (/[/.:@\w-]/.test(before)) continue;
    // "…and Job Search/NatCen/notes": lower-case words the first part picked up from the sentence.
    const [first, ...rest] = m[0].trim().split('/');
    const words = first.split(' ');
    while (words.length > 1 && /^[a-z]/.test(words[0])) words.shift();
    const path = [words.join(' '), ...rest].join('/');
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', apos: "'" };

export function htmlText(html) {
  return String(html ?? '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp|apos);/g, (_, e) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}

function all(iterator) {
  const out = [];
  while (iterator.hasNext()) out.push(iterator.next());
  return out;
}

// The folder a path names, from My Drive down, with the chain it passed through. The first part may
// have picked up words from the sentence before it ("Open Job Search"), so shorter versions of it are
// tried too. Null when it isn't there.
function resolve(root, segments) {
  const first = segments[0].split(' ');
  for (let drop = 0; drop < first.length; drop++) {
    const chain = [root];
    let ok = true;
    for (const name of [first.slice(drop).join(' '), ...segments.slice(1)]) {
      const next = all(chain.at(-1).getFoldersByName(name))[0];
      if (!next) { ok = false; break; }
      chain.push(next);
    }
    if (ok) return chain;
  }
  return null;
}

// What gets read first when there's more than fits: what George wrote about the work (a debrief, his
// reflections, notes), then the rest of the task's own folder, then the folder above.
const WRITTEN_UP = /debrief|reflect|feedback|summary|notes|write-?up/i;
const rankOf = (name, own) => (WRITTEN_UP.test(name) ? 0 : own ? 1 : 2);

function readable(f) {
  return TEXT_NAMES.test(f.getName()) || TEXT_TYPES.test(String(f.getMimeType?.() ?? ''));
}

// The text files in each named folder and the one above it (never My Drive itself) changed in the
// last `days`, newest first, each at most 6,000 characters and all together at most `maxChars`.
// { files: [{ name, path, modified, text }], problem } — never throws.
export function readArtefacts({ DriveApp, paths = [], now, days = 3, maxChars = 12000 }) {
  if (!DriveApp) return { files: [], problem: 'Drive is not connected to the planner yet' };
  try {
    const root = DriveApp.getRootFolder();
    const since = now.getTime() - days * DAY_MS;
    const found = new Map();
    for (const path of paths) {
      const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
      const folders = EXT.test(parts.at(-1)) ? parts.slice(0, -1) : parts;
      if (!folders.length) continue;
      const chain = resolve(root, folders);
      if (!chain) continue;
      const names = chain.slice(1).map((f) => f.getName());
      const places = [{ folder: chain.at(-1), path: names.join('/') }];
      if (chain.length > 2) places.push({ folder: chain.at(-2), path: names.slice(0, -1).join('/') });
      for (const { folder, path: where } of places) {
        for (const f of all(folder.getFiles())) {
          const modified = f.getLastUpdated();
          if (!readable(f) || modified.getTime() < since || found.has(f.getId())) continue;
          found.set(f.getId(), { f, where, modified, rank: rankOf(f.getName(), where === places[0].path) });
        }
      }
    }
    let left = maxChars;
    const files = [];
    for (const { f, where, modified } of [...found.values()].sort((a, b) => a.rank - b.rank || b.modified - a.modified)) {
      if (left <= 0) break;
      const raw = f.getBlob().getDataAsString();
      const html = /\.html?$/i.test(f.getName()) || /html/.test(String(f.getMimeType?.() ?? ''));
      const text = (html ? htmlText(raw) : String(raw).trim()).slice(0, Math.min(FILE_CHARS, left));
      left -= text.length;
      files.push({ name: f.getName(), path: `${where}/${f.getName()}`, modified: modified.toISOString(), text });
    }
    return { files, problem: null };
  } catch (e) {
    return { files: [], problem: String(e?.message ?? e) };
  }
}
