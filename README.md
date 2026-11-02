# This Is You

A local-first, open-source personal health archive and time machine. Pick any date and see your record as it stood then: only what had been documented by that date ("As known then"), or including what was documented about that period later ("As understood now").

**This milestone is the frontend only.** All data is fictional and labeled as such. Import is simulated: files you choose are listed by name and size, and their contents are never read, uploaded or stored. The app does not interpret results or give medical advice.

## Run it

Needs Node 20 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit, workflow and screen tests (Vitest) |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the production build |

The web fonts (Newsreader, IBM Plex Sans, IBM Plex Mono) load from Google Fonts, so the first load needs a network connection. Self-host them before treating the app as fully offline.

## Layout

```
src/
  domain/       Types, date and number formatting, shared vocabulary. No React.
  data/         The fictional dataset. Only services/archiveApi.ts imports it.
  services/     archiveApi.ts: where the data comes from.
                importService.ts: the simulated import pipeline.
  state/        store.ts: all app state and actions, plain TypeScript.
                useStore.ts: connects the store to React.
  viewmodels/   One per screen. Turns state and data into what the screen displays.
  charts/       The SVG charts: timeline, biomarker, weight and compare charts.
  components/   App shell and shared controls.
  screens/      One per screen. Presentation only.
  theme.ts      Colors and fonts.
```

Data flows one way: `Archive` → `AppStore` → view model → screen. Screens hold no logic beyond rendering, and charts keep only their own hover and drag state.

## The two rules that hold the app together

1. **One snapshot date.** `state.cur` is the only snapshot date. Every screen reads it.
2. **One visibility rule.** `AppStore.isVisible` decides whether a record is part of the snapshot. "As known then" compares the date it was `documented`; "As understood now" compares the date it happened.

Every `LabResult` and `HealthEvent` carries a `documentId`, so any value can be traced to its source document. `src/test/archive.test.ts` fails if a link is broken.

## Connecting a backend later

The planned backend is FastAPI with SQLite, with original documents kept on the local filesystem. None of it exists yet.

1. **Reading data:** implement `ArchiveApi` from `src/services/archiveApi.ts` and pass it in `src/main.tsx`. The `Archive` type in `src/domain/types.ts` is the contract.
2. **Importing:** replace `simulateProcessing` in `src/services/importService.ts` with upload and status polling. `ImportJob` already carries progress and outcome.
3. **New sources:** FHIR, portal exports, imaging reports, Apple Health and smart scales all end up as `ArchiveDocument`, `LabResult`, `HealthEvent` or `WeightReading` records, each linked to its document.

`loadArchive` returns the whole archive at once, which suits the demo dataset. A real archive may need paged or per-screen endpoints.

## Design

The Claude Design prototype is the visual source of truth, so typography, spacing and copy match it. Layout styles stay inline, as in the prototype, using the tokens in `theme.ts` and the shared recipes in `components/styles.ts`.

Keep the editorial, archival look: no gradients, pill shapes, heavy shadows, decorative illustrations, emoji icons or AI features, and no em dashes in interface copy.

## License

Apache License 2.0. See [LICENSE](LICENSE).
