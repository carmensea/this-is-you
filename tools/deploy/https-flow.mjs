// The app in production mode, in Chrome, through an HTTPS proxy that behaves like `tailscale serve`, on a fictional
// archive. It checks the HTTPS parts a unit test cannot: cookies a browser really accepts, and the app's content policy.
// It is not Tailscale, and on a Mac it is not Linux. docs/deployment.md lists what only the real machine can show.
//   npm run build && npm run deploy:https-flow
// With TIY_EXTERNAL=1 it drives a stack that is already running and reachable at 127.0.0.1:8443, such as one in a Linux
// machine through a tunnel, and imports the large messy fictional folder as well.
import { chromium } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PY = path.join(REPO, 'backend/.venv/bin/python');
const NAME = 'archive.fictional.ts.net', PORT = 8443, API = 8125;
const ORIGIN = `https://${NAME}:${PORT}`;
const EXTERNAL = process.env.TIY_EXTERNAL === '1';
const PASSPHRASE = EXTERNAL ? 'fictional deployment passphrase' : 'fictional passphrase for https flow';
const BACKUP_KEY = EXTERNAL ? 'fictional backup passphrase here' : 'fictional backup passphrase for https flow';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-https-'));
const data = path.join(dir, 'archive'), backups = path.join(dir, 'Other Drive');
fs.mkdirSync(backups);
fs.writeFileSync(path.join(backups, '.this-is-you-backups'), ''); // What setup-host.sh puts on a real backup drive.
let failed = 0;
const ok = (name, value, detail = '') => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!value) failed += 1;
};
const env = { ...process.env, THIS_IS_YOU_DATA_DIR: data, THIS_IS_YOU_PORT: String(API), THIS_IS_YOU_PUBLIC_ORIGIN: ORIGIN, THIS_IS_YOU_WEB_DIR: path.join(REPO, 'dist'), THIS_IS_YOU_BACKUP_DIR: backups };
const cli = (input, ...args) => spawnSync(PY, ['-m', 'this_is_you', ...args], { cwd: REPO, env, input, encoding: 'utf8' });
let proxy = null, service = null;
if (!EXTERNAL) {
  ok('set the passphrase', cli(`${PASSPHRASE}\n`, 'set-passphrase').status === 0);
  ok('set the backup key', cli(`${BACKUP_KEY}\n`, 'backup-key', 'set').status === 0);

  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', `/CN=${NAME}`, '-addext', `subjectAltName=DNS:${NAME}`], { stdio: 'ignore' });
  proxy = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    // Keeps Host, and adds what `tailscale serve` adds. The service must ignore every one of these.
    const headers = { ...req.headers, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host, 'tailscale-user-login': 'fictional@example.com' };
    const up = http.request({ agent: false, host: '127.0.0.1', port: API, path: req.url, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    res.on('close', () => up.destroy());
    up.on('error', () => {
      if (res.destroyed) return;
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  }).listen(PORT, '127.0.0.1');

  service = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env, stdio: 'ignore' });
  process.on('exit', () => service?.kill('SIGKILL'));
  for (let i = 0; i < 200; i++) {
    if (await fetch(`http://127.0.0.1:${API}/api/status`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  ok('the service starts in production mode', (await (await fetch(`http://127.0.0.1:${API}/api/status`)).json()).passphrase_set === true);
  ok('going around the proxy by address gets nothing', (await fetch(`http://127.0.0.1:${API}/`)).status === 403 && (await fetch(`http://127.0.0.1:${API}/api/documents`)).status === 403);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const outside = [];
await context.route(/^https?:/, (route) => {
  const host = new URL(route.request().url()).hostname;
  if (host === NAME) return route.continue();
  outside.push(host);
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/401/.test(m.text())) problems.push(m.text());
});
await page.goto(`${ORIGIN}/#/import`);
await page.getByRole('heading', { name: 'Sign in to your archive' }).waitFor();
ok('the built app loads with no session', true);
await page.getByLabel('Passphrase').fill('fictional wrong passphrase');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText('That passphrase is not right.').waitFor();
ok('a wrong passphrase is refused', !(await context.cookies()).length);
await page.getByLabel('Passphrase').fill(PASSPHRASE);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('button', { name: 'Choose folder' }).first().waitFor();
const cookie = (await context.cookies()).find((c) => c.name === '__Host-tiy_session');
ok('Chrome accepted the secure cookie', cookie?.secure && cookie?.httpOnly && cookie?.sameSite === 'Strict' && cookie?.path === '/' && cookie?.domain === NAME, JSON.stringify({ secure: cookie?.secure, sameSite: cookie?.sameSite, domain: cookie?.domain }));
ok('page code cannot read it', !(await page.evaluate(() => document.cookie)).includes('tiy'));
const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').length; });
ok('bundled fonts load under the content policy', fonts > 0, `${fonts} faces`);

const folder = path.join(dir, 'Fictional Folder');
fs.mkdirSync(folder);
execFileSync(PY, ['-I', '-c', 'import sys;from pypdf import PdfWriter;w=PdfWriter();w.add_blank_page(612,792);w.write(sys.argv[1])', path.join(folder, 'fictional.pdf')]);
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose folder' }).first().click()]);
await chooser.setFiles(folder);
await page.getByText('fictional.pdf').first().waitFor();
ok('importing a folder works through the proxy', true);
if (EXTERNAL) {
  const messy = path.join(dir, 'messy'), expectedFile = path.join(dir, 'expected.json');
  execFileSync(PY, [path.join(REPO, 'tools/readiness/make_messy.py'), messy, expectedFile, '--scale', process.env.TIY_SCALE ?? '1']);
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  const started = Date.now();
  const documentsNow = () => page.evaluate(async () => (await (await fetch('/api/documents')).json()).documents.length);
  const documentsBefore = await documentsNow();
  const report = async () => page.evaluate(async (label) => (await (await fetch('/api/import-batches')).json()).batches.find((b) => b.label === label), expected.origin);
  const [picker] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose folder' }).first().click()]);
  await picker.setFiles(path.join(messy, expected.origin));
  for (let batch; ; await new Promise((r) => setTimeout(r, 3000))) {
    batch = await report();
    if (batch && batch.total === expected.total && !batch.counts.waiting && !batch.counts.reading) break;
    if (Date.now() - started > 1500000) throw new Error('timed out waiting for the messy import');
  }
  const counts = (await report()).counts;
  for (const [category, n] of Object.entries(expected.counts)) ok(`messy folder through the deployment: ${category}`, (counts[category] ?? 0) === n, `${counts[category] ?? 0} of ${n}`);
  const added = (await documentsNow()) - documentsBefore;
  ok('one document per distinct file', added === expected.stored, `${added} added from ${expected.total} files, in ${Math.round((Date.now() - started) / 1000)} s`);
}
const response = await page.evaluate(async () => {
  const documents = (await (await fetch('/api/documents')).json()).documents;
  const pdf = await fetch(`/api/documents/${documents[0].id}/content`);
  return { count: documents.length, status: pdf.status, type: pdf.headers.get('content-type'), hsts: pdf.headers.get('strict-transport-security'), cache: pdf.headers.get('cache-control') };
});
ok('the original is served to its session', response.count >= 1 && response.status === 200 && response.type === 'application/pdf', JSON.stringify(response));
ok('it is marked not to be stored by the browser', response.cache === 'no-store');
await page.goto(`${ORIGIN}/#/documents`);
await page.waitForSelector('main');
await page.locator('[aria-label^="Original file"] canvas').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
ok('the original is drawn under the content policy', await page.locator('[aria-label^="Original file"] canvas').first().evaluate((c) => c.width > 0));

await page.goto(`${ORIGIN}/#/import`);
await page.getByRole('heading', { name: 'Backups' }).waitFor();
const listing = () => page.evaluate(async () => (await fetch('/api/backups')).json());
const settled = async () => {
  for (let i = 0; i < 300; i++) {
    const now = await listing();
    if (!now.running) return now;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('a backup job did not finish');
};
const newest = (now) => now.backups.find((b) => b.state === 'encrypted');
const existing = (await listing()).backups.length;
await page.getByRole('button', { name: 'Back up now' }).click();
await page.waitForTimeout(1500);
const made = await settled();
ok('Back up now writes an encrypted, tested file', made.backups.length === existing + 1 && newest(made)?.last_check?.ok === true && made.last_result?.ok === true, newest(made)?.name);
if (!EXTERNAL) {
  const written = fs.readdirSync(backups).filter((n) => n.endsWith('.tiyb'));
  ok('and nothing readable is in it', written.length === 1 && !fs.readFileSync(path.join(backups, written[0])).includes('SQLite format'));
}
await page.reload();
await page.getByRole('heading', { name: 'Backups' }).waitFor();
const testRestore = async (passphrase) => {
  await page.getByRole('button', { name: 'Test restore' }).first().click();
  await page.getByLabel(/Backup passphrase/).fill(passphrase);
  await page.locator('section[aria-label="Backups"] form').getByRole('button', { name: 'Test restore' }).click();
  await page.waitForTimeout(1500);
  return newest(await settled()).last_check.ok;
};
ok('testing with the wrong passphrase fails', (await testRestore('fictional wrong passphrase')) === false);
await page.reload();
await page.getByText('Encrypted, failed its last check').first().waitFor();
ok('and the browser says so', true);
ok('testing with the right one passes', (await testRestore(BACKUP_KEY)) === true);
if (!EXTERNAL) ok('the backup passphrase was stored nowhere in the archive', spawnSync('grep', ['-rl', BACKUP_KEY, data]).status === 1);

await page.getByRole('button', { name: 'Sign out', exact: true }).click();
await page.getByRole('heading', { name: 'Sign in to your archive' }).waitFor();
ok('signing out ends the session', (await page.evaluate(async () => (await fetch('/api/documents')).status)) === 401);
await page.goto(`${ORIGIN}/?demo#/overview`);
await page.waitForSelector('main');
ok('the demo opens under the content policy', (await page.locator('body').innerText()).includes('DEMONSTRATION'));
ok('no outside requests', outside.length === 0, outside.join());
ok('no page or content policy errors', problems.length === 0, problems.slice(0, 3).join(' | ').slice(0, 300));

if (!EXTERNAL) ok('the sign-in passphrase is stored nowhere in plain form', spawnSync('grep', ['-rl', PASSPHRASE, data]).status === 1);
await browser.close();
proxy?.close();
service?.kill('SIGTERM');
fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
console.log(failed ? `${failed} FAILED` : 'All passed.');
process.exit(failed ? 1 : 0);
