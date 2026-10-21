// The tool's front door: arguments in, text out. dash.mjs runs main() for real; the tests run it
// with a fake GitHub. Reads print the dashboard; `apply` runs ops from stdin, all or nothing, and
// pushes once. Every line printed goes through scrubText, so the key can never be shown.

import { readConfig } from './config.js';
import { openSession } from './session.js';
import { makeClient as githubClient } from './github.js';
import { READS } from './read.js';
import { OPS, UNLOGGED, runOp, readHandoff, fieldWarnings } from './ops.js';
import { createFileStore } from './files.js';
import { relayingFetch } from './relay.js';
import { curlFetch } from './curl.js';
import { handoffPath, handoffFile, handoffList, pickHandoff, trailLine, pruneTrail, TRAIL_PATH } from './handoff.js';
import { scrubText, APP_VERSION } from '../js/flags.js';
import { capabilities } from './capabilities.js';
import { CAUGHT_UP, caughtUpSince } from './read.js';
import { when } from './text.js';
import { resolveId } from './ids.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const saveFile = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };

// Short, ordered procedures for the jobs that go wrong most: which read to run first, what to change,
// what never to touch. Served from the clone like the reference, so they can't go stale.
export const PLAYBOOKS = ['calendar', 'planning', 'gym', 'workflows', 'reviews', 'food'];

export const USAGE = [
  'Usage: bash run.sh <command> [argument]',
  'Reads: catchup [days] · today · week · goals · list · find <words> · day <YYYY-MM-DD|today|yesterday> · history · checkins [days] · flags [feature|bug|claude|note] · changes [n] · planner · attention · gym · food [days] · photo <meal id> · reference [topic] · handoffs · handoff <name>',
  "Changes: bash run.sh apply <<'EOF' … EOF, with one op or a list of ops as JSON (see reference.md)",
  `Ops: ${Object.keys(OPS).join(' · ')}`,
  'Discover: capabilities [topic|op] · inspect <id> · workflows. Test any JSON batch with preview before apply; preview writes nothing.',
  'Not sure which? `bash run.sh reference` prints the current reference, whose first table maps what you want to do to the command that does it.',
  'Before anything to do with his calendar, planning his week, or training, read the playbook first: bash run.sh reference <calendar|planning|gym>.',
  'For conditional actions or goal reviews: reference workflows or reference reviews.',
  'Start a planning chat with `catchup`: everything since the last one, then it remembers where you got to.',
].join('\n');

function parseOps(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('apply needs JSON on stdin: one op object, or a list of them');
  }
  const ops = Array.isArray(data) ? data : [data];
  if (!ops.length) throw new Error('apply got an empty list — nothing to do');
  return ops;
}

