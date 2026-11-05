// An import killed between saving a file and recording it, in Chrome, on a temp archive of fictional reports.
// Never touches a running archive.
//   npm run build && npm run readiness:recovery
import { chromium } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const PY = path.join(REPO, 'backend/.venv/bin/python');
const PORT = 8134, BASE = `http://127.0.0.1:${PORT}/`;
const PASSPHRASE = 'fictional passphrase for import recovery';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-recovery-'));
const env = { ...process.env, THIS_IS_YOU_DATA_DIR: path.join(dir, 'archive'), THIS_IS_YOU_PORT: String(PORT), THIS_IS_YOU_WEB_DIR: path.join(REPO, 'dist') };
const results = { pass: 0, fail: 0 };
const ok = (name, value, detail = '') => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? `: ${detail}` : ''}`);
  results[value ? 'pass' : 'fail'] += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const folder = path.join(dir, 'Fictional Records');
fs.mkdirSync(folder);
execFileSync(PY, ['-c', `
import sys
sys.path.insert(0, 'backend')
from tests import pdfs
head = ['Fictional Portal', 'Patient: Avery Testperson', 'Collected on Mar 5, 2024 9:12 AM']
for n in range(5):
    body = pdfs.text_pdf(head + [f'WBC {n + 4}.1 x10E3/uL 3.4 - 10.8 x10E3/uL', f'Hemoglobin 13.{n} g/dL 11.1 - 15.9 g/dL'])
    open(f'{sys.argv[1]}/report {n}.pdf', 'wb').write(body)
    if n == 2:
        open(f'{sys.argv[1]}/copy of report 2.pdf', 'wb').write(body)
`, folder], { cwd: REPO });
const names = fs.readdirSync(folder);
const sent = Object.fromEntries(names.map((n) => [n, hash(fs.readFileSync(path.join(folder, n)))]));
const distinct = new Set(Object.values(sent)).size;
spawnSync(PY, ['-m', 'this_is_you', 'set-passphrase'], { cwd: REPO, env, input: `${PASSPHRASE}\n` });

let service = null;
const waitUp = async () => {
  for (let i = 0; i < 200; i++) {
    if (await fetch(`${BASE}api/status`).then((r) => r.ok, () => false)) return;
    await sleep(100);
  }
  throw new Error('the service did not start');
};
const start = async () => {
  service = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env, stdio: 'ignore' });
  await waitUp();
};
const startThenDie = async (n) => {
  service = spawn(PY, [path.join(HERE, 'crash_service.py')], { cwd: REPO, env: { ...env, CRASH_AT_NEW_FILE: String(n) }, stdio: 'ignore' });
  await waitUp();
};
const stop = async () => {
  const dead = service;
  if (dead.exitCode === null && dead.signalCode === null) {
    dead.kill('SIGKILL');
    await new Promise((r) => dead.on('exit', r));
  }
};
process.on('exit', () => service?.kill('SIGKILL'));

await startThenDie(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const outside = [];
await context.route(/^https?:/, (r) => {
  if (new URL(r.request().url()).hostname === '127.0.0.1') return r.continue();
  outside.push(r.request().url());
  return r.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const pageErrors = [];
page.on('pageerror', () => pageErrors.push(1));
const api = async (url) => (await context.request.get(`${BASE}${url}`)).json();
const chooseFolder = async () => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose folder' }).first().click()]);
  await chooser.setFiles(folder);
};
const state = async () => {
  const batch = (await api('api/import-batches')).batches[0];
  const items = (await api(`api/import-batches/${batch.id}/items?limit=500`)).items;
  const documents = (await api('api/documents')).documents;
  return { batch, items, documents };
};
const until = async (name, test, ms = 120000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test().catch(() => false)) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${name}`);
};
const fingerprint = ({ items, documents }) => JSON.stringify([
  [...items].map((i) => [i.path, i.state, i.document_id, i.message]).sort(),
  [...documents].map((d) => [d.id, d.sha256, d.original_filename]).sort(),
]);

await page.goto(`${BASE}#/import`);
await page.getByLabel('Passphrase').fill(PASSPHRASE);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('button', { name: 'Choose folder' }).first().waitFor();

console.log('\n--- The service is killed mid import');
await chooseFolder();
await new Promise((r) => service.on('exit', r));
ok('the service died from SIGKILL', service.signalCode === 'SIGKILL', service.signalCode);
await page.getByText('stopped answering').waitFor({ timeout: 60000 });
ok('the page says it paused', true);

console.log('\n--- Restart');
await start();
await page.reload();
await page.getByRole('heading', { name: 'Import report' }).waitFor();
let now = await state();
let health = await api('api/backups/archive-health');
const recoveredDocs = now.documents.filter((d) => d.original_filename.startsWith('Recovered file '));
// Uploads run side by side, so more than one file can be between saved and recorded at the kill.
ok('each interrupted file came back as one document', health.recovered >= 1 && recoveredDocs.length === health.recovered, health.recovered);
ok('its row still waits for the file', now.items.some((i) => i.state === 'pending'), now.items.filter((i) => i.state === 'pending').length);
ok('stored rows and documents agree, apart from the recovered ones', now.items.filter((i) => i.state === 'stored').length === now.documents.length - recoveredDocs.length);
ok('the page offers to continue', await page.getByText('Choose the same folder to continue').isVisible());
await page.goto(`${BASE}#/documents`);
await page.getByText(/Recovered file/).first().waitFor();
ok('Documents shows the recovered file meanwhile', true);

