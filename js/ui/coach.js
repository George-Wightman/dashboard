// The Coach panel: a conversation with the Coach (js/talk.js says when it opens one and what it's
// told, js/coach-tools.js what it may do), goal shaping under Goals, and last week's digest. Every
// Gemini request runs in the background: the panel says "Thinking…", the rest of the page keeps
// working, and a failure is one line of text, never a dialog. What George types lives in
// ctx.ui.coach, so a re-render (a sync landing, a tick on the left) never loses it. On a phone the
// conversation also opens as a sheet over the page (#coach-sheet), from the Coach's line on Today.

import { h } from './dom.js';
import { GeminiError, MESSAGES } from '../gemini.js';
import { shapePrompt, parseShape, digestOf, digestDue, digestPrompt, parseDigest } from '../coach.js';
import { addDays, weekStart } from '../dates.js';
import { canUndo } from '../changes.js';
import {
  talkId, talkOf, entryOf, entryId, talksOn, heard, openerDue, unfinished, nextOwnSlot, slotName, talkSystem, talkContents,
  plainEntry, OPENERS, PLAIN_OPENERS, WRAP_UP, MESSAGE_MAX, ENTRY_MAX,
} from '../talk.js';
import { coachTools } from '../coach-tools.js';
import { keptFocus, restoreFocus } from './side.js';

const link = (text, onclick) => h('button', { class: 'link', type: 'button', onclick }, text);
// The time: the page's clock (ctx.now, which the tests set), else the real one.
const nowOf = (ctx) => ctx.now?.() ?? new Date();
const hours = (ctx) => {
  const { dayStartHour, checkinHour } = ctx.store.settings();
  return { dayStartHour, checkinHour };
};

// Why a request can't be sent right now ('' when it can): no key on this device, or offline.
function blocker(ctx) {
  if (!ctx.coach.keys().length) return MESSAGES.nokey;
  if (navigator.onLine === false) return MESSAGES.offline;
  return '';
}

// Give a sync up to `ms` a chance to land before asking Gemini — a stuck, slow or failing sync
// must never hold up the request. ctx.coach.syncWaitMs overrides the default (tests inject a short
// cap there rather than waiting out the real one).
function syncFirst(ctx, ms = ctx.coach.syncWaitMs ?? 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => { clearTimeout(timer); resolve(); };
    Promise.resolve(ctx.syncNow?.()).then(done, done);
  });
}

// Ask Gemini for JSON (goal shaping, the digest), then check the reply. Resolves { reply, model }.
// Rejects with an Error whose message is the line to show: Gemini's own plain-English message, or
// the catch-all — never another error's raw text.
async function consult(ctx, prompt, parse) {
  const why = blocker(ctx);
  if (why) throw new Error(why);
  try {
    const { data, model } = await ctx.coach.ask(prompt);
    return { reply: parse(data), model };
  } catch (e) {
    throw new Error(e instanceof GeminiError ? e.message : MESSAGES.failed);
  }
}

// ---- Where the conversation is -------------------------------------------------------------------

// What the Coach is doing, in a word, for the minute tick (which repaints when it changes) and ⚑:
// 'nokey', 'waiting' (its question is on Today), 'talking', 'due' (a moment's opener) or 'quiet'.
export function talkNow(ctx) {
  if (!ctx.coach.keys().length) return 'nokey';
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const talks = talksOn(doc, today);
  if (talks.some((t) => !t.done && t.messages?.length && !heard(t))) return 'waiting';
  if (talks.some((t) => !t.done && heard(t))) return 'talking';
  return openerDue(doc, { today, now: nowOf(ctx), ...hours(ctx) }) ? 'due' : 'quiet';
}

// The conversation on show: the one picked (a new one of George's may not exist yet), else today's
// latest; null when there's none.
function shownSlot(ctx) {
  const c = ctx.ui.coach;
  const talks = talksOn(ctx.store.doc(), ctx.store.today());
  if (c.talk && (String(c.talk).startsWith('own-') || talks.some((t) => t.slot === c.talk))) return c.talk;
  return talks.at(-1)?.slot ?? null;
}

// ---- Entries and their handoffs ------------------------------------------------------------------

