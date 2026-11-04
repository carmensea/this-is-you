// Application state and actions. Plain TypeScript with no React, so it can be tested directly.
import { addMonths, fLong } from '../domain/dates';
import { rangeOnly, fmtR } from '../domain/format';
import { DCATL } from '../domain/vocabulary';
import type { Archive, ArchiveDocument, ArchiveHealth, BackupListing, HealthEvent, IdentityDetails, ImportFile, ImportJob, ISODate, LowConfidenceNote, MetadataFieldKey, SnapshotMode } from '../domain/types';
import { ArchiveRequestError, type DocumentsBackend, type FieldDecision, type GroupApproval, type ObservationFieldValues } from '../services/archiveApi';
import { FIELD_LABEL, FIELD_ORDER, displayValue, isReading } from '../domain/documentReview';
import { listOnly, simulateProcessing } from '../services/importService';
import { buildPersonalArchive, todayLocal } from '../services/localArchiveApi';
import { BatchImporter, emptyReport, type ReportState } from './batchImport';

const READING_POLL_MS = 800;
const BACKUP_POLL_MS = 1000;

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
  status?: string;
  edited?: boolean;
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
  /** The saved import report, which outlasts the browser. */
  report: ReportState;
  /** The last refresh failed, so what is on screen may be out of date. It is not cleared or replaced. */
  archiveStale: boolean;
  identity: IdentityDetails | null;
  identityOpen: boolean;
  backups: BackupListing | null;
  /** Why the backups or identity details could not be loaded or saved. */
  safetyError: string | null;
  archiveHealth: ArchiveHealth | null;
  /** The service stopped accepting this session. No records are shown until signing in again. */
  signedOut: boolean;
  /** Why the last decision on a real document could not be saved. */
  rvError: string | null;
  rvGroupError: string | null;
  /** The page of the original to show, when following a proposal back to its source. */
  rvSourcePage: number | null;
  /** The add-a-measurement form on the review screen. */
  rvAdding: boolean;
  /** Which page of a document's original the Documents screen should show. */
  dSource: { id: string; page: number } | null;
  /** The add-a-result form on the Import screen. */
  manualOpen: boolean;
  manualEdit: string | null;
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
  report: emptyReport,
  archiveStale: false,
  identity: null,
  identityOpen: false,
  backups: null,
  safetyError: null,
  archiveHealth: null,
  signedOut: false,
  dz: false,
  rv: {},
  rvDoc: null,
  rvLine: null,
  rvEdit: null,
  rvDraft: {},
  rvStage: 'review',
  rvFilter: 'all',
  rvError: null,
  rvGroupError: null,
  rvSourcePage: null,
  rvAdding: false,
  dSource: null,
  manualOpen: false,
  manualEdit: null,
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
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  readonly imports: BatchImporter;
  private refreshSeq = 0;
  private seq = 0;

  constructor(
    public archive: Archive,
    overrides: Partial<AppState> = {},
    private backend: DocumentsBackend | null = null,
  ) {
    this.state = { ...initialState, ...overrides };
    this.imports = new BatchImporter(this, backend);
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
  openEventDocument = (e: HealthEvent) => {
    if (e.documentId) this.openDocument(e.documentId);
  };
  openDrawDocument = (draw: number) => {
    const id = this.archive.drawDocuments[draw];
    if (id) this.openDocument(id);
  };
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
    const inReportOrder = [...review.observations].sort(
      (a, b) => (a.source_page ?? Infinity) - (b.source_page ?? Infinity) || (a.source_line ?? Infinity) - (b.source_line ?? Infinity),
    );
    const lines: ReviewLine[] = inReportOrder.map((o) => ({
      key: o.id,
      mk: o.test_code ?? '',
      ri: 0,
      measure: o.reported_name,
      value: o.value_text,
      unit: o.unit ?? '',
      ref: o.reference_text ?? '',
      flag: o.flag ?? '',
      conf: o.issues.length || o.confidence === 'low' ? 'low' : 'high',
      reason: o.issues.join(' '),
      status:
        o.verification_status === 'verified'
          ? 'confirmed'
          : o.verification_status === 'rejected'
            ? 'excluded'
            : 'pending',
      edited: o.edited,
    }));
    return { lines, fields };
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
      rvGroupError: null,
      rvSourcePage: null,
      rvAdding: false,
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
    if (this.backend) void this.imports.receive(files);
    else this.addFiles(files.map((f) => listOnly(f)));
  };

  /** Reloads documents and results. Only the newest answer counts, so a slow reply cannot undo a newer one. */
  async refreshDocuments(backend: DocumentsBackend) {
    const request = ++this.refreshSeq;
    try {
      const [documents, observations] = await Promise.all([backend.listDocuments(), backend.listObservations()]);
      if (request !== this.refreshSeq) return;
      const previous = this.archive;
      const today = todayLocal();
      this.archive = buildPersonalArchive(previous, documents, observations, today);
      // Someone looking at today keeps looking at today, even past midnight. Year filters left wide open stay wide open.
      this.setState((st) => ({
        archiveStale: false,
        cur: st.cur === previous.today ? today : st.cur,
        hxFrom: st.hxFrom === previous.firstYear ? this.archive.firstYear : st.hxFrom,
        hxTo: st.hxTo === previous.lastYear ? this.archive.lastYear : st.hxTo,
      }));
    } catch {
      // What was saved stays saved, and what is on screen stays on screen, marked as possibly out of date.
      if (request === this.refreshSeq) this.setState({ archiveStale: true });
    }
  }

  retryRefresh = () => (this.backend ? this.refreshDocuments(this.backend) : Promise.resolve());

  /** An import keeps adding documents, so this also picks up files that are not on screen yet. */
  noteUpload = () => {
    this.uploadsSinceRefresh = true;
    this.watchReading();
  };

  afterSignIn = async () => {
    this.setState({ signedOut: false });
    await this.retryRefresh();
    if (this.state.view === 'import') await this.imports.refresh();
  };

  /** Reloading drops every record this page holds in memory, and the sign-in screen comes back. */
  signOut = async (everywhere: boolean) => {
    if (!this.backend) return;
    try {
      await this.backend.signOut(everywhere);
      window.location.reload();
    } catch {
      this.setState({ safetyError: 'The archive service did not answer, so you are still signed in.' });
    }
  };

  // Identity details and backups
  loadArchiveSafety = async () => {
    if (!this.backend) return;
    try {
      const [identity, backups, archiveHealth] = await Promise.all([this.backend.getIdentity(), this.backend.listBackups(), this.backend.getArchiveHealth()]);
      this.setState({ identity, backups, archiveHealth, safetyError: null });
      if (backups.running) this.watchBackup();
    } catch {
      this.setState({ safetyError: 'Backups and identity details could not be loaded from the archive service.' });
    }
  };

  /** Resolves to an error for the form to show, or null. Flags on documents change as soon as this is saved. */
  saveIdentity = async (details: Omit<IdentityDetails, 'configured'>) => {
    if (!this.backend) return null;
    try {
      const identity = await this.backend.saveIdentity(details);
      this.setState({ identity, identityOpen: false });
      await this.refreshDocuments(this.backend);
      await this.imports.refresh();
      return null;
    } catch (problem) {
      return problem instanceof ArchiveRequestError ? problem.message : 'This could not be saved.';
    }
  };

  private watchBackup() {
    const backend = this.backend;
    if (!backend || this.backupTimer) return;
    this.backupTimer = setTimeout(async () => {
      this.backupTimer = null;
      try {
        const backups = await backend.listBackups();
        this.setState({ backups, safetyError: null });
        if (backups.running) this.watchBackup();
      } catch {
        this.setState({ safetyError: 'The archive service stopped answering while a backup was running. An unfinished backup is never used.' });
      }
    }, BACKUP_POLL_MS);
  }

  private backupAction = async (start: (backend: DocumentsBackend) => Promise<unknown>) => {
    if (!this.backend) return;
    try {
      await start(this.backend);
      this.setState({ backups: await this.backend.listBackups(), safetyError: null });
      this.watchBackup();
    } catch (problem) {
      this.setState({ safetyError: problem instanceof ArchiveRequestError ? problem.message : 'This could not be started.' });
    }
  };
  startBackup = () => this.backupAction((backend) => backend.startBackup());
  checkBackup = (name: string, passphrase?: string) => this.backupAction((backend) => backend.checkBackup(name, passphrase));

  // Decisions on real documents. The service keeps them; this only shows what it confirms it saved.
  private async saving(request: (backend: DocumentsBackend) => Promise<unknown>): Promise<boolean> {
    if (!this.backend) return false;
    try {
      await request(this.backend);
      await this.refreshDocuments(this.backend);
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

  // Laboratory results
  setObservationStatus = (id: string, action: 'verify' | 'reject' | 'reopen') =>
    this.saving((backend) => backend.setObservationStatus(id, action));

  /** Either way the screen catches up: after a refusal the person has to see what changed before trying again. */
  private async groupAction(work: (backend: DocumentsBackend) => Promise<unknown>) {
    if (!this.backend) return;
    let rvGroupError: string | null = null;
    try {
      await work(this.backend);
    } catch (problem) {
      rvGroupError = problem instanceof ArchiveRequestError ? problem.message : 'This could not be saved, so nothing changed.';
    }
    await this.refreshDocuments(this.backend);
    this.setState({ rvGroupError });
  }

  approveGroup = (approval: GroupApproval) => this.groupAction((backend) => backend.approveGroup(approval));
  undoGroup = (groupId: string) => this.groupAction((backend) => backend.undoGroup(groupId));

  private async attempt(
    work: (backend: DocumentsBackend) => Promise<unknown>,
    after: Partial<AppState>,
  ): Promise<string | null> {
    if (!this.backend) return null;
    try {
      await work(this.backend);
      await this.refreshDocuments(this.backend);
      this.setState(after);
      return null;
    } catch (problem) {
      return problem instanceof ArchiveRequestError ? problem.message : 'This could not be saved.';
    }
  }

  /** Saves a correction. Resolves to an error for the form to show, or null. */
  correctObservation = (id: string, fields: ObservationFieldValues) =>
    this.attempt((backend) => backend.correctObservation(id, fields), { rvEdit: null, manualEdit: null });

  /** Adds a result typed in by a person, optionally linked to a document. */
  createObservation = (fields: ObservationFieldValues, documentId: string | null, verify: boolean) =>
    this.attempt((backend) => backend.createObservation(fields, documentId, verify), {
      rvAdding: false,
      manualOpen: false,
    });

  /** A person retyping their own entry is approving it, so the correction goes straight back on the charts. */
  correctManual = (id: string, fields: ObservationFieldValues) =>
    this.attempt(
      async (backend) => {
        await backend.correctObservation(id, fields);
        await backend.setObservationStatus(id, 'verify');
      },
      { manualEdit: null },
    );

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
      // Each check loads the whole archive, so a large one is checked less often.
      this.readingTimer = setTimeout(check, Math.max(READING_POLL_MS, this.archive.documents.length * 10));
    }
  };
}
