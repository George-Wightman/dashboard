// Which look the page wears: Paper & Ink by day, Night in the evening. Pure, so it can be tested.
// index.html carries a copy of the rule in <head> (so a Night evening never flashes Paper), and
// tests/look.test.js runs that copy against this one.

// The ⚙ choices, in order, with their labels.
export const LOOK_CHOICES = [
  ['auto', 'Follow the day (Paper, then Night from the check-in hour)'],
  ['paper', 'Paper'],
  ['night', 'Night'],
];
export const LOOKS = LOOK_CHOICES.map(([value]) => value);

// Each look's --bg (styles.css), for <meta name="theme-color">: the installed app's title bar.
export const THEME_COLORS = { paper: '#f5f0e7', night: '#1c232b' };

// 'paper' or 'night' for a moment. 'auto' (and anything unknown) is Night from the check-in hour
// until the day starts, Paper otherwise — it turns when the coach starts offering the check-in and
// back at the day rollover. With both hours at 12 that is always Night.
export function resolveLook(now, { look = 'auto', checkinHour = 18, dayStartHour = 4 } = {}) {
  if (look === 'paper' || look === 'night') return look;
  const hour = now.getHours();
  return hour >= checkinHour || hour < dayStartHour ? 'night' : 'paper';
}
