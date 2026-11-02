import type { DragEvent } from 'react';
import { fShort } from '../domain/dates';
import { plural } from '../domain/format';
import { OUTCOME } from '../domain/vocabulary';
import { C } from '../theme';
import type { AppStore } from '../state/store';
import type { ImportJob, ImportOutcome } from '../domain/types';
import { listOnly } from '../services/importService';

/** Opens the browser file picker. Only names and sizes are used. */
function chooseFiles(store: AppStore, folder: boolean) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  if (folder) inp.setAttribute('webkitdirectory', '');
  inp.onchange = () => {
    const fl = Array.from(inp.files || []);
    if (fl.length) store.addFiles(fl.map(listOnly));
  };
  inp.click();
}

export function importVM(store: AppStore) {
  const archive = store.archive,
    s = store.state;
  const imp = s.imp;
  const count = (o: ImportOutcome) => imp.filter((f) => f.done && f.outcome === o).length;
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
      const fl = Array.from(e.dataTransfer?.files ?? []);
      if (fl.length) store.addFiles(fl.map((f) => listOnly(f)));
    },
    pickFiles: () => chooseFiles(store, false),
    pickFolder: () => chooseFiles(store, true),
    loadSample: () => store.addFiles(archive.sampleBatch.map((x) => Object.assign({}, x))),
    clearBatch: () => store.setState({ imp: [] }),
    impHasBatch: imp.length > 0,
    impSummary: imp.length
      ? plural(imp.length, 'file') +
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
        (imp.some((f) => !f.done) ? ' Processing.' : '')
      : '',
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
        p3: f.done && o.ext ? C.ink : 'transparent',
        p4: 'transparent',
      };
    }),
  };
  const queue = archive.documents
    .filter((d) => store.documentStatus(d) === 'parsed')
    .sort((a, b) => Number(b.date === '2026-09-24') - Number(a.date === '2026-09-24') || (a.date < b.date ? 1 : -1));
  const impQueue = queue.map((d) => {
    const x = store.reviewData(d.id),
      rs = (s.rv || {})[d.id] || { lines: {}, fields: {} };
    const tot = x.lines.length + x.fields.length,
      done =
        x.lines.filter((l) => (rs.lines[l.key] || {}).status).length +
        x.fields.filter((l) => (rs.fields[l.key] || {}).status).length;
    const att = x.lines.filter((l) => l.conf === 'low').length + x.fields.filter((l) => l.conf === 'low').length;
    return {
      title: d.title,
      date: fShort(d.date),
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
