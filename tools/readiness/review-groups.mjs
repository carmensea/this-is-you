// Group review in Chrome, on a temp archive of fictional reports, with real restarts. Never touches a running archive.
//   npm run build && npm run readiness:review
import { chromium } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const PY = path.join(REPO, 'backend/.venv/bin/python');
const API = 8128, WEB = 5198, BASE = `http://127.0.0.1:${WEB}/`;
const PASSPHRASE = 'fictional passphrase for review groups';
const HEADERS = { 'X-This-Is-You-Client': '1', 'Content-Type': 'application/json' };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-review-'));
const env = { ...process.env, THIS_IS_YOU_DATA_DIR: path.join(dir, 'archive'), THIS_IS_YOU_PORT: String(API) };
const results = { pass: 0, fail: 0 };
const ok = (name, value, detail = '') => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  results[value ? 'pass' : 'fail'] += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const folder = path.join(dir, 'Fictional Records');
fs.mkdirSync(folder);
execFileSync(PY, ['-c', `
import sys
sys.path.insert(0, 'backend')
from tests import pdfs
head = ['Fictional Portal', 'Patient: Avery Testperson', 'Collected on Mar 5, 2024 9:12 AM', 'Result Date: Mar 6, 2024', 'Component Your Value Standard Range Flag']
cbc = ['WBC 6.2 x10E3/uL 3.4 - 10.8 x10E3/uL', 'Hemoglobin 13.9 g/dL 11.1 - 15.9 g/dL', 'Platelets 451 x10E3/uL 150 - 450 x10E3/uL High', 'MCV 89 fL 79 - 97 fL', 'Hematocrit 41.2 % 34.0 - 46.6 %']
metabolic = ['Glucose 90 mg/dL 65 - 99 mg/dL', 'Sodium 140 mmol/L 134 - 144 mmol/L']
doubts = ['Fictional Marker Alpha 12', 'RBC', '4.61', '3.77 - 5.28', 'Hemoglobin A1c 5.4 %', 'Calcium', 'Standard Range: 8.6 - 10.2 mg/dL']
open(sys.argv[1], 'wb').write(pdfs.text_pdf(head + cbc + metabolic + doubts))
`, path.join(folder, 'fictional cbc.pdf')], { cwd: REPO });
spawnSync(PY, ['-m', 'this_is_you', 'set-passphrase'], { cwd: REPO, env, input: `${PASSPHRASE}\n` });

