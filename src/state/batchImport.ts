// Sends a folder of files to the service one by one and follows the saved report. The service owns the report:
// this keeps no record of its own, so closing the browser or restarting either side loses nothing.
import type { ImportBatchSummary, ImportCategory, ImportReportItem } from '../domain/types';
import type { DocumentsBackend, ListedFile } from '../services/archiveApi';
import { droppedPath } from '../services/droppedFiles';
import type { AppStore } from './store';

const PARALLEL_UPLOADS = 2;
const LISTING_CHUNK = 500;
export const PAGE_SIZE = 25;
const POLL_MS = 1500;
/** Sending again is safe, so a dropped connection gets a few tries before the file counts as not sent. */
export const UPLOAD_RETRY_DELAYS_MS = [500, 2000];
/** This many files in a row with no answer means the service is down, not that the files are bad. */
const STOP_AFTER_UNANSWERED = 3;

export interface ReportState {
  batches: ImportBatchSummary[];
  selected: string | null;
  items: ImportReportItem[];
  total: number;
  category: ImportCategory | null;
  identity: string | null;
  limit: number;
  /** A run this browser is sending now. */
  sending: { batchId: string; sent: number; total: number } | null;
  /** Why the last action stopped or could not start, in words for the person. */
  problem: string | null;
  /** The saved report could not be loaded. Different from there being none. */
  unavailable: boolean;
}

