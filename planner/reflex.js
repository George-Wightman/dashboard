// Reflexes (docs/superpowers/specs/2026-09-25-coach-mind-design.md): something happened — a tick, a
// push, a new calendar event, a block that slipped — and Gemini works out whether it deserves a word
// from the Coach, and what. Each chain reads the event from two or three angles at once, drafts one
// message, then checks it twice (plain code in js/mind.js, and a critic) before anything is said. Also
// the morning and evening openers, now written here rather than by whichever page happens to be open.
// Pure apart from the store writes; Gemini comes in as `gemini.ask` (planner/gemini-gas.js).

import { addDays, logicalDay, daysBetween } from '../js/dates.js';
import { talkContext, talksOn, momentAt, PLAIN_OPENERS } from '../js/talk.js';
import { dayClosed } from '../js/plan-state.js';
import { checkMessage, nextMindSlot, picture, MESSAGE_MAX } from '../js/mind.js';
import { unhandled, budget, spend } from '../js/mind-state.js';

export const WAIT_MINUTES = 20;
export const FRESH_HOURS = 3;
export const DRAFT_MAX = 450;
const MIN = 60000;
const NOT_REFLEXES = new Set(['ask', 'risk', 'reply']);

export const MIND_SYSTEM = [
  "You are the background mind of George's Coach, inside his personal dashboard. Nobody asked you anything: something just happened, and you decide whether it deserves a word from the Coach, and what that word is.",
  'British English. Warm, direct and specific: name the actual task, number, file or time. No generic encouragement, no filler, no emoji.',
  "Only ticks say what George has done. Something is done only when it is in 'Ticked off today' or an event says it was ticked. A calendar block, even one whose time has passed, is a plan and not evidence.",
  "Hold him to what he committed to. Work he pushed or deleted after the morning lock is not a win: ask what happened, briefly, curious rather than lecturing. A times-a-week habit that is on pace is a rest day and needs no comment.",
  'His gym sessions are his own to plan. Never invent a clock time or a date: use only the ones in the plan, the events or the files.',
  "When a task was ticked by Claude, George did that work in a session with Claude: talk about the work, not about Claude.",
  "Don't repeat what the Coach has said recently (it is listed). Saying nothing is a good answer when there is nothing worth saying.",
  'Reply with JSON only, in exactly the shape asked for.',
].join('\n');

const ANGLES = {
  progress: "Angle: progress. From the event, its goal and milestones, and the files George wrote (debriefs, reflections): how is the goal going? What is improving, what keeps coming up, how does this attempt compare with the last one, and is it on track for the goal's date? Cite the files.",
  pattern: "Angle: pattern. From Claude's picture of George, his journal, recent conversations and the earlier events: is this part of a pattern, good or bad, worth naming? Only a pattern the record actually shows.",
  plan: "Angle: plan. From today's and tomorrow's lists, what he committed to and the bookings: what does this change for the rest of today and the next few days? Is anything now at risk, overbooked or worth moving? Never suggest moving his gym.",
};
const ANGLE_SHAPE = 'Shape: {"notes": "at most 600 characters of specific observations", "matters": 0 to 3 (how much this deserves a word from the Coach now), "escalate": true only if the plan for a deadline no longer fits and needs a proper re-plan}';

const OPENER_JOBS = {
  morning: "It's the morning. Write the Coach's opening message for today: one or two sentences that name the most important thing booked today, ending in one question about what today looks like and anything the plan should know.",
  evening: "It's the evening. Write the Coach's opening message about how today went: name something specific he ticked off today; if nothing is ticked, don't claim anything was done; if anything he committed to was pushed, deleted or missed, ask about it rather than calling the day a success. End with one question about today or tomorrow.",
};

// ---- What to look at -----------------------------------------------------------------------------

