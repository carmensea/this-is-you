// Application state and actions. Plain TypeScript with no React, so it can be tested directly.
import { addMonths, fLong } from '../domain/dates';
import { rangeOnly, fmtR } from '../domain/format';
import { DCATL } from '../domain/vocabulary';
import type { Archive, ArchiveDocument, HealthEvent, ImportFile, ImportJob, ISODate, LowConfidenceNote, MetadataFieldKey, SnapshotMode } from '../domain/types';
import { ArchiveRequestError, type DocumentsBackend, type FieldDecision } from '../services/archiveApi';
import { FIELD_LABEL, FIELD_ORDER, displayValue, isReading } from '../domain/documentReview';
import { listOnly, simulateProcessing } from '../services/importService';
import { todayLocal, withDocuments } from '../services/localArchiveApi';
import { fShort } from '../domain/dates';
import { fmtSize, kindOf } from '../domain/format';

const MAX_PARALLEL_UPLOADS = 2;
const READING_POLL_MS = 800;

export type View = 'overview' | 'biomarkers' | 'history' | 'documents' | 'compare' | 'import';
export const VIEWS: View[] = ['overview', 'biomarkers', 'history', 'documents', 'compare', 'import'];
export const VIEW_LABELS: Record<View, string> = {
  overview: 'Overview',
  biomarkers: 'Biomarkers',
  history: 'Medical history',
  documents: 'Documents',
  compare: 'Compare',
  import: 'Import',
};

type ReviewLine = {
  key: string;
  mk: string;
  ri: number;
  measure: string;
  value: string;
  unit: string;
  ref: string;
  flag: string;
  conf: 'low' | 'high';
  reason: string;
};

export type ReviewStatus = 'pending' | 'confirmed' | 'excluded';
export interface ReviewPatch {
  status?: ReviewStatus;
  edited?: boolean;
  value?: string;
  unit?: string;
  ref?: string;
  flag?: string;
}
export interface ReviewRecord {
  lines: Record<string, ReviewPatch>;
  fields: Record<string, ReviewPatch>;
}
export interface ReviewDraft {
  value?: string;
  unit?: string;
  ref?: string;
  flag?: string;
}

export interface AppState {
  view: View;
  returnTo: { view: View; y: number } | null;
  notice: string | null;
  // Shared time machine: every screen reads these two.
  cur: ISODate;
  mode: SnapshotMode | null;
  // Display preferences. The prototype set these from its editor panel, not from a screen.
  units: 'kg' | 'lb';
  future: 'faded' | 'hidden';
  // Overview and Biomarkers
  marker: string;
  sel: number | null;
  range: 'all' | 'window';
  bxRange: 'all' | '10' | '5' | 'custom';
  bxFrom: number;
  bxTo: number;
  bxCmp: string | null;
  bxUnit: string | null;
  bxQuery: string;
  bxFlagged: boolean;
  bxMissing: boolean;
  bxDesc: boolean;
  // Medical history
  hxQuery: string;
  hxTypes: Record<string, boolean>;
  hxSource: string;
  hxFrom: number;
  hxTo: number;
  hxDesc: boolean;
  hxShowAfter: boolean;
  hxOpen: Record<string, boolean>;
  // Documents
  dQuery: string;
  dTypes: Record<string, boolean>;
  dStatus: Record<string, boolean>;
  dDesc: boolean;
  dSnapOnly: boolean;
  dSel: string | null;
  dPage: number;
  dHL: string | null;
  // Import and review
  imp: ImportJob[];
  dz: boolean;
  rv: Record<string, ReviewRecord>;
  rvDoc: string | null;
  rvLine: string | null;
  rvEdit: string | null;
  rvDraft: ReviewDraft;
  rvStage: 'review' | 'confirm' | 'done';
  rvFilter: 'all' | 'attention' | 'done';
  /** Why the last decision on a real document could not be saved. */
  rvError: string | null;
  /** The page of the original to show, when following a proposal back to its source. */
  rvSourcePage: number | null;
  accepted: Record<string, boolean>;
  // Compare
  cA: ISODate | null;
  cB: ISODate | null;
  cMk: string;
  cHideEmpty: boolean;
  cAll: boolean;
}

