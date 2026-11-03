import { vi } from 'vitest';
import type { ImportBatchSummary, ImportCategory, ImportReportItem } from '../domain/types';
import type { DocumentsBackend, ItemUpload, ListedFile, ReportQuery } from '../services/archiveApi';

/** What the service decides about each file. `unreachable` answers nothing. */
export type Answer = { state?: ImportReportItem['state']; extraction?: ImportReportItem['extraction_status']; message?: string; unreachable?: number };

type Readiness = Pick<
  DocumentsBackend,
  'createBatch' | 'addBatchItems' | 'uploadBatchItem' | 'listBatches' | 'listBatchItems' | 'retryReading' | 'removeBatch' | 'getArchiveHealth' | 'signOut' | 'getIdentity' | 'saveIdentity' | 'listBackups' | 'startBackup' | 'checkBackup'
>;

const category = (i: ImportReportItem): ImportCategory => {
  if (i.state === 'pending') return 'waiting';
  if (i.state === 'rejected' || i.state === 'interrupted') return 'failed';
  if (i.state === 'duplicate' || i.state === 'unsupported') return i.state;
  return ({ extracted: 'read', partial: 'partial', image_only: 'scanned', encrypted: 'encrypted', no_text: 'no_text', pending: 'reading', running: 'reading' } as Record<string, ImportCategory>)[i.extraction_status ?? ''] ?? 'failed';
};

/** Behaves as the service does: keeps the report, and listing a file twice returns the same row. */
export function fakeImportServer(answer: Answer = { state: 'stored', extraction: 'extracted' }, limit = 1000): Readiness & { rows: Map<string, ImportReportItem[]>; down: boolean } {
  const rows = new Map<string, ImportReportItem[]>();
  let next = 0;
  let unanswered = answer.unreachable ?? 0;
  const server = {
    rows,
    down: false,
    createBatch: vi.fn(async () => {
      const id = 'b' + rows.size;
      rows.set(id, []);
      return id;
    }),
    addBatchItems: vi.fn(async (batch: string, files: ListedFile[]) =>
      files.map((f) => {
        const list = rows.get(batch)!;
        let row = list.find((r) => r.path === f.path);
        if (!row) {
          const pdf = f.path.toLowerCase().endsWith('.pdf');
          const over = f.size > limit;
          row = {
            id: ++next, path: f.path, byte_size: f.size, attempts: 0, state: pdf && !over ? 'pending' : 'unsupported',
            message: !pdf ? 'Only PDF files can be imported in this version. This file was not copied.' : over ? `This file is larger than the ${Math.floor(limit / 1048576)} MB limit. It was not copied.` : null,
            document_id: null, document_filename: null, extraction_status: null, review_status: null, verification_status: null, pages_with_text: 0, page_count: null, identity: null,
          };
          list.push(row);
        }
        return { id: row.id, path: row.path, state: row.state };
      }),
    ),
    uploadBatchItem: vi.fn(async (batch: string, id: number): Promise<ItemUpload> => {
      if (server.down || unanswered > 0) {
        unanswered -= 1;
        return { kind: 'unreachable' };
      }
      const row = rows.get(batch)!.find((r) => r.id === id)!;
      row.attempts += 1;
      row.state = answer.state ?? 'stored';
      row.message = answer.message ?? null;
      if (row.state === 'stored' || row.state === 'duplicate') {
        Object.assign(row, { document_id: 'd0', document_filename: 'blood work 2024.pdf', extraction_status: answer.extraction ?? 'extracted', review_status: 'not_started', verification_status: 'unverified' });
      }
      return { kind: 'answered', item: row };
    }),
    listBatches: vi.fn(async (): Promise<ImportBatchSummary[]> => {
      if (server.down) throw new Error('down');
      return [...rows].map(([id, list]) => {
        const counts: ImportBatchSummary['counts'] = {};
        for (const r of list) counts[category(r)] = (counts[category(r)] ?? 0) + 1;
        return { id, label: list[0]?.path.includes('/') ? list[0].path.split('/')[0] : 'Chosen files', created_at: '2026-11-02T10:00:00Z', counts, total: list.length, identity_mismatches: 0, identity_undetermined: 0 };
      });
    }),
    listBatchItems: vi.fn(async (batch: string, q: ReportQuery) => {
      if (server.down) throw new Error('down');
      const list = rows.get(batch)!.filter((r) => !q.category || category(r) === q.category);
      return { items: list.slice(0, q.limit), total: list.length };
    }),
    retryReading: vi.fn(async () => ({ requeued: 0 })),
    removeBatch: vi.fn(async (batch: string) => void rows.delete(batch)),
    getArchiveHealth: vi.fn(async () => ({ recovered: 0, set_aside: 0, missing: 0, reader_isolation: 'sandboxed' as const })),
    signOut: vi.fn(async () => undefined),
    getIdentity: vi.fn(async () => ({ full_name: '', date_of_birth: null, previous_names: [], configured: false })),
    saveIdentity: vi.fn(async (d) => ({ ...d, configured: true })),
    listBackups: vi.fn(async () => ({ location: '/private/backups', same_drive: true, backups: [], running: null, last_result: null })),
    startBackup: vi.fn(async () => ({ started: true })),
    checkBackup: vi.fn(async () => ({ started: true })),
  };
  return server as unknown as Readiness & { rows: Map<string, ImportReportItem[]>; down: boolean };
}

export const readinessStub = (): Readiness => fakeImportServer();
