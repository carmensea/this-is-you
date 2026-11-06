// Reviewing one report in Chrome, on a temp archive of fictional results. Never touches a running archive.
//   npm run build && npm run readiness:review [-- --shots <folder>]
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
const PASSPHRASE = 'fictional passphrase for review';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-review-'));
const env = { ...process.env, THIS_IS_YOU_DATA_DIR: path.join(dir, 'archive'), THIS_IS_YOU_PORT: String(API) };
const results = { pass: 0, fail: 0 };
const ok = (name, value, detail = '') => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  results[value ? 'pass' : 'fail'] += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every name, value and date in this report is invented.
const folder = path.join(dir, 'Fictional Records');
fs.mkdirSync(folder);
execFileSync(PY, ['-c', `
import sys
sys.path.insert(0, 'backend')
from tests import pdfs
head = ['Fictional Family Health Portal', 'Fictional Lakeside Laboratory', 'Patient: Avery Testperson', 'Specimen Collected: 03/04/2025 08:40', 'Result Date: 03/05/2025', 'Component Your Value Standard Range Flag']
urine = ['Urinalysis', 'Specific Gravity 1.015 1.005 - 1.030', 'pH, Urine 6.0 5.0 - 8.0', 'Protein, Urine Negative Negative', 'Glucose, Urine Negative Negative',
         'Ketones, Urine Negative Negative', 'Blood, Urine Trace Negative', 'Nitrite, Urine Negative Negative', 'Urobilinogen 0.2 mg/dL 0.2 - 1.0 mg/dL']
micro = ['Microscopic Examination', 'WBC, Urine', '0-2 /HPF', '0 - 5 /HPF', 'RBC, Urine', '3-5 /HPF', '0 - 2 /HPF', 'Squamous Epithelial Cells', 'Few',
         'Bacteria', 'Moderate', 'None seen', 'Hyaline Casts', '0-2/LPF0-2/LPF']
cmp = ['Comprehensive Metabolic Panel', 'Glucose 92 mg/dL 70 - 99 mg/dL', 'BUN 1.4 mg/dL 6 - 20 mg/dL', 'Creatinine 0.86 mg/dL 0.57 - 1.00 mg/dL',
       'Sodium 139 mmol/L 134 - 144 mmol/L', 'Potassium 4.2 mmol/L 3.5 - 5.2 mmol/L', 'Chloride 101 mmol/L 96 - 106 mmol/L', 'Carbon Dioxide, Total 24 mmol/L 20 - 29 mmol/L',
       'Calcium 9.4 mg/dL 8.7 - 10.2 mg/dL', 'Protein, Total 7.0 g/dL 6.0 - 8.5 g/dL', 'Albumin 4.5 g/dL 3.9 - 4.9 g/dL', 'Globulin, Total 2.5 g/dL 15 - 45 g/L',
       'Bilirubin, Total 0.4 mg/dL 0.0 - 1.2 mg/dL', 'Alkaline Phosphatase 72 IU/L 44 - 121 IU/L', 'AST (SGOT) 19 IU/L 0 - 40 IU/L', 'ALT (SGPT) 22 IU/L 0 - 32 IU/L']
other = ['Other Tests', 'Hemoglobin A1c 5.4 % 4.8 - 5.6 %', 'TSH 2.100 uIU/mL 0.450 - 4.500 uIU/mL', 'Ferritin 48 ng/mL 15 - 150 ng/mL',
         'Hemoglobin 13.9 g/dL 11.1 - 15.9 g/dL', 'Hematocrit 41.2 % 34.0 - 46.6 %', 'Platelets 251 x10E3/uL 150 - 450 x10E3/uL', 'Results reviewed by fictional staff.']
open(sys.argv[1], 'wb').write(pdfs.text_pdf(head + urine + micro, head + cmp + other))
`, path.join(folder, 'fictional urinalysis and chemistry.pdf')], { cwd: REPO });
spawnSync(PY, ['-m', 'this_is_you', 'set-passphrase'], { cwd: REPO, env, input: `${PASSPHRASE}\n` });

