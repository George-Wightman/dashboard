// Handoffs: what Claude tells whoever maintains the app, as its own file in the sync repo.
//
// Not a flag. addFlag slices at FLAG_TEXT_MAX, which cut two handoffs off mid-sentence in September
// before anyone had read them — and a flag belongs to George's ⚑ panel, not to us. A file has no
// cap, never joins the document's merge, and never lands in his list. Pure here: cli.js does the
// writing, so the ops stay synchronous.

export const TRAIL_NAME = 'trail.md';
export const TRAIL_PATH = `handoffs/${TRAIL_NAME}`;
export const TRAIL_KEEP = 200; // lines of the trail kept; older ones go

const pad = (n) => String(n).padStart(2, '0');
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function slug(title) {
  const out = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return out.replace(/-+$/, '') || 'handoff';
}

// Named by when it was written, so the list sorts itself and two handoffs a minute apart can't
// collide. UTC throughout: these are read by whoever maintains the app, not by George.
export function handoffPath(at, title) {
  const d = new Date(at);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `handoffs/${day}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}-${slug(title)}.md`;
}

// One line of frontmatter each, then the text exactly as it was given. The build is stamped so a
// handoff read months later says which version of the tool produced it.
export function handoffFile({ at, by, build, app, title, text }) {
  const head = [
    '---',
    `at: ${new Date(at).toISOString()}`,
    `by: ${by}`,
    `tool: ${build}`,
    `app: ${app}`,
    `title: ${oneLine(title)}`,
    '---',
  ].join('\n');
  return `${head}\n\n${text}\n`;
}

const newestFirst = (a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0);

// The trail lives in the same directory but is not a handoff — it is the tool's own record, and
// listing it would only invite Claude to read its own stumbles back.
export const openHandoffs = (files) => files.filter((f) => f.name !== TRAIL_NAME && f.name.endsWith('.md'));

export function handoffList(files) {
  const open = openHandoffs(files);
  if (!open.length) return 'No open handoffs.';
  const lines = [...open].sort(newestFirst).map((f) => `  ${f.name} · ${f.size} characters`);
  return ['Open handoffs (newest first):', ...lines, '', 'One in full: handoff <name>.'].join('\n');
}

export function pickHandoff(files, name) {
  const want = String(name ?? '').trim();
  if (!want) throw new Error('handoff needs the name of one, as the handoffs read shows it');
  const hits = openHandoffs(files).filter((f) => f.name.startsWith(want));
  if (!hits.length) throw new Error(`No handoff starts with ${JSON.stringify(want)}`);
  if (hits.length > 1) throw new Error(`${JSON.stringify(want)} matches ${hits.length} handoffs — say more of the name`);
  return hits[0];
}

// One line, never more: a trail that wraps is a trail nobody reads. What was tried is clipped rather
// than dropped — which key was wrong matters more than seeing the whole object.
export function trailLine({ at, build, what, error }) {
  return `${new Date(at).toISOString()} · ${build} · ${oneLine(what).slice(0, 300)} · ${oneLine(error).slice(0, 300)}`;
}

export function pruneTrail(text, keep = TRAIL_KEEP) {
  const lines = String(text ?? '').split('\n').filter((l) => l.trim());
  return `${lines.slice(-keep).join('\n')}\n`;
}