let service = null;
const start = async () => {
  service = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env, stdio: 'ignore' });
  for (let i = 0; i < 200; i++) {
    if (await fetch(`http://127.0.0.1:${API}/api/status`).then((r) => r.ok, () => false)) return;
    await sleep(100);
  }
  throw new Error('the service did not start');
};
const crash = async () => {
  const dead = service;
  dead.kill('SIGKILL');
  await new Promise((r) => dead.on('exit', r));
};
process.on('exit', () => service?.kill('SIGKILL'));
await start();

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
const web = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    const up = http.request({ agent: false, host: '127.0.0.1', port: API, path: req.url, method: req.method, headers: req.headers }, (r) => {
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
    return;
  }
  const file = path.join(REPO, 'dist', url === '/' ? 'index.html' : path.normalize(url));
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(WEB, '127.0.0.1');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const outside = [];
await context.route(/^https?:/, (route) => {
  const host = new URL(route.request().url()).hostname;
  if (host === '127.0.0.1') return route.continue();
  outside.push(host);
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// The same session as the browser, for what another tab or an inspection would do. Never for the approvals under test.
const inPage = (url, init) => page.evaluate(async ([u, i]) => {
  const r = await fetch(u, i);
  return { status: r.status, body: await r.json().catch(() => null) };
}, [url, init]);
const rows = async () => (await inPage('/api/observations', {})).body.observations;
const named = async (name) => (await rows()).find((o) => o.reported_name === name);
const otherTab = (url, body) => inPage(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });

await page.goto(`${BASE}#/import`);
await page.getByLabel('Passphrase').fill(PASSPHRASE);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('button', { name: 'Choose folder' }).first().waitFor();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose folder' }).first().click()]);
await chooser.setFiles(folder);
for (let i = 0; i < 80; i++) {
  if ((await rows()).length) break;
  await sleep(250);
}
const proposedOnly = (all) => all.every((o) => o.verification_status === 'proposed');
const openReview = async () => {
  await page.goto(`${BASE}#/import`);
  await page.reload();
  const button = page.getByRole('button', { name: 'Review', exact: true }).first();
  await button.waitFor();
  await button.click();
  await page.getByRole('region', { name: 'Extracted values' }).waitFor();
};

console.log('\n--- The table');
await openReview();
let all = await rows();
ok('reading and opening review approved nothing', all.length > 0 && proposedOnly(all), `${all.length} results`);
let body = await page.locator('main').innerText();
ok('the old bulk shortcut is gone', !/high-confidence|Accept all/.test(body));
const cbc = page.getByRole('region', { name: 'Complete blood count' });
const metabolic = page.getByRole('region', { name: 'Metabolic panel' });
const cbcText = await cbc.innerText();
for (const text of ['WBC', '6.2', 'x10E3/uL', '3.4-10.8', 'Platelets', 'High', '5 Mar 2024', 'p.1 l.']) ok(`the table shows ${text}`, cbcText.includes(text));
ok('the original is beside it', (await page.locator('[aria-label^="Original file"]').count()) >= 1);
const box1 = await page.locator('[aria-label^="Original file"]').first().boundingBox();
const drawn = page.locator('[aria-label^="Original file"] canvas').first();
await drawn.waitFor();
await page.waitForFunction(() => { const c = document.querySelector('[aria-label^="Original file"] canvas'); return c && c.width > 300 && c.getContext('2d').getImageData(c.width >> 1, 200, 1, 1).data[3] > 128; });
ok('and is really drawn in the review screen', true);
await page.getByRole('button', { name: 'Open page 1 larger' }).click();
await page.locator('dialog[open]').waitFor();
ok('clicking it enlarges it in this tab', context.pages().length === 1);
await page.keyboard.press('Escape');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
const box2 = await cbc.boundingBox();
ok('side by side at this width', box1.x + box1.width <= box2.x && box2.y < box1.y + box1.height);
ok('the table fits its column', box2.x + box2.width <= 1440);
const approveCbc = cbc.getByRole('button', { name: /^Approve/ });
const allMatch = (table) => table.getByRole('checkbox', { name: /match the original$/ });
const tickAll = async (table) => { await allMatch(table).check(); };
console.log('\n--- The PDF over the numbers');
const strips = cbc.locator('canvas[data-row-strip]');
await page.waitForFunction(() => [...document.querySelectorAll('canvas[data-row-strip]')].every((c) => c.width > 0));
ok('every row has its line of the PDF', (await strips.count()) === 5, await strips.count());
const inked = await page.evaluate(() => [...document.querySelectorAll('canvas[data-row-strip]')].map((c) => {
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128 && data[i] < 128) dark += 1;
  return dark;
}));
ok('each strip has printed text on it', inked.length >= 5 && inked.every((n) => n > 20), inked.join());
const stripBoxes = await strips.evaluateAll((all) => all.map((c) => c.getBoundingClientRect().width));
ok('strips of a table are one width, so columns line up', new Set(stripBoxes.map(Math.round)).size === 1, stripBoxes[0]);
const crops = await page.evaluate(() => [...document.querySelectorAll('canvas[data-row-strip]')].map((c) => c.height));
ok('a strip is one printed row, not the whole page', crops.every((h) => h < 200), crops.join());
ok('approve is off until the rows are ticked', await approveCbc.isDisabled());
await strips.first().click();
await page.locator('dialog[open]').waitFor();
ok('clicking a strip enlarges its page in this tab', context.pages().length === 1);
await page.keyboard.press('Escape');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
await cbc.getByRole('checkbox', { name: 'WBC matches the original' }).check();
ok('one row ticked is not enough', await approveCbc.isDisabled());
await cbc.getByRole('checkbox', { name: 'WBC matches the original' }).uncheck();
await tickAll(cbc);
ok('the top box ticks every row', await cbc.getByRole('checkbox', { name: 'Hemoglobin matches the original' }).isChecked() && await approveCbc.isEnabled());
ok('ticking approves nothing by itself', proposedOnly(await rows()));
await page.screenshot({ path: path.join(HERE, 'results', 'review-strips.png'), fullPage: true }).catch(() => {});
await allMatch(cbc).uncheck();
ok('the top box unticks them too', await approveCbc.isDisabled());
ok('the button names the count and the date', (await approveCbc.innerText()) === 'Approve 5 results collected 5 March 2024', await approveCbc.innerText());
ok('categories have separate tables and buttons', (await metabolic.getByRole('button', { name: /^Approve/ }).innerText()) === 'Approve 2 results collected 5 March 2024');
body = await page.locator('main').innerText();
ok('uncertain results are listed separately', body.includes('Review individually') && !cbcText.includes('Fictional Marker') && body.includes('Fictional Marker Alpha'));
ok('with their reasons', body.includes('not in the known list') && body.includes('No value could be read'));
ok('a word or partial row has no way into the table', !cbcText.includes('Calcium') && !cbcText.includes('RBC'));
await page.screenshot({ path: path.join(HERE, 'results', 'review-table.png'), fullPage: true }).catch(() => {});

console.log('\n--- A correction in the table');
await cbc.getByRole('row').filter({ hasText: 'WBC' }).getByRole('button', { name: 'Edit' }).click();
await page.getByLabel('Value', { exact: true }).fill('6.3');
await page.getByRole('button', { name: 'Save correction' }).click();
await page.getByText('6.3').first().waitFor();
let wbc = await named('WBC');
ok('the correction is saved and still needs approving', wbc.value_text === '6.3' && wbc.verification_status === 'proposed' && wbc.group_eligible === true);
ok('the original reading is kept', wbc.original.value_text === '6.2' && wbc.revisions.map((r) => r.action).join() === 'extracted,corrected');
ok('it stays in the table', (await cbc.innerText()).includes('6.3') && (await approveCbc.innerText()).startsWith('Approve 5 results'));

console.log('\n--- Stale groups');
const hgb = await named('Hemoglobin');
await otherTab(`/api/observations/${hgb.id}/correct`, { fields: { value_text: '14.0' } });
ok('the page still shows the old value', (await cbc.innerText()).includes('13.9'));
await tickAll(cbc);
await approveCbc.click();
await page.getByRole('alert').filter({ hasText: 'nothing was approved' }).waitFor();
all = await rows();
ok('an edit from elsewhere stops the whole group, with nothing approved', proposedOnly(all));
await page.getByText('14.0').first().waitFor();
ok('the table catches up to show what changed', (await cbc.innerText()).includes('14.0'));
ok('the changed row has to be ticked again, and the others stay ticked', !(await cbc.getByRole('checkbox', { name: 'Hemoglobin matches the original' }).isChecked()) && await cbc.getByRole('checkbox', { name: 'MCV matches the original' }).isChecked());
const mcv = await named('MCV');
await otherTab(`/api/observations/${mcv.id}/verify`, {});
await tickAll(cbc);
await approveCbc.click();
await page.getByRole('alert').filter({ hasText: 'nothing was approved' }).waitFor();
all = await rows();
ok('a row accepted elsewhere also stops the group, and the rest stay in review', all.filter((o) => o.verification_status === 'verified').length === 1);
await otherTab(`/api/observations/${mcv.id}/reopen`, {});
await page.reload();
await page.getByRole('button', { name: 'Review', exact: true }).first().click();
await cbc.waitFor();

console.log('\n--- A partial failure');
const shown = (await rows()).filter((o) => o.group_eligible && o.review_group_label === 'Complete blood count');
const bad = await otherTab('/api/observations/approve-group', { document_id: shown[0].document_id, group: shown[0].review_group, collected_on: shown[0].collected_on, items: [...shown.slice(1).map((o) => ({ id: o.id, version: o.version })), { id: 'f'.repeat(32), version: 1 }] });
ok('a set with one wrong row is refused whole', bad.status === 409 && proposedOnly(await rows()));
const partial = await otherTab('/api/observations/approve-group', { document_id: shown[0].document_id, group: shown[0].review_group, collected_on: shown[0].collected_on, items: shown.slice(1).map((o) => ({ id: o.id, version: o.version })) });
ok('so is a set with one row left out', partial.status === 409 && proposedOnly(await rows()));

console.log('\n--- Restart with a table on screen');
const count = await approveCbc.innerText();
await tickAll(cbc);
await crash();
await start();
await approveCbc.click();
await sleep(1500);
all = await rows();
ok('after a crash, a table still shown can be approved, as nothing changed', all.filter((o) => o.verification_status === 'verified').length === 5, count);
await otherTab('/api/observations/group-approvals/' + (await named('WBC')).approved_group_id + '/undo', {});
await openReview();
const afterCrash = await rows();
ok('undo works after the restart too', afterCrash.every((o) => o.verification_status !== 'verified'));

console.log('\n--- Approve');
await tickAll(cbc);
await cbc.getByRole('button', { name: /^Approve/ }).click();
await page.getByRole('button', { name: 'Undo group approval' }).waitFor();
all = await rows();
const approved = all.filter((o) => o.verification_status === 'verified');
const group = approved[0]?.approved_group_id;
ok('exactly the five shown are approved', approved.length === 5 && approved.every((o) => o.approved_group_id === group && o.review_group_label === 'Complete blood count'));
ok('each records its group and when', approved.every((o) => o.revisions.at(-1).review_group_id === group && o.revisions.at(-1).action === 'verified' && o.revisions.at(-1).occurred_at));
ok('nothing else changed', all.filter((o) => o.verification_status === 'proposed').length === all.length - 5);
ok('the metabolic table is still waiting', await metabolic.getByRole('button', { name: /^Approve/ }).isVisible());
body = await page.locator('main').innerText();
ok('the screen says what was approved together', body.includes('5 results collected 5 March 2024 were approved as a group on'));
await page.goto(`${BASE}#/biomarkers`);
await page.waitForSelector('main');
await page.getByText('Hemoglobin').first().waitFor();
ok('approved results reach Biomarkers', (await page.locator('main').innerText()).includes('Hemoglobin'));

console.log('\n--- Restart');
await crash();
await start();
await openReview();
all = await rows();
ok('approval survives a crash', all.filter((o) => o.approved_group_id === group).length === 5);
ok('undo is still offered', await page.getByRole('button', { name: 'Undo group approval' }).isVisible());

console.log('\n--- Undo');
const historyBefore = (await named('WBC')).revisions.length;
await page.getByRole('button', { name: 'Undo group approval' }).click();
await cbc.getByRole('button', { name: /^Approve/ }).waitFor();
all = await rows();
wbc = await named('WBC');
ok('the results return to review', all.every((o) => o.verification_status === 'proposed' && !o.approved_group_id));
ok('and to the table', (await cbc.getByRole('button', { name: /^Approve/ }).innerText()).startsWith('Approve 5 results'));
ok('the whole history is kept', wbc.revisions.length === historyBefore + 1 && wbc.revisions.at(-1).action === 'reopened' && wbc.revisions.filter((r) => r.action === 'corrected').length === 1 && wbc.original.value_text === '6.2');
const stale = await otherTab(`/api/observations/group-approvals/${group}/undo`, {});
ok('a second undo is refused', stale.status === 409);
await page.goto(`${BASE}#/biomarkers`);
await page.waitForSelector('main');
ok('undone results leave the charts', !(await page.locator('main').innerText()).includes('Hemoglobin'));

console.log('\n--- Restart again, then a new approval');
await crash();
await start();
await openReview();
await tickAll(cbc);
await cbc.getByRole('button', { name: /^Approve/ }).click();
await page.getByRole('button', { name: 'Undo group approval' }).waitFor();
all = await rows();
const again = all.filter((o) => o.verification_status === 'verified');
ok('a new approval is a new group', again.length === 5 && again[0].approved_group_id !== group);
ok('with the earlier one still in the history', (await named('WBC')).revisions.some((r) => r.review_group_id === group));

console.log('\n--- Individual review is still there');
const marker = await named('Fictional Marker Alpha');
const line = page.locator('main').getByText('Fictional Marker Alpha', { exact: true }).first();
await line.waitFor();
const rowEl = page.locator('div', { has: page.getByText('Fictional Marker Alpha', { exact: true }) }).last();
await rowEl.getByRole('button', { name: 'Accept' }).click().catch(async () => {
  await page.locator('section[aria-label="Extracted values"] div').filter({ hasText: 'Fictional Marker Alpha' }).last().getByRole('button', { name: 'Accept' }).click();
});
await sleep(800);
const accepted = (await rows()).find((o) => o.id === marker.id);
ok('an uncertain result can be accepted alone, with no group', accepted.verification_status === 'verified' && !accepted.approved_group_id);
const calcium = (await rows()).find((o) => o.reported_name === 'Calcium');
const refused = await otherTab(`/api/observations/${calcium.id}/verify`, {});
ok('one with no value cannot be accepted', refused.status === 422);

console.log('\n--- The rest of the app');
await page.setViewportSize({ width: 390, height: 900 });
await openReview();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok('no sideways scrolling at phone width', overflow <= 0, `${overflow}px`);
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${BASE}?demo#/import`);
await page.waitForSelector('main');
ok('the demo opens, with no bulk shortcut', (await page.locator('body').innerText()).includes('DEMONSTRATION') && !/high-confidence|Accept all|Confirm all/.test(await page.locator('body').innerText()));
ok('no outside requests', outside.length === 0, outside.join());
ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
web.close();
service.kill('SIGTERM');
fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
console.log(`\n${results.pass} of ${results.pass + results.fail} checks passed.`);
process.exit(results.fail ? 1 : 0);
