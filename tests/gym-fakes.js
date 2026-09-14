// Hevy in memory, for the gym tests: its exercise templates, workouts in its own JSON shape, and
// the three read endpoints the planner uses, behind an `api-key` header.

import { at } from '../planner/time.js';

export const HEVY_KEY = '7f1c2d3e-aaaa-bbbb-cccc-0123456789ab';

export const TEMPLATES = {
  SQ: ['Squat (Barbell)', 'weight_reps', 'quadriceps'],
  BP: ['Bench Press (Barbell)', 'weight_reps', 'chest'],
  ROW: ['Bent Over Row (Barbell)', 'weight_reps', 'upper_back'],
  TM: ['Treadmill', 'distance_duration', 'cardio'],
  WK: ['Walking', 'duration', 'cardio'],
};

// An exercise: lift('SQ', [100, 5], [60, 8, 'warmup']) · cardio('WK', 900, 1200).
export const lift = (tpl, ...sets) => ({ tpl, sets: sets.map(([kg, reps, type = 'normal', rpe = null]) => ({ type, weight_kg: kg, reps, rpe })) });
export const cardio = (tpl, seconds, meters = null) => ({ tpl, sets: [{ type: 'normal', duration_seconds: seconds, distance_meters: meters }] });

// A workout as Hevy's API returns it.
export function hevyWorkout(id, day, from, to, exercises, title = 'Legs A') {
  return {
    id, title, routine_id: null, description: null,
    start_time: at(day, from).toISOString(), end_time: at(day, to).toISOString(),
    updated_at: at(day, to).toISOString(), created_at: at(day, to).toISOString(),
    exercises: exercises.map((e, i) => ({
      index: i, title: TEMPLATES[e.tpl]?.[0] ?? e.tpl, notes: null, exercise_template_id: e.tpl, superset_id: null,
      sets: e.sets.map((s, j) => ({ index: j, weight_kg: null, reps: null, distance_meters: null, duration_seconds: null, custom_metric: null, ...s })),
    })),
  };
}

export class FakeHevy {
  constructor({ key = HEVY_KEY, templates = TEMPLATES } = {}) {
    this.key = key;
    this.templates = { ...templates };
    this.workouts = new Map();
    this.events = [];
    this.calls = [];
    this.fail = null;
  }

  // A workout saved in Hevy (an 'updated' event at `when`), or deleted.
  save(w, when) { this.workouts.set(w.id, w); this.events.push({ type: 'updated', workout: w, when }); }
  remove(id, when) { this.workouts.delete(id); this.events.push({ type: 'deleted', id, deleted_at: when, when }); }

  handle(url, headers = {}) {
    this.calls.push(url);
    if (this.fail) return this.fail;
    if (headers['api-key'] !== this.key) return { status: 401, body: { error: 'Unauthorized' } };
    const u = new URL(url);
    const page = Number(u.searchParams.get('page') ?? 1);
    const size = Number(u.searchParams.get('pageSize') ?? 5);
    const slice = (list) => ({ page_count: Math.ceil(list.length / size), items: list.slice((page - 1) * size, page * size) });
    if (u.pathname === '/v1/exercise_templates') {
      const s = slice(Object.entries(this.templates).map(([id, [title, type, muscle]]) => ({ id, title, type, primary_muscle_group: muscle, is_custom: false })));
      return { status: 200, body: { page, page_count: s.page_count, exercise_templates: s.items } };
    }
    if (u.pathname === '/v1/workouts') {
      const s = slice([...this.workouts.values()].sort((a, b) => b.start_time.localeCompare(a.start_time)));
      if (page > Math.max(1, s.page_count)) return { status: 404, body: { error: 'Page not found' } };
      return { status: 200, body: { page, page_count: s.page_count, workouts: s.items } };
    }
    if (u.pathname === '/v1/workouts/events') {
      const since = Date.parse(u.searchParams.get('since'));
      const list = this.events.filter((e) => Date.parse(e.when) > since).reverse().map(({ when, ...e }) => e);
      const s = slice(list);
      return { status: 200, body: { page, page_count: s.page_count, events: s.items } };
    }
    return { status: 404, body: { error: 'Not found' } };
  }

  fetch = async (url, init = {}) => {
    const r = this.handle(url, init.headers ?? {});
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };
}