// The events worth a reflex now, as subjects: level 3 straight away, level 2 once the burst has
// settled (20 minutes since its newest event), nothing older than three hours, at most `max`.
export function pickGroups(mind, now, max = 2) {
  const t = now.getTime();
  const groups = new Map();
  for (const e of unhandled(mind, 'reflex')) {
    if (e.level < 2 || NOT_REFLEXES.has(e.kind) || t - Date.parse(e.at) >= FRESH_HOURS * 3600000) continue;
    const key = e.refs?.goalId ?? e.refs?.itemId ?? e.refs?.calendar ?? e.kind;
    const g = groups.get(key) ?? { key, events: [] };
    g.events.push(e);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const top = [...g.events].sort((a, b) => b.level - a.level)[0];
      return { key: g.key, kind: top.kind, level: top.level, events: g.events, newest: Math.max(...g.events.map((e) => Date.parse(e.at))) };
    })
    .filter((g) => g.level >= 3 || t - g.newest >= WAIT_MINUTES * MIN)
    .sort((a, b) => b.level - a.level || a.newest - b.newest)
    .slice(0, max);
}

export function anglesFor(group, doc, today) {
  const kinds = new Set(group.events.map((e) => e.kind));
  if (kinds.has('tick') || kinds.has('milestone')) {
    const goal = doc?.goals?.[group.events.find((e) => e.refs?.goalId)?.refs.goalId];
    const soon = goal?.targetDate && daysBetween(today, goal.targetDate) <= 7;
    return soon ? ['progress', 'pattern', 'plan'] : ['progress', 'pattern'];
  }
  if (['pushed', 'dropped', 'moved', 'slip'].some((k) => kinds.has(k))) return ['plan', 'pattern'];
  if (kinds.has('hebrew')) return ['progress'];
  return ['plan'];
}

// The events as a prompt reads them. Gemini only ever sees a health label, never the numbers.
export function groupText(group, { forGemini = true } = {}) {
  const lines = ['What just happened:'];
  const files = [];
  for (const e of group.events) {
    lines.push(`- [${e.kind}${e.by && e.by !== 'me' ? `, by ${e.by}` : ''}] ${e.text}`);
    for (const f of e.facts ?? []) lines.push(`  · ${f}`);
    if (e.health?.label) lines.push(`  · Health: ${e.health.label}`);
    if (!forGemini && e.health?.detail) lines.push(`  · Health detail: ${JSON.stringify(e.health.detail)}`);
    for (const a of e.artefacts ?? []) if (!files.some((x) => x.path === a.path)) files.push(a);
  }
  if (files.length) {
    lines.push('', 'Files George wrote about it, from his Drive (newest first):');
    for (const f of files) lines.push(`--- ${f.path} (changed ${f.modified.slice(0, 16).replace('T', ' ')} UTC)`, f.text);
  }
  return lines.join('\n');
}

// What the Coach has said lately, anywhere, so a reflex doesn't say it again.
export function recentCoach(doc, today, n = 6) {
  return Object.values(doc.journal ?? {})
    .filter((t) => t.kind === 'talk' && t.status === 'active' && t.day >= addDays(today, -1))
    .flatMap((t) => (t.messages ?? []).filter((m) => m.who === 'coach'))
    .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
    .slice(-n)
    .map((m) => m.text);
}

function contextFor(doc, today, now, recent) {
  const said = recent.length ? `\n\nWhat the Coach has said recently (don't repeat it):\n${recent.map((r) => `- ${r}`).join('\n')}` : '';
  return `${talkContext(doc, today, now, { first: true })}${said}`;
}

export const readPrompt = (angle, context, group) => ({
  system: MIND_SYSTEM, prompt: `${context}\n\n${groupText(group)}\n\n${ANGLES[angle]}\n${ANGLE_SHAPE}`,
});

export function draftPrompt(context, group, notes) {
  const read = notes.map((n) => `${n.angle}: ${n.notes}`).join('\n');
  return {
    system: MIND_SYSTEM,
    prompt: `${context}\n\n${groupText(group)}\n\nWhat you noticed, by angle:\n${read}\n\nNow decide what the Coach says, if anything. Say something only if it would genuinely help George now: react to what happened, name specifics (the task, what his write-up said, the number), and end with at most one question. One to three sentences, at most ${DRAFT_MAX} characters. If he pushed or deleted committed work, ask why, once, without lecturing.\nShape: {"say": true or false, "text": "the message", "notify": true if it is worth buzzing his phone for (a reaction to something he just did, or a question that matters today), "escalate": true if this needs Claude's deeper re-plan, "why": "one line on why this is (or isn't) worth saying"}`,
  };
}

