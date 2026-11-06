# This Is You

A local-first, open-source personal health archive and time machine. Pick any date and see your record as it stood then: only what had been documented by that date ("As known then"), or including what was documented about that period later ("As understood now").

This version does two separate things:

- **Your archive** stores real PDF files on your computer, unchanged, and reads text-based ones to propose document details and common laboratory results. Nothing counts as verified until you approve it. Biomarkers, Overview, Medical history and Compare show only results you have verified, or entered yourself.
- **The demo archive** is a complete, entirely fictional record. Its import is simulated.

The two never mix. See [Demo mode](#demo-mode).

The app does not interpret results or give medical advice. It has no AI features and does no OCR.

## Run it

Needs Node 20 or newer and Python 3.11 or newer. These commands assume macOS or Linux.

```sh
npm install
npm run backend:setup     # once: creates backend/.venv and installs exact dependency versions
git config core.hooksPath .githooks   # once per clone: refuses records, backups and secrets at commit and push
```

Then, in two terminals:

```sh
npm run backend -- set-passphrase    # once: your archive stays closed until it has one
npm run backend           # the archive service, http://127.0.0.1:8000
npm run dev               # the app, http://127.0.0.1:5180
```

Open **http://127.0.0.1:5180**. Use that address rather than `localhost`, so another dev server on the same port cannot answer instead.

| Command | What it does |
| --- | --- |
| `npm run backend` | Start the archive service |
| `npm run dev` | Start the app with hot reload |
| `npm test` | Frontend tests (Vitest) |
| `npm run test:backend` | Backend tests (pytest) |
| `npm run test:all` | Both |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run perf -- --label X` | Browser timings and checks on synthetic archives, about 30 minutes, written to `tools/perf/results/` (needs Chrome and a prior build) |
| `npm run perf:compare -- <old dist> <new dist>` | Alternates two builds to judge a change, about 15 minutes |
| `npm run deploy:https-flow` | The app in production mode in Chrome, through an HTTPS proxy like `tailscale serve`, on a fictional archive |
| `deploy/test/verify-vm.sh PHASE` | The Compose deployment on a real Linux machine, with attacks and crashes. **Wipes `/srv/this-is-you`: throwaway machines only.** |
| `npm run readiness:recovery` | An import killed between saving a file and recording it, in Chrome, on a fictional archive: restarts, resuming, and the report against Documents |
| `npm run readiness:delete` | Deleting a document in Chrome on a fictional archive: asking first, what goes, what stays, and a restart |
| `npm run readiness:worker` | The shared PDF worker in Chrome on fictional PDFs: rapid switching, cancelling, failed files, killed workers, slow files, Stop and worker lifetime. About 7 minutes. Needs a prior build. |
| `npm run readiness:review` | Group review in Chrome on a fictional archive: corrections, stale groups, approval, undo and real restarts |
| `npm run readiness:dev` | Sign in, import and sign out through the real dev server, on a fictional archive. About 1 minute. |
| `npm run readiness -- [--scale 1]` | The whole import, crash, backup and restore workflow in Chrome, on a messy fictional folder. About 4 minutes at scale 1. Needs a prior build. |

## Self-hosting

To run it on an always-on Linux machine, reached privately through Tailscale, see **[docs/deployment.md](docs/deployment.md)**: Docker Compose, encrypted backups, updates, disaster recovery, and what must be checked on real hardware. Tested results are in [docs/reports/](docs/reports/).

**Not yet verified on the actual mini PC.** So far this has run only on an Ubuntu 24.04 ARM64 virtual machine with a stand-in proxy and fictional records. Real Tailscale and x86_64 hardware testing are still outstanding, so do not trust it with real records until that checklist passes.

## Where your documents live

Outside this repository, in a folder only your user account can read:

| System | Default folder |
| --- | --- |
| macOS | `~/Library/Application Support/ThisIsYou` |
| Linux | `$XDG_DATA_HOME/this-is-you` or `~/.local/share/this-is-you` |
| Windows (untested) | `%APPDATA%\ThisIsYou` |

```
archive.sqlite3     Document details, your decisions and import history
originals/ab/cd/    Your files, read-only, named by their SHA-256
incoming/           Uploads in progress. Cleared on every start.
archive.sqlite3.before-upgrade-*   A copy of the database from before each schema upgrade
```

The folder is not encrypted by this app, so turn on disk encryption (FileVault, for example). See [Backups](#backups).

Settings are environment variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `THIS_IS_YOU_DATA_DIR` | see above | The service refuses a folder inside a Git repository |
| `THIS_IS_YOU_MAX_UPLOAD_BYTES` | 209715200 (200 MB) | Per file |
| `THIS_IS_YOU_BACKUP_DIR` | beside the archive, named `ThisIsYou Backups` | Refused inside the archive or a Git repository. Point it at another drive to survive losing this one. |
| `THIS_IS_YOU_PORT` | 8000 | Set it for both `npm run backend` and `npm run dev` |
| `THIS_IS_YOU_HOST` | 127.0.0.1 | Loopback only. Any other address stops the service from starting. |
| `THIS_IS_YOU_PUBLIC_ORIGIN` | none | Production: the one https address it answers on. Also requires a working sandbox. |
| `THIS_IS_YOU_WEB_DIR` | none | Production: the built app, served by this service |
| `THIS_IS_YOU_READER_SOCKET` | none | Production: where the reader container listens |
| `THIS_IS_YOU_REQUIRE_SANDBOX` | off | Set to `1` to stop reading without a working sandbox, outside production too |

## How uploads work

1. The file streams into a private temp file while being hashed, with the size limit enforced as it arrives.
2. It must have a `.pdf` name, start with a PDF header and end with a PDF end marker. This catches wrong and truncated files. It does not prove that a PDF is well formed.
3. It moves to `originals/` as read-only, named by its hash. The name you gave it is only stored as text, and is never used to build a path.
4. Its metadata is saved. If those exact bytes are already in the archive, no new document or file is created, and the arrival is recorded in the document's import history.
5. The file is queued to be read, one document at a time in the background.

## Importing a whole folder

Choose or drop a folder on the Import screen. Nested folders are included, and files are streamed one at a time, so size is not limited by memory.

- **Every file gets a line in the report,** including files that were refused. Nothing is skipped silently.
- **The report is saved in the archive,** so closing the browser or a crash does not lose it. Sending stops if the browser closes, because only the browser can read your folder. Reading continues in the service.
- **To continue,** choose the same folder again. Finished files are not sent again, and identical bytes are one document, however many times they arrive. A file's report line changes in the same database transaction as its document. One crash window can still leave the report off by one, with no file lost: see [known issues](docs/known-issues.md).
- **Stored, read and verified are separate.** A scanned file is stored and not read. Nothing is verified by importing.
- **Retry failures** reads failed files again. Files that never arrived need the folder chosen again after a page reload, since the browser no longer has access to them.
- Your files are only read, never changed. **Remove this report** deletes the report and its folder paths from the archive after asking. The documents stay, and older backups still hold the report.

Limits: the screen lists up to 500 lines of a report at once, so use the filters past that. Folder paths are stored in the archive and its backups, and folder names can be sensitive. A file stored just as the service crashed, and never sent again, stays in `originals/` unlisted and is not backed up.

## Identity check

Enter your name, birth date and any previous names on the Import screen. Each reading records the names and birth dates printed under a patient label, and these are compared with your details when a document is shown. The details never reach the document reader, so changing them updates every flag with nothing read again.

| Result | Meaning |
| --- | --- |
| Possible match | The printed details resemble yours. A suggestion, not verification. |
| Possible mismatch | A printed name or birth date differs. It may belong to someone else, or be printed differently: nicknames and married names are flagged unless listed. |
| Could not be determined | No readable text, no recognized label, or a birth date with none set in your details. |

A flag never refuses, removes or verifies anything. Only English labels are recognized, and a name printed without a label is not noticed. These details are stored unencrypted in the archive and in backups, like everything else there.

## Backups

**Back up now** on the Import screen writes an encrypted backup and tests it. It stays off until you choose a backup passphrase. From the command line, with the service running or not:

```sh
npm run backend -- backup-key set           # Once: choose the passphrase backups are encrypted for. It is not stored.
npm run backend -- backup [--to FOLDER]     # Write an encrypted one, and test it
npm run backend -- verify BACKUP            # Check every byte and relationship. Changes nothing.
npm run backend -- restore BACKUP --to NEW_FOLDER
npm run backend -- backup --plain           # An unencrypted folder. Anyone who can read it can read every record.
npm run backend -- prune [--keep 3] [--include-replaced] [--yes]   # Lists old backups and leftovers. Removes them only with --yes.
```

- **What is in one:** a consistent snapshot of the database, which holds your metadata, decisions, results, correction history, import reports and identity details, plus every original, and a manifest of hashes, record counts and version numbers.
- **It is safe while the app runs.** The snapshot uses SQLite's online backup, so it includes everything committed to the WAL and nothing half-written.
- **An interrupted backup cannot be mistaken for one.** It is built as `*.incomplete` and renamed only when whole. Leftovers are refused, listed as unusable, and cleared by the next backup.
- **Damage is caught:** a changed, missing or extra file, a damaged database, broken relationships, an edited manifest, or a backup from a newer version. Nothing is restored from a backup that fails.
- **Your archive is protected.** Restoring into a folder that holds files needs its exact name typed, refuses while a service is using it, checks the new copy completely first, and moves the old folder to `*.replaced-*` instead of deleting it. To start using a restored folder, point `THIS_IS_YOU_DATA_DIR` at it.

- **Encrypted by default.** A checked backup is sealed into one file. Changing, reordering, removing or adding anything stops it opening. The destination never holds a plain copy, even after a crash. `verify` and `restore` accept the file and ask for its passphrase. **Lose that passphrase and those backups are gone, by design.**
- **This machine cannot open its own backups.** It keeps only a public key, so it can write them with no passphrase around, and a compromised machine cannot read the ones already written.
- **Other drives:** the app says when backups share the archive's drive. A destination whose parent folder is missing is refused, so an unplugged drive never becomes a surprise folder on this one.
- **Sign-in details are never in a backup.** A restored archive stays closed until you run `set-passphrase` for it.

**Not covered.** Old backups go only when you run `prune`. An encrypted backup needs room for a full plain copy in the archive folder while it is built. A schedule is part of [self-hosting](docs/deployment.md), not this local setup.

## Reading, reviewing and verifying

Each document has three separate statuses:

| Status | Answers | Values |
| --- | --- | --- |
| Extraction | What could the machine read? | `pending`, `running`, `extracted`, `partial`, `image_only`, `encrypted`, `no_text`, `failed`, `too_complex` |
| Review | Where is a person in the workflow? | `not_started`, `in_progress`, `completed` |
| Verification | How many details has a person confirmed? | `unverified`, `partially_verified`, `verified` |

**Proposals are not facts.** Fixed text rules propose each detail with a confidence level, a reason, the source page and the source line. A proposal changes nothing else in the app: until you decide, the title stays the filename, the date stays the import date, and the type stays unclassified. In the API, a field's `value` holds only what a person decided, and an inferred value appears only under `proposal`. High confidence means the rule found a clear label. It does not mean the value is right.

**For each detail you can** confirm the proposal, correct it, or mark it as not stated in the document. Decisions are append-only, and the proposal stays beside your correction, so every change can be traced. The original file is never touched. Changing a detail after a finished review reopens the review. A review can only finish once every detail has a decision.

## Laboratory results

**What is recognized.** Rows from text-based PDFs for complete blood counts, metabolic panels, lipid panels and thyroid tests, in common layouts: test name, value, unit, reference range and flag, in any of the usual column orders. Rules are fixed and local. Other tests are proposed only when a row has a name, value, unit and range together, and they are marked for a closer look. Anything else is left alone, and the document stays reviewable with results added by hand.

**Result tables.** Differentials and blood count unit spellings such as `10*3/uL` and `K/mcL` are included. Tables headed "Your Value", "Standard Range" or "Component Results" are read whether each row is on one line, each cell is on its own line, or a label sits beside each value, and they can continue across pages. Only cells that follow one another under one test name are joined, so a page where all names come before all values is not paired up by counting. A row that could only be partly read is still listed, with what is uncertain, and one with no value cannot be approved until you enter it. These layouts were built from fictional examples of the general format, so a real report may still differ.

**Reviewing results.** Results are listed one per line beside the original, in the order the report printed them. Selecting one marks its printed line in the original, which scrolls and zooms on its own. Each result needs its own decision: **Accept** in one click, or **Reject**, or **Correct**, where "Save and accept" keeps what was first read in the history. A result the reader doubted shows **Check** and its reason, and one with no value read shows **Enter value**, never Accept. Word, range and unitless results are marked quietly and are not graphed. Keys work in the list: ↑ ↓ move, A accepts, R rejects, C corrects, U undoes; they do nothing while typing in a form. Every decision can be undone, and the history keeps each step. A rejected suggestion is left out of your verified records and stays visible in review and its history. Nothing is ever approved automatically, and there is no select-all. Results approved as a group by an earlier version stay so, and **Undo group approval** still returns them to review.

**What is never made up.** A missing unit stays missing. A flag is only what the laboratory printed, and is never worked out from the range. Values are kept exactly as printed, so 14.20 stays 14.20.

**Four separate dates.** Each result keeps these apart, and none stands in for another:

| Date | Meaning | If unknown |
| --- | --- | --- |
| `collected_on` | When the specimen was taken. Charts use this. | Stays unknown. The result is listed but not drawn. |
| `reported_on` | The date printed on the report | Stays unknown. Screens say "Not printed". |
| `documented_on` | When the result entered any record. Proposed from the report date. | Stays unknown. See below. |
| `imported_at` | When it reached this archive | Always known |

**As known then and as understood now.** "As understood now" places a result at its collection date. "As known then" places it at its documented date, or at its import date when no documented date is known. So a 2015 result imported today, with no report date, is hidden from "as known then" for 2016. That is deliberate: nothing shows it was documented earlier. If you know when it was documented, enter that date.

**Review.** The original PDF sits beside a table of proposed results, each with its source page, line and text. You can accept or reject each one, correct its name, value, unit, range, flag and dates, or add one by hand. Every action saves immediately, so you can stop and resume. Correcting an accepted result takes it off the charts until you accept it again. What was first read and every change after that are kept in `lab_observation_revisions`.

**User-entered results.** Use **Enter a result** on the Import screen for a result with no document, or **Add a measurement** during a review to link one to a document. These are always labeled "User-entered" wherever they appear, keep their editing history, and never count as coming from a laboratory report, even when linked to a document. One entered from the Import screen goes on the charts immediately, because you typed it. One added to a document during review waits for you to accept it, like the others on that page. If you enter a result that a report you accepted also contains, the chart shows the report's copy.

**Charts.** Only verified results with a collection date and an exact number are drawn. Limits such as `<0.5`, and results with no collection date, are listed but not drawn. Each point keeps the range printed on its own report, and no band is drawn when none was printed. Different units are plotted separately, and comparisons across units are refused. The app stores a converted value when a conversion for that test is known, but charts do not use it. The same test, date, value and unit from two documents is drawn once. Numbers are shown as recorded, and the app does not say whether a change is good or bad.

**Test identifiers** are this app's own (`this-is-you-v1`), not LOINC, because a correct LOINC code depends on specimen and method details that reports often leave out.

## Viewing an original

Originals are drawn on the page by pdf.js, on this computer. Hover over a page to magnify it, and click a page to enlarge it in the same tab. A file it cannot draw falls back to the browser's own viewer, and Download original always stays. Text in the drawn pages cannot be selected.

A large scan can take minutes to draw, and waiting never cancels it. After 15 seconds a note says it is still working, with a Stop button that ends the work and opens the browser's own viewer. If the PDF worker ends, the browser's lock on it is released, so that is noticed in about two seconds and the file reopens by itself.

A worker that hangs looks exactly like one that is busy, so a hung file waits until you press Stop or switch to another file. Locks need HTTPS or localhost. Without them, a worker silent for 10 minutes is ended instead.

Numeric dates are read month first (03/11/2024 is 11 March), and this alone is not a reason for low confidence. A date that only works day first, such as 28/03/2024, is read that way. A two-digit year still gets a warning.

Urine microscopy is read too: counts per field such as `0-2 /HPF`, printed as a range, and graded words such as Few, Rare or Moderate, which are kept as printed. A test name whose value could not be read is proposed with no value and the printed text quoted, so it is never silently dropped.

## Deleting a document

**Delete document** on the Documents screen asks first, by name, then removes the file and everything known from it: readings, results, decisions, review approvals and its rows in the import report. Other documents are not touched. It is permanent, and a crash partway either finishes it at the next start or leaves everything in place. It does not reach backups already made, which still hold the file until they are removed, and a deleted file's folder will import it again if chosen again.

## What the document reader does not handle


- **Scanned or image-only PDFs** are detected, stored and viewable, but not read. There is no OCR. Enter their details by hand.
- **Password-protected PDFs** are detected and not opened by the reader, even if the password is blank.
- **Partly readable files** are marked `partial`, for example when some pages are scans. Only the first 30 pages are read.
- **Non-English documents and unusual layouts** will mostly get no proposal. Rules look for English labels. Finding nothing is reported as nothing. A result split across lines, or a table drawn as an image, is not recognized.
- **A date like 03/11/2020** could mean March or November, so it is proposed at low confidence with both readings shown.
- **Patient identity is not checked.** The app does not notice a document, or a result, that belongs to someone else.

**Duplicates.** Identical bytes are one document and are not read twice. Different files with the same text, such as the same report saved twice, are both kept and flagged as possible duplicates. You decide what they are.

**Untrusted files.** PDFs are read by `pypdf` in a separate short-lived process, never in the service itself. That process has a wall-clock limit (45 seconds), a CPU limit (30 seconds), a memory limit (1 GB), no write access to files, no core dumps, an empty environment, and Python's network functions disabled. It reads at most 30 pages and 400,000 characters. Only a small summary comes back, which the service checks before saving: the full text never leaves the process and is not stored. Its error output is discarded so that document text cannot reach a log.

**Sandbox.** The reader receives the document as an open file and is never told a path. It runs with no network, no writing, no other programs and no view of the archive: in its own container in production, under `sandbox-exec` on macOS, and under `bubblewrap` on Linux where the system allows it (stock Ubuntu 24.04 does not). This is tested at every start against what it should block. In production, without a working sandbox, files are stored and stay unread, and the app says so. In development it runs with the limits above and says so. This contains a bad file. It does not prevent one, and a subverted reader could still return false results for that document, which stay unverified until you check them.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/documents` | Upload one PDF as the raw body. Returns 201, or 200 with `duplicate: true`. |
| `GET /api/documents` | List documents with statuses, proposals and decisions, newest first |
| `GET /api/documents/{id}` | One document, with import, decision and reading history |
| `GET /api/documents/{id}/content` | The original bytes. Add `?download=true` to save a copy. |
| `POST /api/documents/{id}/metadata/{field}` | Record a decision: `confirmed` (with `proposal_id`), `corrected` (with `value`) or `not_stated` |
| `POST /api/documents/{id}/review` | `{"complete": true}` finishes the review. Refused until every detail is decided. |
| `POST /api/documents/{id}/extract` | Read the file again. Adds proposals and keeps every decision. |
| `GET /api/observations` | Every laboratory result, whatever its status, with history |
| `POST /api/observations` | Enter a result by hand |
| `POST /api/observations/{id}/correct` | Correct a result. Takes it off the charts until accepted again. |
| `POST /api/observations/{id}/verify`, `/reject`, `/reopen` | Accept, reject or reopen one result |
| `POST /api/observations/approve-group` | Approve one exact set of rows at the versions shown. All of them, or none. |
| `POST /api/observations/group-approvals/{id}/undo` | Return a group to review. The history is kept. |
| `GET /api/lab-tests` | The known tests |
| `POST /api/import-batches`, `GET /api/import-batches` | Start a batch, or list saved reports with their counts |
| `POST /api/import-batches/{id}/items` | List up to 500 files. Listing one twice returns the same row. |
| `GET /api/import-batches/{id}/items` | Report lines. Filter with `category` or `identity`, page with `offset` and `limit`. |
| `POST /api/import-batches/{id}/items/{item}/file` | Send one file as the raw body. Repeating it for a stored file changes nothing. |
| `POST /api/import-batches/{id}/retry-reading` | Read failed files again. Add `?item=` for one. |
| `DELETE /api/import-batches/{id}` | Delete a report and its folder paths. Documents stay. |
| `POST /api/auth/login` | Sign in. Open, with limited guesses. |
| `POST /api/auth/logout`, `/logout-everywhere` | End this session, or every session. |
| `GET /api/backups/archive-health` | What the last start recovered, set aside or could not find, and whether the reader is sandboxed. |
| `GET /api/identity`, `PUT /api/identity` | Your details, used only to raise flags |
| `GET /api/backups`, `POST /api/backups` | List backups, or start one |
| `POST /api/backups/{name}/check` | Test-restore a backup. An encrypted one needs its passphrase in the body, used in memory for this check. |
| `GET /api/status` | Whether the service is up, and the size limit |

## Performance

Timings use fictional archives only, and any request to another host is blocked. `tools/perf/baselines/` holds full runs from before and after the first performance work. These were taken on one Mac, so use them as reference points. To judge a change, keep a copy of the old `dist/` and run `npm run perf:compare`: separate runs differ by 10 to 15 percent. `perf:compare` does not cover PDF previews. The `npm run perf` preview timing now waits for the page to be drawn, so results from before this are not comparable: older runs stopped at the browser viewer's frame or at an undrawn canvas.

Medians from alternating loads with nothing cached, in ms, before and after that work:

| Archive and screen | First text | Charts painted | Longest freeze |
|---|---|---|---|
| Small (8 documents), Overview | 4096 → 2636 | 4443 → 4665 | 2192 → 1030 |
| Small, Compare | 4576 → 2952 | 5058 → 5218 | 2964 → 1089 |
| Demo, Overview | 5700 → 4036 | 5930 → 6013 | 3402 → 1644 |
| Large (5,400 results), Overview | 7240 → 5820 | 7516 → 7110 | 4059 → 1436 |

On a page's first paint, charts draw just after the text. This is deliberate: the interface responds sooner, and charts can finish slightly later.

**Known limitations.** These are recorded and not being optimized until there is evidence that they matter in normal use.

- **Cold start.** The first load with nothing cached takes about 2.6 seconds to first text on a small archive and about 4 seconds in demo mode. Reloads are much faster, as Chrome reuses compiled code.
- **PDF preview.** The first click on a document can freeze the page for 1.5 to 2.8 seconds. The file itself is served in about 10 ms. The cause is probably the first render of the detail view, but this has not been confirmed.
- **Large archives.** 5,400 results means an 11.4 MB observations response (about 490 ms), and each correction takes about 250 ms.

A Mac that goes to sleep freezes the browser along with everything else, which looks like a hung page. The perf tools keep the Mac awake and report any sleep during a run.

## Security and privacy

- **Stays on this computer.** Both servers bind to loopback. The service also refuses any connection that is not from loopback, even if someone starts it with a wider address directly.
- **No outside services.** No analytics, telemetry or CDN. Fonts are bundled. The API docs pages are off because they load scripts from a CDN.
- **Other websites are shut out.** Host header checks stop DNS rebinding, uploads need a custom header other sites cannot send, cross-site requests are refused, and no CORS access is granted.
- **No health data in logs.** Access logs are off. The service logs only a document id, an outcome, a count and a size.
- **Files are served safely.** Always as `application/pdf`, with `nosniff`, `no-store` and a restrictive content security policy.

**If a read fails,** the app tries again a few times, then shows what failed with a **Retry** button: no answer from the service, or an error from it. It never shows demo data or an empty archive in place of your records. If a refresh fails during use, your records stay on screen, marked as possibly out of date.

**Signing in.** Every route needs a session except status and sign-in. The passphrase is set only from the command line, so nothing that reaches the service can claim your archive. A device stays signed in for 14 days at most, or until it goes 3 days unused. `npm run backend -- doctor` shows where your archive stands, and `sign-out-everywhere` ends every session.

**Known limits.** Read [docs/threat-model.md](docs/threat-model.md), which separates websites, other devices, other accounts and a compromised host. The main one: **another program running under your own account can read everything directly**, and no login changes that. Run this under its own account on a dedicated machine. Identity details, the live archive and plain backups are not encrypted by this app, so keep disk encryption on. A PDF is opened by your browser's own viewer, so it is only as safe as that viewer. The dev server is not a hardened production setup.

## Demo mode

Use **Open demo archive** in the header, or go to `http://127.0.0.1:5180/?demo`.

- Switching is a full page load, so no state crosses over.
- The fictional dataset is a separate code chunk that a real archive never loads, and a test enforces this.
- Demo mode never calls the backend. Files you pick there are only listed.
- Every demo screen shows the DEMONSTRATION DATA banner, the sample archive label, and "fictional demo" in the page title.
- If the service is down, the app says so. It never falls back to demo data.

## Layout

```
backend/
  this_is_you/
    config.py       Settings, and the refusal of unsafe ones
    security.py     The session, loopback, host and cross-site checks on every request; response headers
    auth.py         The passphrase, signed-in devices and limited guesses
    reconcile.py    Squaring the originals folder with the database at start
    storage.py      The file store: streaming, hashing, validation
    documents.py    Recording uploads and reading documents back
    metadata.py     Running the reader, proposals and decisions
    observations.py Laboratory results: creating, correcting, approving
    imports.py      Batches of files and the report on them
    identity.py     Comparing printed patient details with yours, as a suggestion
    backup.py       Writing, checking, restoring and pruning backups
    backup_crypto.py  Encrypted backups
    lab_catalog.py  Known tests, unit spellings, safe conversions
    extraction/     worker.py: the limited process. rules.py and lab_rows.py: the text rules.
                    runner.py: starts it and checks its output. queue.py: one at a time.
    models.py       Database tables
    migrations/     Alembic migrations, applied on every start
    api/            HTTP routes
  tests/
tools/          perf/: browser timings. readiness/: the whole workflow on a messy fictional folder.
deploy/        Compose support files, host setup, the isolation check and the Linux test
docs/deployment.md  Self-hosting, updates and disaster recovery
docs/threat-model.md  Who this defends against, how, and what it cannot stop
docs/data-model.md  How future record types will attach to documents
src/
  domain/       Types, date and number formatting, shared vocabulary. No React.
  data/         The fictional dataset. Only services/demoArchiveApi.ts imports it.
  services/     archiveApi.ts: the interfaces.
                observationRecords.ts: turns verified results into what the charts read.
                localArchiveApi.ts: the real service. demoArchiveApi.ts: the demo.
                importService.ts: the demo's simulated import.
  state/        store.ts: all app state and actions, plain TypeScript.
                batchImport.ts: sends a folder and follows the saved report.
  viewmodels/   One per screen. Turns state and data into what the screen displays.
  charts/       The SVG charts.
  components/   App shell and shared controls.
  screens/      One per screen. Presentation only.
  styles/       Base CSS and the bundled fonts.
```

Data flows one way: `Archive` → `AppStore` → view model → screen.

**The time machine has two rules.** `state.cur` is the only snapshot date, and every screen reads it. `AppStore.isVisible` decides whether a record is part of the snapshot: "As known then" compares the date it was documented, and "As understood now" compares the date it happened. A real document counts as documented on its import date, and uses its service date only once a person has verified it. Results have their own dates, described under [Laboratory results](#laboratory-results).

**Changing the database:** edit `models.py`, then generate a migration against a scratch folder, never your real archive:

```sh
cd backend && THIS_IS_YOU_DATA_DIR=/tmp/tiy-dev .venv/bin/alembic revision --autogenerate -m "describe change"
```

A test fails if the migrations and models disagree.

## Design

The Claude Design prototype is the visual source of truth, so typography, spacing and copy match it. Layout styles stay inline, as in the prototype, using the tokens in `theme.ts` and the shared recipes in `components/styles.ts`.

Keep the editorial, archival look: no gradients, pill shapes, heavy shadows, decorative illustrations, emoji icons or AI features, and no em dashes in interface copy.

## License

Apache License 2.0. See [LICENSE](LICENSE). The bundled fonts (IBM Plex Sans, IBM Plex Mono and Newsreader) are under the SIL Open Font License 1.1; their license texts are in each `@fontsource` package.
