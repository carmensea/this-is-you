import { fShort } from '../domain/dates';
import { fmtSize, kindOf, plural } from '../domain/format';
import type { ImportBatchSummary, ImportCategory, ImportReportItem } from '../domain/types';
import type { AppStore } from '../state/store';
import { C } from '../theme';

const FILTERS: [ImportCategory, string][] = [
  ['read', 'Read'],
  ['partial', 'Partly read'],
  ['duplicate', 'Duplicate'],
  ['scanned', 'Scanned'],
  ['encrypted', 'Password protected'],
  ['no_text', 'No text found'],
  ['unsupported', 'Unsupported'],
  ['failed', 'Failed'],
  ['reading', 'Being read'],
  ['waiting', 'Not received'],
];

const READING: Partial<Record<NonNullable<ImportReportItem['extraction_status']>, string>> = {
  pending: 'Reading has not started.',
  running: 'Being read now.',
  extracted: 'Read.',
  image_only: 'Not read: scanned pages have no text, and text recognition is not part of this version.',
  encrypted: 'Not read: password protected.',
  no_text: 'Not read: no text was found.',
  failed: 'Reading failed.',
  too_complex: 'Reading stopped at the safety limits.',
};

const VERIFICATION = { unverified: 'None verified yet.', partially_verified: 'Partly verified.', verified: 'Details verified.' };

function describe(item: ImportReportItem) {
  const reading = item.extraction_status;
  const unread = reading === 'failed' || reading === 'too_complex';
  if (item.state === 'pending') return { label: 'Not received', color: C.ink2, result: 'Listed, and not received yet. Nothing was stored.' };
  if (item.state === 'unsupported') return { label: 'Not accepted, not copied', color: C.rust, result: item.message ?? '' };
  if (item.state === 'rejected') return { label: 'Not accepted, nothing stored', color: C.rust, result: item.message ?? '' };
  if (item.state === 'interrupted') return { label: 'Upload failed, nothing stored', color: C.rust, result: item.message ?? '' };
  if (item.state === 'duplicate') {
    return {
      label: 'Duplicate, set aside',
      color: C.muted,
      result: `Identical to ${item.document_filename ?? 'a stored file'}. Set aside; nothing was added.`,
    };
  }
  const partial = reading === 'partial' ? `Partly read: ${item.pages_with_text} of ${item.page_count ?? '?'} pages had text.` : READING[reading!];
  const verification = VERIFICATION[item.verification_status ?? 'unverified'];
  const label =
    item.review_status === 'completed'
      ? 'Reviewed'
      : reading === 'pending' || reading === 'running'
        ? 'Stored, being read'
        : reading === 'extracted'
          ? 'Stored, ready for review'
          : reading === 'partial'
            ? 'Stored, partly read'
            : reading === 'image_only'
              ? 'Stored, scanned, not read'
              : reading === 'encrypted'
                ? 'Stored, password protected'
                : reading === 'no_text'
                  ? 'Stored, no text found'
                  : 'Stored, reading failed';
  const color = item.review_status === 'completed' ? C.green : unread || reading === 'image_only' || reading === 'encrypted' || reading === 'no_text' ? C.rust : reading === 'pending' || reading === 'running' ? C.ink2 : C.amber;
  return { label, color, result: `Stored unchanged. ${partial} ${verification}` };
}

const receivedCount = (b: ImportBatchSummary) => b.total - (b.counts.waiting ?? 0);
const batchName = (b: ImportBatchSummary) => `${b.label}, ${fShort(b.created_at.slice(0, 10))}`;

export function importReportVM(store: AppStore) {
  const r = store.state.report;
  const imports = store.imports;
  const batch = r.batches.find((b) => b.id === r.selected) ?? null;
  const sending = r.sending && r.sending.batchId === r.selected ? r.sending : null;
  const counts = batch?.counts ?? {};
  const failed = counts.failed ?? 0;
  const waiting = counts.waiting ?? 0;
  return {
    show: r.batches.length > 0 || r.unavailable || !!r.problem,
    unavailable: r.unavailable,
    onRetryLoad: imports.refresh,
    problem: r.problem,
    batchOptions: r.batches.map((b) => ({ id: b.id, name: batchName(b) })),
    selected: r.selected ?? '',
    onSelect: imports.select,
    hasBatch: !!batch,
    summary: batch
      ? `${plural(batch.total, 'file')} listed, ${receivedCount(batch)} received. Stored means the original is safe. Read and verified are separate steps, shown on each line.`
      : '',
    progress: sending ? `Sending ${sending.sent} of ${sending.total}. You can leave this page open; closing it pauses sending, and the report stays.` : '',
    interrupted:
      !sending && waiting > 0
        ? `This import stopped with ${plural(waiting, 'file')} not received. Choose the same folder to continue. Finished files are not sent again.`
        : '',
    canRetry: !sending && failed + waiting > 0,
    onRetryAll: imports.retryFailures,
    onRemove: imports.remove,
    filters: [
      { key: 'all', label: 'All', n: batch?.total ?? 0, active: !r.category && !r.identity, onClick: () => imports.filter(null) },
      ...FILTERS.filter(([k]) => counts[k]).map(([k, label]) => ({
        key: k,
        label,
        n: counts[k] ?? 0,
        active: r.category === k,
        onClick: () => imports.filter(k),
      })),
      ...(batch?.identity_mismatches
        ? [{ key: 'mismatch', label: 'Check whose document', n: batch.identity_mismatches, active: r.identity === 'possible_mismatch', onClick: () => imports.filterIdentity('possible_mismatch') }]
        : []),
      ...(batch?.identity_undetermined
        ? [{ key: 'undetermined', label: 'Identity not determined', n: batch.identity_undetermined, active: r.identity === 'undetermined', onClick: () => imports.filterIdentity('undetermined') }]
        : []),
    ],
    identityNotSet: !!batch && !store.state.identity?.configured,
    rows: r.items.map((item) => {
      const d = describe(item);
      const reading = item.extraction_status;
      const wasRead = reading === 'extracted' || reading === 'partial';
      const stored = item.state === 'stored' || item.state === 'duplicate';
      const identity = item.state === 'stored' && item.identity && item.identity.status !== 'not_configured' ? item.identity : null;
      return {
        id: item.id,
        name: item.path,
        size: fmtSize(item.byte_size),
        kind: kindOf(item.path),
        ...d,
        identity: identity?.reason ?? '',
        identityColor: identity?.status === 'possible_mismatch' ? C.rust : C.ink3,
        p1: stored ? C.ink : 'transparent',
        p2: wasRead ? C.ink : 'transparent',
        p3: wasRead ? C.ink : 'transparent',
        p4: item.review_status === 'completed' ? C.ink : 'transparent',
        attempts: item.attempts > 1 ? `${item.attempts} attempts` : '',
        canRetry:
          !sending && (item.state === 'pending' || item.state === 'interrupted' || (item.state === 'rejected' && item.byte_size > 0) || (item.state === 'stored' && (reading === 'failed' || reading === 'too_complex'))),
        onRetry: () => imports.retryItem(item),
        documentId: item.document_id,
        onView: () => store.go('documents', { dSel: item.document_id, dPage: 0, dHL: null }),
      };
    }),
    shown: r.items.length,
    total: r.total,
    canShowMore: r.items.length < r.total && r.limit < 500,
    atLimit: r.items.length < r.total && r.limit >= 500,
    onShowMore: imports.showMore,
  };
}