let service = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env, stdio: 'ignore' });
process.on('exit', () => service.kill('SIGKILL'));
for (let i = 0; i < 200; i++) {
  if (await fetch(`http://127.0.0.1:${API}/api/status`).then((r) => r.ok, () => false)) break;
  await sleep(100);
}

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.mjs': 'text/javascript' };
const web = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    const up = http.request({ agent: false, host: '127.0.0.1', port: API, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => {
      if (!res.destroyed) { res.writeHead(502); res.end(); }
    });
    req.pipe(up);
    return;
  }
  const file = path.join(REPO, 'dist', url === '/' ? 'index.html' : path.normalize(url));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(WEB, '127.0.0.1');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
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
const shot = async (name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const inPage = (url, init) => page.evaluate(async ([u, i]) => {
  const r = await fetch(u, i);
  return { status: r.status, body: await r.json().catch(() => null) };
}, [url, init]);
const rows = async () => (await inPage('/api/observations', {})).body.observations;
const status = async (name) => (await rows()).find((o) => o.reported_name === name)?.verification_status;
const settle = async (check) => {
  for (let i = 0; i < 40; i++) {
    if (await check()) return true;
    await sleep(150);
  }
  return false;
};
const list = page.getByRole('list', { name: 'Measurements, in the order printed' });
const row = (name) => list.locator('[data-row]').filter({ has: page.locator('button[aria-expanded] > span:first-child', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
const select = async (name) => {
  await row(name).locator('button[aria-expanded]').focus();
};

await page.goto(`${BASE}#/import`);
await page.getByLabel('Passphrase').fill(PASSPHRASE);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('button', { name: 'Choose folder' }).first().waitFor();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose folder' }).first().click()]);
await chooser.setFiles(folder);
await settle(async () => (await rows()).length > 0);
await page.reload();
await page.getByRole('button', { name: 'Review', exact: true }).first().click();
await page.getByRole('region', { name: 'Extracted values' }).waitFor();
await page.waitForFunction(() => {
  const c = document.querySelector('[aria-label^="Original file"] canvas');
  return c && c.width > 300 && c.getContext('2d').getImageData(c.width >> 1, 200, 1, 1).data[3] > 128;
});

console.log('\n--- What was read');
const all = await rows();
ok('opening review approved nothing', all.length > 0 && all.every((o) => o.verification_status === 'proposed'), `${all.length} results`);
const names = await list.locator('[data-row] button[aria-expanded] > span:first-child').allInnerTexts();
const printed = [...all].sort((a, b) => a.source_page - b.source_page || a.source_line - b.source_line).map((o) => o.reported_name);
ok('rows are in the order printed', JSON.stringify(names) === JSON.stringify(printed));
const EXPECTED = ['Specific Gravity', 'pH, Urine', 'Protein, Urine', 'Glucose, Urine', 'Ketones, Urine', 'Blood, Urine', 'Nitrite, Urine', 'Urobilinogen',
  'WBC, Urine', 'RBC, Urine', 'Squamous Epithelial Cells', 'Bacteria', 'Hyaline Casts',
  'Glucose', 'BUN', 'Creatinine', 'Sodium', 'Potassium', 'Chloride', 'Carbon Dioxide, Total', 'Calcium', 'Protein, Total', 'Albumin', 'Globulin, Total',
  'Bilirubin, Total', 'Alkaline Phosphatase', 'AST (SGOT)', 'ALT (SGPT)', 'Hemoglobin A1c', 'TSH', 'Ferritin', 'Hemoglobin', 'Hematocrit', 'Platelets'];
ok('every printed result was proposed, and nothing else: no headings or notes', JSON.stringify(names) === JSON.stringify(EXPECTED), names.filter((n) => !EXPECTED.includes(n)).join(', '));
const read = Object.fromEntries(all.map((o) => [o.reported_name, o]));
ok('each keeps its page, line and printed text', all.every((o) => o.source_page >= 1 && o.source_line >= 1 && o.source_text.startsWith(o.reported_name)));
ok('the microscopy cells keep their own printed text', read['WBC, Urine'].source_text === 'WBC, Urine | 0-2 /HPF | 0 - 5 /HPF' && read['Hyaline Casts'].source_text === 'Hyaline Casts | 0-2/LPF0-2/LPF');
ok('the unread value is proposed empty, saying what was printed', read['Hyaline Casts'].value_text === '' && read['Hyaline Casts'].issues.some((i) => i.includes('0-2/LPF0-2/LPF')));
for (const [name, value] of [['WBC, Urine', '0-2'], ['Squamous Epithelial Cells', 'Few'], ['Bacteria', 'Moderate'], ['Hyaline Casts', 'Not read']]) {
  ok(`${name} reads as ${value}`, (await row(name).innerText()).includes(value));
}
ok('no select-all or group approval', (await page.getByRole('checkbox').count()) === 0 && (await page.getByRole('button', { name: /^Approve/ }).count()) === 0);
ok('the unread value asks for one, and offers no Accept', /Enter value/.test(await row('Hyaline Casts').innerText()) && !/Accept/.test(await row('Hyaline Casts').innerText()));
ok('a doubted result asks for a look first', /Check/.test(await row('Globulin, Total').innerText()));
await shot('1-start');

console.log('\n--- Deciding');
await page.getByRole('button', { name: 'Confirm' }).first().waitFor();
while ((await page.getByRole('region', { name: 'Document details' }).getByRole('button', { name: 'Confirm' }).count()) > 0) {
  await page.getByRole('region', { name: 'Document details' }).getByRole('button', { name: 'Confirm' }).first().click();
  await sleep(250);
}
// A detail nothing was proposed for is marked as not stated, as a person would after checking the original.
const details = page.getByRole('region', { name: 'Document details' });
while ((await details.getByRole('button', { name: 'Not stated' }).count()) > 0) {
  await details.getByRole('button', { name: 'Not stated' }).first().click();
  await sleep(250);
}
ok('the details fold away once all are decided', await settle(async () => (await details.innerText()).includes('All 4 decided')));
await select('Specific Gravity');
for (const name of ['Specific Gravity', 'pH, Urine', 'Protein, Urine', 'Glucose, Urine']) {
  await page.keyboard.press('a');
  ok(`A accepts ${name}`, await settle(async () => (await status(name)) === 'verified'), (await rows()).find((o) => o.reported_name === name)?.issues.join(' '));
  await settle(async () => /Accepted/.test(await row(name).innerText()));
}
await page.keyboard.press('r');
ok('R rejects Ketones, Urine', await settle(async () => (await status('Ketones, Urine')) === 'rejected'));
for (const name of ['Blood, Urine', 'Nitrite, Urine', 'Urobilinogen', 'WBC, Urine', 'RBC, Urine', 'Squamous Epithelial Cells', 'Bacteria']) {
  await row(name).getByRole('button', { name: /^Accept / }).click();
  ok(`one click accepts ${name}`, await settle(async () => (await status(name)) === 'verified'));
}
await select('Nitrite, Urine');
await page.keyboard.press('u');
ok('U undoes an acceptance', await settle(async () => (await status('Nitrite, Urine')) === 'proposed'));
await settle(async () => !/Accepted/.test(await row('Nitrite, Urine').innerText()));
await page.keyboard.press('r');
ok('and R then rejects it instead', await settle(async () => (await status('Nitrite, Urine')) === 'rejected'));

console.log('\n--- Keyboard and screen reader');
await select('Hyaline Casts');
await page.keyboard.press('c');
ok('C opens the correction form with the focus in it', await page.evaluate(() => document.activeElement?.closest('[data-editing]') !== null && document.activeElement?.tagName === 'INPUT'));
await page.keyboard.press('Escape');
ok('Escape closes it and puts the focus back on its row', await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? '').startsWith('Hyaline Casts: no value read')));
await page.keyboard.press('Tab');
ok('Tab goes from a row to its own action', /Enter the value for Hyaline Casts/.test(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')));
const unnamed = await page.getByRole('region', { name: 'Extracted values' }).evaluate((section) =>
  [...section.querySelectorAll('button, input, select, textarea, a[href]')].filter((el) => {
    const label = el.getAttribute('aria-label') || el.textContent?.trim() || (el.id && section.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest('label')?.textContent?.trim();
    return !label;
  }).length);
ok('every control on the review panel has a name', unnamed === 0, `${unnamed} without`);
ok('progress is announced politely as it changes', /of 34 measurements decided/.test(await page.getByRole('status').first().innerText()));
const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
ok('the focused control shows a focus ring', ring !== 'none', ring);
await row('Hyaline Casts').getByRole('button', { name: 'Enter the value for Hyaline Casts' }).click();
const value = page.getByLabel('Value', { exact: true });
await value.fill('');
await value.press('a');
await value.press('r');
ok('keys typed into the form decide nothing', (await status('Hyaline Casts')) === 'proposed' && (await value.inputValue()) === 'ar');
await value.fill('0-2');
await page.getByLabel('Unit', { exact: true }).fill('/LPF');
await page.getByLabel('Reference range').fill('0-2');
await shot('3-unreadable-value');
await page.getByRole('button', { name: 'Save and accept' }).click();
ok('an unread value is entered and accepted together', await settle(async () => (await rows()).some((o) => o.reported_name === 'Hyaline Casts' && o.verification_status === 'verified' && o.value_text === '0-2')));

for (const name of ['Glucose', 'Creatinine']) {
  await row(name).getByRole('button', { name: /^Accept / }).click();
  await settle(async () => (await status(name)) === 'verified');
}
await row('BUN').locator('button[aria-expanded]').click();
await row('BUN').getByRole('button', { name: 'Correct' }).click();
await page.getByLabel('Value', { exact: true }).fill('14');
await page.getByRole('button', { name: 'Save and accept' }).click();
const bun = await settle(async () => (await rows()).some((o) => o.reported_name === 'BUN' && o.value_text === '14' && o.verification_status === 'verified' && o.edited));
ok('a misread value is corrected and accepted, with what was read first kept', bun);
await row('BUN').locator('button[aria-expanded]').click();
await row('BUN').getByText('Source and details').click();
ok('the correction shows what was first read', /First read as BUN 1\.4 mg\/dL/.test(await row('BUN').innerText()));
await row('BUN').locator('button[aria-expanded]').click();

await row('Ketones, Urine').locator('button[aria-expanded]').click();
ok('a rejected suggestion says it is kept in the history', /Left out of your verified records, and kept here and in the review history/.test(await row('Ketones, Urine').innerText()));
await row('Ketones, Urine').locator('button[aria-expanded]').click();

await row('Ketones, Urine').evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -110); });
await shot('2a-halfway-decided');

console.log('\n--- After reload, reopening and a restart');
const states = async () => Object.fromEntries(await Promise.all(['Specific Gravity', 'Ketones, Urine', 'Nitrite, Urine', 'BUN', 'Hyaline Casts', 'Sodium'].map(async (n) => [n, (await row(n).innerText()).replace(/\s+/g, ' ')])));
const reopen = async () => {
  await page.goto(`${BASE}#/import`);
  await page.reload();
  await page.getByRole('button', { name: 'Review', exact: true }).first().click();
  await page.getByRole('region', { name: 'Extracted values' }).waitFor();
  await row('Sodium').waitFor();
};
const shown = await states();
const checkKept = async (when) => {
  const now = await states();
  ok(`${when}: every row shows the same decision`, JSON.stringify(now) === JSON.stringify(shown));
  ok(`${when}: accepted, corrected and rejected each read as such`, /Accepted/.test(now['Specific Gravity']) && /Corrected.*14.*Accepted/.test(now.BUN) && /Rejected/.test(now['Ketones, Urine']) && /Accept/.test(now.Sodium) && !/Accepted/.test(now.Sodium));
  const kept = await rows();
  const bunNow = kept.find((o) => o.reported_name === 'BUN');
  ok(`${when}: the correction keeps what was first read`, bunNow.original.value_text === '1.4' && bunNow.value_text === '14');
  const actions = bunNow.revisions.map((r) => r.action);
  ok(`${when}: its history lists each step`, actions[0] === 'extracted' && actions.includes('corrected') && actions.at(-1) === 'verified', actions.join(' > '));
  const nitrite = kept.find((o) => o.reported_name === 'Nitrite, Urine').revisions.map((r) => r.action);
  ok(`${when}: an undone decision stays in the history`, JSON.stringify(nitrite.slice(1)) === JSON.stringify(['verified', 'reopened', 'rejected']), nitrite.join(' > '));
};
await reopen();
await checkKept('after a reload');
await page.getByRole('button', { name: '‹ Review queue' }).click().catch(() => {});
await reopen();
await checkKept('after leaving and reopening');
service.kill('SIGTERM');
await new Promise((r) => service.on('exit', r));
service = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env, stdio: 'ignore' });
for (let i = 0; i < 200; i++) {
  if (await fetch(`http://127.0.0.1:${API}/api/status`).then((r) => r.ok, () => false)) break;
  await sleep(100);
}
await reopen();
if (await page.getByLabel('Passphrase').isVisible().catch(() => false)) {
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await reopen();
}
await checkKept('after the service restarts');