export const checkPrompt = (context, group, text) => ({
  system: 'You check a message the Coach is about to send George against the record. British English. Reply with JSON only.',
  prompt: `The record:\n${context}\n\n${groupText(group)}\n\nThe message:\n"${text}"\n\nLook for: claiming something is done that isn't ticked; a wrong time, day or number; anything the record or the files don't support; calling a rest day a miss; generic filler; more than one question; lecturing.\nShape: {"ok": true or false, "problems": ["…"], "text": "if not ok, the message corrected in the same voice and at most ${DRAFT_MAX} characters; otherwise empty"}`,
});

export const openerPrompt = (slot, context) => ({
  system: MIND_SYSTEM, prompt: `${context}\n\n${OPENER_JOBS[slot]} At most ${DRAFT_MAX} characters.\nShape: {"text": "the message"}`,
});

const cleanText = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX);

// ---- A chain ------------------------------------------------------------------------------------

export async function runChain({ gemini, doc, group, now, today, recent = [] }) {
  const context = contextFor(doc, today, now, recent);
  const angles = anglesFor(group, doc, today);
  let calls = angles.length;
  const reads = await gemini.ask(angles.map((a) => ({ ...readPrompt(a, context, group), model: 'think' })));
  const notes = reads.map((r, i) => (r.data ? { angle: angles[i], notes: String(r.data.notes ?? ''), matters: Number(r.data.matters) || 0, escalate: r.data.escalate === true } : null)).filter(Boolean);
  if (!notes.length) return { say: false, calls, escalate: false, problems: [], error: reads[0]?.error ?? 'failed' };
  const escalate = notes.some((n) => n.escalate);
  if (group.level < 3 && Math.max(...notes.map((n) => n.matters)) === 0) return { say: false, calls, escalate, problems: [], why: 'Nothing worth saying' };

  const [draft] = await gemini.ask([{ ...draftPrompt(context, group, notes), model: 'think' }]);
  calls++;
  if (!draft.data) return { say: false, calls, escalate, problems: [], error: draft.error };
  const d = draft.data;
  if (d.say !== true || !cleanText(d.text)) return { say: false, calls, escalate: escalate || d.escalate === true, problems: [], why: String(d.why ?? '') };

  let text = cleanText(d.text);
  const plain = checkMessage(doc, { today, now, text, recent });
  const [critic] = await gemini.ask([{ ...checkPrompt(context, group, text), model: 'check' }]);
  calls++;
  const criticOk = !critic.data || critic.data.ok !== false;
  if (!plain.ok || !criticOk) {
    const revised = cleanText(critic.data?.text);
    const again = revised ? checkMessage(doc, { today, now, text: revised, recent }) : { ok: false, problems: [] };
    if (!revised || !again.ok) {
      return { say: false, calls, escalate: escalate || d.escalate === true, problems: [...plain.problems, ...(critic.data?.problems ?? []), ...again.problems].map(String) };
    }
    text = revised;
  }
  return { say: true, text, notify: d.notify === true, escalate: escalate || d.escalate === true, calls, problems: [], why: String(d.why ?? '') };
}