export async function main({
  argv, readText, readStdin, makeClient = githubClient, makeFiles = createFileStore,
  now = () => new Date(), newId, env = process.env, writeFile = saveFile,
}) {
  const out = [];
  let secrets = [];
  let relayed = false;
  const say = (text) => out.push(scrubText(String(text), secrets));
  const finish = (code) => {
    if (relayed) say("(This sandbox can't reach GitHub, so this went through the planner's relay.)");
    return { code, text: out.join('\n') };
  };

  try {
    const args = [...argv];
    const at = args.indexOf('--config');
    if (at === -1 || !args[at + 1]) {
      say('Missing --config <path to config.json>.');
      say(USAGE);
      return finish(1);
    }
    const [, configPath] = args.splice(at, 2);
    // run.sh knows two things the tool can't work out for itself: which build of the docs the clone
    // holds, and where that clone's reference.md is. Run without them — the tests, a local checkout —
    // the tool simply says so rather than pretending.
    const takeFlag = (name) => {
      const i = args.indexOf(name);
      return i === -1 || !args[i + 1] ? null : args.splice(i, 2)[1];
    };
    const build = takeFlag('--build') ?? 'unknown';
    const referencePath = takeFlag('--reference');
    const [command, ...rest] = args;
    // GitHub first; the planner's relay when this sandbox's proxy refuses or can't reach it.
    const connect = (config) => {
      secrets = [config.token, config.relayKey].filter(Boolean);
      const fetch = config.relayUrl
        ? relayingFetch({ relayUrl: config.relayUrl, relayKey: config.relayKey, curl: curlFetch, force: env.DASHBOARD_RELAY === '1', onSwitch: () => { relayed = true; } })
        : undefined;
      return { fetch, files: makeFiles({ token: config.token, repo: config.repo, ...(fetch ? { fetch } : {}) }) };
    };
    if (command === 'capabilities') { say(capabilities(rest.join(' ').trim())); return finish(0); }
    if (!command || command === 'help') {
      say(USAGE);
      return finish(command ? 0 : 1);
    }

    // The reference and the playbooks from the clone, not from this folder — the whole point is that
    // they can't go stale. With a topic it's that playbook; without one, the reference itself.
    if (command === 'reference') {
      if (!referencePath) {
        say("This copy of the tool wasn't told where the current reference is — run it through run.sh.");
        return finish(1);
      }
      const topic = rest.join(' ').trim().toLowerCase();
      if (topic && !PLAYBOOKS.includes(topic)) {
        say(`There's no playbook for ${JSON.stringify(topic)} — there is one for ${PLAYBOOKS.join(', ')}. Plain \`reference\` prints the whole thing.`);
        return finish(1);
      }
      const path = topic
        ? `${referencePath.slice(0, referencePath.lastIndexOf('/') + 1)}playbooks/${topic}.md`
        : referencePath;
      try {
        say(readText(path));
      } catch {
        say(topic ? `Can't read the ${topic} playbook (${path})` : `Can't read the current reference (${path})`);
        return finish(1);
      }
      // A playbook's personal half (his health rules, say) can't sit in this public repo, so it lives
      // in the private sync repo as notes/<topic>.md and is printed after the public half.
      if (topic) {
        try {
          const notes = await connect(readConfig(readText(configPath))).files.read(`notes/${topic}.md`);
          if (notes) say(`\n# His own notes for ${topic} (private, from the sync repo)\n\n${notes.text}`);
        } catch (e) {
          say(`\n(Couldn't read his private notes for ${topic}: ${e.message})`);
        }
      }
      return finish(0);
    }

    let text;
    try {
      text = readText(configPath);
    } catch {
      say(`Can't read the skill's config.json (${configPath})`);
      return finish(1);
    }
    let config;
    try {
      config = readConfig(text);
    } catch (e) {
      say(e.message);
      return finish(1);
    }
    const { fetch, files } = connect(config);

    // What the tool refused, kept in the repo. A weaker model can't be relied on to notice it should
    // report anything, so the tool records its own stumbles: four goes at an op that doesn't exist
    // are worth seeing even when the chat that made them never said a word about it.
    //
    // Recording one must never make it worse. A trail that won't write is silent, and whoever
    // stumbled gets exactly the error they would have got anyway.
    const trail = async (what, error) => {
      if (command === 'preview') return;
      try {
        const existing = await files.read(TRAIL_PATH);
        const line = scrubText(trailLine({ at: now(), build, what, error }), secrets);
        await files.write(TRAIL_PATH, pruneTrail(`${existing?.text ?? ''}\n${line}`), 'trail');
      } catch { /* never fatal, never mentioned */ }
    };

    // Handoffs are files in the repo rather than part of the document, so they are answered here
    // rather than through READS, which only ever see the document.
    if (command === 'handoffs' || command === 'handoff') {
      try {
        const open = await files.list('handoffs');
        if (command === 'handoffs') { say(handoffList(open)); return finish(0); }
        const file = pickHandoff(open, rest.join(' '));
        const body = await files.read(file.path);
        say(body ? body.text : `Can't read ${file.name}`);
        return finish(0);
      } catch (e) {
        say(`Couldn't reach the handoffs: ${e.message}`);
        return finish(2);
      }
    }
    // Before any date is made: the sandbox runs on UTC, George's devices on London time.
    env.TZ = config.timeZone;

    if (command !== 'apply' && command !== 'preview' && command !== 'photo' && !Object.hasOwn(READS, command)) {
      await trail(`command: ${command}`, `Unknown command "${command}"`);
      say(`Unknown command "${command}".`);
      say(USAGE);
      return finish(1);
    }
    let ops = null;
    if (command === 'apply' || command === 'preview') {
      try {
        ops = parseOps(await readStdin());
      } catch (e) {
        say(e.message);
        return finish(1);
      }
    }
    let session;
    try {
      session = await openSession({
        client: makeClient({ token: config.token, repo: config.repo, ...(fetch ? { fetch } : {}) }),
        dayStartHour: config.dayStartHour, now, newId,
      });
    } catch (e) {
      say(`Couldn't read the dashboard: ${e.message}`);
      return finish(2);
    }
    const { store } = session;

    // A meal's photo, from the sync repo to a file Claude can open and look at.
    if (command === 'photo') {
      try {
        const { id, rec } = resolveId(store.doc(), rest.join(' '), ['meals']);
        if (rec.kind !== 'meal') throw new Error(`${id} isn't a meal`);
        if (!rec.photo) {
          say(rec.photoState === 'local' ? `That meal's photo is on George's phone and hasn't been uploaded yet.` : 'That meal has no photo.');
          return finish(0);
        }
        const bytes = await files.readBytes(rec.photo);
        if (!bytes) { say(`The photo ${rec.photo} isn't in the sync repo.`); return finish(1); }
        const path = join(tmpdir(), 'dashboard-photos', `${id.replace(/[^\w.-]+/g, '-')}.jpg`);
        writeFile(path, bytes);
        say(`Saved ${rec.photo} to ${path} — open it to look at the meal.`);
        return finish(0);
      } catch (e) {
        say(e.message);
        return finish(1);
      }
    }

    // The catch-up remembers where it got to, so the next one starts there: the one read that writes.
    // A fixed look back (`catchup 3`) reads without moving the marker.
    if (command === 'catchup') {
      try {
        say(READS.catchup(store.doc(), store.today(), rest.join(' '), now()));
      } catch (e) {
        say(e.message);
        return finish(1);
      }
      if (!rest.join('').trim()) {
        session.record((s) => s.putCalendar(CAUGHT_UP, { at: now().toISOString() }, 'claude'), { log: false });
        const saved = await session.push();
        say(saved.ok ? `(Caught up to ${when(caughtUpSince(store.doc()) ?? now().toISOString()).split(', ')[1]} — the next catchup starts here.)`
          : `(The catch-up couldn't be marked, so the next one will repeat this: ${saved.error})`);
      }
      return finish(0);
    }

    if (command !== 'apply' && command !== 'preview') {
      try {
        say(READS[command](store.doc(), store.today(), rest.join(' ')));
        return finish(0);
      } catch (e) {
        say(e.message);
        return finish(1);
      }
    }

    // Every op runs in memory first; one failure and nothing is pushed.
    const lines = [];
    const handoffs = [];
    const notes = [];
    for (const [i, op] of ops.entries()) {
      try {
        if (command === 'preview' && fieldWarnings(op).length) throw new Error(fieldWarnings(op).join(' '));
        lines.push(session.record((s) => runOp(s, op), { log: !UNLOGGED.has(op?.op) }).summary);
        if (op?.op === 'handoff') handoffs.push(readHandoff(op));
        // A field the op never read is a thing George asked for that didn't happen, so it is said
        // out loud and kept, even though the op itself went through.
        for (const note of fieldWarnings(op)) {
          lines.push(note);
          notes.push([`apply op ${i + 1} of ${ops.length}: ${JSON.stringify(op)}`, note]);
        }
      } catch (e) {
        await trail(`apply op ${i + 1} of ${ops.length}: ${JSON.stringify(op)}`, e.message);
        say(`Nothing was changed. Op ${i + 1} of ${ops.length} (${op?.op ?? '?'}) failed: ${e.message}`);
        return finish(1);
      }
    }
    if (command === 'preview') {
      lines.forEach(say);
      say('Preview only: nothing saved, no API calls or handoff files written. Conditional actions run later, after a matching report; this does not simulate future reports.');
      say('Any new #ids above are only for this preview: apply makes its own, so use the ids apply prints.');
      return finish(0);
    }
    const result = await session.push();
    if (!result.ok) {
      say(`Nothing was saved: ${result.error}`);
      return finish(2);
    }
    for (const [what, note] of notes) await trail(what, note);
    lines.forEach(say);
    if (ops.length > handoffs.length) {
      say(!result.pushed ? 'Nothing needed changing.' : 'Saved to GitHub — the laptop and phone pick it up at their next sync.');
    }
    // Handoffs go last, and each on its own: a file that won't write is worth a line of its own
    // rather than losing the ops that did land.
    for (const h of handoffs) {
      const at = now();
      const path = handoffPath(at, h.title);
      try {
        const body = handoffFile({ at, by: 'claude', build, app: APP_VERSION, title: h.title, text: h.text });
        await files.write(path, body, `handoff: ${h.title}`);
        say(`Written to ${path} — ${h.text.length} characters, none of them cut.`);
      } catch (e) {
        say(`The handoff ${JSON.stringify(h.title)} couldn't be written: ${e.message}`);
        return finish(2);
      }
    }
    return finish(0);
  } catch (e) {
    say(`Something went wrong in the dashboard tool: ${e?.message ?? e}`);
    return finish(2);
  }
}
