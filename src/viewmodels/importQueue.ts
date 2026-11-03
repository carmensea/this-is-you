import type { DragEvent } from 'react';
import { fShort } from '../domain/dates';
import { plural } from '../domain/format';
import { OUTCOME } from '../domain/vocabulary';
import type { ObservationFields } from '../components/ObservationForm';
import { C } from '../theme';
import type { AppStore } from '../state/store';
import type { ImportJob, ImportOutcome } from '../domain/types';
import { FIELD_ORDER, canReview } from '../domain/documentReview';
import { collectDropped } from '../services/droppedFiles';

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

const personalCopy = (maxBytes: number): typeof DEMO_COPY => ({
  headNote:
    'Files stay on this computer. Each PDF is stored unchanged, then read here to propose basic details for you to check. Nothing is sent anywhere.',
  dropTitle: 'Drop PDF files or folders here',
  dropBody:
    'Each original is copied into the archive on this computer, unchanged. An identical file is recognized and set aside instead of being stored twice. Every file gets a line in the report, which stays here if you close the browser. Nothing counts as verified until you confirm it.',
  formats: `PDF only · up to ${Math.floor(maxBytes / 1048576)} MB per file`,
  readTitle: 'What can be imported',
  readRows: [
    {
      k: 'PDF',
      text: 'PDFs with real text: document details and common laboratory results are proposed for you to check. Nothing is verified until you accept it.',
    },
    {
      k: 'Scan',
      warn: true,
      text: 'Scanned, image-only and password-protected PDFs are stored and viewable, but not read. Enter their details by hand.',
    },
    {
      k: 'Other',
      warn: true,
      text: 'Not accepted yet. Images, Word documents and other formats are listed in the report as not copied, and nothing is stored.',
    },
  ],
  steps: [
    'The original file is copied into the archive unchanged, with a checksum.',
    'Text is read on this computer, in a separate process with limits on time and memory. Scanned pages are not read.',
    'Document details and common laboratory results are proposed, each with its source and a confidence level.',
    'You accept, correct or reject each one against the original. Only then is it verified and shown in Biomarkers.',
  ],
});

export function importVM(store: AppStore) {
  const archive = store.archive,
    s = store.state;
  const imp = s.imp;
  const count = (o: ImportOutcome) => imp.filter((f) => f.done && f.outcome === o).length;
  const personal = archive.kind === 'personal';
  const stage = (f: ImportJob) =>
    f.done ? '' : f.pct < 25 ? 'Storing original' : f.pct < 60 ? 'Reading' : 'Extracting';
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
      // Folder contents can only be reached during the drop event, so this starts before anything waits.
      if (personal) void collectDropped(e.dataTransfer).then((fl) => fl.length && store.receiveFiles(fl));
      else {
        const fl = Array.from(e.dataTransfer?.files ?? []);
        if (fl.length) store.receiveFiles(fl);
      }
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
      const stored = f.pct >= 25 || f.done;
      return {
        name: f.name,
        size: f.size,
        kind: f.done || f.pct >= 60 ? f.kind : 'Detecting type',
        pct: String(f.pct),
        isRunning: !f.done,
        isDone: f.done,
        stage: stage(f),
        result: f.result,
        statusLabel: f.done ? o.label : 'In progress',
        statusColor: f.done ? o.color : C.ink2,
        p1: stored ? C.ink : 'transparent',
        p2: f.done && o.read ? C.ink : !f.done && f.pct >= 60 ? C.ink : 'transparent',
        documentId: f.documentId,
        onView: () => store.go('documents', { dSel: f.documentId ?? null, dPage: 0, dHL: null }),
        p3: f.done && o.ext ? C.ink : 'transparent',
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
  const manual = archive.observations.filter((o) => o.origin === 'manual' && !o.document_id);
  const manualRows = manual.map((o) => ({
    id: o.id,
    observation: o,
    name: o.reported_name,
    value: o.value_text + (o.unit ? ' ' + o.unit : ''),
    date: o.collected_on ? fShort(o.collected_on) : 'Collection date unknown',
    status:
      o.verification_status === 'verified'
        ? 'User-entered, shown in charts'
        : o.verification_status === 'rejected'
          ? 'Removed from charts'
          : 'Not verified',
    statusColor: o.verification_status === 'verified' ? C.green : C.ink3,
    history: o.edited
      ? `Edited ${plural(o.revisions.filter((r) => r.action === 'corrected').length, 'time')}. First entered as ${String(o.original.value_text)}.`
      : 'Not edited since it was entered.',
    isEditing: s.manualEdit === o.id,
    isRejected: o.verification_status === 'rejected',
    onEdit: () => store.setState({ manualEdit: o.id }),
    onCancel: () => store.setState({ manualEdit: null }),
    onSave: (fields: ObservationFields) => store.correctManual(o.id, fields),
    onRemove: () => void store.setObservationStatus(o.id, 'reject'),
    onRestore: () => void store.setObservationStatus(o.id, 'verify'),
  }));
  return {
    ...out,
    impQueue,
    impQueueCount,
    impQueueEmpty,
    manualRows,
    manualOpen: s.manualOpen,
    testNames: archive.testNames,
    toggleManual: () => store.setState((st) => ({ manualOpen: !st.manualOpen })),
    saveManual: (fields: ObservationFields) => store.createObservation(fields, null, true),
  };
}
