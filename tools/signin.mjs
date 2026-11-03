// For the test tools, which run on temp archives. They sign in the same way a person does: there is no test bypass in the app.
import { spawnSync } from 'node:child_process';

export const PASSPHRASE = 'fictional passphrase for test tools';

export function setPassphrase(python, repo, dataDir, passphrase = PASSPHRASE) {
  const result = spawnSync(python, ['-m', 'this_is_you', 'set-passphrase'], {
    cwd: repo,
    env: { ...process.env, THIS_IS_YOU_DATA_DIR: dataDir },
    input: `${passphrase}\n`,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`set-passphrase failed: ${result.stderr}`);
}

/** Returns the session cookie's value. */
export async function login(port, passphrase = PASSPHRASE) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'X-This-Is-You-Client': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
  const cookie = /tiy_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '');
  if (!cookie) throw new Error(`sign-in failed: ${response.status}`);
  return cookie[1];
}

/** Puts the session in a browser context. Cookies ignore ports, so it covers every port on this host. */
export const addSession = (context, token) =>
  context.addCookies([{ name: 'tiy_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }]);