console.log('\n--- The original');
await row('Globulin, Total').getByRole('button', { name: 'Check Globulin, Total before deciding' }).click();
await page.locator('[data-source-mark]').waitFor();
const mark = await page.locator('[data-source-mark]').boundingBox();
const viewer = await page.locator('[aria-label^="Original file"] [role="toolbar"] + div').boundingBox();
ok('the selected line is marked in the original, in view', !!mark && mark.y >= viewer.y && mark.y + mark.height <= viewer.y + viewer.height);
const before = await page.evaluate(() => window.scrollY);
await page.locator('[aria-label^="Original file"] [role="toolbar"] + div').evaluate((el) => { el.scrollTop += 300; });
ok('the original scrolls on its own, without moving the page', (await page.evaluate(() => window.scrollY)) === before);
await row('Globulin, Total').locator('button[aria-expanded]').focus();
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowUp');
await row('Globulin, Total').getByRole('button', { name: 'Check Globulin, Total before deciding' }).click();
await sleep(500);
await shot('2b-halfway-check');
const width = async () => page.locator('[aria-label^="Original file"] [data-pdf-page="2"] canvas').evaluate((c) => c.getBoundingClientRect().width);
const fit = await width();
await page.getByRole('button', { name: 'Zoom in' }).click();
await page.getByRole('button', { name: 'Zoom in' }).click();
await sleep(600);
ok('zoom enlarges the pages', (await width()) > fit * 1.4, `${Math.round(fit)} to ${Math.round(await width())}px`);
await page.locator('[data-source-mark]').waitFor();
await shot('4-zoomed-source');
await page.getByRole('button', { name: 'Fit width' }).click();
const left = await rows();
ok('about half decided, with nothing decided by itself', left.filter((o) => o.verification_status !== 'proposed').length >= 15 && left.some((o) => o.verification_status === 'proposed'));

