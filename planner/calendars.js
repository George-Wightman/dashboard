// Which of George's calendars the planner reads, which one each area's blocks go on, and which
// habits are linked to events — from its settings, by the names George sees. Pure.

export const norm = (s) => String(s ?? '').trim().toLowerCase();

// list: [{ id, name, primary, backgroundColor, accessRole }]. A calendar is ignored when its name
// starts with an `ignore` entry; `main` is the primary calendar.
export function resolveCalendars(list, config) {
  const prefixes = config.ignore.map(norm).filter(Boolean);
  const watched = list.filter((c) => !prefixes.some((p) => norm(c.name).startsWith(p)));
  const find = (name) => (norm(name) === 'main'
    ? list.find((c) => c.primary)
    : list.find((c) => norm(c.name) === norm(name))) ?? null;
  return { watched, find };
}

export function calendarFor(area, config, find, problems) {
  const key = Object.keys(config.areaCalendars).find((a) => norm(a) === norm(area));
  const wanted = key ? config.areaCalendars[key] : config.defaultCalendar;
  const cal = find(wanted);
  if (cal) return cal;
  problems.add(`Can't find the "${wanted}" calendar — ${area ? `blocks for ${area}` : 'those blocks'} went to your main calendar`);
  return find('main');
}

// Each `habitEvents` entry names its habit by id or by the start of its title. One matching no
// active habit, or more than one, is skipped with a note (its events are then just fixed events).
export function habitLinks(doc, config, find, problems) {
  const habits = Object.values(doc.items ?? {}).filter((i) => i.type === 'habit' && i.status === 'active');
  const links = [];
  for (const link of config.habitEvents) {
    const byId = habits.filter((h) => h.id === link.habit);
    const matches = byId.length ? byId : habits.filter((h) => norm(h.title).startsWith(norm(link.habit)));
    if (matches.length !== 1) {
      problems.add(`The planner can't tell which habit "${link.habit}" is (${matches.length ? 'more than one match' : 'no match'}) — its events are treated as fixed`);
      continue;
    }
    const cal = find(link.calendar);
    if (!cal) {
      problems.add(`Can't find the "${link.calendar}" calendar for ${link.title}`);
      continue;
    }
    links.push({ habitId: matches[0].id, calendarId: cal.id, title: link.title, area: String(matches[0].area ?? '').trim() });
  }
  return links;
}