// An entry's handoffs are flags from the Coach, kept in step with its list: one it already had keeps
// its flag, a new one gets a flag, and one taken out has its flag marked addressed.
function reflag(store, id, before, forClaude) {
  const oldTexts = before?.forClaude ?? [];
  const oldIds = before?.flagIds ?? [];
  const ids = forClaude.map((text) => {
    const i = oldTexts.indexOf(text);
    const kept = i === -1 ? null : oldIds[i];
    return kept && store.doc().flags[kept] ? kept : store.addFlag(text, { from: 'coach', entry: id }, 'coach', 'claude').id;
  });
  for (const f of oldIds) if (!ids.includes(f) && store.doc().flags[f]?.status === 'active') store.addressFlag(f);
  return ids;
}

function saveEntry(store, day, slot, entry) {
  const id = entryId(day, slot);
  const forClaude = talkOf(store.doc(), day, slot)?.handoffs ?? [];
  const flagIds = reflag(store, id, entryOf(store.doc(), day, slot), forClaude);
  store.saveJournal({ kind: 'entry', day, slot, ...entry, forClaude, flagIds }, 'gemini');
}

export function editEntry(ctx, e) {
  ctx.ui.coach.editing = { id: e.id, feeling: e.feeling ?? '', text: e.text ?? '', forClaude: (e.forClaude ?? []).join('\n') };
  ctx.render();
}

export function saveEdit(ctx) {
  const { store, ui } = ctx;
  const ed = ui.coach.editing;
  const e = ed && store.doc().journal[ed.id];
  if (!e) { ui.coach.editing = null; ctx.render(); return; }
  const text = ed.text.trim().slice(0, ENTRY_MAX);
  if (!text) { ui.coach.talkError = 'An entry needs some words — or Remove it.'; ctx.render(); return; }
  const forClaude = ed.forClaude.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10);
  const flagIds = reflag(store, e.id, e, forClaude);
  ui.coach.editing = null;
  ui.coach.talkError = '';
  store.updateJournal(e.id, { feeling: ed.feeling.trim().slice(0, 60), text, forClaude, flagIds });
}

// Remove: the entry is archived and its handoffs are withdrawn (their flags marked addressed).
export function removeEntry(ctx, e) {
  const { store } = ctx;
  for (const f of e.flagIds ?? []) if (store.doc().flags[f]?.status === 'active') store.addressFlag(f);
  store.updateJournal(e.id, { status: 'archived' });
}

// ---- The conversation ----------------------------------------------------------------------------

const QUIET_TOOLS = new Set(['get_day', 'get_gym', 'find', 'get_journal', 'finish', 'hand_to_claude']);

// What a turn left, kept with the conversation: the Coach's reply with what it did, any handoffs,
// and — when it called finish — the conversation marked done and its journal entry saved.
function keep(store, day, slot, at, result, did, handoffs, entry) {
  const t = talkOf(store.doc(), day, slot);
  const text = result?.text || (did.length ? 'Done.' : '');
  const reply = text ? [{ who: 'coach', text, at, ...(did.length ? { did } : {}) }] : [];
  store.saveJournal({
    kind: 'talk', day, slot,
    messages: [...(t?.messages ?? []), ...reply],
    handoffs: [...(t?.handoffs ?? []), ...handoffs],
    ...(result?.model ? { model: result.model } : {}),
    ...(entry ? { done: true } : {}),
  }, 'gemini');
  if (entry) saveEntry(store, day, slot, entry);
}

// One turn with the tools. The Coach's changes land as it makes them; what it says lands once
// nothing is being typed elsewhere (ctx.whenIdle). Resolves the entry finish wrote, if any; rejects
// when Gemini gave nothing back (what it did before failing is still kept).
async function turn(ctx, day, slot, extra = [], { only = null, toolConfig = null, steps } = {}) {
  const { store } = ctx;
  const did = [];
  const handoffs = [];
  let entry = null;
  const tools = coachTools({ store, onHandoff: (t) => handoffs.push(t), onFinish: (e) => { entry = e; } });
  let result;
  try {
    result = await ctx.coach.talk({
      system: talkSystem(store.doc(), day, nowOf(ctx)),
      contents: talkContents(talkOf(store.doc(), day, slot), extra),
      tools: only ? tools.declarations.filter((d) => only.includes(d.name)) : tools.declarations,
      toolConfig,
      ...(steps != null ? { steps } : {}),
      run: (name, args) => {
        const res = tools.run(name, args);
        if (res.ok && res.did && !QUIET_TOOLS.has(name)) did.push({ text: res.did, change: res.change ?? null });
        return res;
      },
    });
  } catch (e) {
    await ctx.whenIdle();
    if (did.length || handoffs.length || entry) keep(store, day, slot, nowOf(ctx).toISOString(), null, did, handoffs, entry);
    throw e;
  }
  await ctx.whenIdle();
  keep(store, day, slot, nowOf(ctx).toISOString(), result, did, handoffs, entry);
  return entry;
}

