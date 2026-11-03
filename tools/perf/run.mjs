// Repeatable browser measurements of the built app, on fictional records only.
//   npm run build && npm run perf -- --label before [--dist dist] [--runs 3] [--archives demo,empty,small,large]
// Each archive lives in a temp folder and the backend is pointed at it, so a personal archive is never opened.
// Nothing leaves this computer: any request to another host is blocked and fails the run.
import { chromium } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values: args } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    dist: { type: 'string', default: 'dist' },
    runs: { type: 'string', default: '3' },
    archives: { type: 'string', default: 'demo,empty,small,large' },
    'allow-sleep': { type: 'boolean', default: false },
  },
});
const DIST = path.resolve(args.dist);
const RUNS = +args.runs;
const API_PORT = 8123;
const WEB_PORT = 5190;
const BASE = `http://127.0.0.1:${WEB_PORT}/`;
const SEEDS = { empty: [0, 0], small: [8, 0], large: [100, 5000] };
const SEED_ROOT = path.join(os.tmpdir(), 'this-is-you-perf-seed-v1');
const SCREENS = ['overview', 'biomarkers', 'history', 'compare', 'documents', 'import'];
const NAV = { overview: 'Overview', biomarkers: 'Biomarkers', history: 'Medical history', compare: 'Compare', documents: 'Documents', import: 'Import' };
const WITH_RECORDS = ['overview', 'biomarkers', 'history', 'compare'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const results = { label: args.label, started: new Date().toISOString(), runs: RUNS, measures: {}, failures: [], pauses: [] };
const check = (name, ok, detail = '') => {
  if (!ok) {
    results.failures.push(`${name} ${detail}`.trim());
    console.log(`FAIL ${name} ${detail}`);
  }
};

// A Mac asleep freezes the browser and this script together, which looks exactly like a hung page.
if (process.platform === 'darwin' && !args['allow-sleep']) {
  spawn('caffeinate', ['-ims', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
}
let beat = Date.now();
setInterval(() => {
  const gap = Date.now() - beat;
  if (gap > 5000) results.pauses.push({ at: new Date(beat).toISOString(), seconds: Math.round(gap / 1000) });
  beat = Date.now();
}, 1000).unref();

async function waitFor(url) {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // Not listening yet.
    }
    await sleep(100);
  }
  throw new Error(`${url} did not start`);
}

async function startBackend(dataDir) {
  // Another backend on this port would answer with some other archive.
  const stale = await fetch(`http://127.0.0.1:${API_PORT}/api/status`).then(() => true, () => false);
  if (stale) throw new Error(`Port ${API_PORT} is already in use.`);
  const child = spawn(path.join(REPO, 'backend/.venv/bin/python'), ['-m', 'this_is_you'], {
    cwd: REPO,
    env: { ...process.env, THIS_IS_YOU_DATA_DIR: dataDir, THIS_IS_YOU_PORT: String(API_PORT) },
    stdio: 'ignore',
  });
  process.on('exit', () => child.kill());
  await waitFor(`http://127.0.0.1:${API_PORT}/api/status`);
  return async () => {
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
  };
}

/** Same files for every run. Seeding happens once, so before and after measure one archive. */
async function seeded(name) {
  const dir = path.join(SEED_ROOT, name);
  if (fs.existsSync(path.join(dir, '.seeded'))) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const stop = await startBackend(dir);
  const [pdfs, rows] = SEEDS[name];
  const python = path.join(REPO, 'backend/.venv/bin/python');
  const seed = path.join(REPO, 'tools/perf/seed.py');
  console.log(name, execFileSync(python, [seed, `http://127.0.0.1:${API_PORT}`, dir, String(pdfs), String(rows)], { encoding: 'utf8' }).trim());
  await stop();
  fs.writeFileSync(path.join(dir, '.seeded'), '');
  return dir;
}

// Chrome's PDF viewer fetches files out of Playwright's sight, so the server reports when one has been sent.
let pdfServed = null;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
function serveDist() {
  return http
    .createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.startsWith('/api/')) {
        // No reused connections: one closed by the backend at the wrong moment would look like an app failure.
        const up = http.request({ agent: false, host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
          if (url.endsWith('/content') && r.statusCode === 200) r.on('end', () => pdfServed?.());
        });
        // The page can close before or during the answer. Left unread, the answer stops the service from exiting.
        res.on('close', () => up.destroy());
        up.on('error', (e) => {
          if (res.destroyed) return;
          check('backend answers', false, `${url} ${e.code}`);
          res.writeHead(502);
          res.end();
        });
        req.pipe(up);
        return;
      }
      const file = path.join(DIST, url === '/' ? 'index.html' : path.normalize(url));
      if (!file.startsWith(DIST) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      // Same caching for every run: hashed assets may be reused, which is what reloads exercise.
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' });
      fs.createReadStream(file).pipe(res);
    })
    .listen(WEB_PORT, '127.0.0.1');
}

