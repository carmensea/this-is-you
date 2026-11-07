# Threat model

This Is You holds one person's health records on a machine they control. This page says who it defends against, how, and what it does not stop. Each claim names the check that backs it, so it can be re-verified.

The intended setup is an always-on Linux mini PC, reached privately from a phone through Tailscale, using [docs/deployment.md](deployment.md). The service still accepts connections only on its own loopback. In production, the one thing that shares that loopback is the Tailscale proxy. **Real Tailscale has not been tested yet.** Section 6 lists what depends on it.

## 1. What is being protected

- Original documents, extracted results, decisions and correction history.
- Identity details (name, date of birth, previous names).
- Filenames and folder paths, which can reveal a clinic or a condition by themselves.
- Integrity: a record must not be silently changed, lost or attributed to the wrong source.

## 2. Who it defends against

| Attacker | Example | Verdict |
|---|---|---|
| A website open in your browser | A page that tries to read `127.0.0.1` or rebinds its own name to it | **Defended** |
| The public internet | A scanner | **Defended** by not listening on a network address at all |
| Another device on the network or tailnet, without your passphrase | A shared tailnet device, once remote access exists | **Defended by the login**, with the limits in section 4 |
| Another program under a **different** OS account | A second user on the mini PC | **Largely defended** while files stay private and the service needs a session |
| A malicious PDF | A crafted file exploiting the parser | **Contained** by the sandbox, not prevented |
| A lost backup drive | Stolen external disk | **Defended** for encrypted backups, the default. Plain ones have to be asked for |
| A lost, unlocked phone with a live session | | **Limited**: see section 4 |
| Another program under **your** OS account | Malware, a compromised dev tool | **Not defended**: see section 5 |
| Someone with root, or control of the host | A compromised mini PC | **Not defended**: see section 5 |

## 3. What is in place

### Every request

`security.py` runs before any route, and refuses by default.

- **Session required.** Only `GET /api/status` and `POST /api/auth/login` are open, plus `GET /api/connections/callback`, where a provider's sign-in page returns the browser from its own site, so neither the session cookie nor a same-site request is possible. It is accepted only with a single-use state made by a signed-in Connect within the last 10 minutes, and it answers only with a small page that moves on to the app with a fixed word. A redirect would not do: the browser would still count the app's page as a visit from the provider's site, and the cross-site check above would refuse it, as the live sandbox test showed. A route added later is protected automatically. `test_every_route_but_the_listed_ones_needs_a_session` walks the framework's route list, so a new route cannot be missed.
- **Passphrase is set only from the command line.** No web route can create or replace it. Anything that reaches the service cannot claim an archive that has no passphrase. An archive with none stays closed.
- **Host check**, which stops DNS rebinding.
- **Origin must match Host**, and browsers reporting `cross-site` or `same-site` are refused, even with a valid session.
- **Custom header on every change**, which a cross-site request cannot send without a CORS approval this service never gives. This is the CSRF defense, alongside `SameSite=Strict`.
- **Loopback only**, checked per connection. Forwarded headers are ignored, so a client cannot claim another address. Starting on a network address is refused.
- **WebSockets are closed**: the app has none.

### Sessions

- Cookie is `HttpOnly` and `SameSite=Strict`, so page code cannot read it.
- The token is 256 random bits. The database stores only its hash, so a copy of the database holds nothing replayable.
- Ends after 3 days unused or 14 days in all. **Sign out everywhere** and `sign-out-everywhere` end every device. A new passphrase does as well.
- The passphrase is hashed with scrypt (128 MB, n=2^17). Guesses are limited: after 5 wrong tries, a wait that doubles up to 5 minutes.

### The PDF reader

Assumes the parser can be subverted by a crafted file.

- One process per document, with no environment, no stderr, and limits on CPU, memory, output and open files.
- **The document arrives as an open file.** The reader is never told a path, so the archive's location is not in its arguments.
- **In production, its own container**, with a different account, no network, no archive, no backups, a read-only filesystem and no capabilities. The kernel enforces all of it through Docker's standard settings. The app hands it one document as an open, read-only file over a Unix socket.
- **In development on macOS,** `sandbox-exec`. **On Linux outside a container,** `bubblewrap` where the system allows it. Stock Ubuntu 24.04 does not, on the host or in Docker, even with Docker's protections turned off, and a test on macOS said nothing about that.
- **It is tested at every start, not assumed.** The reader tries to reach the network, read and write a real archive file, and write to its own disk. If anything gets through, or it cannot be asked, it counts as no sandbox at all.
- **Production never falls back.** Without a working sandbox, files are stored and stay unread, and the app says so in `doctor`, the log and the Import screen. Reading resumes after a fix and a restart. Only development runs with the limits alone, for trying it with fictional files.
- **A subverted worker is short-lived:** it cannot start other processes, is killed when its reading ends, and leaves nothing behind in a read-only container, so it cannot wait for the next document. It runs as the same account as the reader service, so it can kill that service, which restarts, or replace its socket, which is rebuilt within seconds. It can delay reading, not see other documents.
- Output is treated as untrusted and checked field by field.