export const initialState: AppState = {
  view: 'overview',
  returnTo: null,
  notice: null,
  cur: '2018-05-08',
  mode: null,
  units: 'kg',
  future: 'faded',
  marker: 'ldl',
  sel: null,
  range: 'all',
  bxRange: 'all',
  bxFrom: 2015,
  bxTo: 2026,
  bxCmp: null,
  bxUnit: null,
  bxQuery: '',
  bxFlagged: false,
  bxMissing: false,
  bxDesc: true,
  hxQuery: '',
  hxTypes: {},
  hxSource: 'all',
  hxFrom: 2009,
  hxTo: 2026,
  hxDesc: true,
  hxShowAfter: true,
  hxOpen: {},
  dQuery: '',
  dTypes: {},
  dStatus: {},
  dDesc: true,
  dSnapOnly: false,
  dSel: null,
  dPage: 0,
  dHL: null,
  imp: [],
  dz: false,
  rv: {},
  rvDoc: null,
  rvLine: null,
  rvEdit: null,
  rvDraft: {},
  rvStage: 'review',
  rvFilter: 'all',
  rvError: null,
  rvSourcePage: null,
  accepted: {},
  cA: null,
  cB: null,
  cMk: 'ldl',
  cHideEmpty: false,
  cAll: false,
};

type Update = Partial<AppState> | ((s: AppState) => Partial<AppState>);

const scrollTop = (y = 0) => {
  if (typeof window !== 'undefined') window.scrollTo(0, y);
};
const scrollY = () => (typeof window !== 'undefined' ? window.scrollY : 0);

export class AppStore {
  state: AppState;
  private listeners = new Set<() => void>();
  private stopSim: (() => void) | null = null;
  private readingTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadsSinceRefresh = false;
  private seq = 0;

