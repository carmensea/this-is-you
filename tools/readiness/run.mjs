// The whole real-records workflow in a real browser, on a large messy fictional folder, with real crashes.
//   npm run build && npm run readiness -- [--scale 1] [--keep]
// Everything lives in temp folders. A personal archive is never opened, and any other host is blocked.
import { chromium } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { addSession, login, PASSPHRASE, setPassphrase } from '../signin.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values: args } = parseArgs({ options: { scale: { type: 'string', default: '1' }, dist: { type: 'string', default: 'dist' }, keep: { type: 'boolean', default: false } } });
const DIST = path.resolve(args.dist);
const PY = path.join(REPO, 'backend/.venv/bin/python');
const API = 8123, API2 = 8124, WEB = 5195;
const BASE = `http://127.0.0.1:${WEB}/`;
const HEADERS = { 'X-This-Is-You-Client': '1', 'Content-Type': 'application/json' };
const FICTIONAL_DEMO = ['DEMONSTRATION DATA', 'Jordan Vale', 'SYNTHETIC SAMPLE RECORD'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-readiness-'));
const SOURCE = path.join(root, 'source'), EXPECTED = path.join(root, 'expected.json'), DATA = path.join(root, 'archive'), BACKUPS = path.join(root, 'archive Backups'), LOG = path.join(root, 'service.log');
const results = [];
const started = Date.now();
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${Math.round((Date.now() - started) / 1000)}s] ${name}${detail !== '' ? `: ${detail}` : ''}`);
};
const section = (name) => console.log(`\n--- ${name}`);
if (process.platform === 'darwin') spawn('caffeinate', ['-ims', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();

const logFd = fs.openSync(LOG, 'a');
let backend = null;
const serviceEnv = (data, port) => ({ ...process.env, THIS_IS_YOU_DATA_DIR: data, THIS_IS_YOU_PORT: String(port), THIS_IS_YOU_MAX_UPLOAD_BYTES: String(5 * 1024 * 1024) });
const up = async (port, tries = 600) => {
  for (let i = 0; i < tries; i++) {
    if (await fetch(`http://127.0.0.1:${port}/api/status`).then((r) => r.ok, () => false)) return;
    await sleep(100);
  }
  throw new Error(`service on ${port} did not start`);
};
const startService = async () => {
  backend = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env: serviceEnv(DATA, API), stdio: ['ignore', logFd, logFd] });
  await up(API);
};
const crash = async () => {
  const dead = backend;
  dead.kill('SIGKILL');
  await new Promise((r) => dead.on('exit', r));
  backend = null;
};
process.on('exit', () => backend?.kill('SIGKILL'));
const cliWith = (input, ...command) => spawnSync(PY, ['-m', 'this_is_you', ...command], { cwd: REPO, env: serviceEnv(DATA, API), encoding: 'utf8', input });
const cli = (...command) => spawnSync(PY, ['-m', 'this_is_you', ...command], { cwd: REPO, env: serviceEnv(DATA, API), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const sessions = {};
const signedIn = (port = API) => ({ Cookie: `tiy_session=${sessions[port]}` });
const api = async (url, port = API) => (await fetch(`http://127.0.0.1:${port}${url}`, { headers: signedIn(port) })).json();
const post = (url, body) => fetch(`http://127.0.0.1:${API}${url}`, { method: 'POST', headers: { ...HEADERS, ...signedIn() }, body: body ? JSON.stringify(body) : undefined });
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const web = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    const upstream = http.request({ agent: false, host: '127.0.0.1', port: API, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    // The page can close before or during the answer. Left unread, the answer stops the service from exiting.
    res.on('close', () => upstream.destroy());
    upstream.on('error', () => {
      if (res.destroyed) return;
      res.writeHead(502);
      res.end();
    });
    req.on('error', () => upstream.destroy());
    req.pipe(upstream);
    return;
  }
  const file = path.join(DIST, url === '/' ? 'index.html' : path.normalize(url));
  if (!file.startsWith(DIST) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(WEB, '127.0.0.1');

// Fictional one-page PDFs that no earlier step has seen, so each counts as a new document.
const MAKE_LATE = (n) => {
  const file = path.join(root, `late-source-${n}.pdf`);
  if (!fs.existsSync(file)) {
    execFileSync(PY, ['-I', '-c', 'import sys;from pypdf import PdfWriter;w=PdfWriter();w.add_blank_page(612,792);w.add_metadata({"/Title":"Fictional late file "+sys.argv[2]});w.write(sys.argv[1])', file, String(n)]);
  }
  return file;
};
const external = [];
const auditFree = (cookies) => !cookies.some((c) => c.name === 'tiy_session');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function open(hash = '#/import', width = 1440, signed = true) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  if (signed && sessions[API]) await addSession(context, sessions[API]);
  await context.route(/^https?:/, (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1') return route.continue();
    external.push(host);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(BASE + hash);
  await page.waitForSelector('main');
  return { context, page };
}
const until = async (what, test, ms = 900000, every = 500) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
};
const chooseFolder = async (page, folder) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose folder' }).first().click()]);
  await chooser.setFiles(folder);
};
const batch = async () => (await api('/api/import-batches')).batches[0];
const received = (b) => (b ? b.total - (b.counts.waiting ?? 0) : 0);
const allItems = async (id, query = '') => {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const page = await api(`/api/import-batches/${id}/items?limit=500&offset=${offset}${query}`);
    out.push(...page.items);
    if (out.length >= page.total) return out;
  }
};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const hashTree = (dir) => Object.fromEntries(walk(dir).map((f) => [path.relative(dir, f), sha(fs.readFileSync(f))]));

try {
  section('Building the fictional folder');
  execFileSync(PY, [path.join(REPO, 'tools/readiness/make_messy.py'), SOURCE, EXPECTED, '--scale', args.scale]);
  const expected = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
  const folder = path.join(SOURCE, expected.origin);
  const sourceBefore = hashTree(SOURCE);
  console.log(`${expected.total} files, ${expected.stored} distinct documents expected`, JSON.stringify(expected.counts));

  section('Nothing opens without signing in');
  await startService();
  let { context, page } = await open('#/overview', 1440, false);
  await page.getByRole('heading', { name: 'Set a passphrase first' }).waitFor();
  check('an archive with no passphrase stays closed and explains how to set one', (await page.locator('main').innerText()).includes('set-passphrase') && (await page.locator('input').count()) === 0);
  check('a page cannot set a passphrase', (await fetch(`http://127.0.0.1:${API}/api/auth/passphrase`, { method: 'POST', headers: HEADERS, body: '{"passphrase":"fictional attacker passphrase"}' })).status === 401);
  setPassphrase(PY, REPO, DATA);
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('heading', { name: 'Sign in to your archive' }).waitFor();
  check('the screen shows no records and no demo data', !FICTIONAL_DEMO.some((t) => page.url().includes(t)) && !/Overview|Biomarkers/.test(await page.locator('body').innerText()));
  await page.getByLabel('Passphrase').fill('fictional wrong passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('That passphrase is not right.').waitFor();
  check('a wrong passphrase is refused and says so', auditFree(await context.cookies()));
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: /no records|yet/i }).or(page.getByRole('navigation')).first().waitFor();
  const issued = (await context.cookies()).find((c) => c.name === 'tiy_session');
  check('the right passphrase signs in with a private cookie', issued?.httpOnly && issued?.sameSite === 'Strict');
  check('page code cannot read the session', !(await page.evaluate(() => document.cookie)).includes('tiy_session'));
  await context.close();
  sessions[API] = await login(API);
  const raw = (extra = {}, url = '/api/documents', method = 'GET') => fetch(`http://127.0.0.1:${API}${url}`, { method, headers: extra });
  for (const url of ['/api/documents', '/api/identity', '/api/backups', '/api/import-batches', '/api/observations', `/api/documents/${'0'.repeat(32)}/content`]) {
    check(`no session, no answer: ${url.slice(0, 24)}`, (await raw({}, url)).status === 401);
  }
  check('a forged cookie is refused', (await raw({ Cookie: 'tiy_session=forged' })).status === 401);
  check('a signed-in request from another origin is refused', (await raw({ ...signedIn(), Origin: 'https://evil.example' })).status === 403);
  check('a signed-in request from a sibling site is refused', (await raw({ ...signedIn(), 'Sec-Fetch-Site': 'same-site' })).status === 403);
  check('a signed-in change without the app header is refused', (await raw(signedIn(), '/api/backups', 'POST')).status === 403);
  const doctor = cli('doctor');
  check('the reader runs in an operating-system sandbox on this machine', doctor.stdout.includes('PDF reader: sandboxed'), doctor.stdout.split('\n').find((l) => l.startsWith('PDF')));
  check('doctor reports the passphrase and the shared drive', doctor.stdout.includes('Passphrase: set') && doctor.stdout.includes('SAME DRIVE'));

  section('An empty archive is not an error');
  ({ context, page } = await open('#/biomarkers'));
  let text = await page.locator('body').innerText();
  check('an empty archive says so, with no error', !/not reachable|could not be read/i.test(text) && /no|yet/i.test(text));
  check('an empty archive shows no demo data', !FICTIONAL_DEMO.some((t) => text.includes(t)));

  section('Identity details, entered in the browser');
  await page.goto(BASE + '#/import');
  await page.getByRole('button', { name: 'Enter your details' }).click();
  await page.getByLabel('Full name').fill(expected.identity.full_name);
  await page.getByLabel('Date of birth').fill(expected.identity.date_of_birth);
  await page.getByLabel(/Previous names/).fill(expected.identity.previous_names.join('\n'));
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByRole('button', { name: 'Edit your details' }).waitFor();
  check('identity details saved', (await api('/api/identity')).configured);

  section('Import, with a service crash partway through');
  await chooseFolder(page, folder);
  const crashAt = Math.floor(expected.total * 0.2);
  await until('a fifth of the files', async () => received(await batch()) >= crashAt, 600000, 100);
  const beforeCrash = await batch();
  await crash();
  console.log(`service killed at ${received(beforeCrash)} of ${expected.total}`);
  await page.getByText('stopped answering').waitFor({ timeout: 60000 });
  check('the page says it paused, and that nothing was lost', await page.getByText('Everything already stored is safe').isVisible());
  await page.reload();
  await page.getByRole('heading', { name: 'Your archive is not reachable' }).waitFor({ timeout: 30000 });
  text = await page.locator('body').innerText();
  check('with the service down, it says so and offers Retry', await page.getByRole('button', { name: 'Retry' }).isVisible());
  check('with the service down, no demo data stands in', !FICTIONAL_DEMO.some((t) => text.includes(t)));
  await startService();
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('heading', { name: 'Import', exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole('heading', { name: 'Import report' }).waitFor({ timeout: 30000 });
  check('Retry recovers without a reload', true);
  let summary = await batch();
  const docsAfterCrash = (await api('/api/documents')).documents.length;
  const items = await allItems(summary.id);
  const storedRows = items.filter((i) => i.state === 'stored').length;
  // A kill between saving a file and recording it leaves one recovered document, whose row waits for the file to return.
  const { recovered: recoveredAtStart } = await api('/api/backups/archive-health');
  check('after the crash, the report and the archive agree on what is stored', storedRows === docsAfterCrash - recoveredAtStart, `${storedRows} rows, ${docsAfterCrash} documents, ${recoveredAtStart} recovered`);
  check('after the crash, the report kept the whole listing', summary.total >= crashAt, summary.total);
  check('the page offers to continue', await page.getByText('Choose the same folder to continue').isVisible());

  section('Closing the browser partway through, then continuing');
  await chooseFolder(page, folder);
  await until('60 percent', async () => received(await batch()) >= expected.total * 0.6, 600000, 100);
  await context.close();
  await sleep(1500);
  const afterClose = await batch();
  check('the report outlasts a closed browser', afterClose.total === expected.total && received(afterClose) < expected.total, `${received(afterClose)} of ${afterClose.total}`);
  ({ context, page } = await open('#/import'));
  await page.getByRole('heading', { name: 'Import report' }).waitFor();
  check('a new browser shows the saved report', await page.getByText(`${expected.total} files listed`).isVisible());
  const uploadCalls = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/file')) uploadCalls.push(r.url());
  });
  const remaining = afterClose.total - received(afterClose);
  await chooseFolder(page, folder);
  await until('every file received', async () => received(await batch()) === expected.total, 600000, 200);
  await until('sending to finish', async () => !(await page.getByText(/^Sending /).isVisible()), 60000, 200);
  check('resuming sends only what had not arrived, plus what had failed', uploadCalls.length <= remaining + expected.counts.failed + 2, `${uploadCalls.length} sent, ${remaining} were waiting`);

  section('A crash while files are being read');
  await until('some reading done', async () => {
    const b = await batch();
    return (b.counts.read ?? 0) > 20;
  }, 600000);
  const readingBefore = (await batch()).counts.reading ?? 0;
  await crash();
  await startService();
  console.log(`service killed with ${readingBefore} still to read`);
  await until('reading to finish', async () => !(await batch()).counts.reading, 1800000, 2000);
  check('reading picks up by itself after a crash', readingBefore > 0, `${readingBefore} were waiting`);

  section('The report matches the folder');
  summary = await batch();
  check('every file has a row', summary.total === expected.total, `${summary.total} of ${expected.total}`);
  // A file over the size limit that is listed as unsupported, and everything else, exactly as built.
  for (const [category, n] of Object.entries(expected.counts)) check(`category ${category}`, (summary.counts[category] ?? 0) === n, `${summary.counts[category] ?? 0} of ${n}`);
  const documents = (await api('/api/documents')).documents;
  check('one document per distinct file', documents.length === expected.stored && new Set(documents.map((d) => d.sha256)).size === documents.length, `${documents.length} of ${expected.stored}`);
  const events = documents.length;
  check('nothing was verified by the import', documents.every((d) => d.verification_status === 'unverified' && d.review_status === 'not_started') && (await api('/api/observations')).observations.every((o) => o.verification_status === 'proposed'));
  check('identity: possible mismatches counted', summary.identity_mismatches === expected.mismatches, `${summary.identity_mismatches} of ${expected.mismatches}`);
  check('identity: undetermined counted', summary.identity_undetermined === expected.undetermined, `${summary.identity_undetermined} of ${expected.undetermined}`);
  const allRows = await allItems(summary.id);
  const sourcePaths = new Set(walk(folder).map((f) => `${expected.origin}/${path.relative(folder, f)}`));
  check('every row names a real file, and every file has a row', allRows.length === sourcePaths.size && allRows.every((r) => sourcePaths.has(r.path)));
  let bytesOk = 0;
  for (const row of allRows.filter((r) => r.state === 'stored')) {
    const stored = Buffer.from(await (await fetch(`http://127.0.0.1:${API}/api/documents/${row.document_id}/content`, { headers: signedIn() })).arrayBuffer());
    const disk = fs.readFileSync(path.join(SOURCE, row.path));
    if (stored.equals(disk)) bytesOk += 1;
  }
  check('stored originals match the source, byte for byte', bytesOk === documents.length, `${bytesOk} of ${documents.length}`);
  const sourceAfter = hashTree(SOURCE);
  check('the source folder was not changed', JSON.stringify(sourceAfter) === JSON.stringify(sourceBefore));

  section('The report in the browser');
  await page.goto(BASE + '#/import');
  await page.reload();
  await page.getByRole('heading', { name: 'Import report' }).waitFor();
  const filterGroup = page.getByRole('group', { name: 'Filter the report' });
  await filterGroup.getByRole('button', { name: /^Failed/ }).click();
  await page.getByText('Not accepted, nothing stored').first().waitFor();
  check('filtering shows failures with their reason', await page.getByText('not a readable PDF').first().isVisible());
  await filterGroup.getByRole('button', { name: /Check whose document/ }).click();
  await page.getByText('differs from your details').first().waitFor();
  check('flagged documents can be listed', (await page.getByText('Stored, ready for review').count()) > 0);
  await page.getByRole('button', { name: 'View in Documents' }).first().click();
  await page.getByText('differs from your details').first().waitFor();
  check('a flagged document still opens, with the flag shown', true);
  await page.goto(BASE + '#/import');
  await page.reload();
  await page.getByRole('heading', { name: 'Import report' }).waitFor();
  await filterGroup.getByRole('button', { name: /^Scanned/ }).click();
  await page.getByText('Stored, scanned, not read').first().waitFor();
  check('storage and reading are separate on a scanned file', await page.getByText('Stored unchanged. Not read').first().isVisible());
  await filterGroup.getByRole('button', { name: /^All/ }).click();

  section('Retrying failures');
  await page.getByRole('button', { name: 'Retry failures' }).click();
  await page.getByText('choosing again').waitFor({ timeout: 30000 });
  check('after a reload, retry asks for the folder again, without pretending', true);
  await until('those readings to finish', async () => !(await batch()).counts.reading, 300000);
  const before = (await batch()).counts;
  await chooseFolder(page, folder);
  await until('the retry to finish', async () => !(await page.getByText(/^Sending /).isVisible()), 300000, 300);
  await sleep(1000);
  await until('readings to finish', async () => !(await batch()).counts.reading, 300000);
  const afterRetry = await batch();
  check('retrying files that are still damaged changes nothing else', JSON.stringify(afterRetry.counts) === JSON.stringify(before), JSON.stringify(afterRetry.counts));
  check('retrying added no documents', (await api('/api/documents')).documents.length === documents.length);

  await page.reload();
  await page.getByRole('heading', { name: 'Import report' }).waitFor();
  await filterGroup.getByRole('button', { name: /^Failed/ }).click();
  const unreadable = page.locator('section[aria-label="Import report"] > div > div > div', { hasText: 'Stored, reading failed' }).first();
  for (let i = 0; i < 40 && !(await unreadable.count()); i++) {
    await page.getByRole('button', { name: /^Show more/ }).click();
    await sleep(300);
  }
  const failedRow = (await allItems(afterRetry.id, '&category=failed')).find((r) => r.state === 'stored');
  const runsBefore = (await api(`/api/documents/${failedRow.document_id}`)).runs.length;
  await unreadable.getByRole('button', { name: 'Retry' }).click();
  const anyDocument = async () => (await api(`/api/documents/${(await allItems(afterRetry.id, '&category=failed')).find((r) => r.state === 'stored').document_id}`)).runs.length;
  await until('the row retry to run', async () => {
    const counts = (await batch()).counts;
    const rows = await allItems(afterRetry.id, '&category=failed');
    const totals = await Promise.all(rows.filter((r) => r.state === 'stored').map(async (r) => (await api(`/api/documents/${r.document_id}`)).runs.length));
    return !counts.reading && totals.reduce((a, b) => a + b, 0) > 0 && totals.some((n) => n > runsBefore);
  }, 120000);
  check('retrying one row reads that file again and keeps the original', (await anyDocument()) >= runsBefore && (await api('/api/documents')).documents.length === documents.length);

  section('Reviewing some results, so charts and history exist');
  const observations = (await api('/api/observations')).observations;
  const chosen = observations.filter((o) => o.test_code).slice(0, 60);
  for (const o of chosen.slice(0, 50)) await post(`/api/observations/${o.id}/verify`);
  await post(`/api/observations/${chosen[0].id}/correct`, { fields: { value_text: '13.9' } });
  await post(`/api/observations/${chosen[0].id}/verify`);
  await post(`/api/documents/${documents[0].id}/metadata/provider`, { action: 'corrected', value: 'Fictional Clinic' });
  const obsCount = observations.length;

  section('Failed reads on Biomarkers');
  await context.close();
  ({ context, page } = await open('#/biomarkers'));
  await page.locator('main svg').first().waitFor();
  check('Biomarkers draws from the real archive', true);
  let hits = 0;
  await page.route('**/api/observations', (route) => (hits++ < 2 ? route.fulfill({ status: 502, body: '' }) : route.continue()));
  await page.reload();
  await page.locator('main svg').first().waitFor();
  text = await page.locator('body').innerText();
  check('two failed reads recover by themselves, with nothing shown', hits >= 3 && !/not reachable/.test(text), `${hits} requests`);
  await page.unroute('**/api/observations');
  await page.route('**/api/observations', (route) => route.fulfill({ status: 502, body: '' }));
  await page.reload();
  await page.getByRole('heading', { name: 'Your archive is not reachable' }).waitFor({ timeout: 15000 });
  check('a lasting failure stops retrying and shows Retry', await page.getByRole('button', { name: 'Retry' }).isVisible());
  text = await page.locator('body').innerText();
  check('it never substitutes demo data', !FICTIONAL_DEMO.some((t) => text.includes(t)));
  check('it does not claim the archive is empty', text.includes('does not mean your archive is empty'));
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('button', { name: 'Retrying' }).waitFor({ timeout: 5000 }).catch(() => {});
  await page.getByText('Still not available').waitFor({ timeout: 15000 });
  check('Retry reports when it did not help', true);
  await page.unroute('**/api/observations');
  await page.route('**/api/observations', (route) => route.fulfill({ status: 500, headers: { 'x-content-type-options': 'nosniff' }, body: '{}' }));
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('heading', { name: 'Your archive could not be read' }).waitFor({ timeout: 15000 });
  check('an error from the service is told apart from no service', true);
  await page.unroute('**/api/observations');
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.locator('main svg').first().waitFor({ timeout: 30000 });
  check('Retry recovers Biomarkers, with charts', true);
  await page.route('**/api/documents', (route) => route.fulfill({ status: 502, body: '' }));
  await page.evaluate(() => { location.hash = '/import'; });
  await page.getByRole('button', { name: 'Edit your details' }).click();
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByText('may be out of date').waitFor({ timeout: 20000 });
  check('a failed refresh during use keeps the records and says so', (await page.locator('main').innerText()).includes('Import report'));
  await page.unroute('**/api/documents');
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await page.getByText('may be out of date').waitFor({ state: 'detached', timeout: 20000 });
  check('Retry clears that notice', true);
  check('recovery changed no data', (await api('/api/documents')).documents.length === documents.length && (await api('/api/observations')).observations.length === obsCount);

  section('Backups');
  await page.reload();
  await page.getByRole('heading', { name: 'Backups' }).waitFor();
  check('Back up now is off until there is a backup key', await page.getByRole('button', { name: 'Back up now' }).isDisabled());
  const BACKUP_KEY = 'fictional backup passphrase';
  check('setting the backup key works', cliWith(`${BACKUP_KEY}\n`, 'backup-key', 'set').status === 0);
  check('the machine does not hold what opens backups', !fs.readFileSync(path.join(DATA, 'backup-key.json'), 'utf8').includes(BACKUP_KEY));
  await page.reload();
  await page.getByRole('button', { name: 'Back up now' }).click();
  await page.getByText(/Encrypted, tested/).first().waitFor({ timeout: 600000 });
  check('a backup from the browser is encrypted, and tested before it is called good', fs.readdirSync(BACKUPS).some((n) => n.endsWith('.tiyb')));
  // The checks on damage below look inside a backup, so they need a plain one, which has to be asked for.
  const plainRun = cli('backup', '--plain');
  check('a plain backup has to be asked for, and says what it is', plainRun.status === 0 && plainRun.stdout.includes('NOT encrypted'), plainRun.stderr.trim());
  const good = (await api('/api/backups')).backups.find((b) => b.state === 'complete');
  check('the backup lists every document', good.documents === documents.length, good.documents);
  const goodPath = path.join(BACKUPS, good.name);
  check('the backup is outside the Git repository', !goodPath.startsWith(REPO));
  check('the backup folder is private', (fs.statSync(goodPath).mode & 0o777) === 0o700);

  section('A crash in the middle of a backup');
  const STAGING = path.join(DATA, 'backup-staging');
  const sealedBefore = fs.readdirSync(BACKUPS).filter((n) => n.endsWith('.tiyb')).length;
  const startedBackup = await post('/api/backups');
  if (startedBackup.status !== 202) throw new Error(`backup did not start: ${startedBackup.status}`);
  await until('the plain working copy to appear', () => fs.existsSync(STAGING), 30000, 2);
  await crash();
  await startService();
  check('a crash while building an encrypted backup leaves no plain copy after the next start', !fs.existsSync(STAGING));
  check('and no file that could pass as a backup', fs.readdirSync(BACKUPS).filter((n) => n.endsWith('.tiyb')).length === sealedBefore);
  // A plain backup builds its folder where it will stay, so this is the one that can leave an unfinished folder there.
  const plainCrash = spawn(PY, ['-m', 'this_is_you', 'backup', '--plain'], { cwd: REPO, env: serviceEnv(DATA, API), stdio: 'ignore' });
  await until('the unfinished folder to appear', () => fs.readdirSync(BACKUPS).some((n) => n.endsWith('.incomplete')), 60000, 2);
  plainCrash.kill('SIGKILL');
  await new Promise((r) => plainCrash.on('exit', r));
  check('a crash partway through a backup was produced', fs.readdirSync(BACKUPS).some((n) => n.endsWith('.incomplete')));
  const crashed = (await api('/api/backups')).backups.find((b) => b.state === 'incomplete');
  check('an interrupted backup is listed as unusable', !!crashed);
  const crashedPath = path.join(BACKUPS, crashed.name);
  const refused = cli('verify', crashedPath);
  check('an interrupted backup fails its check', refused.status !== 0, (refused.stdout + refused.stderr).trim());
  check('an interrupted backup cannot be restored', cli('restore', crashedPath, '--to', path.join(root, 'from-incomplete')).status !== 0 && !fs.existsSync(path.join(root, 'from-incomplete')));
  await page.reload();
  await page.getByText('Did not finish, cannot be used').waitFor({ timeout: 30000 });
  check('the browser shows it as unusable', true);
  await page.getByRole('button', { name: 'Back up now' }).click();
  await until('the next backup', async () => {
    const list = await api('/api/backups');
    return !list.running && list.last_result?.ok;
  }, 600000);
  check('the next backup clears the leftover', !fs.existsSync(crashedPath));

  section('Damaged backups');
  const copy = (suffix, damage) => {
    const target = `${goodPath}-${suffix}`;
    fs.cpSync(goodPath, target, { recursive: true });
    damage(target);
    return target;
  };
  const original = (dir) => walk(path.join(dir, 'originals'))[0];
  const flip = (file) => {
    fs.chmodSync(file, 0o600);
    const body = fs.readFileSync(file);
    body[body.length >> 1] ^= 0xff;
    fs.writeFileSync(file, body);
  };
  const damaged = {
    'a flipped bit in an original': copy(1, (d) => flip(original(d))),
    'a flipped bit in the database': copy(2, (d) => flip(path.join(d, 'archive.sqlite3'))),
    'a missing original': copy(3, (d) => fs.rmSync(original(d), { force: true })),
    'a truncated database': copy(4, (d) => {
      const file = path.join(d, 'archive.sqlite3');
      fs.chmodSync(file, 0o600);
      fs.truncateSync(file, 4096);
    }),
    'a missing manifest': copy(5, (d) => fs.rmSync(path.join(d, 'manifest.json'))),
    'an edited manifest': copy(6, (d) => fs.writeFileSync(path.join(d, 'manifest.json'), fs.readFileSync(path.join(d, 'manifest.json'), 'utf8').replace('"documents":', '"documents": 1, "x":'))),
  };
  for (const [what, dir] of Object.entries(damaged)) {
    const out = cli('verify', dir);
    const target = path.join(root, `restored-${path.basename(dir)}`);
    const restore = cli('restore', dir, '--to', target);
    check(`${what} is caught, and nothing is restored`, out.status !== 0 && restore.status !== 0 && !fs.existsSync(target), (out.stdout + out.stderr).trim().slice(0, 110));
  }
  await page.reload();
  const row = page.locator('section[aria-label="Backups"] > div', { hasText: `${path.basename(damaged['a flipped bit in an original'])}` });
  await row.getByRole('button', { name: 'Test restore' }).click();
  await row.getByText('Failed its last check').waitFor({ timeout: 120000 });
  check('the browser reports a damaged backup', true);

  section('Restoring into a separate archive');
  const restored = path.join(root, 'restored');
  const restore = cli('restore', goodPath, '--to', restored);
  check('restoring into a new folder works', restore.status === 0, restore.stderr.trim());
  const live = { documents: await api('/api/documents'), identity: await api('/api/identity') };
  const second = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env: serviceEnv(restored, API2), stdio: ['ignore', logFd, logFd] });
  await up(API2);
  check('a restored archive stays closed until it has its own passphrase', (await (await fetch(`http://127.0.0.1:${API2}/api/status`)).json()).passphrase_set === false && (await fetch(`http://127.0.0.1:${API2}/api/documents`, { headers: signedIn() })).status === 401);
  setPassphrase(PY, REPO, restored);
  sessions[API2] = await login(API2);
  const copyDocs = await api('/api/documents', API2);
  const key = (d) => JSON.stringify([d.id, d.sha256, d.original_filename, d.metadata, d.extraction_status, d.verification_status]);
  const liveAtBackup = live.documents.documents.map(key).sort();
  // The live archive was only added to after this backup by reads, so the two should be the same.
  check('documents, details and decisions came back', JSON.stringify(copyDocs.documents.map(key).sort()) === JSON.stringify(liveAtBackup), `${copyDocs.documents.length} documents`);
  const copyObs = (await api('/api/observations', API2)).observations;
  check('results came back, verified ones included', copyObs.length === obsCount && copyObs.filter((o) => o.verification_status === 'verified').length === 50);
  const corrected = copyObs.find((o) => o.id === chosen[0].id);
  check('correction history came back', corrected.edited && corrected.value_text === '13.9' && corrected.revisions.length >= 3 && corrected.original.value_text === chosen[0].value_text, `${corrected.revisions.map((r) => r.action).join(', ')}`);
  check('identity details came back', JSON.stringify(await api('/api/identity', API2)) === JSON.stringify(live.identity));
  const copyBatch = (await api('/api/import-batches', API2)).batches[0];
  check('the import report came back', copyBatch.total === expected.total);
  let sameBytes = 0;
  for (const d of copyDocs.documents) {
    const body = Buffer.from(await (await fetch(`http://127.0.0.1:${API2}/api/documents/${d.id}/content`, { headers: signedIn(API2) })).arrayBuffer());
    if (sha(body) === d.sha256) sameBytes += 1;
  }
  check('every restored PDF has its original bytes', sameBytes === copyDocs.documents.length, `${sameBytes} of ${copyDocs.documents.length}`);
  second.kill('SIGTERM');
  await new Promise((r) => second.on('exit', r));
  const relationships = execFileSync(PY, ['-c', `import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(len(c.execute('PRAGMA foreign_key_check').fetchall()), c.execute('PRAGMA integrity_check').fetchone()[0])`, path.join(restored, 'archive.sqlite3')], { encoding: 'utf8' }).trim();
  check('restored relationships and structure are sound', relationships === '0 ok', relationships);

  section('The active archive is protected');
  const activeBefore = fs.statSync(path.join(DATA, 'archive.sqlite3')).mtimeMs;
  const over = cli('restore', goodPath, '--to', DATA);
  check('restoring over the active archive needs confirmation', over.status !== 0 && /nothing was restored/.test(over.stderr), over.stderr.trim().slice(0, 110));
  check('the active archive was not touched', fs.statSync(path.join(DATA, 'archive.sqlite3')).mtimeMs === activeBefore && (await api('/api/documents')).documents.length === documents.length);
  const secondService = spawnSync(PY, ['-m', 'this_is_you'], { cwd: REPO, env: serviceEnv(DATA, API2), encoding: 'utf8', timeout: 20000 });
  check('a second service on the same archive is refused', secondService.status !== 0 && /already using/.test(secondService.stderr), secondService.stderr.trim());

  section('Design and privacy');
  await page.goto(BASE + '#/import');
  await page.reload();
  await page.getByRole('heading', { name: 'Import report' }).waitFor();
  const importText = await page.locator('main').innerText();
  check('no em dashes in the new copy', !importText.includes('—'));
  const shot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
  fs.mkdirSync(shot, { recursive: true });
  await page.screenshot({ path: path.join(shot, 'import-desktop.png'), fullPage: true });
  await context.close();
  ({ context, page } = await open('#/import', 390));
  await page.getByRole('heading', { name: 'Import report' }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('no sideways scrolling at phone width', overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: path.join(shot, 'import-phone.png'), fullPage: true });
  await context.close();
  ({ context, page } = await open('?demo#/import'));
  text = await page.locator('main').innerText();
  check('the demo has no report, identity, backup or sign-in section', !/Import report|Identity check|Back up now|Sign out/.test(text));
  await context.close();
  ({ context, page } = await open('?demo#/overview', 1440, false));
  const apiCalls = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url()); });
  await page.reload();
  await page.waitForSelector('main');
  check('the demo opens with no session and asks the service for nothing', apiCalls.length === 0 && (await page.locator('body').innerText()).includes('DEMONSTRATION'), apiCalls.slice(0, 2).join(', '));
  await context.close();

  section('Signed out in the middle of an import');
  const lateFolder = path.join(root, 'Late Folder');
  fs.mkdirSync(lateFolder);
  for (let n = 0; n < 40; n++) fs.copyFileSync(MAKE_LATE(n), path.join(lateFolder, `late-${n}.pdf`));
  const beforeLate = (await api('/api/documents')).documents.length;
  ({ context, page } = await open('#/import'));
  await page.getByRole('heading', { name: 'Import report' }).waitFor();
  await chooseFolder(page, lateFolder);
  await until('some of them to arrive', async () => (await api('/api/documents')).documents.length > beforeLate, 120000, 25);
  check('ending every session from the command line works', cli('sign-out-everywhere').status === 0);
  await page.getByRole('heading', { name: 'Sign in to your archive' }).waitFor();
  check('the page stops showing records as soon as the session ends', !/Late Folder|Import report/.test(await page.locator('body').innerText()));
  sessions[API] = await login(API);
  await addSession(context, sessions[API]);
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Import report' }).waitFor();
  const retryLate = page.getByRole('button', { name: 'Retry failures' });
  await retryLate.waitFor();
  await retryLate.click();
  await until('the rest to arrive', async () => (await api('/api/import-batches')).batches.find((b) => b.label === 'Late Folder')?.counts.waiting === undefined && !(await api('/api/import-batches')).batches.find((b) => b.label === 'Late Folder')?.counts.failed, 120000);
  sessions[API] = await login(API);
  const afterLate = (await api('/api/documents')).documents.length;
  check('every file arrived exactly once, with nothing lost to the sign-out', afterLate === beforeLate + 40, `${afterLate - beforeLate} added`);
  await context.close();

  section('Interrupted storage');
  await crash();
  const orphanBody = fs.readFileSync(MAKE_LATE(900));
  const orphanSha = sha(orphanBody);
  const orphanPath = path.join(DATA, 'originals', orphanSha.slice(0, 2), orphanSha.slice(2, 4), `${orphanSha}.pdf`);
  fs.mkdirSync(path.dirname(orphanPath), { recursive: true });
  fs.writeFileSync(orphanPath, orphanBody);
  const damagedPath = path.join(DATA, 'originals', 'ab', 'cd', `abcd${'0'.repeat(60)}.pdf`);
  fs.mkdirSync(path.dirname(damagedPath), { recursive: true });
  fs.writeFileSync(damagedPath, 'fictional damaged file');
  await startService();
  const recovered = (await api('/api/documents')).documents.filter((d) => d.original_filename.startsWith('Recovered file '));
  check('a stored file with no record comes back as a document', recovered.length === 1 && recovered[0].sha256 === orphanSha && recovered[0].verification_status === 'unverified');
  check('a file that does not match its name is set aside, not deleted', !fs.existsSync(damagedPath) && fs.existsSync(path.join(DATA, 'set-aside', path.basename(damagedPath))));
  check('the recovered bytes are exact', fs.readFileSync(orphanPath).equals(orphanBody));
  ({ context, page } = await open('#/import'));
  await page.getByText('left by an interrupted import').waitFor();
  check('the browser says what was recovered and set aside', (await page.locator('section[aria-label="Sign-in"]').innerText()).includes('set-aside'));
  await context.close();

  section('Encrypted backups');
  const drive = path.join(root, 'Fictional Drive');
  fs.mkdirSync(drive);
  const sealedRun = cli('backup', '--to', drive);
  check('an encrypted backup is written and tested', sealedRun.status === 0, sealedRun.stderr.trim().slice(0, 120));
  const sealedName = fs.readdirSync(drive).find((n) => n.endsWith('.tiyb'));
  const sealedPath = path.join(drive, sealedName);
  check('the destination holds one file, with no plain copy beside it', fs.readdirSync(drive).length === 1);
  const sealedBytes = fs.readFileSync(sealedPath);
  check('nothing readable is in it', !['SQLite format', 'manifest.json', ...expected.forbidden_in_logs].some((w) => sealedBytes.includes(w)));
  check('no plain copy stayed behind', !fs.existsSync(path.join(DATA, 'backup-staging')));
  check('it passes verify with its passphrase', cliWith(`${BACKUP_KEY}\n`, 'verify', sealedPath).status === 0);
  check('it fails verify with another passphrase', cliWith('fictional wrong passphrase\n', 'verify', sealedPath).status !== 0);
  const flipped = Buffer.from(sealedBytes);
  flipped[Math.floor(flipped.length / 2)] ^= 1;
  const tampered = path.join(drive, sealedName.replace('.tiyb', '-1.tiyb'));
  fs.writeFileSync(tampered, flipped);
  const tamperedRestore = path.join(root, 'tampered');
  check('a changed byte stops the restore and restores nothing', cliWith(`${BACKUP_KEY}\n`, 'restore', tampered, '--to', tamperedRestore).status !== 0 && !fs.existsSync(tamperedRestore) && !fs.readdirSync(root).some((n) => n.startsWith('.tampered')));
  fs.rmSync(tampered);
  fs.writeFileSync(tampered, sealedBytes.subarray(0, sealedBytes.length >> 1));
  check('a cut-short file stops the restore', cliWith(`${BACKUP_KEY}\n`, 'restore', tampered, '--to', tamperedRestore).status !== 0 && !fs.existsSync(tamperedRestore));
  fs.rmSync(tampered);
  const sealedRestored = path.join(root, 'sealed-restored');
  check('it restores into a new folder', cliWith(`${BACKUP_KEY}\n`, 'restore', sealedPath, '--to', sealedRestored).status === 0);
  const restoredDb = execFileSync(PY, ['-I', '-c', 'import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute("select count(*) from documents").fetchone()[0],c.execute("select count(*) from auth_credential").fetchone()[0],c.execute("select count(*) from auth_sessions").fetchone()[0],c.execute("pragma foreign_key_check").fetchone())', path.join(sealedRestored, 'archive.sqlite3')], { encoding: 'utf8' }).trim();
  check('it holds every document and no sign-in details', restoredDb === `${(await api('/api/documents')).documents.length} 0 0 None`, restoredDb);
  check('a backup to a drive that is not connected is refused', cli('backup', '--to', path.join(root, 'Missing Drive', 'Backups')).status !== 0 && !fs.existsSync(path.join(root, 'Missing Drive')));
  const killMid = spawn(PY, ['-m', 'this_is_you', 'backup', '--to', drive], { cwd: REPO, env: serviceEnv(DATA, API), stdio: 'ignore' });
  // A fixed wait can outlast a small backup: the kill then tests nothing, and the exit has already fired.
  const killed = new Promise((r) => killMid.on('exit', r));
  await until('the backup to begin', () => fs.existsSync(path.join(DATA, 'backup-staging')), 30000, 20);
  killMid.kill('SIGKILL');
  await killed;
  const leftBehind = fs.readdirSync(drive).filter((n) => n !== sealedName);
  check('killing a sealed backup leaves nothing that can pass as finished', leftBehind.every((n) => n.endsWith('.incomplete')), leftBehind.join(', '));
  await crash();
  await startService();
  check('plain copies from that crash are cleared on the next start', !fs.existsSync(path.join(DATA, 'backup-staging')));

  check('no request left this computer', external.length === 0, external.slice(0, 3).join(', '));
  const log = fs.readFileSync(LOG, 'utf8');
  const leaked = expected.forbidden_in_logs.filter((word) => log.includes(word));
  check('names, filenames and contents stayed out of the service log', leaked.length === 0, `${log.length} bytes of log. ${leaked.join(', ')}`);
  const timing = async () => {
    const t = performance.now();
    await api('/api/import-batches');
    return Math.round(performance.now() - t);
  };
  console.log(`report poll on ${expected.total} rows: ${await timing()} ms, ${await timing()} ms. ${events} documents.`);
} catch (problem) {
  check('the run finished', false, problem.message.split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
  web.close();
  backend?.kill('SIGTERM');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed, in ${Math.round((Date.now() - started) / 1000)} s.`);
  failed.forEach((f) => console.log(`FAILED: ${f.name}: ${f.detail}`));
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'last.json'), JSON.stringify(results, null, 1));
  await sleep(500);
  if (args.keep) console.log(`Kept ${root}`);
  else fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  process.exit(failed.length ? 1 : 0);
}