console.log('\n--- Elsewhere');
await page.getByRole('region', { name: 'Document details' }).getByRole('button', { name: 'Show' }).click();
await page.evaluate(() => window.scrollTo(0, 0));
await shot('5-details-shown');
await page.setViewportSize({ width: 390, height: 900 });
await sleep(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok('no sideways page scrolling at phone width', overflow <= 0, `${overflow}px`);
ok('stacked on a phone, the original scrolls away rather than covering the review', (await page.locator('.review-original').evaluate((el) => getComputedStyle(el).position)) !== 'sticky');
const table = list.locator('xpath=..');
const wide = await table.evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth }));
ok('the measurement table scrolls sideways inside its own box', wide.scroll > wide.width, `${wide.width} of ${wide.scroll}px shown`);
await row('Sodium').scrollIntoViewIfNeeded();
const box = await table.boundingBox();
await page.mouse.move(box.x + box.width / 2, Math.min(box.y + 200, 850));
const y0 = await page.evaluate(() => window.scrollY);
await page.mouse.wheel(0, 500);
await sleep(400);
ok('scrolling down over the table still scrolls the page', (await page.evaluate(() => window.scrollY)) > y0);
const over = await row('Hemoglobin').boundingBox();
await page.mouse.move(over.x + 40, over.y + over.height / 2);
await page.mouse.wheel(300, 0);
await sleep(300);
ok('and sideways scrolls only the table', (await table.evaluate((el) => el.scrollLeft)) > 0 && (await page.evaluate(() => window.scrollX)) === 0);
await table.evaluate((el) => { el.scrollLeft = 0; });
await shot('6-phone');
ok('no outside requests', outside.length === 0, outside.join());
ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
web.close();
service.kill('SIGTERM');
fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
console.log(`\n${results.pass} of ${results.pass + results.fail} checks passed.`);
process.exit(results.fail ? 1 : 0);
