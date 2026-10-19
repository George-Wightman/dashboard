// The coach on Daylight's screen (js/coach.js has the rules): the timeline's morning question
// "How's your back?", a session's exercises under its row with the sore-back warning, and in Body
// the next session and the back mornings (the big view: 90 of them, and lifts ready for more weight).

import { h } from './dom.js';
import { BACK, backRowState, backScores, backFlag, nextSession, sessionLines, sessionTasks, sessionWorkout, readyMarks } from '../coach.js';
import { liftSessions, kgText } from '../gym.js';
import { addDays, shortWeekday, shortDate } from '../dates.js';
import { bigSection } from './big.js';

const dayWord = (day, today) => (day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : `${shortWeekday(day)} ${shortDate(day)}`);

// His best recent estimated 1RM for a lift, for the "heavy squat" test.
const e1rmOf = (doc) => (name) => {
  const s = liftSessions(doc, name).slice(-6);
  return s.length ? Math.max(...s.map((x) => x.e1rm)) : null;
};

function answer(ctx, score) {
  const today = ctx.store.today();
  try {
    ctx.store.setBack(today, score);
    ctx.store.soreFlag(today);
    ctx.ui.backAsk = false;
  } catch (e) {
    ctx.ui.taskError = e.message;
  }
  ctx.render();
}

// The first row of the morning: four answers, or the one he gave (tap to change it).
export function renderBackRow(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const s = backRowState(doc, today, new Date(), ctx.store.settings().dayStartHour, { anyTime: !!ctx.ui.backAsk });
  if (!s) return null;
  if (s.state === 'answered' && !ctx.ui.backAsk) {
    return h('li', { class: 'tl-back answered' },
      h('span', {}, `Back this morning: ${s.word}`),
      h('button', { class: 'link', type: 'button', onclick: () => { ctx.ui.backAsk = true; ctx.render(); } }, 'Change'));
  }
  return h('li', { class: 'tl-back' },
    h('span', { class: 'tl-back-q', id: 'back-q' }, "How's your back this morning?"),
    h('span', { class: 'tl-back-answers', role: 'group', 'aria-labelledby': 'back-q' },
      BACK.map((word, score) => h('button', { class: `dl-btn back-${score}`, type: 'button', 'aria-pressed': s.score === score ? 'true' : 'false', onclick: () => answer(ctx, score) }, word))));
}

// Under a session's row: its lines, and on a sore or bad morning the warning about loading the back.
export function sessionExtras(ctx, row) {
  const session = row.item.session;
  if (!session || row.suggested) return [];
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const out = sessionLines(session).map((line) => h('li', { class: 'tl-sub tl-session' }, line));
  const score = backScores(doc, today, 1)[0]?.score ?? null;
  const warn = row.done ? null : backFlag(session, score, e1rmOf(doc));
  if (warn) out.unshift(h('li', { class: 'tl-sub tl-warn', role: 'note' }, warn));
  return out;
}

// One cell a morning, oldest first: darker is worse, and each says its day and answer.
export function backCells(doc, today, days) {
  const scores = new Map(backScores(doc, today, days).map((s) => [s.day, s.score]));
  const cells = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const score = scores.get(day);
    const label = `${shortWeekday(day)} ${shortDate(day)}: ${score == null ? 'no answer' : BACK[score]}`;
    cells.push(h('span', { class: `back-cell ${score == null ? 'none' : `s${score}`}`, title: label, 'aria-label': label, role: 'img' }));
  }
  return h('div', { class: `back-cells${days > 7 ? ' many' : ''}` }, cells);
}

// Body's part: the next session in three lines, and the week's back mornings.
export function renderCoach(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const next = nextSession(doc, today);
  const anyBack = backScores(doc, today, 7).length > 0;
  if (!next && !anyBack) return null;
  return h('div', { class: 'coach' },
    next ? h('div', { class: 'coach-next' },
      h('p', { class: 'coach-name' }, h('strong', {}, next.session.name), ` · ${dayWord(next.date, today)}${next.time ? ` ${next.time}` : ''}`),
      sessionLines(next.session).filter((l) => l !== next.session.note).slice(0, 3).map((l) => h('p', { class: 'coach-line' }, l))) : null,
    anyBack ? h('div', { class: 'coach-back' }, h('span', { class: 'coach-label' }, 'Back'), backCells(doc, today, 7)) : null);
}

// Opened big: the coming week's sessions in full, 90 mornings, and what's ready for more weight.
export function renderCoachBig(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const coming = sessionTasks(doc, today, addDays(today, 6));
  const ready = [];
  for (const t of sessionTasks(doc, addDays(today, -27), today)) {
    const w = sessionWorkout(doc, t);
    if (!w) continue;
    for (const name of readyMarks(t.session, w)) {
      const ex = t.session.exercises.find((e) => e.name === name);
      ready.push(h('li', {}, `${name}: ${kgText(ex.kg)} kg done in full, ${dayWord(t.date, today).toLowerCase()}`));
    }
  }
  const scores = backScores(doc, today, 90);
  if (!coming.length && !ready.length && !scores.length) return null;
  return h('div', { class: 'big coach' },
    coming.length ? bigSection('Coming sessions', coming.map((t) => h('div', { class: 'coach-next' },
      h('p', { class: 'coach-name' }, h('strong', {}, t.session.name), ` · ${dayWord(t.date, today)}${t.time ? ` ${t.time}` : ''}`),
      sessionLines(t.session).map((l) => h('p', { class: 'coach-line' }, l))))) : null,
    ready.length ? bigSection('Ready for more weight', h('ul', { class: 'coach-ready' }, ready)) : null,
    scores.length ? bigSection('Back, the last 90 mornings', backCells(doc, today, 90),
      h('p', { class: 'gym-note' }, BACK.map((w, i) => `${w} ${scores.filter((s) => s.score === i).length}`).join(' · '))) : null);
}