// Runs in the page before any app code.
const INIT = () => {
  window.__t = {};
  window.__lt = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration));
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__t.fcp = Math.round(e.startTime);
  }).observe({ type: 'paint', buffered: true });
  const watch = new MutationObserver(() => {
    if (!window.__t.main && document.querySelector('main')) window.__t.main = Math.round(performance.now());
    if (!window.__t.chart && document.querySelector('main svg')) window.__t.chart = Math.round(performance.now());
  });
  document.addEventListener('DOMContentLoaded', () => watch.observe(document.body, { childList: true, subtree: true }));
};

async function newPage(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(120000);
  await context.route('**/*', (route) => {
    const target = new URL(route.request().url());
    // Chrome's own PDF viewer asks for its files over chrome-extension:, which never leaves the computer.
    if (target.hostname === '127.0.0.1' || !/^https?:$/.test(target.protocol)) return route.continue();
    check(`${name}: request to another host`, false);
    return route.abort();
  });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  page.on('pageerror', (e) => check(`${name}: page error`, false, e.message));
  return { context, page };
}

/** Waits until the main thread has been free for a while, then reads the timings. */
async function settled(page) {
  await page.waitForSelector('main');
  // Not Playwright's networkidle: it never fires once a Chrome PDF viewer is on the page, with no request open.
  await page.evaluate(() => new Promise((done) => {
    let seen = -1;
    let calm = 0;
    const tick = () => {
      calm = window.__lt.length === seen ? calm + 1 : 0;
      seen = window.__lt.length;
      if (calm >= 2) done();
      else setTimeout(tick, 500);
    };
    tick();
  }));
  return page.evaluate(() => ({
    main: window.__t.main,
    fcp: window.__t.fcp,
    chart: window.__t.chart ?? 0,
    longest: Math.max(0, ...window.__lt),
    blocked: window.__lt.reduce((sum, d) => sum + d, 0),
  }));
}

const hasDemoBanner = (page) => page.locator('body').innerText().then((t) => t.includes('in this prototype is fictional'));

async function screenChecks(page, name, screen, archive) {
  const text = await page.locator('main').innerText();
  check(`${name}: shows no NaN or undefined`, !/\bNaN\b|\bundefined\b/.test(text));
  if (archive !== 'demo') check(`${name}: no demo records`, !(await hasDemoBanner(page)));
  if (WITH_RECORDS.includes(screen)) {
    const blocked = text.includes('there are none yet');
    check(`${name}: ${archive === 'empty' ? 'says there are no records' : 'shows records'}`, blocked === (archive === 'empty'));
    if (archive !== 'empty') check(`${name}: drew a chart`, (await page.locator('main svg').count()) > 0);
  }
}

/** Dark pixels in a screenshot of the timeline. Blank means it painted no bars. */
async function timelineInk(page, fullPage) {
  const box = await page.locator('[role=slider]').first().boundingBox();
  const scroll = await page.evaluate(() => scrollY);
  const shot = (await page.screenshot({ fullPage })).toString('base64');
  const top = fullPage ? box.y + scroll : box.y;
  return page.evaluate(async ({ shot, top, height }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${shot}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, Math.ceil(height));
    const c = canvas.getContext('2d');
    c.drawImage(bitmap, 0, -Math.round(top));
    const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 120) dark++;
    return dark;
  }, { shot, top, height: box.height });
}

const url = (archive, screen) => `${BASE}${archive === 'demo' ? '?demo' : ''}#/${screen}`;

async function coldAndReload(browser, archive) {
  for (const screen of SCREENS) {
    const name = `${archive} ${screen}`;
    const cold = [];
    const reload = [];
    for (let run = 0; run < RUNS; run++) {
      const { context, page } = await newPage(browser, name);
      await page.goto(url(archive, screen));
      cold.push(await settled(page));
      await screenChecks(page, name, screen, archive);
      for (let r = 0; r < 2; r++) {
        await page.reload();
        reload.push(await settled(page));
      }
      await screenChecks(page, `${name} reload`, screen, archive);
      await context.close();
    }
    const pick = (rows, key) => median(rows.map((row) => row[key]));
    results.measures[name] = {
      coldMain: pick(cold, 'main'), coldFcp: pick(cold, 'fcp'), coldChart: pick(cold, 'chart'), coldLongest: pick(cold, 'longest'), coldBlocked: pick(cold, 'blocked'),
      reloadMain: pick(reload, 'main'), reloadFcp: pick(reload, 'fcp'), reloadChart: pick(reload, 'chart'), reloadLongest: pick(reload, 'longest'),
    };
    console.log(name.padEnd(22), JSON.stringify(results.measures[name]));
  }
}