// George's message, and the Coach's answer. Nothing back from Gemini: his message comes off the
// conversation and goes back in the box, with the reason underneath.
export async function sendMessage(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  const text = String(c.draft ?? '').trim().slice(0, MESSAGE_MAX);
  if (!text || c.talkBusy) return;
  const why = blocker(ctx);
  if (why) { c.talkError = why; ctx.render(); return; }
  const day = store.today();
  const current = shownSlot(ctx);
  const slot = current && !talkOf(store.doc(), day, current)?.done ? current : nextOwnSlot(store.doc(), day);
  const before = talkOf(store.doc(), day, slot)?.messages ?? [];
  Object.assign(c, { talk: slot, draft: '', talkError: '', talkBusy: 'thinking' });
  store.saveJournal({ kind: 'talk', day, slot, messages: [...before, { who: 'george', text, at: nowOf(ctx).toISOString() }] }, 'gemini');
  try {
    await turn(ctx, day, slot);
  } catch (e) {
    const msgs = [...(talkOf(store.doc(), day, slot)?.messages ?? [])];
    if (msgs.at(-1)?.who === 'george' && msgs.at(-1).text === text) {
      msgs.pop();
      store.saveJournal({ kind: 'talk', day, slot, messages: msgs }, 'gemini');
      if (!msgs.length) store.updateJournal(talkId(day, slot), { status: 'archived' });
      if (!c.draft) c.draft = text;
    }
    c.talkError = e instanceof GeminiError ? e.message : MESSAGES.failed;
  } finally {
    c.talkBusy = '';
    ctx.render();
  }
}

// A conversation over: one George never answered just closes; one he spoke in gets its journal
// entry — from Gemini, asked to finish, or else from his own words.
async function wrapUp(ctx, talk) {
  const { store } = ctx;
  if (!heard(talk)) { store.updateJournal(talk.id, { done: true }); return; }
  let entry = null;
  try {
    entry = await turn(ctx, talk.day, talk.slot, [{ role: 'user', parts: [{ text: WRAP_UP }] }], {
      only: ['finish'], toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['finish'] } }, steps: 1,
    });
  } catch {
    // his own words will do
  }
  await ctx.whenIdle();
  const latest = talkOf(store.doc(), talk.day, talk.slot) ?? talk;
  if (!latest.done) store.updateJournal(latest.id, { done: true });
  if (!entry && !entryOf(store.doc(), talk.day, talk.slot)) saveEntry(store, talk.day, talk.slot, plainEntry(latest));
}

// Finish: the conversation on show ends, and its journal entry is written.
export async function finishTalk(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  const slot = shownSlot(ctx);
  const t = slot ? talkOf(store.doc(), store.today(), slot) : null;
  if (!t || t.done || c.talkBusy) return;
  Object.assign(c, { talkBusy: 'entry', talkError: '' });
  ctx.render();
  try {
    await wrapUp(ctx, t);
  } finally {
    c.talkBusy = '';
    ctx.render();
  }
}

// A moment's opener (js/app.js asks when openerDue says one is due). The conversations before it
// are wrapped up first. If Gemini can't be reached the plain line is used; either way it's tried
// once per moment on this device.
export async function openMoment(ctx, slot) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.talkBusy) return;
  const day = store.today();
  c.tried[`${day}|${slot}`] = true;
  c.talkBusy = 'opening';
  ctx.render();
  try {
    await syncFirst(ctx);
    if (openerDue(store.doc(), { today: day, now: nowOf(ctx), ...hours(ctx) }) !== slot) return;
    for (const t of unfinished(store.doc())) await wrapUp(ctx, t);
    for (const t of talksOn(store.doc(), day)) if (!t.done && !heard(t)) store.updateJournal(t.id, { done: true });
    let text = PLAIN_OPENERS[slot];
    let model = '';
    try {
      const r = await ctx.coach.talk({ system: talkSystem(store.doc(), day, nowOf(ctx)), contents: [{ role: 'user', parts: [{ text: OPENERS[slot] }] }] });
      if (r.text) { text = r.text.trim().slice(0, 600); model = r.model; }
    } catch {
      // the plain line will do
    }
    await ctx.whenIdle();
    if (!talkOf(store.doc(), day, slot)) store.saveJournal({ kind: 'talk', day, slot, messages: [{ who: 'coach', text, at: nowOf(ctx).toISOString() }], model }, 'gemini');
    c.talk = slot;
  } finally {
    c.talkBusy = '';
    ctx.render();
  }
}

