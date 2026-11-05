// Deleting a document in Chrome, on a temp archive of fictional reports. Never touches a running archive.
//   npm run build && npm run readiness:delete
import { chromium } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PY = path.join(REPO, 'backend/.venv/bin/python');
const PORT = 8135, BASE = `http://127.0.0.1:${PORT}/`;
const PASSPHRASE = 'fictional passphrase for deleting';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-delete-'));
const DATA = path.join(dir, 'archive');
const env = { ...process.env, THIS_IS_YOU_DATA_DIR: DATA, THIS_IS_YOU_PORT: String(PORT), THIS_IS_YOU_WEB_DIR: path.join(REPO, 'dist') };
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
head = ['Fictional Portal', 'Collected on Mar 5, 2024 9:12 AM']
open(sys.argv[1] + '/wrong person mri.pdf', 'wb').write(pdfs.text_pdf(head + ['Glucose 90 mg/dL 65 - 99 mg/dL']))
open(sys.argv[1] + '/my labs.pdf', 'wb').write(pdfs.text_pdf(head + ['WBC 6.2 x10E3/uL 3.4 - 10.8 x10E3/uL', 'Hemoglobin 13.9 g/dL 11.1 - 15.9 g/dL']))
`, folder], { cwd: REPO });
const wrongSha = hash(fs.readFileSync(path.join(folder, 'wrong person mri.pdf')));
const mineSha = hash(fs.readFileSync(path.join(folder, 'my labs.pdf')));
const stored = (sha) => path.join(DATA, 'originals', sha.slice(0, 2), sha.slice(2, 4), `${sha}.pdf`);
spawnSync(PY, ['-m', 'this_is_you', 'set-passphrase'], { cwd: REPO, env, input: `${PASSPHRASE}\n` });
let service = null;
const start = async () => {
  service = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env, stdio: 'ignore' });
  for (let i = 0; i < 200; i++) {
    if (await fetch(`${BASE}api/status`).then((r) => r.ok, () => false)) return;
    await sleep(100);
  }
  throw new Error('the service did not start');
};
process.on('exit', () => service?.kill('SIGKILL'));
process.on('unhandledRejection', (problem) => { console.log(String(problem).slice(0, 600)); process.exit(1); });
await start();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
process.on('exit', () => browser.close());
page.setDefaultTimeout(30000);
let pageErrors = 0;
page.on('pageerror', () => { pageErrors += 1; });
const api = async (url) => (await context.request.get(`${BASE}${url}`)).json();
await page.goto(`${BASE}#/import`);
await page.getByLabel('Passphrase').fill(PASSPHRASE);
await page.getByRole('button', { name: 'Sign in' }).click();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose folder' }).first().click()]);
await chooser.setFiles(folder);
for (let i = 0; i < 200; i++) {
  const b = (await api('api/import-batches')).batches[0];
  if (b && b.total === 2 && !b.counts.waiting && !b.counts.reading) break;
  await sleep(200);
}
for (let i = 0; i < 100 && (await page.getByText(/^Sending /).isVisible()); i++) await sleep(200);
await sleep(1000);
const docs = async () => (await api('api/documents')).documents;
const observations = async () => (await api('api/observations')).observations;
const openWrong = async () => {
  await page.goto(`${BASE}#/documents`);
  await page.reload();
  await page.getByText('wrong person mri.pdf').first().click();
  await page.getByRole('button', { name: 'Delete document' }).waitFor();
};

console.log('\n--- Asking first');
await openWrong();
await page.getByRole('button', { name: 'Delete document' }).click();
const dialog = page.getByRole('dialog', { name: 'Delete this document' });
await dialog.waitFor();
let text = await dialog.innerText();
ok('it names the file', text.includes('wrong person mri.pdf'));
ok('it says it is permanent, and about backups and the folder', text.includes('cannot be undone') && text.includes('Backups you already made') && text.includes('import it again'));
ok('the safe choice has the focus', await page.getByRole('button', { name: 'Cancel' }).evaluate((b) => b === document.activeElement));
ok('nothing is gone yet', (await docs()).length === 2 && fs.existsSync(stored(wrongSha)));
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });
ok('Escape cancels', (await docs()).length === 2);
await page.getByRole('button', { name: 'Delete document' }).click();
await page.getByRole('button', { name: 'Cancel' }).click();
ok('Cancel cancels', (await docs()).length === 2 && fs.existsSync(stored(wrongSha)));

console.log('\n--- Deleting');
const mine = (await docs()).find((d) => d.sha256 === mineSha);
const mineDetail = await api(`api/documents/${mine.id}`);
const mineResults = (await observations()).filter((o) => o.document_id === mine.id);
await page.getByRole('button', { name: 'Delete document' }).click();
await page.getByRole('button', { name: 'Delete permanently' }).click();
await dialog.waitFor({ state: 'detached' });
await page.getByText('wrong person mri.pdf').first().waitFor({ state: 'detached' });
ok('it leaves the Documents screen', !(await page.locator('main').innerText()).includes('wrong person mri.pdf'));
ok('the file is gone from the disk', !fs.existsSync(stored(wrongSha)));
ok('your other document is untouched', JSON.stringify(await api(`api/documents/${mine.id}`)) === JSON.stringify(mineDetail) && fs.readFileSync(stored(mineSha)).length > 0 && hash(fs.readFileSync(stored(mineSha))) === mineSha);
const left = await observations();
ok('only its results went', JSON.stringify(left.filter((o) => o.document_id === mine.id)) === JSON.stringify(mineResults) && left.length === mineResults.length, left.length);
ok('nothing was approved', left.every((o) => o.verification_status === 'proposed'));
const batch = (await api('api/import-batches')).batches[0];
const rows = (await api(`api/import-batches/${batch.id}/items`)).items;
ok('the report and Documents agree', rows.length === 1 && rows[0].document_id === mine.id && batch.total === 1 && (await docs()).length === 1);
await page.goto(`${BASE}#/import`);
await page.getByRole('heading', { name: 'Import report' }).waitFor();
text = await page.locator('main').innerText();
ok('the report on screen no longer names it', !text.includes('wrong person mri'));

console.log('\n--- After a kill and restart');
await new Promise((r) => { service.on('exit', r); service.kill('SIGKILL'); });
await start();
const health = await api('api/backups/archive-health');
ok('it does not come back', health.recovered === 0 && (await docs()).length === 1 && !fs.existsSync(stored(wrongSha)), health.recovered);
const sqlite = fs.readdirSync(DATA).filter((n) => n.startsWith('archive.sqlite')).map((n) => fs.readFileSync(path.join(DATA, n)));
ok('the database no longer holds its name', !sqlite.some((b) => b.includes('wrong person mri')));
ok('no page errors', pageErrors === 0, pageErrors);
await browser.close();
service.kill('SIGKILL');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${results.pass} of ${results.pass + results.fail} checks passed.`);
process.exit(results.fail ? 1 : 0);