### Files on disk

- The archive folder and everything in it is private to your account (0700/0600), and originals are read-only.
- **Orphans:** a crash between storing a file and recording it leaves a file nothing points to. At start, a file whose bytes match its name becomes a document named `Recovered file`, unverified. Importing the same file later restores its name.
- **Anything else in `originals/`** is moved to `set-aside/`, never deleted, and reported. Links are moved, not followed.
- **Missing originals** are counted and reported.
- **Stale copies:** partial uploads and plain staging copies are cleared at start. Only the 2 newest `before-upgrade` databases are kept.
- **Deleting a document** does not reach existing backups, and on an SSD the removed file's blocks may survive until the drive reuses them. Rows are overwritten in the database and cleared from its log.
- **`prune`** lists older backups, unfinished work and replaced archives, and removes them only with `--yes`. The newest backup that passed a check is always kept.
- Deleted database rows are overwritten (`secure_delete`).

### Backups

- **Encrypted by default,** from the button, the command line and the timer. Each file gets a new key by X25519 agreement with a public key, and is sealed with AES-256-GCM in authenticated chunks. Changing, reordering, removing or adding anything fails to open, including cutting the end off. The plain copy is built in the archive's own folder, so the destination never sees one, even after a crash. Each is opened and checked before it is kept.
- **The machine cannot open its own backups.** It stores a public key. The private key is derived from your backup passphrase only when one is opened. So a compromised machine cannot read backups it already wrote, and scheduled backups need no passphrase on the machine.
- **Sign-in details are never in a backup**, encrypted or not. A restored archive stays closed until given a passphrase.
- **Separate storage:** the app says when backups share the archive's drive. In production, a destination has to hold a marker file that `setup-host.sh` puts on the real drive, and an unplugged drive's empty mount point belongs to root. So backups are refused rather than quietly written to the system disk.
- **Plain backups** need `backup --plain` on the command line, and warn you. Their manifest detects damage, not forgery.
- **Encryption here shows a file is undamaged and sealed for this key, not who sealed it.** Anyone can seal to a public key. Someone who took over the machine could write a false backup, which you would only notice by looking at what it restores. That is one more reason to keep older copies.

### Sensitive metadata

- Filenames travel in headers or the database, never in URLs, and access logs are off. Logs hold ids, sizes and counts. The readiness run checks this against a list of fictional names.
- **Remove this report** deletes a report and its folder paths from the archive. Older backups still hold them.
- `/api/backups` shows the location with `~` in place of the home folder.
- Responses are `no-store`, so PDFs are not meant to stay in a browser cache.

## 4. Known limits within the defended cases

0. **Originals are drawn in the browser by pdf.js.** This is what makes the magnifier possible. It runs in a worker on the app's own origin, so a flaw in pdf.js that a crafted PDF could reach would run with the signed-in session, which the browser's own PDF viewer would not. The content policy still forbids eval and every outside address, the version is pinned, and only your own uploads are ever opened. Keep it updated.

1. **A signed-in device is fully trusted.** There is one person and one role. A lost, unlocked phone with a live session reads everything until the session ends or you sign out everywhere, which needs another device or the command line.
2. **Passphrase strength is on you.** 12 characters is the minimum, and scrypt slows guessing but cannot save a weak one. There is no second factor.
3. **Guessing can delay you.** The limit is one shared counter, so someone guessing can delay your own sign-in by up to 5 minutes at a time. It resets on restart.
4. **Records remain in page memory when a session ends mid-use.** The sign-in screen replaces them on screen so an import can continue. Signing out on purpose reloads the page and drops them.
5. **Cookies ignore ports.** In development on `127.0.0.1`, other local web apps you run receive this cookie on requests to themselves. Production uses a `__Host-` cookie, Secure, on one exact hostname.
6. **The reader sandbox limits what a subverted reader can do, not what it can report.** It could still return false results for that document, and read that one document. Results stay unverified until a person checks them.
7. **macOS sandbox:** `sandbox-exec` is deprecated by Apple, though it works today. File metadata (names and sizes, given an exact path) remains visible to the reader.
8. **Metadata in plain sight:** an encrypted backup's name shows its date and its size shows roughly how much it holds. `doctor` output and the service's start message show folder paths.
9. **Deleted is not erased.** `prune` and report removal do not defeat disk forensics or snapshots such as Time Machine, which also hold copies. Rely on full-disk encryption.
10. **Plain folders on drives without permissions** (exFAT) are readable by anyone with the drive. The command line warns. Use encrypted backups, the default.
11. **Encrypted backups need room** for a full plain copy in the archive's folder while they are built. A crash leaves that copy there until the next start, in a private folder.
12. **Losing a backup passphrase loses that backup.** There is no recovery by design.
13. **Typing the backup passphrase on the machine** for **Test restore** or `verify` sends it there, in memory, for that one check. On a compromised machine that hands it over, along with every backup. Test on a clean machine if you have any doubt.

