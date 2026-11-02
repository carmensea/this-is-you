import type { DragEvent } from 'react';
import { fShort } from '../domain/dates';
import { plural } from '../domain/format';
import { OUTCOME } from '../domain/vocabulary';
import { C } from '../theme';
import type { AppStore } from '../state/store';
import type { ArchiveDocument, ImportJob, ImportOutcome } from '../domain/types';
import { EXTRACTION_LABEL, FIELD_ORDER, canReview, isReading, proposalCount } from '../domain/documentReview';

/** Opens the browser file picker. */
function chooseFiles(store: AppStore, folder: boolean) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  if (store.archive.kind === 'personal' && !folder) inp.accept = '.pdf,application/pdf';
  if (folder) inp.setAttribute('webkitdirectory', '');
  inp.onchange = () => {
    const fl = Array.from(inp.files || []);
    if (fl.length) store.receiveFiles(fl);
  };
  inp.click();
}

/** Words that differ between a real archive and the demo. Real mode only promises what exists today. */
const DEMO_COPY = {
  headNote:
    'Prototype: processing on this page is simulated. Files you choose yourself are only listed; their contents are not read.',
  dropTitle: 'Drop files or folders here',
  dropBody:
    'Add years of records at once. Each original is stored unchanged before anything is read, so nothing is lost if extraction fails. Nothing becomes part of your health record until you review it.',
  formats: 'PDF · CSV · XML · JSON · ZIP · patient portal and device exports',
  readTitle: 'What can be read',
  readRows: [
    {
      k: 'PDF',
      text: 'Lab, imaging and pathology reports, clinical notes. Scanned pages are read with text recognition and always need review.',
    },
    { k: 'CSV', text: 'Smart scale and device exports. Columns are mapped to measurements you can check.' },
    { k: 'XML', text: 'Patient portal clinical documents (CCD). Apple Health export.xml is stored but not yet read.' },
    { k: 'JSON', text: 'FHIR bundles from patient portals.' },
    { k: 'ZIP', text: 'Folders and exports. Contents are handled file by file.' },
    {
      k: 'Other',
      warn: true,
      text: 'Images, Word documents and unknown formats are stored as originals. Nothing is extracted.',
    },
  ],
  steps: [
    'The original file is copied into the archive unchanged, with a checksum.',
    'Text and tables are recognized and the document type is detected.',
    'Values, dates, units and ranges are proposed, each with a confidence level.',
    'You confirm each value against the original. Only then is it health information in your archive.',
  ],
};

/** Once a real upload is stored, its row follows what the reader and the person have done since. */
function realRow(d: ArchiveDocument | undefined, f: ImportJob) {
  if (!d?.review || f.outcome !== 'stored') return {};
  const r = d.review;
  const read = !isReading(d) && r.extraction !== 'failed';
  const reading = isReading(d);
  const count = proposalCount(r);
  const label = reading
    ? 'Stored, being read'
    : r.review === 'completed'
      ? 'Reviewed'
      : count
        ? 'Stored, ready for review'
        : 'Stored, needs details by hand';
  return {
    statusLabel: label,
    statusColor: reading ? C.ink2 : r.review === 'completed' ? C.green : count ? C.amber : C.rust,
    result: reading
      ? 'Stored unchanged on this computer. Reading its text now.'
      : `Stored unchanged. ${EXTRACTION_LABEL[r.extraction]}. ${count ? plural(count, 'detail') + ' proposed, none verified yet.' : 'No details could be proposed.'}`,
    p2: read ? C.ink : 'transparent',
    p3: count ? C.ink : 'transparent',
    p4: r.review === 'completed' ? C.ink : 'transparent',
  };
}

const personalCopy = (maxBytes: number): typeof DEMO_COPY => ({
  headNote:
    'Files stay on this computer. Each PDF is stored unchanged, then read here to propose basic details for you to check. Nothing is sent anywhere.',
  dropTitle: 'Drop PDF files here',
  dropBody:
    'Each original is copied into the archive on this computer, unchanged. An identical file is recognized and set aside instead of being stored twice. Nothing counts as verified until you confirm it.',
  formats: `PDF only · up to ${Math.floor(maxBytes / 1048576)} MB per file`,
  readTitle: 'What can be imported',
  readRows: [
    {
      k: 'PDF',
      text: 'PDFs with real text: document type, date, provider and title are proposed for you to check. Test results are not extracted yet.',
    },
    {
      k: 'Scan',
      warn: true,
      text: 'Scanned, image-only and password-protected PDFs are stored and viewable, but not read. Enter their details by hand.',
    },
    {
      k: 'Other',
      warn: true,
      text: 'Not accepted yet. Images, Word documents and other formats are turned away, and nothing is stored.',
    },
  ],
  steps: [
    'The original file is copied into the archive unchanged, with a checksum.',
    'Text is read on this computer, in a separate process with limits on time and memory. Scanned pages are not read.',
    'Document type, date, provider and title are proposed, each with its source and a confidence level.',
    'You confirm or correct each detail against the original. Only then is it verified.',
  ],
});

