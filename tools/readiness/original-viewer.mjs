// The original-file viewer in Chrome, under the real content policy, on a temp archive of fictional PDFs.
//   npm run build && npm run readiness:viewer
//   VIEWER_DEV=1 npm run readiness:viewer checks the same things through the development server, with no content policy.
import { chromium } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PY = path.join(REPO, 'backend/.venv/bin/python');
const PORT = 8133, DEV_PORT = 5202, DEV = !!process.env.VIEWER_DEV, BASE = `http://127.0.0.1:${DEV ? DEV_PORT : PORT}/`;
const PASSPHRASE = 'fictional passphrase for the viewer';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-viewer-'));
const env = { ...process.env, THIS_IS_YOU_DATA_DIR: path.join(dir, 'archive'), THIS_IS_YOU_PORT: String(PORT), ...(DEV ? {} : { THIS_IS_YOU_WEB_DIR: path.join(REPO, 'dist') }) };
const shots = process.env.VIEWER_SHOTS;
const results = { pass: 0, fail: 0 };
const ok = (name, value, detail = '') => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  results[value ? 'pass' : 'fail'] += 1;
};

// A large grey picture, as JPEG 2000 and as JPEG: the formats scanned reports tend to use.
execFileSync(PY, ['-I', '-c', `
import struct, sys, zlib
w, h = 600, 800
raw = b"".join(b"\\x00" + bytes([60, 60, 60]) * w for _ in range(h))
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
open(sys.argv[1], "wb").write(b"\\x89PNG\\r\\n\\x1a\\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
`, path.join(dir, 'scan.png')]);
for (const [format, ext] of [['jp2', 'jp2'], ['jpeg', 'jpg']]) spawnSync('sips', ['-s', 'format', format, path.join(dir, 'scan.png'), '--out', path.join(dir, `scan.${ext}`)], { stdio: 'ignore' });
execFileSync(PY, ['-c', `
import sys
sys.path.insert(0, 'backend')
from tests import pdfs
out = sys.argv[1]
line = lambda n: [f"Fictional report line {i} for page {n}, with enough words to fill the width" for i in range(40)]
open(out + "/text.pdf", "wb").write(pdfs.text_pdf(line(1), line(2), line(3)))
def scan(image, kind, name):
    data = open(f"{out}/{image}", "rb").read()
    parts = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
             b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>"]
    content = b"q 600 0 0 800 0 0 cm /Im0 Do Q"
    parts.append(b"<< /Length %d >>\\nstream\\n" % len(content) + content + b"\\nendstream")
    parts.append(b"<< /Type /XObject /Subtype /Image /Width 600 /Height 800 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /%s /Length %d >>\\nstream\\n" % (kind, len(data)) + data + b"\\nendstream")
    body, offsets = b"%PDF-1.5\\n", []
    for i, p in enumerate(parts, 1):
        offsets.append(len(body)); body += b"%d 0 obj\\n" % i + p + b"\\nendobj\\n"
    start = len(body); body += b"xref\\n0 %d\\n0000000000 65535 f \\n" % (len(parts) + 1)
    for o in offsets: body += b"%010d 00000 n \\n" % o
    body += b"trailer << /Size %d /Root 1 0 R >>\\nstartxref\\n%d\\n%%%%EOF\\n" % (len(parts) + 1, start)
    open(f"{out}/{name}", "wb").write(body)
scan("scan.jp2", b"JPXDecode", "scan-jpx.pdf")
scan("scan.jpg", b"DCTDecode", "scan-dct.pdf")
`, dir], { cwd: REPO });

