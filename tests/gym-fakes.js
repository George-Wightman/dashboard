// Hevy in memory, for the gym tests: its exercise templates, workouts in its own JSON shape, and
// the three read endpoints the planner uses, and routine folders and routines (the coach's
// sessions: list and create folders, list, get, create and update routines; Hevy has no delete), behind an
// `api-key` header.

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
    this.writes = []; // [method, path, body] for every POST and PUT
    this.fail = null;
    this.folders = [];
    this.routines = new Map();
    this.n = 0;
    this.refuseFolder = null; // a folder id a new routine is refused for (deleted in the app)
    this.refuse = null; // a { status, body } every routine write answers with, when set
  }

  // A workout saved in Hevy (an 'updated' event at `when`), or deleted.
  save(w, when) { this.workouts.set(w.id, w); this.events.push({ type: 'updated', workout: w, when }); }
  remove(id, when) { this.workouts.delete(id); this.events.push({ type: 'deleted', id, deleted_at: when, when }); }

  handle(url, headers = {}, method = 'GET', body = null) {
    this.calls.push(method === 'GET' ? url : `${method} ${url}`);
    if (this.fail) return this.fail;
    if (headers['api-key'] !== this.key) return { status: 401, body: { error: 'Unauthorized' } };
    const u = new URL(url);
    const page = Number(u.searchParams.get('page') ?? 1);
    const size = Number(u.searchParams.get('pageSize') ?? 5);
    const slice = (list) => ({ page_count: Math.ceil(list.length / size), items: list.slice((page - 1) * size, page * size) });
    if (method !== 'GET') {
      const data = body == null ? null : JSON.parse(body);
      this.writes.push([method, u.pathname, data]);
      if (this.refuse) return this.refuse;
      if (method === 'POST' && u.pathname === '/v1/routine_folders') {
        const folder = { id: 100 + this.folders.length, index: this.folders.length, title: data.routine_folder.title };
        this.folders.push(folder);
        return { status: 201, body: { routine_folder: folder } };
      }
      if (method === 'POST' && u.pathname === '/v1/routines') {
        if (data.routine.folder_id === this.refuseFolder) return { status: 404, body: { error: 'Routine folder not found' } };
        const r = { id: `rt-${++this.n}`, ...data.routine };
        this.routines.set(r.id, r);
        return { status: 201, body: { routine: [r] } };
      }
      const put = /^\/v1\/routines\/([^/]+)$/.exec(u.pathname);
      if (method === 'PUT' && put) {
        if (!this.routines.has(put[1])) return { status: 404, body: { error: 'Routine not found' } };
        if ('folder_id' in data.routine) return { status: 400, body: { error: 'folder_id is not allowed' } };
        const r = { ...this.routines.get(put[1]), ...data.routine };
        this.routines.set(r.id, r);
        return { status: 200, body: { routine: [r] } };
      }
      return { status: 404, body: { error: 'Not found' } };
    }
    const one = /^\/v1\/routines\/([^/]+)$/.exec(u.pathname);
    if (one) {
      if (!this.routines.has(one[1])) return { status: 404, body: { error: 'Routine not found' } };
      return { status: 200, body: { routine: this.routines.get(one[1]) } };
    }
    if (u.pathname === '/v1/routines') {
      const s = slice([...this.routines.values()]);
      return { status: 200, body: { page, page_count: s.page_count, routines: s.items } };
    }
    if (u.pathname === '/v1/routine_folders') {
      const s = slice(this.folders);
      return { status: 200, body: { page, page_count: s.page_count, routine_folders: s.items } };
    }
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
    const r = this.handle(url, init.headers ?? {}, String(init.method ?? 'GET').toUpperCase(), init.body ?? null);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };
}
