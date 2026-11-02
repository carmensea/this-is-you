# This Is You

A local-first, open-source personal health archive and time machine. Pick any date and see your record as it stood then: only what had been documented by that date ("As known then"), or including what was documented about that period later ("As understood now").

This version does two separate things:

- **Your archive** stores real PDF files on your computer, unchanged, and reads text-based ones to propose basic details: document type, date of service, provider and title. Nothing counts as verified until you confirm or correct it. Test results are not extracted yet, so the record-based screens (Overview, Biomarkers, Medical history, Compare) stay empty and say why.
- **The demo archive** is a complete, entirely fictional record that shows what those screens are for. Its import is simulated.

The two never mix. See [Demo mode](#demo-mode).

The app does not interpret results or give medical advice. It has no AI features and does no OCR.

## Run it

Needs Node 20 or newer and Python 3.11 or newer. These commands assume macOS or Linux.

```sh
npm install
npm run backend:setup     # once: creates backend/.venv and installs exact dependency versions
```

Then, in two terminals:

```sh
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

**Back up this whole folder.** It is not encrypted by this app, so turn on disk encryption (FileVault, for example). To keep a backup consistent, stop the service first.

Settings are environment variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `THIS_IS_YOU_DATA_DIR` | see above | The service refuses a folder inside a Git repository |
| `THIS_IS_YOU_MAX_UPLOAD_BYTES` | 209715200 (200 MB) | Per file |
| `THIS_IS_YOU_PORT` | 8000 | Set it for both `npm run backend` and `npm run dev` |
| `THIS_IS_YOU_HOST` | 127.0.0.1 | Loopback only. Any other address stops the service from starting. |

## How uploads work

1. The file streams into a private temp file while being hashed, with the size limit enforced as it arrives.
2. It must have a `.pdf` name, start with a PDF header and end with a PDF end marker. This catches wrong and truncated files. It does not prove that a PDF is well formed.
3. It moves to `originals/` as read-only, named by its hash. The name you gave it is only stored as text, and is never used to build a path.
4. Its metadata is saved. If those exact bytes are already in the archive, no new document or file is created, and the arrival is recorded in the document's import history.
5. The file is queued to be read, one document at a time in the background.

## Reading, reviewing and verifying

Each document has three separate statuses:

| Status | Answers | Values |
| --- | --- | --- |
| Extraction | What could the machine read? | `pending`, `running`, `extracted`, `partial`, `image_only`, `encrypted`, `no_text`, `failed`, `too_complex` |
| Review | Where is a person in the workflow? | `not_started`, `in_progress`, `completed` |
| Verification | How many details has a person confirmed? | `unverified`, `partially_verified`, `verified` |

**Proposals are not facts.** Fixed text rules propose each detail with a confidence level, a reason, the source page and the source line. A proposal changes nothing else in the app: until you decide, the title stays the filename, the date stays the import date, and the type stays unclassified. In the API, a field's `value` holds only what a person decided, and an inferred value appears only under `proposal`. High confidence means the rule found a clear label. It does not mean the value is right.

**For each detail you can** confirm the proposal, correct it, or mark it as not stated in the document. Decisions are append-only, and the proposal stays beside your correction, so every change can be traced. The original file is never touched. Changing a detail after a finished review reopens the review. A review can only finish once every detail has a decision.

**What the reader does not handle:**

- **Scanned or image-only PDFs** are detected, stored and viewable, but not read. There is no OCR. Enter their details by hand.
- **Password-protected PDFs** are detected and not opened by the reader, even if the password is blank.
- **Partly readable files** are marked `partial`, for example when some pages are scans. Only the first 30 pages are read.
- **Non-English documents and unusual layouts** will mostly get no proposal. Rules look for English labels. Finding nothing is reported as nothing.
- **A date like 03/11/2020** could mean March or November, so it is proposed at low confidence with both readings shown.
- **Patient identity is not checked.** The app does not notice a document that belongs to someone else.

**Duplicates.** Identical bytes are one document and are not read twice. Different files with the same text, such as the same report saved twice, are both kept and flagged as possible duplicates. You decide what they are.

**Untrusted files.** PDFs are read by `pypdf` in a separate short-lived process, never in the service itself. That process has a wall-clock limit (45 seconds), a CPU limit (30 seconds), a memory limit (1 GB), no write access to files, no core dumps, an empty environment, and Python's network functions disabled. It reads at most 30 pages and 400,000 characters. Only a small summary comes back, which the service checks before saving: the full text never leaves the process and is not stored. Its error output is discarded so that document text cannot reach a log.

**Limits of that isolation.** This is containment, not a full sandbox. The network block is at the Python level rather than enforced by the operating system, and the reader can still read other files your user account can read. A serious flaw in Python or `pypdf` could get past these limits, so keep dependencies updated.

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
| `GET /api/status` | Whether the service is up, and the size limit |

## Security and privacy

- **Stays on this computer.** Both servers bind to loopback. The service also refuses any connection that is not from loopback, even if someone starts it with a wider address directly.
- **No outside services.** No analytics, telemetry or CDN. Fonts are bundled. The API docs pages are off because they load scripts from a CDN.
- **Other websites are shut out.** Host header checks stop DNS rebinding, uploads need a custom header other sites cannot send, cross-site requests are refused, and no CORS access is granted.
- **No health data in logs.** Access logs are off. The service logs only a document id, an outcome, a count and a size.
- **Files are served safely.** Always as `application/pdf`, with `nosniff`, `no-store` and a restrictive content security policy.

**Known limits.** There is no login, so other programs and other user accounts running on this computer can reach the service while it runs (though other accounts cannot read the files on disk). Files are not encrypted by the app or scanned for malware. A PDF is opened by your browser's own viewer, so it is only as safe as that viewer. The dev server is not a hardened production setup.

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
    security.py     Loopback, host and cross-site checks; response headers
    storage.py      The file store: streaming, hashing, validation
    documents.py    Recording uploads and reading documents back
    metadata.py     Running the reader, proposals and decisions
    extraction/     worker.py: the limited process. rules.py: the text rules.
                    runner.py: starts it and checks its output. queue.py: one at a time.
    models.py       Database tables
    migrations/     Alembic migrations, applied on every start
    api/            HTTP routes
  tests/
docs/data-model.md  How future record types will attach to documents
src/
  domain/       Types, date and number formatting, shared vocabulary. No React.
  data/         The fictional dataset. Only services/demoArchiveApi.ts imports it.
  services/     archiveApi.ts: the interfaces.
                localArchiveApi.ts: the real service. demoArchiveApi.ts: the demo.
                importService.ts: the demo's simulated import.
  state/        store.ts: all app state and actions, plain TypeScript.
  viewmodels/   One per screen. Turns state and data into what the screen displays.
  charts/       The SVG charts.
  components/   App shell and shared controls.
  screens/      One per screen. Presentation only.
  styles/       Base CSS and the bundled fonts.
```

Data flows one way: `Archive` → `AppStore` → view model → screen.

**The time machine has two rules.** `state.cur` is the only snapshot date, and every screen reads it. `AppStore.isVisible` decides whether a record is part of the snapshot: "As known then" compares the date it was documented, and "As understood now" compares the date it happened. A real file counts as documented on its import date, and uses its service date only once a person has verified it.

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
