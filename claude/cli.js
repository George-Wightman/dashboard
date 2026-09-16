// The tool's front door: arguments in, text out. dash.mjs runs main() for real; the tests run it
// with a fake GitHub. Reads print the dashboard; `apply` runs ops from stdin, all or nothing, and
// pushes once. Every line printed goes through scrubText, so the key can never be shown.

import { readConfig } from './config.js';
import { openSession } from './session.js';
import { makeClient as githubClient } from './github.js';
import { READS } from './read.js';
import { OPS, UNLOGGED, runOp } from './ops.js';
import { scrubText } from '../js/flags.js';

export const USAGE = [
  'Usage: bash run.sh <command> [argument]',
  'Reads: today · week · goals · list · find <words> · day <YYYY-MM-DD|today|yesterday> · history · journal · talk <day> · flags · changes [n] · planner · attention · gym · reference',
  "Changes: bash run.sh apply <<'EOF' … EOF, with one op or a list of ops as JSON (see reference.md)",
  `Ops: ${Object.keys(OPS).join(' · ')}`,
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
  argv, readText, readStdin, makeClient = githubClient, now = () => new Date(), newId, env = process.env,
}) {
  const out = [];
  let secrets = [];
  const say = (text) => out.push(scrubText(String(text), secrets));
  const finish = (code) => ({ code, text: out.join('\n') });

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
    if (!command || command === 'help') {
      say(USAGE);
      return finish(command ? 0 : 1);
    }

    // The reference from the clone, not from this folder — the whole point is that it can't go stale.
    if (command === 'reference') {
      if (!referencePath) {
        say("This copy of the tool wasn't told where the current reference is — run it through run.sh.");
        return finish(1);
      }
      try {
        say(readText(referencePath));
      } catch {
        say(`Can't read the current reference (${referencePath})`);
        return finish(1);
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
    secrets = [config.token];
    // Before any date is made: the sandbox runs on UTC, George's devices on London time.
    env.TZ = config.timeZone;

    if (command !== 'apply' && !Object.hasOwn(READS, command)) {
      say(`Unknown command "${command}".`);
      say(USAGE);
      return finish(1);
    }
    let ops = null;
    if (command === 'apply') {
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
        client: makeClient({ token: config.token, repo: config.repo }),
        dayStartHour: config.dayStartHour, now, newId,
      });
    } catch (e) {
      say(`Couldn't read the dashboard: ${e.message}`);
      return finish(2);
    }
    const { store } = session;

    if (command !== 'apply') {
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
    for (const [i, op] of ops.entries()) {
      try {
        lines.push(session.record((s) => runOp(s, op), { log: !UNLOGGED.has(op?.op) }).summary);
      } catch (e) {
        say(`Nothing was changed. Op ${i + 1} of ${ops.length} (${op?.op ?? '?'}) failed: ${e.message}`);
        return finish(1);
      }
    }
    const result = await session.push();
    if (!result.ok) {
      say(`Nothing was saved: ${result.error}`);
      return finish(2);
    }
    lines.forEach(say);
    say(result.pushed ? 'Saved to GitHub — the laptop and phone pick it up at their next sync.' : 'Nothing needed changing.');
    return finish(0);
  } catch (e) {
    say(`Something went wrong in the dashboard tool: ${e?.message ?? e}`);
    return finish(2);
  }
}
