// Quick-add parsing and amount display. Minute quotas are stored in minutes and shown in hours.

const positive = (n) => (Number.isFinite(n) && n > 0 ? n : null);

export function parseAmount(text, unit) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  if (unit === 'count') {
    return /^\d+(\.\d+)?$/.test(s) ? positive(Number(s)) : null;
  }

  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)m?$/))) return positive(Math.round(Number(m[1])));
  if ((m = s.match(/^(\d+(?:\.\d+)?)h$/))) return positive(Math.round(Number(m[1]) * 60));
  if ((m = s.match(/^(\d+)h(\d{1,2})m?$/))) {
    const mins = Number(m[2]);
    return mins < 60 ? positive(Number(m[1]) * 60 + mins) : null;
  }
  return null;
}

const oneDecimal = (n) => String(Number(n.toFixed(1)));
const hours = (minutes) => oneDecimal(minutes / 60);

export function formatAmount(value, unit) {
  if (unit === 'minutes') return value < 60 ? `${Math.round(value)}m` : `${hours(value)}h`;
  return String(Number(value.toFixed(2)));
}

export function formatProgress(total, target, unit) {
  if (unit === 'minutes') return `${hours(total)} / ${hours(target)}h`;
  return `${formatAmount(total, unit)} / ${formatAmount(target, unit)}`;
}