// Talk: a new conversation of George's own, shown and ready to type in.
export function startTalk(ctx) {
  Object.assign(ctx.ui.coach, { talk: nextOwnSlot(ctx.store.doc(), ctx.store.today()), talkError: '', editing: null });
  ctx.render();
  queueMicrotask(() => document.querySelector('[data-focus^="coach-talk"]')?.focus());
}

// ---- Drawing it ------------------------------------------------------------------------------------

function didLine(ctx, d) {
  const change = d.change ? ctx.store.doc().changes?.[d.change] : null;
  return h('li', {}, h('span', {}, d.text),
    change && canUndo(change) ? link('Undo', () => ctx.store.undoChange(change.id, 'me')) : null,
    change?.undoneAt ? h('span', { class: 'muted' }, '· undone') : null);
}

function bubble(ctx, m) {
  return h('li', { class: m.who === 'george' ? 'msg george' : 'msg coach' },
    h('span', { class: 'msg-text' }, m.text),
    m.did?.length ? h('ul', { class: 'did' }, m.did.map((d) => didLine(ctx, d))) : null);
}

function field(tag, attrs, value, onInput) {
  const el = h(tag, attrs);
  el.value = value;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

function renderEntry(ctx, e) {
  const c = ctx.ui.coach;
  if (c.editing?.id === e.id) {
    const ed = c.editing;
    return h('form', { class: 'entry editing', onsubmit: (ev) => { ev.preventDefault(); saveEdit(ctx); } },
      h('strong', {}, 'Journal'),
      field('input', { type: 'text', placeholder: 'How you were feeling', 'aria-label': 'How you were feeling', 'data-focus': 'entry-feeling' }, ed.feeling, (v) => { ed.feeling = v; }),
      field('textarea', { rows: 4, 'aria-label': 'The entry', 'data-focus': 'entry-text' }, ed.text, (v) => { ed.text = v; }),
      field('textarea', { rows: 2, placeholder: 'For Claude — one per line', 'aria-label': 'For Claude, one per line', 'data-focus': 'entry-claude' }, ed.forClaude, (v) => { ed.forClaude = v; }),
      h('div', { class: 'buttons' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
        link('Cancel', () => { c.editing = null; ctx.render(); })));
  }
  const collapsed = c.collapsedEntries.has(e.id);
  const toggle = () => {
    if (collapsed) c.collapsedEntries.delete(e.id); else c.collapsedEntries.add(e.id);
    ctx.render();
  };
  return h('div', { class: 'entry' },
    h('div', { class: 'entry-head' },
      h('strong', {}, 'Journal'),
      link(collapsed ? 'Show' : 'Minimise', toggle)),
    collapsed ? null : h('p', { class: 'entry-text' }, e.text),
    collapsed || !e.pointers?.length ? null : h('ul', {}, e.pointers.map((p) => h('li', {}, p))),
    collapsed ? null : (e.forClaude ?? []).map((t) => h('p', { class: 'handoff' }, `For Claude: ${t}`)),
    collapsed ? null : h('div', { class: 'entry-links' }, link('Edit', () => editEntry(ctx, e)), link('Remove', () => removeEntry(ctx, e))));
}

function renderBox(ctx, where, talk) {
  const c = ctx.ui.coach;
  const send = () => sendMessage(ctx);
  const box = field('textarea', {
    rows: 2, placeholder: 'Talk to the Coach…', 'aria-label': 'Message to the Coach', 'data-focus': `coach-talk-${where}`,
  }, c.draft, (v) => { c.draft = v; });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
  return h('form', { class: 'talk-box', onsubmit: (e) => { e.preventDefault(); send(); } },
    box,
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit', disabled: !!c.talkBusy }, 'Send'),
      talk && heard(talk) && !talk.done ? link('Finish', () => finishTalk(ctx)) : null));
}

const BUSY = { opening: 'The Coach is thinking of something to ask…', thinking: 'Thinking…', entry: 'Writing the journal entry…' };

// In the panel the messages scroll inside a box about three messages tall (styles.css .talk.capped),
// so the widgets below stay on screen. The page is redrawn on every change, so where the box was
// scrolled is kept here: at the newest message, unless George has scrolled up to reread something —
// and back to the newest whenever a message arrives or another conversation is shown.
const talkScroll = { id: '', count: 0, top: 0, pinned: true };
const PINNED_SLACK = 12; // px from the bottom that still counts as "at the newest"

function messageList(ctx, talk, where) {
  const items = talk.messages.map((m) => bubble(ctx, m));
  if (where !== 'panel') return h('ul', { class: 'talk' }, items);
  if (talk.id !== talkScroll.id || talk.messages.length > talkScroll.count) talkScroll.pinned = true;
  Object.assign(talkScroll, { id: talk.id, count: talk.messages.length });
  const list = h('ul', { class: 'talk capped' }, items);
  list.addEventListener('scroll', () => {
    talkScroll.top = list.scrollTop;
    talkScroll.pinned = list.scrollHeight - list.scrollTop - list.clientHeight <= PINNED_SLACK;
  });
  queueMicrotask(() => {
    list.scrollTop = talkScroll.pinned ? list.scrollHeight : talkScroll.top;
  });
  return list;
}

// The conversation, as the panel and the phone sheet both show it.
export function renderTalk(ctx, where = 'panel') {
  const c = ctx.ui.coach;
  if (!ctx.coach.keys().length) return h('div', { class: 'talk-area' }, h('p', { class: 'muted' }, MESSAGES.nokey));
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const slot = shownSlot(ctx);
  const talk = slot ? talkOf(doc, today, slot) : null;
  const entry = slot ? entryOf(doc, today, slot) : null;
  const slots = [...talksOn(doc, today).map((t) => t.slot), ...(slot && !talk ? [slot] : [])];
  const pick = (s) => { Object.assign(c, { talk: s, editing: null }); ctx.render(); };
  return h('div', { class: 'talk-area' },
    slots.length > 1
      ? h('div', { class: 'talk-tabs' }, slots.map((s) => h('button', {
        class: s === slot ? 'chip on' : 'chip', type: 'button', 'aria-pressed': String(s === slot), onclick: () => pick(s),
      }, slotName(s))))
      : null,
    !talk?.messages?.length && !c.talkBusy
      ? h('p', { class: 'muted' }, 'Say how the day is going, give it a pointer, or ask it to move something.')
      : null,
    talk?.messages?.length ? messageList(ctx, talk, where) : null,
    talk && !entry ? (talk.handoffs ?? []).map((t) => h('p', { class: 'handoff' }, `For Claude: ${t}`)) : null,
    entry ? renderEntry(ctx, entry) : null,
    BUSY[c.talkBusy] ? h('p', { class: 'muted', role: 'status' }, BUSY[c.talkBusy]) : null,
    c.talkError ? h('p', { class: 'error', role: 'status' }, c.talkError) : null,
    talk?.done
      ? h('p', { class: 'muted' }, link('Talk again', () => startTalk(ctx)))
      : renderBox(ctx, where, talk));
}

// On a phone: the conversation as a sheet over the page, redrawn with the page (js/app.js's render).
export function openCoachSheet(ctx) {
  const dlg = document.getElementById('coach-sheet');
  if (!dlg) return;
  ctx.ui.coach.sheet = true;
  dlg.onclose = () => { ctx.ui.coach.sheet = false; };
  paintCoachSheet(ctx);
  if (!dlg.open) dlg.showModal();
  queueMicrotask(() => dlg.querySelector('[data-focus^="coach-talk"]')?.focus());
}

export function paintCoachSheet(ctx) {
  const dlg = document.getElementById('coach-sheet');
  if (!dlg || !ctx.ui.coach.sheet) return;
  const kept = keptFocus(dlg);
  dlg.replaceChildren(h('div', { class: 'coach sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, 'Coach'), link('Close', () => dlg.close())),
    renderTalk(ctx, 'sheet')));
  restoreFocus(dlg, kept);
}

export function renderCoach(ctx) {
  return h('section', { class: 'panel coach' },
    h('h2', {}, 'Coach',
      ctx.coach.fake ? h('span', { class: 'fake' }, `fake · ${ctx.coach.fake}`) : null,
      ctx.coach.keys().length ? h('span', { class: 'panel-links' }, link('Talk', () => startTalk(ctx))) : null),
    renderTalk(ctx, 'panel'),
    renderDigest(ctx));
}

// ---- Shape a goal -----------------------------------------------------------------------------

// Job C: a big goal in plain words becomes a suggested goal with milestones, habits and weekly
// targets — all suggestions, written in one commit, only once the reply has passed its parser.
export async function shapeGoal(ctx, text) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.shapeBusy) return;
  if (!String(text ?? '').trim()) {
    c.shapeError = 'Say what you want to achieve first.';
    ctx.render();
    return;
  }
  const today = store.today();
  c.shapeError = '';
  c.shapeBusy = true;
  ctx.render();
  try {
    const { reply: plan } = await consult(ctx, shapePrompt(store.doc(), today, text), (data) => parseShape(data, today));
    await ctx.whenIdle();
    store.addPlan({
      goal: { title: plan.title, targetDate: plan.targetDate, why: plan.why },
      milestones: plan.milestones,
      habits: plan.habits,
      targets: plan.targets,
    });
    // Only clear and close the box if what's typed is still what was sent — if he's carried on
    // typing a new idea while this one was being shaped, that text must survive.
    if (c.shapeText === text) {
      c.shapeOpen = false;
      c.shapeText = '';
    }
  } catch (e) {
    await ctx.whenIdle();
    c.shapeError = e.message;
  } finally {
    c.shapeBusy = false;
    ctx.render();
  }
}