export const emptyReport: ReportState = {
  batches: [],
  selected: null,
  items: [],
  total: 0,
  category: null,
  identity: null,
  limit: PAGE_SIZE,
  sending: null,
  problem: null,
  unavailable: false,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pathOf = (file: File) => droppedPath(file) ?? (file.webkitRelativePath || file.name);
const SENDABLE = new Set<ImportReportItem['state']>(['pending', 'interrupted', 'rejected']);

export class BatchImporter {
  /** Handles to files chosen in this session, not their bytes. Lost on reload, when the folder is chosen again. */
  private files = new Map<number, File>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private store: AppStore,
    private backend: DocumentsBackend | null,
  ) {}

  private get report() {
    return this.store.state.report;
  }
  private patch(change: Partial<ReportState>) {
    this.store.setState((st) => ({ report: { ...st.report, ...change } }));
  }

  /** Reads the saved report. Called on start, so a report from before a closed browser is back at once. */
  load = () => this.refresh();

  refresh = async () => {
    const backend = this.backend;
    if (!backend) return;
    try {
      const batches = await backend.listBatches();
      const selected = batches.some((b) => b.id === this.report.selected) ? this.report.selected : (batches[0]?.id ?? null);
      const { category, identity, limit } = this.report;
      const page = selected ? await backend.listBatchItems(selected, { category, identity, limit }) : { items: [], total: 0 };
      this.patch({ batches, selected, items: page.items, total: page.total, unavailable: false });
    } catch {
      this.patch({ unavailable: true });
    }
    this.follow();
  };

  /** Keeps checking while files are being sent or read, and stops when nothing is changing. */
  private follow() {
    const active = this.report.sending || this.report.batches.some((b) => b.counts.reading);
    if (!active || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh().then(() => {
        const done = !this.report.sending && !this.report.batches.some((b) => b.counts.reading);
        if (done && this.backend) void this.store.refreshDocuments(this.backend);
      });
    }, POLL_MS);
  }

  /** Chosen files start a new batch, or continue one that stopped with files from the same folder still to come. */
  receive = async (files: File[]) => {
    const backend = this.backend;
    if (!backend || !files.length) return;
    if (this.report.sending) {
      this.patch({ problem: 'An import is still running. Choose more files when it has finished.' });
      return;
    }
    const first = pathOf(files[0]);
    const label = first.includes('/') ? first.split('/')[0] : 'Chosen files';
    this.patch({ problem: null });
    try {
      const unfinished = this.report.batches.find(
        (b) => b.label === label && (b.counts.waiting || b.counts.failed),
      );
      const batchId = unfinished?.id ?? (await backend.createBatch(label));
      this.patch({ selected: batchId, category: null, identity: null, limit: PAGE_SIZE });
      const toSend: { id: number; file: File }[] = [];
      for (let at = 0; at < files.length; at += LISTING_CHUNK) {
        const chunk = files.slice(at, at + LISTING_CHUNK);
        const listed: ListedFile[] = chunk.map((f) => ({ path: pathOf(f), size: f.size, modified: f.lastModified }));
        const items = await backend.addBatchItems(batchId, listed);
        items.forEach((item, i) => {
          // Empty files were decided from the listing, and sending them again changes nothing.
          if (SENDABLE.has(item.state) && chunk[i].size > 0) toSend.push({ id: item.id, file: chunk[i] });
        });
      }
      await this.send(batchId, toSend);
    } catch {
      this.patch({ problem: 'The archive service did not answer, so this import did not start. Nothing was stored. Retry when it is running.' });
      await this.refresh();
    }
  };

  private async send(batchId: string, jobs: { id: number; file: File }[]) {
    const backend = this.backend!;
    jobs.forEach((job) => this.files.set(job.id, job.file));
    const queue = [...jobs];
    let unanswered = 0;
    let sent = 0;
    this.patch({ sending: { batchId, sent: 0, total: jobs.length } });
    void this.refresh();
    const worker = async () => {
      for (let job = queue.shift(); job && unanswered < STOP_AFTER_UNANSWERED; job = queue.shift()) {
        let result = await backend.uploadBatchItem(batchId, job.id, job.file);
        for (const delay of UPLOAD_RETRY_DELAYS_MS) {
          if (result.kind === 'answered') break;
          await wait(delay);
          result = await backend.uploadBatchItem(batchId, job.id, job.file);
        }
        if (result.kind === 'answered') {
          unanswered = 0;
          sent += 1;
          // A refused file stays in hand: it may have been repaired by the time someone retries it.
          if (result.item.state === 'stored' || result.item.state === 'duplicate') this.files.delete(job.id);
          if (result.item.state === 'stored') this.store.noteUpload();
          this.patch({ sending: { batchId, sent, total: jobs.length } });
        } else {
          unanswered += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, jobs.length) }, worker));
    this.patch({
      sending: null,
      problem:
        unanswered >= STOP_AFTER_UNANSWERED || sent < jobs.length
          ? 'The archive service stopped answering, so this import paused. Everything already stored is safe, and finished files will not be sent again.'
          : null,
    });
    await this.refresh();
    await this.store.refreshDocuments(backend);
  }

  /** Every failure that can be retried from here: readings, and files still in hand. The rest need choosing again. */
  retryFailures = async () => {
    const backend = this.backend;
    const batchId = this.report.selected;
    if (!backend || !batchId || this.report.sending) return;
    this.patch({ problem: null });
    try {
      await backend.retryReading(batchId);
      const failed = await backend.listBatchItems(batchId, { category: 'failed', identity: null, limit: 500 });
      const waiting = await backend.listBatchItems(batchId, { category: 'waiting', identity: null, limit: 500 });
      const candidates = [...failed.items, ...waiting.items].filter((i) => SENDABLE.has(i.state) && i.byte_size > 0);
      const jobs = candidates.flatMap((i) => {
        const file = this.files.get(i.id);
        return file ? [{ id: i.id, file }] : [];
      });
      const missing = candidates.length - jobs.length;
      if (jobs.length) await this.send(batchId, jobs);
      else await this.refresh();
      if (missing > 0 && !this.report.problem) {
        this.patch({ problem: `${missing} ${missing === 1 ? 'file needs' : 'files need'} choosing again, because this page was closed or reloaded. Choose the same folder to continue.` });
      }
    } catch {
      this.patch({ problem: 'The archive service did not answer, so nothing was retried.' });
    }
  };

  retryItem = async (item: ImportReportItem) => {
    const backend = this.backend;
    const batchId = this.report.selected;
    if (!backend || !batchId || this.report.sending) return;
    this.patch({ problem: null });
    try {
      if (item.state === 'stored') {
        await backend.retryReading(batchId, item.id);
        await this.refresh();
        return;
      }
      const file = this.files.get(item.id);
      if (file) await this.send(batchId, [{ id: item.id, file }]);
      else this.patch({ problem: 'This file needs choosing again, because this page was closed or reloaded. Choose the same folder to continue.' });
    } catch {
      this.patch({ problem: 'The archive service did not answer, so nothing was retried.' });
    }
  };

  private view(change: Partial<ReportState>) {
    this.patch({ limit: PAGE_SIZE, ...change });
    void this.refresh();
  }
  select = (selected: string) => this.view({ selected, category: null, identity: null, problem: null });
  filter = (category: ImportCategory | null) => this.view({ category, identity: null });
  filterIdentity = (identity: string | null) => this.view({ identity, category: null });
  showMore = () => {
    this.patch({ limit: Math.min(500, this.report.limit + PAGE_SIZE) });
    void this.refresh();
  };

  /** Takes it off this screen. The rows stay in the archive and in every backup. */
  hide = async () => {
    const batchId = this.report.selected;
    if (!this.backend || !batchId) return;
    try {
      await this.backend.hideBatch(batchId);
      this.patch({ selected: null, category: null, identity: null, limit: PAGE_SIZE });
      await this.refresh();
    } catch {
      this.patch({ problem: 'The archive service did not answer, so this report was not hidden.' });
    }
  };
}