export function importVM(store: AppStore) {
  const archive = store.archive,
    s = store.state;
  const imp = s.imp;
  const count = (o: ImportOutcome) => imp.filter((f) => f.done && f.outcome === o).length;
  const personal = archive.kind === 'personal';
  const stage = (f: ImportJob) =>
    f.done ? '' : personal ? 'Uploading' : f.pct < 25 ? 'Storing original' : f.pct < 60 ? 'Reading' : 'Extracting';
  const out = {
    dzBg: s.dz ? '#EDE9DF' : '#FBFAF6',
    dzBorder: s.dz ? '#1F1E1B' : '#6E6A61',
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (!store.state.dz) store.setState({ dz: true });
    },
    onDragLeave: () => store.setState({ dz: false }),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      store.setState({ dz: false });
      const fl = Array.from(e.dataTransfer?.files ?? []);
      if (fl.length) store.receiveFiles(fl);
    },
    pickFiles: () => chooseFiles(store, false),
    pickFolder: () => chooseFiles(store, true),
    loadSample: () => store.addFiles(archive.sampleBatch.map((x) => Object.assign({}, x))),
    clearBatch: () => store.setState({ imp: [] }),
    impHasBatch: imp.length > 0,
    isDemo: !personal,
    copy: personal ? personalCopy(store.maxUploadBytes) : DEMO_COPY,
    impSummary: !imp.length
      ? ''
      : personal
        ? plural(imp.length, 'file') +
          ' received. ' +
          count('stored') +
          ' stored, ' +
          count('duplicate') +
          ' duplicate, set aside, ' +
          (count('rejected') + count('interrupted')) +
          ' not stored.' +
          (imp.some((f) => !f.done) ? ' Uploading.' : '')
        : plural(imp.length, 'file') +
          ' received. ' +
          imp.filter((f) => f.pct >= 25 || f.done).length +
          ' originals stored. ' +
          count('parsed') +
          ' parsed, ' +
          (count('duplicate') + count('possible')) +
          ' duplicate or possible duplicate, ' +
          count('failed') +
          ' failed, ' +
          count('unsupported') +
          ' unsupported.' +
          (imp.some((f) => !f.done) ? ' Processing.' : ''),
    impRows: imp.map((f) => {
      const o = OUTCOME[f.outcome];
      const stored = personal ? f.outcome === 'stored' || f.outcome === 'duplicate' : f.pct >= 25 || f.done;
      return {
        name: f.name,
        size: f.size,
        kind: personal || f.done || f.pct >= 60 ? f.kind : 'Detecting type',
        pct: String(f.pct),
        isRunning: !f.done,
        isDone: f.done,
        stage: stage(f),
        result: f.result,
        statusLabel: f.done ? o.label : 'In progress',
        statusColor: f.done ? o.color : C.ink2,
        p1: stored ? C.ink : 'transparent',
        p2: personal ? 'transparent' : f.done && o.read ? C.ink : !f.done && f.pct >= 60 ? C.ink : 'transparent',
        ...realRow(archive.documentsById[f.documentId ?? ''], f),
        documentId: f.documentId,
        onView: () => store.go('documents', { dSel: f.documentId ?? null, dPage: 0, dHL: null }),
        p3: !personal && f.done && o.ext ? C.ink : 'transparent',
        p4: 'transparent',
      };
    }),
  };
  const queue = archive.documents
    .filter((d) => (d.review ? canReview(d) && d.review.review !== 'completed' : store.documentStatus(d) === 'parsed'))
    .sort((a, b) => Number(b.date === '2026-09-24') - Number(a.date === '2026-09-24') || (a.date < b.date ? 1 : -1));
  const impQueue = queue.map((d) => {
    const x = store.reviewData(d.id),
      rs = (s.rv || {})[d.id] || { lines: {}, fields: {} };
    const tot = x.lines.length + x.fields.length,
      done = d.review
        ? FIELD_ORDER.filter((k) => d.review!.fields[k].decidedAt).length
        : x.lines.filter((l) => (rs.lines[l.key] || {}).status).length +
          x.fields.filter((l) => (rs.fields[l.key] || {}).status).length;
    const att = d.review
      ? FIELD_ORDER.filter(
          (k) => !d.review!.fields[k].decidedAt && (d.review!.fields[k].proposal?.confidence ?? 'low') === 'low',
        ).length
      : x.lines.filter((l) => l.conf === 'low').length + x.fields.filter((l) => l.conf === 'low').length;
    return {
      title: d.title,
      date: d.review ? 'Imported ' + d.imported : fShort(d.date),
      source: d.source,
      format: d.format,
      values: x.lines.length ? plural(x.lines.length, 'value') : 'Details only',
      attention: att
        ? plural(att, 'item') + (att === 1 ? ' needs' : ' need') + ' attention'
        : 'No low-confidence items',
      attColor: att ? C.rust : C.ink2,
      progress: done ? done + ' of ' + tot + ' resolved' : 'Not started',
      onReview: () => store.openReview(d.id),
    };
  });
  const impQueueCount = plural(queue.length, 'document') + ' waiting for review';
  const impQueueEmpty = !queue.length;
  return { ...out, impQueue, impQueueCount, impQueueEmpty };
}
