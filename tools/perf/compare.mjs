// Alternates loads of two builds on one fictional archive, so machine drift hits both alike. Use this to judge a
// change: separate `npm run perf` runs differ by 10 to 15 percent, and more when the machine is busy.
//   npm run perf:compare -- <dist before> <dist after> [--loads 7]
// Needs the fictional archives that a first `npm run perf` creates. Each load copies one to a temp folder.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { addSession, login, setPassphrase } from '../signin.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values: args, positionals } = parseArgs({ options: { loads: { type: 'string', default: '7' } }, allowPositionals: true });
if (positionals.length !== 2) throw new Error('Usage: npm run perf:compare -- <dist before> <dist after> [--loads 7]');
const [DIST_A, DIST_B] = positionals.map((p) => path.resolve(p));
for (const dist of [DIST_A, DIST_B]) if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`${dist} is not a build.`);

const SEED_ROOT = path.join(os.tmpdir(), 'this-is-you-perf-seed-v1');
const API_PORT = 8123;
const PORT_A = 5192;
const PORT_B = 5193;
const CASES = [
  ['small', '#/overview'],
  ['small', '#/biomarkers'],
  ['small', '#/history'],
  ['small', '#/compare'],
  ['small', '#/documents'],
  ['small', '#/import'],
  ['small', '?demo#/overview'],
  ['large', '#/overview'],
  ['empty', '#/overview'],
];
for (const [seed] of CASES) {
  if (!fs.existsSync(path.join(SEED_ROOT, seed, '.seeded'))) throw new Error(`Archive "${seed}" is missing. Run npm run perf once first.`);
}
if (await fetch(`http://127.0.0.1:${API_PORT}/api/status`).then(() => true, () => false)) throw new Error(`Port ${API_PORT} is already in use.`);

// A Mac asleep freezes the browser and this script together, which looks exactly like a hung page.
if (process.platform === 'darwin') spawn('caffeinate', ['-ims', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

const serve = (dist, port) =>
  http
    .createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.startsWith('/api/')) {
        const up = http.request({ agent: false, host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        });
        // The page can close before or during the answer. Left unread, the answer stops the service from exiting.
        res.on('close', () => up.destroy());
        up.on('error', (e) => {
          if (res.destroyed) return;
          // A failed request puts the app on its error screen, whose timings would be counted as a fast load.
          console.log(`FAIL ${url} ${e.code}: this run is not valid`);
          process.exitCode = 1;
          res.writeHead(502);
          res.end();
        });
        req.pipe(up);
        return;
      }
      const file = path.join(dist, url === '/' ? 'index.html' : path.normalize(url));
      if (!file.startsWith(dist) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, '127.0.0.1');

// Runs in the page before any app code.
const INIT = () => {
  window.__t = {};
  window.__long = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__t.text = Math.round(e.startTime);
  }).observe({ type: 'paint', buffered: true });
  const seen = new MutationObserver(() => {
    if (window.__t.chart || !document.querySelector('main svg')) return;
    window.__t.chart = 1;
    // A task after the next frame runs once that frame has painted.
    requestAnimationFrame(() => setTimeout(() => (window.__t.chart = Math.round(performance.now()))));
  });
  document.addEventListener('DOMContentLoaded', () => seen.observe(document.body, { childList: true, subtree: true }));
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

let session = null;
async function load(port, hash) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await addSession(context, session);
  context.setDefaultTimeout(120000);
  // Nothing leaves this computer.
  await context.route(/^https?:/, (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
  await context.addInitScript(INIT);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/${hash}`);
  await page.waitForSelector('main');
  // Done when no long task has appeared for 1.5 seconds.
  await page.evaluate(
    () =>
      new Promise((done) => {
        let last = -1;
        let calm = 0;
        const tick = () => {
          calm = window.__long.length === last ? calm + 1 : 0;
          last = window.__long.length;
          if (calm >= 3) done();
          else setTimeout(tick, 500);
        };
        tick();
      }),
  );
  const result = await page.evaluate(() => ({ ...window.__t, longest: Math.max(0, ...window.__long) }));
  await context.close();
  return result;
}

const servers = [serve(DIST_A, PORT_A), serve(DIST_B, PORT_B)];
console.log('medians in ms, before > after');
for (const [seed, hash] of CASES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-compare-'));
  fs.cpSync(path.join(SEED_ROOT, seed), dir, { recursive: true });
  setPassphrase(path.join(REPO, 'backend/.venv/bin/python'), REPO, dir);
  const backend = spawn(path.join(REPO, 'backend/.venv/bin/python'), ['-m', 'this_is_you'], {
    cwd: REPO,
    env: { ...process.env, THIS_IS_YOU_DATA_DIR: dir, THIS_IS_YOU_PORT: String(API_PORT) },
    stdio: 'ignore',
  });
  process.on('exit', () => backend.kill());
  for (let i = 0; i < 300; i++) {
    if (await fetch(`http://127.0.0.1:${API_PORT}/api/status`).then(() => true, () => false)) break;
    await sleep(100);
  }
  session = await login(API_PORT);
  const a = [];
  const b = [];
  for (let i = 0; i < +args.loads; i++) {
    a.push(await load(PORT_A, hash));
    b.push(await load(PORT_B, hash));
  }
  const cell = (key) => `${key} ${median(a.map((r) => r[key] ?? 0))} > ${median(b.map((r) => r[key] ?? 0))}`;
  console.log(seed.padEnd(6), hash.padEnd(18), ['text', 'chart', 'longest'].map(cell).join('   '));
  backend.kill();
  const force = setTimeout(() => {
    console.log('FAIL the service did not stop within 15 s');
    process.exitCode = 1;
    backend.kill('SIGKILL');
  }, 15000);
  await new Promise((r) => backend.on('exit', r));
  clearTimeout(force);
  fs.rmSync(dir, { recursive: true, force: true });
}
await browser.close();
servers.forEach((s) => s.close());
process.exit();