  constructor(
    public archive: Archive,
    overrides: Partial<AppState> = {},
    private backend: DocumentsBackend | null = null,
  ) {
    this.state = { ...initialState, ...overrides };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  setState = (u: Update) => {
    this.state = { ...this.state, ...(typeof u === 'function' ? u(this.state) : u) };
    this.listeners.forEach((fn) => fn());
  };

  // Time machine
  get snapshotMode(): SnapshotMode {
    return this.state.mode || 'known';
  }
  /** The date a record joins the record under the current mode. */
  evKey = (e: { date: ISODate; documented: ISODate }) => (this.snapshotMode === 'known' ? e.documented : e.date);
  /** The central rule of the time machine: is this record part of the snapshot? */
  isVisible = (r: { date: ISODate; documented: ISODate }) => this.evKey(r) <= this.state.cur;
  setCur = (c: ISODate) => {
    const { start, today } = this.archive;
    this.setState({ cur: c < start ? start : c > today ? today : c, sel: null });
  };
  eventKeys = () => [...new Set(this.archive.events.map(this.evKey))].sort();
  stepEvent = (dir: 1 | -1) => {
    const cur = this.state.cur,
      keys = this.eventKeys();
    const k = dir > 0 ? keys.find((x) => x > cur) : [...keys].reverse().find((x) => x < cur);
    if (k) this.setCur(k);
  };
  stepMonths = (n: number) => this.setCur(addMonths(this.state.cur, n));

  // Navigation
  go = (view: View, extra: Partial<AppState> = {}) => {
    this.setState({ view, notice: null, ...extra });
    scrollTop();
  };
  /** Navigate and remember where to return to, keeping the scroll position. */
  goFrom = (view: View, extra: Partial<AppState> = {}) =>
    this.go(view, { returnTo: { view: this.state.view, y: scrollY() }, ...extra });
  goBack = () => {
    const r = this.state.returnTo;
    if (!r) return;
    this.setState({ view: r.view, returnTo: null });
    setTimeout(() => scrollTop(r.y), 40);
  };

  // Source documents
  openDocument = (id: string, highlight: string | null = null) => {
    const v = this.state.view;
    this.go('documents', {
      dSel: id,
      dPage: 0,
      dHL: highlight,
      returnTo: v !== 'documents' ? { view: v, y: scrollY() } : this.state.returnTo,
    });
  };
  openEventDocument = (e: HealthEvent) => this.openDocument(e.documentId);
  openDrawDocument = (draw: number) => this.openDocument('lab-' + draw);
  documentStatus = (d: ArchiveDocument) => (this.state.accepted[d.id] ? ('reviewed' as const) : d.status);

  // Review
  reviewData = (id: string) => {
    if (this.archive.documentsById[id]?.review) return this.personalReviewData(id);
    const a = this.archive,
      d = a.documentsById[id],
      f = a.lowConfidence[id] || {};
    const lines =
      d.draw != null
        ? a.markers.flatMap((mk) => {
            const r = mk.results.find((x) => x.i === d.draw);
            if (!r) return [];
            const o = (f[mk.key] || {}) as Partial<LowConfidenceNote>;
            return [
              {
                key: mk.key,
                mk: mk.key,
                ri: r.i,
                measure: mk.name,
                value: o.read != null ? o.read : fmtR(r),
                unit: o.unit || r.unit,
                ref: rangeOnly(r),
                flag: r.flag as string,
                conf: o.reason ? ('low' as const) : ('high' as const),
                reason: o.reason || '',
              },
            ];
          })
        : [];
    const scanned = d.format.indexOf('Scanned') >= 0;
    const lowDate = f._date || (scanned && !lines.length);
    const fields = [
      { key: 'type', label: 'Document type', value: DCATL[d.cat], conf: 'high' as const, reason: '' },
      {
        key: 'date',
        label: d.cat === 'lab' ? 'Collection date' : 'Date of service',
        value: fLong(d.date),
        conf: lowDate ? ('low' as const) : ('high' as const),
        reason: f._date || (scanned && !lines.length ? 'Scanned page: confirm the date against the original.' : ''),
      },
      {
        key: 'provider',
        label: d.cat === 'lab' ? 'Laboratory' : 'Provider',
        value: d.source,
        conf: 'high' as const,
        reason: '',
      },
      { key: 'patient', label: 'Patient name on document', value: a.patientName, conf: 'high' as const, reason: '' },
    ];
    return { lines, fields };
  };
  /** A real document's details as review rows. Status comes only from what a person has decided. */
  private personalReviewData(id: string) {
    const review = this.archive.documentsById[id].review!;
    const fields = FIELD_ORDER.map((key) => {
      const f = review.fields[key];
      const shownProposal = f.proposal ? displayValue(key, f.proposal.value) : '';
      const hasDecision = f.state === 'confirmed' || f.state === 'corrected' || f.state === 'not_stated';
      return {
        key,
        label: FIELD_LABEL[key],
        value:
          f.state === 'not_stated'
            ? 'Not stated in the document'
            : f.value
              ? displayValue(key, f.value)
              : shownProposal || 'Nothing proposed',
        conf: !f.proposal || f.proposal.confidence === 'low' ? ('low' as const) : ('high' as const),
        reason: f.proposal?.reason ?? '',
        status: hasDecision ? 'confirmed' : 'pending',
        edited: f.state === 'corrected',
      };
    });
    return { lines: [] as ReviewLine[], fields };
  }

  patchReview = (id: string, grp: keyof ReviewRecord, key: string, patch: ReviewPatch) => {
    this.setState((st) => {
      const c: ReviewRecord = st.rv[id] || { lines: {}, fields: {} };
      return { rv: { ...st.rv, [id]: { ...c, [grp]: { ...c[grp], [key]: { ...c[grp][key], ...patch } } } } };
    });
  };
  openReview = (id: string, extra: Partial<AppState> = {}) =>
    this.go('import', {
      rvDoc: id,
      rvStage: 'review',
      rvLine: null,
      rvEdit: null,
      rvFilter: 'all',
      rvError: null,
      rvSourcePage: null,
      ...extra,
    });

  // Simulated import
  addFiles = (list: ImportFile[]) => {
    const files: ImportJob[] = list.map((f) => ({ ...f, id: 'f' + ++this.seq, pct: 0, done: false }));
    this.setState((st) => ({ imp: files.concat(st.imp) }));
    if (this.stopSim) this.stopSim();
    this.stopSim = simulateProcessing(
      () => this.state.imp,
      (imp) => this.setState({ imp }),
    );
  };

  // Real uploads
  get maxUploadBytes() {
    return this.backend?.maxUploadBytes ?? 0;
  }

  /** Takes files from the picker or a drop. The demo archive only lists them. */
  receiveFiles = (files: File[]) => {
    if (this.backend) this.uploadFiles(files, this.backend);
    else this.addFiles(files.map((f) => listOnly(f)));
  };

  private patchJob = (id: string, patch: Partial<ImportJob>) =>
    this.setState((st) => ({ imp: st.imp.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));

  private uploadFiles(files: File[], backend: DocumentsBackend) {
    const queue: { job: ImportJob; file: File }[] = [];
    const jobs = files.map((file) => {
      const name = file.webkitRelativePath || file.name;
      const job: ImportJob = {
        name,
        size: fmtSize(file.size),
        kind: kindOf(file.name),
        outcome: 'uploading',
        result: '',
        id: 'u' + ++this.seq,
        pct: 0,
        done: false,
      };
      const refusal = !file.name.toLowerCase().endsWith('.pdf')
        ? 'Only PDF files can be imported in this version. Nothing was stored.'
        : file.size > backend.maxUploadBytes
          ? `This file is larger than the ${Math.floor(backend.maxUploadBytes / 1048576)} MB limit. Nothing was stored.`
          : null;
      if (refusal) return { ...job, outcome: 'rejected' as const, result: refusal, pct: 100, done: true };
      queue.push({ job, file });
      return job;
    });
    this.setState((st) => ({ imp: jobs.concat(st.imp) }));
    const work = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { job, file } = next;
        const result = await backend.upload(file, (fraction) =>
          this.patchJob(job.id, { pct: Math.min(99, Math.round(fraction * 100)) }),
        );
        if (result.kind === 'stored') {
          this.patchJob(job.id, {
            outcome: 'stored',
            pct: 100,
            done: true,
            documentId: result.document.id,
            result: 'Stored unchanged on this computer.',
          });
        } else if (result.kind === 'duplicate') {
          const d = result.document;
          this.patchJob(job.id, {
            outcome: 'duplicate',
            pct: 100,
            done: true,
            documentId: d.id,
            result: `Identical to ${d.title}, imported ${fShort(d.date)}. Set aside; nothing was added.`,
          });
        } else {
          this.patchJob(job.id, {
            outcome: result.kind === 'rejected' ? 'rejected' : 'interrupted',
            pct: 100,
            done: true,
            result: result.message,
          });
        }
        if (result.kind === 'stored') {
          await this.refreshDocuments(backend);
          this.uploadsSinceRefresh = true;
          this.watchReading();
        }
      }
    };
    return Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_UPLOADS, queue.length) }, work));
  }

  private async refreshDocuments(backend: DocumentsBackend) {
    try {
      const documents = await backend.listDocuments();
      const today = todayLocal(),
        previous = this.archive.today;
      this.archive = { ...withDocuments(this.archive, documents), today };
      // Someone looking at today keeps looking at today, even past midnight.
      this.setState((st) => (st.cur === previous ? { cur: today } : {}));
    } catch {
      // The upload itself succeeded. The list catches up on the next refresh or page load.
    }
  }

  // Decisions on real documents. The service keeps them; this only shows what it confirms it saved.
  private replaceDocument(document: ArchiveDocument) {
    const documents = this.archive.documents.map((d) => (d.id === document.id ? document : d));
    this.archive = withDocuments(this.archive, documents);
  }

  private async saving(request: (backend: DocumentsBackend) => Promise<ArchiveDocument>): Promise<boolean> {
    if (!this.backend) return false;
    try {
      this.replaceDocument(await request(this.backend));
      this.setState({ rvError: null });
      return true;
    } catch (problem) {
      const message = problem instanceof ArchiveRequestError ? problem.message : 'This could not be saved.';
      this.setState({ rvError: message });
      // A stale proposal means the screen is behind. Catch up so the person sees the new value.
      if (problem instanceof ArchiveRequestError && problem.code === 'stale_proposal')
        await this.refreshDocuments(this.backend);
      return false;
    }
  }

  decideField = (id: string, field: MetadataFieldKey, decision: FieldDecision) =>
    this.saving((backend) => backend.decide(id, field, decision));

  completeReview = async (id: string) => {
    if (await this.saving((backend) => backend.setReview(id, true))) {
      this.setState({ rvStage: 'done' });
      window.scrollTo(0, 0);
    }
  };

  readAgain = async (id: string) => {
    if (await this.saving((backend) => backend.readAgain(id))) this.watchReading();
  };

  /** Checks back while any document is still being read. */
  watchReading = () => {
    const backend = this.backend;
    if (!backend || this.readingTimer) return;
    const check = async () => {
      this.readingTimer = null;
      await this.refreshDocuments(backend);
      if (this.archive.documents.some(isReading)) this.watchReading();
    };
    if (this.archive.documents.some(isReading) || this.uploadsSinceRefresh) {
      this.uploadsSinceRefresh = false;
      this.readingTimer = setTimeout(check, READING_POLL_MS);
    }
  };
}