// The inline box under the Goals heading, or null while it's closed.
export function renderShapeBox(ctx) {
  const c = ctx.ui.coach;
  if (!c.shapeOpen) return null;
  // Blur before asking: otherwise the busy render's restoreFocus (js/ui/side.js) puts the caret
  // straight back in this box, typing() stays true, and whenIdle() never resolves.
  const shape = () => { box.blur(); shapeGoal(ctx, c.shapeText); };
  const box = h('textarea', {
    rows: 3, placeholder: 'What do you want to achieve?', 'aria-label': 'What do you want to achieve?',
    'data-focus': 'coach-shape',
  });
  box.value = c.shapeText;
  box.addEventListener('input', () => { c.shapeText = box.value; });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); shape(); }
  });
  return h('form', { class: 'shape', onsubmit: (e) => { e.preventDefault(); shape(); } },
    box,
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit', disabled: c.shapeBusy }, c.shapeBusy ? 'Shaping…' : 'Shape'),
      link('Cancel', () => { c.shapeOpen = false; c.shapeError = ''; ctx.render(); })),
    c.shapeError ? h('p', { class: 'error', role: 'status' }, c.shapeError) : null);
}

// ---- Last week's digest -----------------------------------------------------------------------

// Job D: last week's digest, filed under last week's Monday. Quiet (the background trigger in
// js/app.js) says nothing when there's no key or no network, and swallows a failure, leaving the
// "Write last week's digest" link.
export async function writeDigest(ctx, { quiet = false } = {}) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.digestBusy) return;
  if (quiet && blocker(ctx)) return;
  const monday = addDays(weekStart(store.today()), -7);
  c.digestError = '';
  c.digestBusy = true;
  ctx.render();
  try {
    const { reply, model } = await consult(ctx, digestPrompt(store.doc(), monday), parseDigest);
    await ctx.whenIdle();
    store.saveJournal({ kind: 'digest', day: monday, ...reply, model });
  } catch (e) {
    await ctx.whenIdle();
    if (!quiet) c.digestError = e.message;
  } finally {
    c.digestBusy = false;
    ctx.render();
  }
}

