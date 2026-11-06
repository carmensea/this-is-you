// The connector against Epic's real sandbox, in Chrome, on a temp sandbox archive. Fictional patients only.
//   npm run build && npm run readiness:epic                                    preflight only: never opens Epic's sign-in
//   npm run build && EPIC_SANDBOX_CLIENT_ID=<non-production client ID> npm run readiness:epic    preflight, then live
// The app must list http://127.0.0.1:8137/api/connections/callback as a redirect URI, and its public key must be the key set
// in EPIC_KEY_DIR/epic-sandbox-jwks.json (default folder: kept between runs, outside the repository and any archive).
// It types Epic's published fictional MyChart login on Epic's own page. Never a real one: there is no way to pass one in.
// It prints counts and statuses only, never what a record says.
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addSession, login, setPassphrase } from '../signin.mjs';

// The client ID comes from a file only you can read, written by you, so it never appears in a command, a log or this output.
const KEY_HOME = process.env.EPIC_KEY_DIR ?? path.join(os.homedir(), '.this-is-you-epic-sandbox-keys');
const ID_FILE = path.join(KEY_HOME, 'client-id');
function readClientId() {
  if (process.env.EPIC_SANDBOX_CLIENT_ID) return process.env.EPIC_SANDBOX_CLIENT_ID.trim();
  if (!fs.existsSync(ID_FILE)) return null;
  if ((fs.statSync(ID_FILE).mode & 0o077) !== 0) {
    console.log(`${ID_FILE} can be read by other users. Run: chmod 600 ${ID_FILE}. Nothing was run.`);
    process.exit(2);
  }
  const id = fs.readFileSync(ID_FILE, 'utf8').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) {
    console.log(`${ID_FILE} does not hold a client ID on one line (letters, digits and dashes). Nothing was run.`);
    process.exit(2);
  }
  return id;
}
const GIVEN_ID = readClientId();
const LIVE = !!GIVEN_ID;
const CLIENT_ID = GIVEN_ID || 'preflight-not-registered';
// Anything printed passes through this, so the client ID never reaches the screen, even inside an error message.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const masked = (text) => (GIVEN_ID ? String(text).split(GIVEN_ID).join('[client ID]') : String(text));
// Epic's documented sandbox patient Camila Lopez. Published by Epic for testing; it is not a person.
const FICTIONAL_LOGIN = { username: 'fhircamila', password: 'epicepic1' };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PY = path.join(REPO, 'backend/.venv/bin/python');
const PORT = 8137, BASE = `http://127.0.0.1:${PORT}/`;
// The key registered with Epic has to survive between runs, so it lives in its own folder, never inside the repository.
const KEYS = KEY_HOME;
const SIGNING = 'connector-signing-key.pem';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiy-epic-'));
const data = path.join(dir, 'archive');
fs.mkdirSync(data, { mode: 0o700 });
// Marks this throwaway archive as a sandbox: the only kind the sandbox connects from, and one that connects to nothing real.
fs.writeFileSync(path.join(data, 'SANDBOX-ONLY-FICTIONAL-RECORDS'), 'Temporary archive for Epic sandbox tests. Fictional records only.\n');
const env = {
  ...process.env, THIS_IS_YOU_DATA_DIR: data, THIS_IS_YOU_PORT: String(PORT), THIS_IS_YOU_WEB_DIR: path.join(REPO, 'dist'),
  THIS_IS_YOU_EPIC_NONPRODUCTION_CLIENT_ID: CLIENT_ID, THIS_IS_YOU_CONNECTOR_REDIRECT_URI: `${BASE}api/connections/callback`,
};
const results = { pass: 0, fail: 0 };
const ok = (name, value, detail = '') => {
  console.log(masked(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`));
  results[value ? 'pass' : 'fail'] += 1;
};

console.log('\n--- Preflight: an isolated installation');
// Nothing may already answer on this port: the callback must reach this run's service and no other.
ok('nothing else is listening on the callback port', !(await fetch(`${BASE}api/status`).then(() => true, () => false)), String(PORT));
const realDefault = execFileSync(PY, ['-I', '-c', 'import sys; sys.path.insert(0, "backend"); from this_is_you.config import default_data_dir; print(default_data_dir().resolve())'],
  { cwd: REPO, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('THIS_IS_YOU_'))), encoding: 'utf8' }).trim();
const resolved = fs.realpathSync(data);
ok('the archive is a new temporary folder, not the default archive', resolved.startsWith(fs.realpathSync(os.tmpdir())) && !resolved.startsWith(realDefault) && !realDefault.startsWith(resolved));
ok('the key folder is outside every archive and the repository', !path.resolve(KEYS).startsWith(realDefault) && !path.resolve(KEYS).startsWith(REPO));
if (!fs.existsSync(path.join(KEYS, SIGNING))) {
  fs.mkdirSync(KEYS, { recursive: true, mode: 0o700 });
  const jwks = execFileSync(PY, ['-m', 'this_is_you', 'connector-key'], { cwd: REPO, env: { ...process.env, THIS_IS_YOU_DATA_DIR: KEYS }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  fs.writeFileSync(path.join(KEYS, 'epic-sandbox-jwks.json'), jwks, { mode: 0o600 });
  console.log(`Made a new key pair. Upload ${path.join(KEYS, 'epic-sandbox-jwks.json')} to the app before a live run.`);
}
fs.copyFileSync(path.join(KEYS, SIGNING), path.join(data, SIGNING));
fs.chmodSync(path.join(data, SIGNING), 0o600);
setPassphrase(PY, REPO, data);
const service = spawn(PY, ['-m', 'this_is_you'], { cwd: REPO, env, stdio: 'ignore' });
process.on('exit', () => service.kill('SIGKILL'));
for (let i = 0; i < 200; i++) {
  if (await fetch(`${BASE}api/status`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 100));
}
const api = async (url, method = 'GET') => {
  const r = await fetch(BASE + url.replace(/^\//, ''), { method, headers: { 'X-This-Is-You-Client': '1', cookie: `tiy_session=${token}` } });
  return r.json();
};
const token = await login(PORT);
const sandbox = async () => (await api('/api/connections')).providers.find((p) => p.key === 'epic-sandbox');

const CALLBACK = `${BASE}api/connections/callback`;
const listing = await api('/api/connections');
ok('the service names the callback it is listening on', listing.redirect_uri === CALLBACK, listing.redirect_uri);
const byKey = Object.fromEntries(listing.providers.map((p) => [p.key, p]));
ok('this archive may connect the sandbox and nothing real', byKey['epic-sandbox'].allowed_here && listing.providers.every((p) => p.key === 'epic-sandbox' || !p.allowed_here));
const started = await (await fetch(`${BASE}api/connections/epic-sandbox/authorize`, { method: 'POST', headers: { 'X-This-Is-You-Client': '1', cookie: `tiy_session=${token}` } })).json();
const asked = new URL(started.authorize_url ?? 'http://invalid/');
const q = asked.searchParams;
ok('the sign-in goes to Epic, found through its published discovery document', asked.href.startsWith('https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize?'));
ok('it sends Epic exactly that callback', q.get('redirect_uri') === CALLBACK, q.get('redirect_uri') ?? '');
ok('with PKCE, the sandbox audience and the client ID given', q.get('code_challenge_method') === 'S256' && q.get('aud') === byKey['epic-sandbox'].fhir_base && q.get('client_id') === CLIENT_ID);
const back = await fetch(`${CALLBACK}?state=preflight-unknown`, { redirect: 'manual' });
ok('the callback answers at that address, and refuses an unknown sign-in', back.status === 200 && (await back.text()).includes('/#/sources?result=expired'));
if (!LIVE) {
  console.log('\nNo EPIC_SANDBOX_CLIENT_ID, so the live sign-in was not run. Epic was asked only for its public discovery document.');
  console.log(`\n${results.pass} of ${results.pass + results.fail} checks passed.`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(results.fail ? 1 : 0);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await addSession(context, token);
const hosts = new Set();
// The browser may reach this app and Epic's sandbox, and nothing else.
await context.route(/^https?:/, (r) => {
  const host = new URL(r.request().url()).hostname;
  hosts.add(host);
  return host === '127.0.0.1' || host === 'fhir.epic.com' ? r.continue() : r.abort();
});
const page = await context.newPage();

try {
  await page.goto(`${BASE}#/sources`);
  await page.getByRole('heading', { name: 'Connected sources' }).waitFor();
  console.log('\n--- Signing in at Epic');
  await page.getByRole('region', { name: 'Epic sandbox' }).getByRole('button', { name: 'Connect' }).click();
  await page.waitForURL(/fhir\.epic\.com/, { timeout: 30000 });
  ok('Connect opens Epic\'s own sign-in page', new URL(page.url()).hostname === 'fhir.epic.com');
  // MyChart asks for the username first and shows the password field after it.
  const username = page.locator('input[name="Login"], input[type="text"]:visible').first();
  await username.waitFor({ timeout: 30000 });
  await username.fill(FICTIONAL_LOGIN.username);
  const password = page.locator('input[type="password"]');
  if (!(await password.isVisible())) {
    await page.locator('button[type="button"]:visible, input[type="submit"]:visible').first().click().catch(() => username.press('Enter'));
  }
  await password.waitFor({ state: 'visible', timeout: 30000 });
  await password.fill(FICTIONAL_LOGIN.password);
  await password.press('Enter');
  // MyChart's consent screen: an access duration is required, then Allow. The shortest duration on offer is chosen.
  for (let i = 0; i < 8 && !page.url().startsWith(BASE); i++) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const durations = page.locator('input[type="radio"][name="accessduration"]');
    if ((await durations.count()) && !(await page.locator('input[name="accessduration"]:checked').count())) {
      await durations.first().check({ force: true }).catch(() => {});
    }
    const allow = page.locator('#allowDataSharing, button[name="allowDataSharing"]').first();
    const next = page.locator('#nextButton, button[name="nextButton"]').first();
    if (await allow.isVisible().catch(() => false)) await allow.click();
    else if (await next.isVisible().catch(() => false)) await next.click();
    else {
      const agree = page.getByRole('button', { name: /^(allow|accept|continue|approve|authorize)/i }).first();
      if (await agree.isVisible().catch(() => false)) await agree.click();
    }
    await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 6000 }).catch(() => {});
  }
  await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 60000 });
  let p = await sandbox();
  ok('the sign-in comes back connected and waits for confirmation', p.connection?.status === 'awaiting_confirmation', p.connection?.status);

  console.log('\n--- Confirming and synchronizing');
  await page.getByRole('button', { name: 'This is my record' }).click();
  await page.getByRole('button', { name: 'Synchronize now' }).waitFor();
  await page.getByRole('button', { name: 'Synchronize now' }).click();
  await page.getByText(/^(Completed|Completed, with problems|Failed)$/).first().waitFor({ timeout: 180000 });
  p = await sandbox();
  const run = p.connection.runs[0];
  ok('a synchronization finishes', run.status === 'completed' || run.status === 'partial', `${run.status}; problems: ${run.problems.length}`);
  ok('results arrive for review', (run.counts.results_proposed ?? 0) > 0, `${run.counts.results_proposed ?? 0} results, ${run.counts.Observation_received ?? 0} received`);
  const proposed = (await api('/api/observations')).observations.filter((o) => o.origin === 'fhir');
  ok('none is verified automatically', proposed.length > 0 && proposed.every((o) => o.verification_status === 'proposed'));
  const again = (await api('/api/connections/epic-sandbox/sync', 'POST')).providers.find((x) => x.key === 'epic-sandbox').connection.runs[0];
  ok('synchronizing again adds no new versions', !again.counts.results_proposed && (again.counts.Observation_unchanged ?? 0) === (run.counts.Observation_received ?? 0));

  console.log('\n--- Deciding in Results to review');
  const list = page.getByRole('list', { name: 'Results read from connected sources' });
  await list.waitFor();
  const firstAccept = list.getByRole('button', { name: /^Accept / }).first();
  const pick = proposed.find((o) => o.issues.length === 0) ?? proposed[0];
  if (await firstAccept.count()) {
    const label = await firstAccept.getAttribute('aria-label');
    await firstAccept.click();
    const status = async () => (await api('/api/observations')).observations.filter((o) => o.origin === 'fhir' && o.verification_status === 'verified').length;
    let verified = 0;
    for (let i = 0; i < 40 && !verified; i++) { verified = await status(); if (!verified) await sleep(150); }
    ok('one click accepts a provider result, through the same review as a report', verified === 1, label ? 'one result' : '');
    await list.getByRole('button', { name: /accepted\. Select to undo\.$/ }).first().click();
    let left = 1;
    for (let i = 0; i < 40 && left; i++) { left = await status(); if (left) await sleep(150); }
    ok('and undoing it puts it back to review, with both steps in its history', left === 0);
  } else {
    ok('a provider result can be accepted in one click', false, `no plain result to accept; ${pick ? 'all need a check' : 'none proposed'}`);
  }
  const firstRow = list.locator('[data-row]').first();
  await firstRow.locator('button[aria-expanded]').click();
  await firstRow.getByText('Source and details').click();
  ok('its source names the provider record and its stored version', /Read from epic-sandbox: Observation .+, version \d+ of \d+ kept/.test(await firstRow.innerText()));

  console.log('\n--- Disconnecting');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByText(/^Disconnected /).waitFor();
  p = await sandbox();
  ok('disconnecting removes the permission and keeps the records', p.connection.status === 'disconnected' && Object.keys(p.connection.record_versions).length > 0);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete imported records' }).click();
  await page.getByRole('button', { name: 'Delete imported records' }).waitFor({ state: 'detached' });
  ok('imported records are deleted only when asked', (await api('/api/observations')).observations.every((o) => o.origin !== 'fhir'));
} catch (problem) {
  // What the page showed, without its address, form values or anything a person typed: title, headings, field kinds, OAuth error code.
  const seen = await page.evaluate(() => ({
    title: document.title,
    headings: [...document.querySelectorAll('h1, h2, h3, [role="alert"], .error, .errorMessage, #error')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 6),
    fields: [...document.querySelectorAll('input, button, select')].map((e) => `${e.tagName.toLowerCase()}:${e.type || ''}:${e.name || e.id || ''}`).slice(0, 20),
    frames: document.querySelectorAll('iframe').length,
    // Before any sign-in, so there is no patient data here: Epic's error explanation only.
    text: document.body ? document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 300) : '',
  })).catch(() => null);
  const at = (() => { try { const u = new URL(page.url()); return { host: u.hostname, path: u.pathname, error: u.searchParams.get('error'), description: u.searchParams.get('error_description') }; } catch { return null; } })();
  console.log(masked(`Page when it stopped: ${JSON.stringify({ at, ...seen })}`).replace(/https?:\/\/\S+/g, '[address]').slice(0, 1500));
  // Only the first line, and without addresses: Epic's page addresses carry the client ID and sign-in state.
  ok('the run reached its end', false, String(problem.message ?? problem).split('\n')[0].replace(/https?:\/\/\S+/g, '[address]').slice(0, 200));
} finally {
  // The temporary archive goes, with its tokens and token key. Only the signing key Epic knows stays, in its own folder.
  ok('the browser reached only this app and Epic', [...hosts].every((h) => h === '127.0.0.1' || h === 'fhir.epic.com'), [...hosts].join(', '));
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${results.pass} of ${results.pass + results.fail} checks passed.`);
  process.exit(results.fail ? 1 : 0);
}
