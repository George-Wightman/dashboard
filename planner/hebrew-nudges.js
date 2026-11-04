// Hebrew's own pings (docs/superpowers/specs/2026-11-02-hebrew-nudges-design.md): to the devices that
// turned on Reminders in the Hebrew app, which publishes them in its sync file, so a tap opens the
// Hebrew app and nothing depends on the dashboard. What's said and when is js/hebrew-voice.js; this
// only sends, each ping once, at most three a day (a budget of its own, apart from the dashboard's),
// and never again to a device that's gone. Kept in script properties. Nothing here stops the planner.

import { duePing } from '../js/hebrew-voice.js';
import { makePusher } from './checkins.js';
import { gasCrypto } from './webpush.js';

export function createHebrewNudges({ UrlFetchApp, Utilities = null, props, log = () => {}, crypto = null, t }) {
  const tools = crypto ?? (Utilities ? gasCrypto(Utilities) : null);
  const read = (key, fallback) => { try { return JSON.parse(props.get(key) ?? 'null') ?? fallback; } catch { return fallback; } };

  // `devices` and `practising` (its `device`) from planner/hebrew-progress.js, `input` from
  // hebrewInputFrom. Reminders on a device he no longer practises on are still sent, but said, since
  // "1 device" once hid that every ping was going to the laptop (4 Nov 2026). Returns
  // { sent, devices, error } for the dashboard's hebrew:status.
  function send({ devices, input, practising = null }) {
    let state = read('HEBREW_NUDGES', null);
    if (state?.day !== input.today || !Array.isArray(state.sent)) state = { day: input.today, sent: [] };
    const gone = new Set(read('HEBREW_GONE', []));
    const live = devices.filter((d) => !gone.has(d.endpoint));
    if (!live.length) return { sent: 0, devices: 0, error: 'Reminders are off: turn them on in the Hebrew app' };
    const privateKey = props.get('VAPID_PRIVATE');
    const publicKey = props.get('VAPID_PUBLIC');
    if (!tools || !privateKey || !publicKey) return { sent: 0, devices: live.length, error: 'The planner has no push keys yet' };
    const elsewhere = practising && !live.some((d) => d.id === `hvr:${practising}`)
      ? `Reminders aren't on for the device you last practised on (${practising}), only ${live.map((d) => d.id.replace(/^hvr:/, '')).join(', ')}: turn them on in the Hebrew app there`
      : null;
    const ping = duePing(input, state.sent);
    if (!ping) return { sent: 0, devices: live.length, error: elsewhere };
    let error = null;
    let sent = 0;
    try {
      const push = makePusher({ UrlFetchApp, Utilities, tools, keys: { privateKey, publicKey }, t });
      const r = push(live, { title: ping.title, body: ping.body, url: ping.url, tag: ping.id });
      for (const id of r.gone) gone.add(live.find((d) => d.id === id)?.endpoint);
      if (r.failed.length) { error = r.failed.join('; '); log(`Hebrew pings: ${error}`); }
      if (r.ok) sent = 1;
    } catch (e) {
      error = `Couldn't send the Hebrew ping (${e?.message ?? e})`;
      log(error);
    }
    // Tried once, whatever happened: a ping is never sent twice.
    state.sent.push(ping.id);
    props.put('HEBREW_NUDGES', JSON.stringify(state));
    props.put('HEBREW_GONE', JSON.stringify([...gone].filter(Boolean).slice(-20)));
    return { sent, devices: live.filter((d) => !gone.has(d.endpoint)).length, error: error ?? elsewhere };
  }

  return { send };
}