// The collapsed "Last week" line once the digest exists; before that, the link to write it (only
// with a key, and only for a week that had anything in it).
function renderDigest(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  const doc = store.doc();
  const today = store.today();
  const digest = digestOf(doc, addDays(weekStart(today), -7));
  if (digest) {
    const line = (label, text) => h('p', {}, h('strong', {}, label), text);
    const details = h('details', { class: 'digest', open: c.digestOpen },
      h('summary', {}, 'Last week'),
      h('p', { class: 'digest-summary' }, digest.summary),
      digest.wins?.length ? line('Went well: ', digest.wins.join(' · ')) : null,
      digest.slipped?.length ? line('Slipped: ', digest.slipped.join(' · ')) : null,
      digest.focus ? line('This week: ', digest.focus) : null);
    details.addEventListener('toggle', () => { c.digestOpen = details.open; });
    return details;
  }
  if (!ctx.coach.keys().length || !digestDue(doc, today)) return null;
  return h('div', { class: 'digest-write' },
    c.digestBusy
      ? h('p', { class: 'muted', role: 'status' }, "Writing last week's digest…")
      : h('p', {}, link("Write last week's digest", () => writeDigest(ctx))),
    c.digestError ? h('p', { class: 'error', role: 'status' }, c.digestError) : null);
}