console.log('\n--- Restarting again changes nothing');
const beforeRepeat = fingerprint(now);
for (let n = 0; n < 2; n++) {
  await stop();
  await start();
  health = await api('api/backups/archive-health');
  now = await state();
  ok(`restart ${n + 1}: nothing more recovered, nothing changed`, health.recovered === 0 && fingerprint(now) === beforeRepeat, `recovered ${health.recovered}; ${fingerprint(now) === beforeRepeat ? 'same' : `was ${beforeRepeat.replace(/[0-9a-f]{32,}/g, '#')} now ${fingerprint(now).replace(/[0-9a-f]{32,}/g, '#')}`}`);
}

console.log('\n--- Choosing the same folder');
await page.goto(`${BASE}#/import`);
await page.reload();
await page.getByRole('heading', { name: 'Import report' }).waitFor();
await chooseFolder();
await until('every file received', async () => (await state()).batch.counts.waiting === undefined);
await until('reading to finish', async () => !(await state()).batch.counts.reading);
await page.reload();
await page.getByRole('heading', { name: 'Import report' }).waitFor();

now = await state();
const stored = now.items.filter((i) => i.state === 'stored');
const copies = now.items.filter((i) => i.state === 'duplicate');
ok('every file listed has one outcome', now.items.length === names.length && stored.length + copies.length === names.length, `${stored.length} stored, ${copies.length} duplicate`);
ok('only the true copy is a duplicate', copies.length === names.length - distinct && copies.every((i) => sent[path.basename(i.path)] === sent['report 2.pdf']));
ok('one stored row for each document', stored.map((i) => i.document_id).sort().join() === now.documents.map((d) => d.id).sort().join());
ok('no document is left with a recovered name', !now.documents.some((d) => d.original_filename.startsWith('Recovered file ')));
ok('recovered documents kept their ids', recoveredDocs.every((r) => now.documents.some((d) => d.id === r.id)));
const note = stored.filter((i) => i.message?.startsWith('Recovered'));
ok('exactly the recovered files say so on their rows', note.map((i) => i.document_id).sort().join() === recoveredDocs.map((d) => d.id).sort().join(), note.length);
let same = 0;
for (const item of now.items) {
  const body = await (await context.request.get(`${BASE}api/documents/${item.document_id}/content`)).body();
  same += hash(body) === sent[path.basename(item.path)];
}
ok('every stored original matches its source, byte for byte', same === names.length, `${same} of ${names.length}`);
const observations = (await api('api/observations')).observations;
ok('nothing was approved', observations.length > 0 && observations.every((o) => o.verification_status === 'proposed'), observations.length);
ok('each result was read once', observations.length === distinct * 2, observations.length);

console.log('\n--- The report and Documents agree on screen');
let text = await page.locator('main').innerText();
ok('the report counts every file', text.includes(`${names.length} files listed, ${names.length} received`));
ok('the report shows the recovered row', text.includes('Recovered after an interrupted import'));
ok('the report shows the true copy as a duplicate', text.includes('Duplicate, set aside'));
await page.goto(`${BASE}#/documents`);
await page.waitForSelector('main');
await page.getByText(now.documents[0].original_filename).first().waitFor();
text = await page.locator('main').innerText();
ok('Documents lists each stored file by its real name', now.documents.every((d) => text.includes(d.original_filename)));
ok('Documents shows no recovered name', !text.includes('Recovered file'));
ok('Documents does not list the copy as its own document', !text.includes('copy of report 2.pdf') || now.documents.some((d) => d.original_filename === 'copy of report 2.pdf'));

console.log('\n--- After another kill and restart');
const settled = fingerprint(now);
await stop();
await start();
health = await api('api/backups/archive-health');
now = await state();
ok('nothing changes', health.recovered === 0 && fingerprint(now) === settled, `recovered ${health.recovered}`);
await page.goto(`${BASE}#/import`);
await page.reload();
await page.getByRole('heading', { name: 'Import report' }).waitFor();
await chooseFolder();
await sleep(2500);
now = await state();
const finishedReport = JSON.parse(settled)[0];
const older = (await api('api/import-batches')).batches.at(-1);
const olderItems = (await api(`api/import-batches/${older.id}/items?limit=500`)).items;
ok('choosing the folder once more is a new attempt: all duplicates, a new report', now.batch.id !== older.id && now.batch.counts.duplicate === names.length, JSON.stringify(now.batch.counts));
ok('it adds no document and leaves the finished report alone', JSON.stringify(JSON.parse(fingerprint(now))[1]) === JSON.stringify(JSON.parse(settled)[1]) && JSON.stringify(olderItems.map((i) => [i.path, i.state, i.document_id, i.message]).sort()) === JSON.stringify(finishedReport));

ok('nothing was sent to another host', outside.length === 0, outside.length);
ok('no page errors', pageErrors.length === 0, pageErrors.length);
await browser.close();
await stop();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${results.pass} of ${results.pass + results.fail} checks passed.`);
process.exit(results.fail ? 1 : 0);
