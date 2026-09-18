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
  await page.goto(origin + '/?fakegemini=ok');
  await page.locator('#add-title').fill('Shared plan browser task');
  await page.locator('#add-title').press('Enter');
  await page.locator('#list').getByText('Shared plan browser task', { exact: true }).waitFor();
  const dates = await page.evaluate(async () => {
    const { createStore } = await import('./js/data.js');
    const { addDays } = await import('./js/dates.js');
    const today = createStore({ storage: localStorage }).today();
    return { today, next: addDays(today, 2), future: addDays(today, 20) };
  });
  const coach = page.locator('section.coach');
  const send = async text => {
    await coach.getByLabel('Message to the Coach').fill(text);
    await coach.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('section.coach button[type=submit]')?.disabled);
  };
  await send('review the layout for tomorrow');
  await coach.getByText('Proposed changes', { exact: true }).waitFor();
  const item = async () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dash_data')).items).find(i => i.title === 'Shared plan browser task'));
  assert.equal((await item()).date, dates.today, 'proposal does not move live task');
  await coach.getByLabel('Proposed date for Shared plan browser task').fill(dates.next);
  await coach.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(date => Object.values(JSON.parse(localStorage.getItem('dash_data')).items).find(i => i.title === 'Shared plan browser task').date === date, dates.next);
  await coach.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await item()).date, dates.today);
  await send('I am going to bed');
  await coach.getByText(/Today is closed for planning/).waitFor();
  await send('add Future captured task on ' + dates.future);
  await page.locator('.agenda').getByText('Future captured task', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dash_data')).items).find(i => i.title === 'Future captured task').date), dates.future);
  await coach.getByRole('button', { name: 'Reopen today', exact: true }).click();
  const id = (await item()).id;
  await page.goto(origin + '/?fakegemini=ok&task=' + encodeURIComponent(id));
  await page.locator('#task-card').getByRole('button', { name: 'Mark complete' }).waitFor();
  assert.equal(await page.evaluate(id => Object.values(JSON.parse(localStorage.getItem('dash_data')).logs).some(l => l.itemId === id && l.kind === 'done' && l.status === 'active'), id), false);
  await page.locator('#task-card').getByRole('button', { name: 'Mark complete' }).click();
  await page.locator('#task-card').getByText('Completed', { exact: true }).waitFor();
  await page.locator('#task-card').getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Shared-plan browser checks passed: reviewed and edited proposal, atomic apply and undo, closed day, future capture, task deep link and explicit completion, mobile layout.');
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