spawnSync(PY, ['-m', 'this_is_you', 'set-passphrase'], { cwd: REPO, env, input: `${PASSPHRASE}\n` });
const service = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env, stdio: 'ignore' });
const vite = DEV ? spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort'], { cwd: REPO, env, stdio: 'ignore', detached: true }) : null;
process.on('exit', () => {
  service.kill('SIGKILL');
  if (vite) process.kill(-vite.pid, 'SIGKILL');
});
for (let i = 0; i < 200; i++) {
  if (await fetch(`${BASE}api/status`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const problems = [];
let external = 0, popups = 0;
await context.route(/^https?:/, (r) => { if (new URL(r.request().url()).hostname === '127.0.0.1') return r.continue(); external += 1; return r.abort(); });
context.on('page', () => { popups += 1; });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const watch = (p) => {
  // Compiled decoders are refused by the content policy on purpose. pdf.js then uses its plain versions, checked below.
  p.on('console', (m) => { if (/content security policy|refused to|failed to/i.test(m.text()) && !m.text().includes('#instantiateWasm')) problems.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => problems.push(e.message.slice(0, 160)));
};
watch(page);
popups = 0;
await page.goto(`${BASE}#/documents`);
await page.getByLabel('Passphrase').fill(PASSPHRASE);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByLabel('Passphrase').waitFor({ state: 'detached' });
await page.waitForSelector('main');
problems.length = 0; // Asking for records before signing in is refused, as it should be.
for (const name of ['text.pdf', 'scan-jpx.pdf', 'scan-dct.pdf']) {
  const done = await page.evaluate(async ([n, b64]) => {
    const body = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return (await fetch('/api/documents', { method: 'POST', body, headers: { 'X-This-Is-You-Client': '1', 'Content-Type': 'application/pdf', 'X-Original-Filename': n } })).status;
  }, [name, fs.readFileSync(path.join(dir, name)).toString('base64')]);
  if (done >= 300) throw new Error(`upload ${name}: ${done}`);
}
await page.reload();

const stats = (locator) => locator.evaluate((c) => {
  if (!c.width) return { width: 0, ink: 0, middle: 255 };
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 128 && d[i] < 200) ink += 1; // A canvas not drawn yet is clear, not dark.
  const m = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
  return { width: c.width, ink, middle: m[3] > 128 ? m[0] : 255 };
});
const painted = async (locator) => {
  for (let i = 0; i < 100; i++) {
    if ((await locator.count()) && (await stats(locator)).ink > 0) return stats(locator);
    await page.waitForTimeout(200);
  }
  return { width: 0, ink: 0, middle: 255 };
};
const open = async (name) => {
  await page.goto(`${BASE}#/documents`);
  await page.getByText(name, { exact: true }).first().click();
  const frame = page.locator(`[aria-label="Original file: ${name}"]`);
  await frame.waitFor();
  await frame.scrollIntoViewIfNeeded();
  return frame;
};

console.log('\n--- A text PDF');
let frame = await open('text.pdf');
const sheet = frame.getByRole('img', { name: /^Page 1 of 3/ });
const first = await painted(sheet);
ok('the page is drawn, with its text', first.ink > 0, `${first.ink} dark samples`);
ok('it is drawn sharper than it is shown, for the lens', first.width > (await sheet.boundingBox()).width, `${first.width} pixels across, shown at ${(await sheet.boundingBox()).width}`);
ok('there is no iframe and no new-tab link', (await page.locator('iframe').count()) === 0 && (await page.locator('a[target="_blank"]').count()) === 0);
ok('Download original stays', (await page.getByText('Download original').count()) === 1);
ok('every page is listed', (await frame.getByRole('button', { name: /^Open page \d+ larger$/ }).count()) === 3);

console.log('\n--- Going to a page');
const list = frame.locator('[data-pdf-page="1"]').locator('..');
const atTop = await list.evaluate((n) => n.scrollTop);
await page.getByRole('button', { name: 'Next page' }).click();
await page.waitForTimeout(400);
ok('the page buttons still move through the original', atTop === 0 && (await list.evaluate((n) => n.scrollTop)) > 300);
await page.getByRole('button', { name: 'Previous page' }).click();
await page.waitForTimeout(400);
ok('and back', (await list.evaluate((n) => n.scrollTop)) === 0);

console.log('\n--- The magnifier');
const lens = frame.locator('[data-pdf-lens]');
ok('the lens is hidden until the mouse is over a page', !(await lens.isVisible()));
const box = await sheet.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 110);
await page.mouse.move(box.x + box.width / 2 + 4, box.y + 112);
await lens.waitFor({ state: 'visible' });
const glass = await stats(lens);
ok('it shows the page under the mouse', glass.ink > 0, `${glass.ink} dark samples`);
const where = await lens.boundingBox();
ok('it follows the mouse', Math.abs(where.x + where.width / 2 - (box.x + box.width / 2 + 4)) < 3);
await page.mouse.move(box.x + box.width / 2 + 60, box.y + 150);
ok('and keeps following it', Math.abs((await lens.boundingBox()).x + 120 - (box.x + box.width / 2 + 60)) < 3);
if (shots) await page.screenshot({ path: path.join(shots, 'lens.png') });
await page.mouse.move(5, 5);
await page.waitForTimeout(100);
ok('it goes away when the mouse leaves', !(await lens.isVisible()));

console.log('\n--- Clicking a page');
const address = page.url();
await page.mouse.click(box.x + box.width / 2, box.y + 110);
const dialog = page.locator('dialog[open]');
await dialog.waitFor();
const big = await painted(dialog.getByRole('img', { name: /^Page 1 of 3/ }));
ok('it opens in a popup in this tab', popups === 0 && page.url() === address);
ok('larger than it was', (await dialog.getByRole('img', { name: /^Page 1 of 3/ }).boundingBox()).width > box.width);
ok('with the page drawn', big.ink > 0);
const large = await dialog.getByRole('img', { name: /^Page 1 of 3/ }).boundingBox();
await page.mouse.move(large.x + large.width / 2, large.y + 200);
await page.mouse.move(large.x + large.width / 2 + 3, large.y + 202);
await dialog.locator('[data-pdf-lens]').waitFor({ state: 'visible' });
ok('the magnifier works there too', (await stats(dialog.locator('[data-pdf-lens]'))).ink > 0);
if (shots) await page.screenshot({ path: path.join(shots, 'modal.png') });
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });
ok('Escape closes it', true);
await frame.getByRole('button', { name: 'Open page 3 larger' }).click();
await dialog.waitFor();
await page.waitForTimeout(400);
ok('it opens at the page that was clicked', (await dialog.getByRole('img', { name: /^Page 3 of 3/ }).boundingBox()).y < 200);
await dialog.getByRole('button', { name: 'Close' }).click();
await dialog.waitFor({ state: 'detached' });
ok('Close closes it', true);
await frame.getByRole('button', { name: 'Open page 1 larger' }).focus();
await page.keyboard.press('Enter');
await dialog.waitFor();
ok('the keyboard opens it', true);
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });

