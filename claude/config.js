// The skill's config.json: Claude's own GitHub key, the sync repo, and the day as George's devices
// count it. Checked here so a mistake reads as a sentence, not a stack trace. The key is never part
// of any message.

export const DEFAULT_ZONE = 'Europe/London';

export function readConfig(text) {
  let c;
  try {
    c = JSON.parse(text);
  } catch {
    throw new Error("The skill's config.json isn't valid JSON");
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error("The skill's config.json should be an object");
  const token = typeof c.token === 'string' ? c.token.trim() : '';
  if (!token) throw new Error("The skill's config.json has no token");
  const repo = typeof c.repo === 'string' ? c.repo.trim() : '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("The skill's config.json repo should look like owner/name");
  const dayStartHour = c.dayStartHour ?? 4;
  if (!(Number.isInteger(dayStartHour) && dayStartHour >= 0 && dayStartHour <= 12)) {
    throw new Error("The skill's config.json dayStartHour should be a whole hour from 0 to 12");
  }
  const timeZone = c.timeZone ?? DEFAULT_ZONE;
  try {
    if (typeof timeZone !== 'string') throw new Error();
    new Intl.DateTimeFormat('en-GB', { timeZone });
  } catch {
    throw new Error(`The skill's config.json timeZone ${JSON.stringify(timeZone)} isn't a time zone Node knows`);
  }
  return { token, repo, dayStartHour, timeZone };
}