// Every reflex due this run. Writes the Coach's messages into the store (a new mind-n talk each),
// stamps the events it looked at, and returns what it said and what should go to Claude.
export async function runReflexes({ gemini, store, mind, now, config, timeLeft = () => true, quiet = false, dayStartHour = 4 }) {
  const today = logicalDay(now, dayStartHour);
  const at = now.toISOString();
  const said = [];
  const escalate = [];
  const runs = [];
  for (const group of pickGroups(mind, now)) {
    if (!timeLeft()) break;
    const doc = store.doc();
    const result = await runChain({ gemini, doc, group, now, today, recent: recentCoach(doc, today) });
    const ids = group.events.map((e) => e.id);
    for (const id of ids) mind.events[id] = { ...mind.events[id], reflex: at };
    if (result.escalate) escalate.push(...ids);
    let spoke = false;
    if (result.say) {
      const b = budget(mind, today);
      const gapOk = group.level >= 3 || !b.lastSaid || now.getTime() - Date.parse(b.lastSaid) >= config.gapMinutes * MIN;
      if (b.messages < config.messagesPerDay && gapOk) {
        const slot = nextMindSlot(doc, today, 'mind');
        const m = { who: 'coach', text: result.text, at, from: 'mind', by: 'gemini', notify: !!(result.notify && group.level >= 3 && !quiet), ref: ids };
        store.saveJournal({ kind: 'talk', day: today, slot, messages: [m], model: config.models.think }, 'mind');
        spend(mind, today, 'messages');
        mind.budget.lastSaid = at;
        said.push({ talkId: `talk:${today}:${slot}`, m });
        spoke = true;
      }
    }
    runs.push({ id: `reflex:${at}:${group.key}`, at, engine: 'reflex', trigger: group.kind, events: ids, calls: result.calls, said: spoke,
      summary: result.why ?? '', ...(result.problems?.length ? { problems: result.problems.slice(0, 6) } : {}), ...(result.error ? { error: result.error } : {}) });
  }
  for (const r of runs) mind.runs[r.id] = r;
  return { said, escalate, runs };
}

// ---- Openers -----------------------------------------------------------------------------------

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// The opener the background owes George now, or null: the morning one from `morningAt` until noon,
// the evening one from `checkinAt`; one each a day, none on a closed day, and none for a moment he has
// already spoken in.
export function backgroundOpenerDue({ doc, now, config, dayStartHour = 4, quiet = false }) {
  const today = logicalDay(now, dayStartHour);
  if (dayClosed(doc, today)) return null;
  const h = now.getHours();
  const m = (h < dayStartHour ? h + 24 : h) * 60 + now.getMinutes();
  const hours = { dayStartHour, checkinHour: Number(config.checkinAt.slice(0, 2)) };
  const spoke = (slot) => talksOn(doc, today).some((t) => (t.messages ?? []).some((x) => x.who === 'george' && momentAt(new Date(x.at), hours) === slot));
  const have = (slot) => !!doc.journal?.[`talk:${today}:${slot}`];
  if (m >= minutes(config.morningAt) && m < 12 * 60 && !quiet && !have('morning') && !spoke('morning')) return 'morning';
  if (m >= minutes(config.checkinAt) && !have('evening') && !spoke('evening')) return 'evening';
  return null;
}

export async function writeOpener({ gemini, store, slot, now, config, quiet = false, dayStartHour = 4 }) {
  const today = logicalDay(now, dayStartHour);
  const doc = store.doc();
  const recent = recentCoach(doc, today);
  let text = null;
  let by = 'gemini';
  const pic = picture(doc);
  if (slot === 'morning' && pic?.opener?.day === today && checkMessage(doc, { today, now, text: pic.opener.text, recent }).ok) {
    text = cleanText(pic.opener.text);
    by = 'claude';
  }
  if (!text && gemini) {
    const context = contextFor(doc, today, now, recent);
    let problems = [];
    for (let attempt = 0; attempt < 2 && !text; attempt++) {
      const extra = problems.length ? `\n\nYour last draft had these problems, so write it again: ${problems.join('; ')}` : '';
      const p = openerPrompt(slot, context);
      const [r] = await gemini.ask([{ ...p, prompt: p.prompt + extra, model: 'think' }]);
      if (!r.data) break;
      const draft = cleanText(r.data.text);
      const check = checkMessage(doc, { today, now, text: draft, recent });
      if (draft && check.ok) text = draft;
      else problems = check.problems;
    }
  }
  if (!text) { text = PLAIN_OPENERS[slot]; by = 'plain'; }
  // An earlier opener he never answered expires, as it does on the page.
  for (const t of talksOn(store.doc(), today)) {
    if (['morning', 'afternoon', 'evening'].includes(t.slot) && !t.done && !(t.messages ?? []).some((x) => x.who === 'george')) store.updateJournal(t.id, { done: true });
  }
  const m = { who: 'coach', text, at: now.toISOString(), from: 'mind', by, notify: !quiet };
  store.saveJournal({ kind: 'talk', day: today, slot, messages: [m], model: by === 'gemini' ? config.models.think : '' }, 'mind');
  return { talkId: `talk:${today}:${slot}`, m };
}