async function snapshots(browser, archive) {
  // Overview and Medical history have the ruler. The other two move with the bar's buttons.
  for (const screen of WITH_RECORDS) {
    const name = `${archive} ${screen} snapshot`;
    const { context, page } = await newPage(browser, name);
    await page.goto(url(archive, screen));
    await settled(page);
    const before = await page.locator('main').innerText();
    await page.evaluate(() => { window.__lt.length = 0; });
    const times = [];
    for (let i = 0; i < 12; i++) {
      times.push(await page.evaluate(async (year) => {
        const start = performance.now();
        const ruler = document.querySelector('[role=slider]');
        if (ruler) ruler.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: year, bubbles: true }));
        else [...document.querySelectorAll('[aria-label="Move snapshot date"] button')].find((b) => b.textContent.includes(year ? '1 yr' : '1 mo')).click();
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
        return performance.now() - start;
      }, i % 3 === 0));
    }
    check(`${name}: screen changed with the date`, (await page.locator('main').innerText()) !== before);
    const longest = await page.evaluate(() => Math.max(0, ...window.__lt));
    results.measures[name] = { stepMedian: Math.round(median(times)), stepWorst: Math.round(Math.max(...times)), longest };
    console.log(name.padEnd(30), JSON.stringify(results.measures[name]));
    await screenChecks(page, name, screen, archive);
    await context.close();
  }
}

async function backForward(browser, archive) {
  const name = `${archive} back and forward`;
  const { context, page } = await newPage(browser, name);
  await page.goto(url(archive, 'overview'));
  await settled(page);
  const clicks = [];
  for (const screen of SCREENS.slice(1)) {
    const start = Date.now();
    await page.locator('nav[aria-label="Primary"] button', { hasText: new RegExp(`^${NAV[screen]}$`) }).click();
    await page.waitForFunction((s) => location.hash === `#/${s}`, screen);
    clicks.push(Date.now() - start);
  }
  const moves = [];
  const expectView = async (screen, how) => {
    await page.waitForFunction((s) => location.hash === `#/${s}`, screen);
    await page.waitForSelector('main');
    await screenChecks(page, `${name} ${how} ${screen}`, screen, archive);
  };
  for (const screen of [...SCREENS].reverse().slice(1)) {
    const start = Date.now();
    await page.goBack();
    await expectView(screen, 'back');
    moves.push(Date.now() - start);
  }
  for (const screen of SCREENS.slice(1)) {
    const start = Date.now();
    await page.goForward();
    await expectView(screen, 'forward');
    moves.push(Date.now() - start);
  }
  results.measures[name] = { clickMedian: median(clicks), clickWorst: Math.max(...clicks), historyMedian: median(moves), historyWorst: Math.max(...moves) };
  console.log(name.padEnd(30), JSON.stringify(results.measures[name]));
  await context.close();
}

async function pdfPreview(browser, archive) {
  const name = `${archive} PDF preview`;
  const { context, page } = await newPage(browser, name);
  await page.goto(url(archive, 'documents'));
  await settled(page);
  const times = [];
  for (let i = 0; i < 3; i++) {
    // Row 0 is already open when the screen loads, and its file has already been requested.
    const row = page.locator('main button.row-hover:not([role=checkbox])').nth(1 + i * 2);
    await page.evaluate(() => { window.__lt.length = 0; });
    const start = Date.now();
    const pdf = new Promise((resolve, reject) => {
      pdfServed = resolve;
      setTimeout(() => reject(new Error(`${name}: file not requested within 60 s`)), 60000).unref();
    });
    await row.click();
    await page.locator('iframe[title^="Original file"]').scrollIntoViewIfNeeded();
    await pdf;
    await page.locator('iframe[title^="Original file"]').waitFor();
    // The page must stay responsive while the viewer works.
    const frame = await page.evaluate(() => new Promise((r) => { const t = performance.now(); requestAnimationFrame(() => r(performance.now() - t)); }));
    times.push({ loaded: Date.now() - start, frame: Math.round(frame), longest: await page.evaluate(() => Math.max(0, ...window.__lt)) });
  }
  results.measures[name] = { loadedMedian: median(times.map((t) => t.loaded)), loadedWorst: Math.max(...times.map((t) => t.loaded)), nextFrameWorst: Math.max(...times.map((t) => t.frame)), longest: Math.max(...times.map((t) => t.longest)) };
  console.log(name.padEnd(30), JSON.stringify(results.measures[name]));
  await context.close();
}