console.log('\n--- Scanned reports');
for (const [name, label] of [['scan-jpx.pdf', 'JPEG 2000'], ['scan-dct.pdf', 'JPEG']]) {
  frame = await open(name);
  const scan = await painted(frame.getByRole('img', { name: /^Page 1 of 1/ }));
  ok(`a ${label} scan is really drawn, in its real shade`, Math.abs(scan.middle - 60) < 25, `middle ${scan.middle}`);
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
  ok(`no fallback viewer was needed for ${label}`, (await page.locator('iframe').count()) === 0);
}

console.log('\n--- A phone');
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await context.storageState() });
const small = await phone.newPage();
watch(small);
await small.goto(`${BASE}#/documents`);
await small.getByText('text.pdf', { exact: true }).first().click();
const smallFrame = small.locator('[aria-label="Original file: text.pdf"]');
await smallFrame.waitFor();
await smallFrame.scrollIntoViewIfNeeded();
const touch = smallFrame.getByRole('button', { name: 'Open page 1 larger' });
await touch.waitFor();
await touch.tap();
const smallDialog = small.locator('dialog[open]');
await smallDialog.waitFor();
ok('a tap opens the popup', true);
ok('nothing scrolls sideways', await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
if (shots) await small.screenshot({ path: path.join(shots, 'phone.png') });
await phone.close();

ok('the content policy refused nothing, and nothing failed', problems.length === 0, problems.slice(0, 3).join(' / '));
ok('no new tab opened', popups === 0);
ok('no request left this computer', external === 0);
await browser.close();
service.kill('SIGTERM');
console.log(`\n${results.pass} of ${results.pass + results.fail} checks passed.`);
fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
process.exit(results.fail ? 1 : 0);
