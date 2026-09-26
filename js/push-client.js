// Notifications on this device (docs/superpowers/specs/2026-09-26-checkins-design.md): subscribe the
// installed app to Web Push with the planner's public key (`push-config`, which the planner makes on
// its first run), and keep the subscription as a `push:<device>` record so the planner
// knows where to send. The planner encrypts every ping for this device alone; sw.js shows it.

export const DEVICE_KEY = 'dash_device';

// A name for this device that stays put: its push record's id.
export function deviceId(storage) {
  try {
    let id = storage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      storage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'this-device';
  }
}

export function b64urlToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const pushSupport = (env = globalThis) => !!(env.navigator?.serviceWorker && env.PushManager && env.Notification);
const deviceLabel = (env) => (/Android|iPhone|iPad|Mobile/i.test(env.navigator?.userAgent ?? '') ? 'phone' : 'laptop');
const sameKey = (a, b) => !!a && !!b && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

async function current(env) {
  const reg = await env.navigator.serviceWorker.getRegistration();
  return { reg, sub: reg ? await reg.pushManager.getSubscription() : null };
}

// 'unsupported' · 'waiting' (the planner hasn't made its key yet) · 'blocked' · 'off' · 'on'.
export async function pushState(ctx, env = globalThis) {
  if (!pushSupport(env)) return 'unsupported';
  const publicKey = ctx.store.doc().calendar?.['push-config']?.publicKey;
  if (!publicKey) return 'waiting';
  if (env.Notification.permission === 'denied') return 'blocked';
  const rec = ctx.store.doc().calendar?.[`push:${deviceId(env.localStorage)}`];
  if (rec?.status !== 'active') return 'off';
  try {
    const { sub } = await current(env);
    return sub && sub.endpoint === rec.endpoint ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export async function turnOn(ctx, env = globalThis) {
  if (!pushSupport(env)) throw new Error("This browser can't show notifications from the dashboard.");
  const publicKey = ctx.store.doc().calendar?.['push-config']?.publicKey;
  if (!publicKey) throw new Error('The calendar planner sets notifications up on its next run — try again in ten minutes.');
  const permission = await env.Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? "Notifications are blocked for this site — allow them in the browser's site settings." : 'Notifications were not allowed.');
  }
  const reg = await env.navigator.serviceWorker.ready;
  const key = b64urlToBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older key can't receive the planner's pings: start again.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON();
  ctx.store.putCalendar(`push:${deviceId(env.localStorage)}`, {
    endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, label: deviceLabel(env), at: new Date().toISOString(), status: 'active', archivedOn: null,
  }, 'me');
  ctx.syncNow?.();
}

export async function turnOff(ctx, env = globalThis) {
  try {
    const { sub } = await current(env);
    await sub?.unsubscribe();
  } catch { /* the record goes either way */ }
  const id = `push:${deviceId(env.localStorage)}`;
  if (ctx.store.doc().calendar?.[id]) ctx.store.putCalendar(id, { status: 'archived', archivedOn: ctx.store.today() }, 'me');
  ctx.syncNow?.();
}
