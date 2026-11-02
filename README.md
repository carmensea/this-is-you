# This Is You

A local-first, open-source personal health archive and time machine. Pick any date and see your record as it stood then: only what had been documented by that date ("As known then"), or including what was documented about that period later ("As understood now").

This version does two separate things:

- **Your archive** stores real PDF files on your computer: unchanged, checksummed, and viewable from the Documents screen. Nothing reads their contents yet, so the record-based screens (Overview, Biomarkers, Medical history, Compare) stay empty and say why.
- **The demo archive** is a complete, entirely fictional record that shows what those screens are for. Its import is simulated.

The two never mix. See [Demo mode](#demo-mode).

The app does not interpret results or give medical advice.

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
archive.sqlite3     Document metadata and import history
originals/ab/cd/    Your files, read-only, named by their SHA-256
incoming/           Uploads in progress. Cleared on every start.
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

| Endpoint | Purpose |
| --- | --- |
| `POST /api/documents` | Upload one PDF as the raw body. Returns 201, or 200 with `duplicate: true`. |
| `GET /api/documents` | List documents, newest first |
| `GET /api/documents/{id}` | One document with its import history |
| `GET /api/documents/{id}/content` | The original bytes. Add `?download=true` to save a copy. |
| `GET /api/status` | Whether the service is up, and the size limit |

## Security and privacy

- **Stays on this computer.** Both servers bind to loopback. The service also refuses any connection that is not from loopback, even if someone starts it with a wider address directly.
- **No outside services.** No analytics, telemetry or CDN. Fonts are bundled. The API docs pages are off because they load scripts from a CDN.
- **Other websites are shut out.** Host header checks stop DNS rebinding, uploads need a custom header other sites cannot send, cross-site requests are refused, and no CORS access is granted.
- **No health data in logs.** Access logs are off. The service logs only a document id, an outcome and a size.
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

**The time machine has two rules.** `state.cur` is the only snapshot date, and every screen reads it. `AppStore.isVisible` decides whether a record is part of the snapshot: "As known then" compares the date it was documented, and "As understood now" compares the date it happened. For a real file, whose own date is unknown, both use the import date.

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
