// The shared PDF worker in Chrome, under the real content policy, on a temp archive of fictional PDFs.
//   npm run build && npm run readiness:worker
//   WORKER_HASHES=<file> writes each file's drawn pixels and stops, to compare two builds. WORKER_DIST=<dist> picks the build.
import { chromium } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PY = path.join(REPO, 'backend/.venv/bin/python');
const PORT = 8136, BASE = `http://127.0.0.1:${PORT}/`;
const PASSPHRASE = 'fictional passphrase for the worker';
const DIST = path.resolve(process.env.WORKER_DIST ?? path.join(REPO, 'dist'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-worker-'));
const env = { ...process.env, THIS_IS_YOU_DATA_DIR: path.join(dir, 'archive'), THIS_IS_YOU_PORT: String(PORT), THIS_IS_YOU_WEB_DIR: DIST };
const results = { pass: 0, fail: 0 };
const ok = (name, value, detail = '') => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? `: ${detail}` : ''}`);
  results[value ? 'pass' : 'fail'] += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map((n) => `${n}.pdf`);
const LONG = 'long.pdf';
execFileSync(PY, ['-c', `
import sys
sys.path.insert(0, 'backend')
from tests import pdfs
out = sys.argv[1]
for i, name in enumerate(sys.argv[2:]):
    # Every file reads differently, so its pixels say which file is on screen.
    open(f"{out}/{name}.pdf", "wb").write(pdfs.text_pdf([f"Fictional {name} report line {n} value {i * 7 + n}" for n in range(30)], [f"Fictional {name} second page {n}" for n in range(30)]))
open(out + "/long.pdf", "wb").write(pdfs.text_pdf(*[[f"Fictional long report page {p} line {n}" for n in range(40)] for p in range(41)]))
`, dir, ...NAMES.map((n) => n.replace('.pdf', ''))], { cwd: REPO });

spawnSync(PY, ['-m', 'this_is_you', 'set-passphrase'], { cwd: REPO, env, input: `${PASSPHRASE}\n` });
const service = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env, stdio: 'ignore' });
process.on('exit', () => service.kill('SIGKILL'));
for (let i = 0; i < 200; i++) {
  if (await fetch(`${BASE}api/status`).then((r) => r.ok, () => false)) break;
  await sleep(100);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let external = 0;
await context.route(/^https?:/, (r) => { if (new URL(r.request().url()).hostname === '127.0.0.1') return r.continue(); external += 1; return r.abort(); });
// Runs before the app. Keeps every worker the page makes, and checks every page the moment it is drawn.
await context.addInitScript(() => {
  window.__workers = [];
  const Real = window.Worker;
  window.Worker = new Proxy(Real, {
    construct(T, args) {
      const w = new T(...args);
      const record = { w, ended: false };
      const end = w.terminate.bind(w);
      w.terminate = () => { record.ended = true; end(); };
      window.__workers.push(record);
      return w;
    },
  });
  window.__hash = (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4 * 3) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return `${c.width}x${c.height}:${h >>> 0}`;
  };
  window.__known = {};
  window.__wrong = [];
  window.__checked = 0;
  document.addEventListener('DOMContentLoaded', () => new MutationObserver((changes) => {
    for (const { target: c } of changes) {
      if (!c.matches?.('canvas[role="img"]:not([data-row-strip])') || !c.width) continue;
      const frame = c.closest('[aria-label^="Original file"]');
      if (!frame) continue;
      const name = frame.getAttribute('aria-label').replace('Original file: ', '');
      const page = c.getAttribute('aria-label').match(/^Page (\d+) of (\d+)/);
      const want = window.__known[`${name}|${page[1]}|${page[2]}`];
      // A far page of the long file has no reference, but a page count this file does not have is still wrong.
      if (!want) { if (Object.keys(window.__known).length && !window.__known[`${name}|1|${page[2]}`]) window.__wrong.push(`${name} page ${page[1]} of ${page[2]}: no such page`); continue; }
      const got = window.__hash(c);
      window.__checked += 1;
      if (got !== want) window.__wrong.push(`${name} page ${page[1]}: ${got} not ${want}`);
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['width'] }));
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const problems = [];
page.on('pageerror', (e) => problems.push(e.message.slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|500)|#instantiateWasm|Invalid PDF|Failed to load resource/i.test(m.text())) problems.push(m.text().slice(0, 160)); });

await page.goto(`${BASE}#/documents`);
await page.getByLabel('Passphrase').fill(PASSPHRASE);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByLabel('Passphrase').waitFor({ state: 'detached' });
await page.waitForSelector('main');
problems.length = 0; // Asking for records before signing in is refused, as it should be.
for (const name of [...NAMES, LONG]) {
  const done = await page.evaluate(async ([n, b64]) => {
    const body = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return (await fetch('/api/documents', { method: 'POST', body, headers: { 'X-This-Is-You-Client': '1', 'Content-Type': 'application/pdf', 'X-Original-Filename': n } })).status;
  }, [name, fs.readFileSync(path.join(dir, name)).toString('base64')]);
  if (done >= 300) throw new Error(`upload ${name}: ${done}`);
}

const frameOf = (name) => page.locator(`[aria-label="Original file: ${name}"]`);
const sheetOf = (name) => frameOf(name).locator('canvas[role="img"][aria-label^="Page 1 of"]');
const drawn = (name, timeout = 30000) => frameOf(name).locator('canvas[role="img"][aria-label^="Page 1 of"][width]:not([width="0"])').waitFor({ timeout });
const click = (name) => page.evaluate((n) => [...document.querySelectorAll('main button.row-hover:not([role=checkbox])')].find((b) => b.textContent.includes(n)).click(), name);
const show = async (name) => { await click(name); await drawn(name); };
const workers = () => page.evaluate(() => ({ made: window.__workers.length, live: window.__workers.filter((r) => !r.ended).length }));
const frames = () => page.locator('iframe[title^="Original file"]').count();
const wrong = () => page.evaluate(() => window.__wrong);
const home = async () => { await page.goto(`${BASE}#/documents`); await page.reload(); await page.waitForSelector('main button.row-hover'); };

console.log('\n--- What each file looks like, each opened alone');
const known = {};
for (const name of [...NAMES, LONG]) {
  await home();
  await click(name);
  await drawn(name);
  // The first two pages of every file are near the screen, so wait for both.
  await frameOf(name).locator('canvas[role="img"][aria-label^="Page 2 of"][width]:not([width="0"])').waitFor();
  for (const c of await frameOf(name).locator('canvas[role="img"][width]:not([width="0"])').all()) {
    const label = await c.getAttribute('aria-label');
    const m = label.match(/^Page (\d+) of (\d+)/);
    known[`${name}|${m[1]}|${m[2]}`] = await c.evaluate((n) => window.__hash(n));
  }
}
if (process.env.WORKER_HASHES) {
  fs.writeFileSync(process.env.WORKER_HASHES, JSON.stringify(known, null, 1));
  console.log(`${Object.keys(known).length} pages written`);
  await browser.close();
  service.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  process.exit(0);
}
const firstPages = NAMES.map((n) => known[Object.keys(known).find((k) => k.startsWith(`${n}|1|`))]);
ok('every file draws differently, so a wrong page would show', new Set(firstPages).size === NAMES.length);
const teach = async () => { await page.evaluate((k) => { window.__known = k; window.__wrong = []; window.__checked = 0; }, known); };

console.log('\n--- Rapid switching');
await home();
await teach();
const before = await workers();
await page.evaluate(async (names) => {
  const rows = [...document.querySelectorAll('main button.row-hover:not([role=checkbox])')];
  let seed = 20261104;
  const next = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const row = (name) => rows.find((b) => b.textContent.includes(name));
  for (let i = 0; i < 300; i++) {
    row(names[next(names.length)]).click();
    if (next(3)) await new Promise((r) => setTimeout(r, next(60)));
  }
  row(names[0]).click();
}, NAMES);
await drawn(NAMES[0]);
await sleep(1500);
let shown = await sheetOf(NAMES[0]).evaluate((c) => window.__hash(c));
ok('after 300 switches, the last file chosen is the one on screen', shown === known[`${NAMES[0]}|1|2`]);
let bad = await wrong();
ok('no page ever appeared under the wrong file, checked as each was drawn', bad.length === 0, bad[0] ?? '');
const during = await workers();
ok('it stayed on one worker', during.live === 1 && during.made <= before.made + 13, `${during.made - before.made} made, ${during.live} running`);
ok('nothing fell back to the browser viewer', (await frames()) === 0);

console.log('\n--- Repeated switching');
await teach();
let right = true;
for (let i = 0; i < 30; i++) {
  const name = NAMES[i % 2];
  await show(name);
  right &&= (await sheetOf(name).evaluate((c) => window.__hash(c))) === known[`${name}|1|2`];
}
ok('going back and forth 30 times draws each file exactly as it was alone', right);
bad = await wrong();
ok('and nothing wrong was drawn on the way', bad.length === 0, bad[0] ?? '');
ok('and the same file reopened is the same', (await page.evaluate(() => window.__checked)) >= 30, `${await page.evaluate(() => window.__checked)} pages checked`);

console.log('\n--- Cancelling');
await teach();
await page.route('**/api/documents/*/content', async (r) => { await sleep(400); await r.continue().catch(() => {}); });
await click(NAMES[2]);
await click(NAMES[3]);
await show(NAMES[4]);
ok('a file left while its bytes are still coming is dropped', (await frameOf(NAMES[2]).count()) === 0 && (await frameOf(NAMES[3]).count()) === 0);
await click(NAMES[5]);
await page.evaluate(() => { location.hash = '#/overview'; });
await sleep(1000);
await page.unroute('**/api/documents/*/content');
await page.evaluate(() => { location.hash = '#/documents'; });
await page.waitForSelector('main button.row-hover');
await show(NAMES[2]);
await click(NAMES[3]); // Left during drawing, too.
await frameOf(NAMES[3]).locator('canvas[role="img"]').first().waitFor();
await click(NAMES[4]);
await drawn(NAMES[4]);
ok('leaving the screen mid-load, and coming back, still draws', (await sheetOf(NAMES[4]).evaluate((c) => window.__hash(c))) === known[`${NAMES[4]}|1|2`]);
bad = await wrong();
ok('nothing cancelled reached the screen', bad.length === 0, bad[0] ?? '');
ok('a cancelled file causes no error', problems.length === 0, problems.slice(0, 2).join(' / '));

console.log('\n--- Files that cannot be read');
const steady = await workers();
for (const [how, answer] of [['a server failure', { status: 500, body: 'no' }], ['bytes that are not a PDF', { status: 200, contentType: 'application/pdf', body: 'this is not a PDF at all' }], ['a truncated PDF', { status: 200, contentType: 'application/pdf', body: fs.readFileSync(path.join(dir, NAMES[1])).subarray(0, 300) }]]) {
  await page.route('**/api/documents/*/content', (r) => r.request().url().includes('download') ? r.continue() : r.fulfill(answer));
  await click(NAMES[0]);
  await page.locator('iframe[title^="Original file"]').waitFor();
  ok(`${how} falls back to the browser viewer`, true);
  await page.unroute('**/api/documents/*/content');
  await show(NAMES[1]);
  ok(`and the next file still draws on the same worker`, (await frames()) === 0 && (await sheetOf(NAMES[1]).evaluate((c) => window.__hash(c))) === known[`${NAMES[1]}|1|2`]);
  await show(NAMES[2]);
}
const afterBad = await workers();
ok('bad files end no worker', afterBad.made === steady.made && afterBad.live === 1, `${afterBad.made - steady.made} made, ${afterBad.live} running`);
problems.length = 0; // pdf.js and the browser viewer report those failures themselves.

console.log('\n--- A worker that crashes');
await show(NAMES[0]);
let was = await workers();
await teach();
await page.evaluate(() => window.__workers.at(-1).w.dispatchEvent(new ErrorEvent('error', { message: 'fictional crash' })));
await page.waitForFunction((made) => window.__workers.length > made, was.made);
await drawn(NAMES[0]);
let now = await workers();
ok('the file open at the time comes back by itself, on a new worker', now.made === was.made + 1 && now.live === 1 && (await frames()) === 0);
ok('with the right pixels', (await sheetOf(NAMES[0]).evaluate((c) => window.__hash(c))) === known[`${NAMES[0]}|1|2`]);
await show(NAMES[1]);
ok('and the next file draws', (await frames()) === 0);
await show(NAMES[2]);
was = await workers();
await page.evaluate(() => window.__workers.at(-1).w.dispatchEvent(new ErrorEvent('error', { message: 'fictional crash' })));
await page.waitForFunction((made) => window.__workers.length > made, was.made);
await drawn(NAMES[2]);
await page.evaluate(() => window.__workers.at(-1).w.dispatchEvent(new ErrorEvent('error', { message: 'fictional crash' })));
await page.locator('iframe[title^="Original file"]').waitFor();
ok('crashing again on the same file goes to the browser viewer and stops trying', (await workers()).made === was.made + 1);
await show(NAMES[3]);
ok('and even then the next file draws on a new worker', (await frames()) === 0 && (await workers()).live === 1);

console.log('\n--- A worker that dies without a word');
await show(NAMES[0]);
was = await workers();
await page.evaluate(() => { window.__workers.at(-1).w.terminate(); });
let start = Date.now();
await click(NAMES[1]);
await drawn(NAMES[1], 40000);
ok('switching to another file recovers', (await workers()).made === was.made + 1 && (await frames()) === 0, `after ${Math.round((Date.now() - start) / 1000)} s`);
ok('with the right pixels', (await sheetOf(NAMES[1]).evaluate((c) => window.__hash(c))) === known[`${NAMES[1]}|1|2`]);
was = await workers();
await page.evaluate(() => { window.__workers.at(-1).w.terminate(); });
start = Date.now();
await click(NAMES[2]);
await click(NAMES[3]);
await click(NAMES[4]);
await drawn(NAMES[4], 90000);
ok('so does switching several times at once', (await workers()).live === 1 && (await frames()) === 0, `after ${Math.round((Date.now() - start) / 1000)} s`);
await click(LONG);
await drawn(LONG);
was = await workers();
await page.evaluate(() => { window.__workers.at(-1).w.terminate(); });
start = Date.now();
await page.waitForFunction((made) => window.__workers.length > made, was.made, { timeout: 5000 });
const noticed = Date.now() - start;
await drawn(LONG, 30000);
ok('with no switch at all, it is noticed at once and the file recovers', (await frames()) === 0, `noticed after ${noticed} ms, drawn after ${Math.round((Date.now() - start) / 1000)} s`);

console.log('\n--- A slow file is not a stuck file');
const STILL = page.getByRole('status').filter({ hasText: 'Still working on this file.' });
was = await workers();
await page.route('**/api/documents/*/content', async (r) => { await sleep(70000); await r.continue().catch(() => {}); });
await click(NAMES[5]);
await STILL.waitFor({ timeout: 20000 });
ok('a file taking a while says so', true);
await drawn(NAMES[5], 120000);
await page.unroute('**/api/documents/*/content');
now = await workers();
ok('a file silent for over a minute still draws, on the same worker', now.made === was.made && (await frames()) === 0);
ok('with the right pixels', (await sheetOf(NAMES[5]).evaluate((c) => window.__hash(c))) === known[`${NAMES[5]}|1|2`]);
await STILL.waitFor({ state: 'detached', timeout: 5000 });
ok('and stops saying so', true);

console.log('\n--- Stopping a stuck file');
was = await workers();
await page.route('**/api/documents/*/content', (r) => { if (!r.request().url().includes('download') && r.request().resourceType() !== 'document') return; return r.continue(); });
await click(NAMES[0]);
await STILL.waitFor({ timeout: 20000 });
await page.unroute('**/api/documents/*/content');
await STILL.getByRole('button', { name: 'Stop' }).click();
await page.locator('iframe[title^="Original file"]').waitFor();
now = await workers();
ok('Stop goes to the browser viewer and ends the worker', now.live === 0, `${now.live} running`);
await sleep(2000);
ok('and the file does not reopen', (await frames()) === 1 && (await workers()).made === was.made);
await show(NAMES[1]);
ok('the next file draws on a new worker, with the right pixels', (await workers()).made === was.made + 1 && (await sheetOf(NAMES[1]).evaluate((c) => window.__hash(c))) === known[`${NAMES[1]}|1|2`]);

console.log('\n--- Many files');
await teach();
was = await workers();
for (let i = 0; i < 60; i++) await show(NAMES[i % NAMES.length]);
now = await workers();
ok('60 files leave one worker running', now.live === 1, `${now.made - was.made} made along the way, all others ended`);
bad = await wrong();
ok('and every page was right', bad.length === 0, bad[0] ?? '');
const liveCanvases = await page.locator('canvas[role="img"]').count();
ok('only the open file has canvases', liveCanvases === 2, `${liveCanvases}`);

console.log('\n--- After all that, the viewer still works');
const name = NAMES[0];
await show(name);
const frame = frameOf(name);
await frame.scrollIntoViewIfNeeded();
const sheet = sheetOf(name);
const box = await sheet.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 110);
await page.mouse.move(box.x + box.width / 2 + 4, box.y + 112);
const lens = frame.locator('[data-pdf-lens]');
await lens.waitFor({ state: 'visible' });
ok('the magnifier shows the page', true);
await page.mouse.click(box.x + box.width / 2, box.y + 110);
const dialog = page.locator('dialog[open]');
await dialog.waitFor();
await dialog.locator('canvas[role="img"][width]:not([width="0"])').first().waitFor();
ok('clicking a page enlarges it', true);
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });
const list = frame.locator('[data-pdf-page="1"]').locator('..');
await page.getByRole('button', { name: 'Next page' }).click();
await page.waitForTimeout(400);
ok('the page buttons move through it', (await list.evaluate((n) => n.scrollTop)) > 300);

console.log('\n--- Leaving it alone');
await page.evaluate(() => { location.hash = '#/overview'; });
await page.waitForSelector('main');
await sleep(125000);
now = await workers();
ok('with nothing open, the worker ends after two minutes', now.live === 0, `${now.live} running`);
await page.evaluate(() => { location.hash = '#/documents'; });
await page.waitForSelector('main button.row-hover');
await show(NAMES[1]);
ok('and the next file starts a new one', (await workers()).live === 1 && (await frames()) === 0);

ok('no page error or unexpected console error, from the bad files on', problems.length === 0, problems.slice(0, 2).join(' / '));
ok('no request left this computer', external === 0);
await browser.close();
service.kill('SIGTERM');
console.log(`\n${results.pass} of ${results.pass + results.fail} checks passed.`);
fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
process.exit(results.fail ? 1 : 0);
