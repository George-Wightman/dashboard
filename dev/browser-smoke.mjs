// Optional browser regression check. Uses an isolated profile, synthetic data,
// a loopback server, and blocks external requests. Never opens the user's app data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'Last-Modified': 'Wed, 16 Sep 2026 08:00:00 GMT' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext();
  await context.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/?fakegemini=nokey&classic');
  await page.waitForFunction(() => document.querySelector('#list')?.textContent.includes('Nothing on today'));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await page.locator('#add-title').fill('Browser regression task');
  await page.locator('#add-title').press('Enter');
  await page.locator('#list').getByText('Browser regression task', { exact: true }).waitFor();
  await page.locator('#list').getByText('Browser regression task', { exact: true }).click();
  await page.locator('#editor').getByLabel('Title', { exact: true }).fill('Edited without losing my draft');
  const other = await context.newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto(origin + '/?fakegemini=nokey&classic');
  await other.locator('#list').getByText('Browser regression task', { exact: true }).click();
  await other.locator('#editor').getByLabel('Date', { exact: true }).fill('2026-09-01');
  await other.locator('#editor').getByRole('button', { name: 'Save', exact: true }).click();
  for (const title of ['From another tab A', 'From another tab B']) {
    await other.locator('#add-title').fill(title);
    await other.locator('#add-title').press('Enter');
    await other.locator('#list').getByText(title, { exact: true }).waitFor();
  }
  assert.equal(await page.locator('#editor').getByLabel('Title', { exact: true }).inputValue(), 'Edited without losing my draft');
  await page.locator('#editor').getByRole('button', { name: 'Save', exact: true }).click();
  for (const title of ['Edited without losing my draft', 'From another tab A', 'From another tab B']) {
    await page.locator('#list').getByText(title, { exact: true }).waitFor();
  }
  assert.equal(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dash_data')).items)
    .find((item) => item.title === 'Edited without losing my draft').date), '2026-09-01');
  await other.close();
  const retained = await page.evaluate(async () => {
    await caches.open('hebrew-smoke');
    const channel = new MessageChannel();
    const reply = new Promise((resolve) => { channel.port1.onmessage = (e) => resolve(e.data.ok); });
    navigator.serviceWorker.controller.postMessage({ type: 'refresh' }, [channel.port2]);
    return { refreshed: await reply, neighbours: (await caches.keys()).includes('hebrew-smoke') };
  });
  assert.deepEqual(retained, { refreshed: true, neighbours: true });
  await context.setOffline(true);
  await page.reload();
  await page.locator('#list').getByText('Edited without losing my draft', { exact: true }).waitFor();
  await page.locator('#add-title').fill('Saved while offline');
  await page.locator('#add-title').press('Enter');
  await page.reload();
  await page.locator('#list').getByText('Saved while offline', { exact: true }).waitFor();
  await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('dash_data'));
    doc.items.broken = null;
    localStorage.setItem('dash_data', JSON.stringify(doc));
  });
  await page.reload();
  await page.locator('#list').getByText('Saved while offline', { exact: true }).waitFor();
  assert.match(await page.locator('#save-warning').textContent(), /recovered/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'mobile layout fits the viewport');
  await page.locator('#list').getByText('Saved while offline', { exact: true }).click();
  await page.locator('#editor').getByLabel('Title', { exact: true }).fill('Edited on mobile');
  await page.locator('#editor').getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('#list').getByText('Edited on mobile', { exact: true }).waitFor();
  // Configure advanced controls through the same store used by Claude; then
  // exercise George's actual completion and goal-review UI without any API calls.
  await page.evaluate(async () => {
    const { createStore } = await import('./js/data.js');
    const store = createStore({ storage: localStorage });
    const goal = store.addGoal({ title: 'Goal review regression' });
    const item = store.addItem({ id: 'browser-outcome', title: 'Report practice result', type: 'task', goalId: goal.id });
    store.setDetails('items', item.id, { successCriteria: 'Record an honest result', outcomeForm: [
      { key: 'ready', label: 'Ready for the next stage?', type: 'boolean', required: true },
    ] });
    store.saveRule({ title: 'Review after practice', enabled: true, definition: { sourceId: item.id, match: 'all',
      conditions: [{ field: 'ready', op: 'eq', value: true }], actions: [{ type: 'review', goalId: goal.id }] } });
    store.addItem({ id: 'browser-dependent', title: 'Next stage waits', type: 'task', details: { dependsOn: [item.id] } });
  });
  await page.reload();
  assert.equal(await page.getByRole('checkbox', { name: 'Done: Next stage waits', exact: true }).isDisabled(), true);
  await page.locator('#list').getByText('Report practice result', { exact: true }).click();
  await page.locator('#editor').getByText('More options', { exact: true }).click();
  await page.locator('#editor').getByLabel('Context', { exact: true }).fill('Quiet desk');
  await page.locator('#editor').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Done: Report practice result', exact: true }).click();
  await page.locator('#editor').getByLabel('Ready for the next stage?', { exact: true }).selectOption('true');
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT, fullPage: true });
  await page.locator('#editor').getByRole('button', { name: 'Save outcome and complete' }).click();
  assert.equal(await page.getByRole('checkbox', { name: 'Done: Next stage waits', exact: true }).isDisabled(), false);
  await page.evaluate(async () => {
    const { createStore } = await import('./js/data.js');
    const { processWorkflows } = await import('./js/workflow.js');
    processWorkflows(createStore({ storage: localStorage }));
  });
  await page.reload();
  await page.getByText('Goal review regression', { exact: true }).click();
  await page.getByText('Queued for the planner. Its Gemini key must be configured.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Review progress with AI' }).isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  // Daylight, the default screen: the sky, the note for Claude at the top (and moved in Arrange),
  // the tiles, a big view, the snap sheet, and the Log Hebrew time shortcut.
  await context.setOffline(false);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.evaluate(async () => {
    const { createStore } = await import('./js/data.js');
    createStore({ storage: localStorage }).addItem({ id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420 });
  });
  await page.goto(origin + '/?fakegemini=meal&do=hebrew');
  await page.waitForFunction(() => document.documentElement.dataset.screen === 'daylight' && document.querySelector('#dl-sky')?.children.length > 0);
  await page.locator('#hebrew-log').getByRole('button', { name: '30 min', exact: true }).click();
  assert.equal(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dash_data')).logs).some((l) => l.itemId === 'hebrew-minutes' && l.amount === 30 && l.status === 'active')), true);
  assert.equal(await page.evaluate(() => location.search.includes('do=')), false, 'the shortcut tidies the address');
  await page.locator('#dl-note-top textarea').waitFor();
  assert.ok(await page.locator('#tiles .tile').count() >= 3, 'the tiles draw');
  await page.locator('#tiles .tile[data-tile="weeks"] .tile-open').click();
  await page.locator('#widget-sheet[open]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#tiles').getByRole('button', { name: 'Snap a meal', exact: true }).click();
  await page.locator('#snap[open]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#dl-sky').getByRole('button', { name: 'Arrange', exact: true }).click();
  await page.locator('.note-place').getByRole('button', { name: 'Under the day', exact: true }).click();
  await page.locator('#timeline .dl-note textarea').waitFor();
  await page.locator('.note-place').getByRole('button', { name: 'Top', exact: true }).click();
  await page.locator('#dl-sky').getByRole('button', { name: 'Done', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Daylight fits a phone');
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: startup, concurrent editing, offline recovery, mobile layout, advanced details, outcome completion, dependency unlocking, queued goal review, and Daylight (sky, note, tiles, big view, snap, the Hebrew shortcut, Arrange, phone width).');
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