async function blankTimeline(browser, archive) {
  const name = `${archive} timeline captures`;
  const counts = { full: [], view: [] };
  let removed = 0;
  // A busy machine is what lets a capture land in the gap while charts are missing.
  const burners = os.cpus().map(() => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
  for (let i = 0; i < RUNS * 4; i++) {
    const { context, page } = await newPage(browser, name);
    await page.goto(url(archive, 'overview'));
    await page.waitForSelector('[role=slider]');
    await settled(page);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      window.__chartsRemoved = 0;
      new MutationObserver((changes) => {
        for (const change of changes) for (const node of change.removedNodes) if (node.nodeName === 'svg') window.__chartsRemoved++;
      }).observe(document.body, { childList: true, subtree: true });
    });
    counts.full.push(await timelineInk(page, true));
    counts.view.push(await timelineInk(page, false));
    removed += await page.evaluate(() => window.__chartsRemoved);
    await context.close();
  }
  burners.forEach((b) => b.kill());
  const blank = [...counts.full, ...counts.view].filter((n) => n === 0).length;
  check(`${name}: never blank`, blank === 0, JSON.stringify(counts));
  // Blank only shows when a capture lands in the gap. Removal happens on every capture, so it is the reliable check.
  check(`${name}: capturing never removes a chart`, removed === 0, `${removed} removed`);
  results.measures[name] = { captures: RUNS * 8, blank, chartsRemoved: removed };
  console.log(name.padEnd(30), JSON.stringify(results.measures[name]));
}

async function modeSwitch(browser, archive) {
  const name = `demo and ${archive} switching`;
  const { context, page } = await newPage(browser, name);
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    await page.goto(`${BASE}?demo#/overview`);
    times.push({ demo: (await settled(page)).main });
    check(`${name}: demo shows its banner`, await hasDemoBanner(page));
    await page.goto(`${BASE}#/overview`);
    times.at(-1).real = (await settled(page)).main;
    check(`${name}: real archive has no demo banner`, !(await hasDemoBanner(page)));
  }
  results.measures[name] = { demoMain: median(times.map((t) => t.demo)), realMain: median(times.map((t) => t.real)) };
  console.log(name.padEnd(30), JSON.stringify(results.measures[name]));
  await context.close();
}

async function apiTimes(archive) {
  const row = {};
  for (const route of ['status', 'documents', 'observations', 'lab-tests']) {
    const start = performance.now();
    const body = await (await fetch(`http://127.0.0.1:${API_PORT}/api/${route}`)).text();
    row[route] = { ms: Math.round(performance.now() - start), kb: Math.round(body.length / 1024) };
  }
  results.measures[`${archive} API`] = row;
  console.log(`${archive} API`.padEnd(30), JSON.stringify(row));
}

async function main() {
  check('build exists', fs.existsSync(path.join(DIST, 'index.html')), DIST);
  const started = Date.now();
  const web = serveDist();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const archive of args.archives.split(',')) {
    const source = archive === 'demo' ? await seeded('empty') : await seeded(archive);
    // Tests read, but the backend may touch its files, so each run gets its own copy.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'this-is-you-perf-'));
    fs.cpSync(source, dir, { recursive: true });
    const stop = await startBackend(dir);
    if (archive !== 'demo') await apiTimes(archive);
    await coldAndReload(browser, archive);
    if (archive !== 'empty') {
      await snapshots(browser, archive);
      await blankTimeline(browser, archive);
    }
    await backForward(browser, archive);
    if (archive === 'small' || archive === 'large') await pdfPreview(browser, archive);
    if (archive !== 'demo') await modeSwitch(browser, archive);
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await browser.close();
  web.close();
  results.seconds = Math.round((Date.now() - started) / 1000);
  if (process.platform === 'darwin') {
    const log = spawnSync('pmset', ['-g', 'log'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout ?? '';
    results.sleeps = log.split('\n').filter((l) => /\sSleep\s+\t?Entering Sleep/.test(l) && new Date(l.slice(0, 19).replace(' ', 'T')) > new Date(results.started)).length;
  }
  const out = path.join(REPO, 'tools/perf/results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${args.label}.json`), JSON.stringify(results, null, 1));
  console.log(`\n${results.seconds} s, ${results.failures.length} failed checks, ${results.pauses.length} pauses over 5 s, ${results.sleeps ?? 'unknown'} Mac sleeps during the run`);
  results.failures.forEach((f) => console.log('FAIL', f));
  results.pauses.forEach((p) => console.log('PAUSE', p.at, p.seconds, 's'));
  process.exit(results.failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