14. **Provider connections reach the internet.** Only when you press Connect or Synchronize, only to the sandbox in `providers.py` and the providers in your own `connector-providers.json`, over HTTPS, without following redirects. A token is only ever sent under the provider's FHIR address. A provider could still send false records: they arrive as proposals for review, like any reading. Tokens are encrypted in the database with a key outside it and outside backups. Anyone who can read the service user's files can read both, so the folder's permissions are what protect them.

15. **Provider connections go to the address that was checked.** For each new connection the provider's host name is looked up once, every address it gives must be on the public internet, and the connection is made to one of those exact addresses, so a name whose answer changes (DNS rebinding) cannot reach this machine or its network with a sign-in code, a client assertion or a token. TLS is still set up with the provider's host name, so its certificate must match that name. Tests in `test_connections.py` show a changed answer is refused, that only the checked address is connected to, and that the certificate check uses the name. The limit that remains: httpx has no public option for this, so `connectors/client.py` rebuilds its connection pool with the pinned connection. A test fails if an httpx upgrade stops that from taking effect.

## 5. What this cannot stop

**Another process under your OS account can get everything.** The app runs as you, and the OS treats that program as you. It can:

- read the database, originals and unencrypted backups directly, with no login involved
- replace the passphrase with `set-passphrase`, since the command line is the recovery path
- read the session hash (useless) but also read your browser's cookies (useful), or record keystrokes
- change files the app later trusts, or the app's own code, so that it logs your passphrase next time

Login, sandboxing and CSRF protection do not apply to it. The only real defenses are outside this app: keep the machine clean, run this under **its own OS account on the mini PC**, and keep nothing else on that account. That turns other programs into the "different account" row in section 2.

**Root or a compromised host** can do all of that and more. In a Docker deployment, **anyone in the `docker` group counts as root here**, since they can mount the archive into a container of their own. Backups already written stay private, even on that machine, as long as their passphrase has never been stored or typed there. New backups made after a compromise cannot be trusted.

**Full-disk encryption** protects a powered-off machine only. Once the mini PC is running with the disk unlocked, it does nothing against someone on it. An always-on machine is unlocked nearly all the time, so physical access to a running one is a real gap that this app does not address.

**There is no encryption of the live archive.** A key would have to live on the same always-on machine or be typed at every restart, and the first adds little against the attackers above. This is a deliberate choice, and can be revisited.

## 6. What is done for remote access, and what real hardware must confirm

**Done and tested against a stand-in HTTPS proxy on real Linux:**

- `__Host-` cookie, Secure, HttpOnly and SameSite=Strict. A browser really accepted it.
- One exact Host and one exact Origin in production. Forwarded headers are ignored.
- The service stays on loopback. No port is published, and another container or the machine's own LAN address cannot reach it.
- The app is served by the service under a content policy, with no dev server in production.
- A dedicated unprivileged account for each service, with a read-only filesystem and no capabilities.

**Remaining, listed in [docs/deployment.md](deployment.md) section 9:**

1. Real `tailscale serve`. The image starts under this hardening and reads its key, but its real headers have not been seen.
2. **A proxy on the same network makes every client look like `127.0.0.1`, so the loopback check does not separate tailnet devices. The login is the only barrier between them.** Tailnet ACLs limiting this port to your own devices are the second layer, and they are in your admin console rather than in this repository.
3. Guessing limits are one shared counter, not per device. A tailnet device can delay your sign-in.
4. Whether a real phone keeps PDFs in its cache, despite `no-store`.
5. Tailscale itself is one more trusted party: its account controls which devices join, and it could add a device if compromised. That device would still need your passphrase.
