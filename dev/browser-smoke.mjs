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
  await page.goto(origin + '/?fakegemini=nokey');
  await page.waitForFunction(() => document.querySelector('#list')?.textContent.includes('Nothing on today'));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await page.locator('#add-title').fill('Browser regression task');
  await page.locator('#add-title').press('Enter');
  await page.getByText('Browser regression task', { exact: true }).waitFor();
  await page.getByText('Browser regression task', { exact: true }).click();
  await page.locator('#editor').getByLabel('Title', { exact: true }).fill('Edited without losing my draft');
  const other = await context.newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto(origin + '/?fakegemini=nokey');
  await other.getByText('Browser regression task', { exact: true }).click();
  await other.locator('#editor').getByLabel('Date', { exact: true }).fill('2026-09-01');
  await other.locator('#editor').getByRole('button', { name: 'Save', exact: true }).click();
  for (const title of ['From another tab A', 'From another tab B']) {
    await other.locator('#add-title').fill(title);
    await other.locator('#add-title').press('Enter');
    await other.getByText(title, { exact: true }).waitFor();
  }
  assert.equal(await page.locator('#editor').getByLabel('Title', { exact: true }).inputValue(), 'Edited without losing my draft');
  await page.locator('#editor').getByRole('button', { name: 'Save', exact: true }).click();
  for (const title of ['Edited without losing my draft', 'From another tab A', 'From another tab B']) {
    await page.getByText(title, { exact: true }).waitFor();
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
  await page.getByText('Edited without losing my draft', { exact: true }).waitFor();
  await page.locator('#add-title').fill('Saved while offline');
  await page.locator('#add-title').press('Enter');
  await page.reload();
  await page.getByText('Saved while offline', { exact: true }).waitFor();
  await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('dash_data'));
    doc.items.broken = null;
    localStorage.setItem('dash_data', JSON.stringify(doc));
  });
  await page.reload();
  await page.getByText('Saved while offline', { exact: true }).waitFor();
  assert.match(await page.locator('#save-warning').textContent(), /recovered/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'mobile layout fits the viewport');
  await page.getByText('Saved while offline', { exact: true }).click();
  await page.locator('#editor').getByLabel('Title', { exact: true }).fill('Edited on mobile');
  await page.locator('#editor').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Edited on mobile', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: startup, edit, concurrent cross-tab fields, cache isolation, offline reload/write, corrupt-data recovery, mobile layout and editing.');
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
