import { describe, expect, it, vi } from 'vitest';
import { syntheticArchive as a } from '../data/syntheticArchive';
import { advanceJobs, listOnly } from '../services/importService';
import { AppStore } from '../state/store';
import { documentsVM } from '../viewmodels/documents';
import { importVM } from '../viewmodels/importQueue';
import { reviewVM } from '../viewmodels/review';

describe('simulated import', () => {
  it('runs every file to completion, two at a time', () => {
    let jobs = a.sampleBatch.map((f, i) => ({ ...f, id:String(i), pct:0, done:false }));
    let peak = 0, steps = 0;
    for (;;) {
      const next = advanceJobs(jobs, () => 0.5);
      if (!next) break;
      peak = Math.max(peak, next.filter((j, i) => j.pct !== jobs[i].pct).length);
      jobs = next;
      expect(++steps).toBeLessThan(200);
    }
    expect(peak).toBe(2);
    expect(jobs.every(j => j.done)).toBe(true);
  });
  it('only lists files the user picks, and says so', () => {
    const f = listOnly({ name:'report.pdf', size:2048 });
    expect(f.outcome).toBe('local');
    expect(f.result).toMatch(/not read or stored/);
  });
  it('adds a batch and finishes it on a timer', () => {
    vi.useFakeTimers();
    const store = new AppStore(a);
    store.addFiles(a.sampleBatch);
    expect(importVM(store).impSummary).toMatch(/^7 files received/);
    vi.advanceTimersByTime(60000);
    expect(store.state.imp.every(j => j.done)).toBe(true);
    expect(importVM(store).impSummary).not.toMatch(/Processing/);
    vi.useRealTimers();
  });
});

describe('review', () => {
  const id = 'lab-16';
  it('blocks acceptance until every item is resolved, then marks the document reviewed', () => {
    const store = new AppStore(a);
    const before = importVM(store).impQueue.length;
    store.openReview(id);
    expect(reviewVM(store)!.rvContinueDisabled).toBe(true);

    reviewVM(store)!.rvConfirmHigh();
    reviewVM(store)!.rvFields.forEach(f => f.onConfirm());
    reviewVM(store)!.rvLines.filter(l => l.isLow).forEach(l => l.onExclude());
    const v = reviewVM(store)!;
    expect(v.rvContinueDisabled).toBe(false);

    v.rvContinue();
    expect(store.state.rvStage).toBe('confirm');
    reviewVM(store)!.rvAccept();
    expect(store.documentStatus(a.documentsById[id])).toBe('reviewed');
    expect(importVM(store).impQueue.length).toBe(before - 1);
  });
  it('keeps the extracted value alongside a correction', () => {
    const store = new AppStore(a);
    store.openReview(id);
    const line = () => reviewVM(store)!.rvLines.find(l => l.key === 'creat')!;
    line().onEdit();
    store.setState({ rvDraft:{ ...store.state.rvDraft, value:'1.07' } });
    line().onSave();
    expect(line().value).toBe('1.07');
    expect(line().editedText).toContain('Extracted as 1.02');
  });
});

describe('document links', () => {
  it('opens a source document and returns to where the reader was', () => {
    const store = new AppStore(a, { view:'biomarkers' });
    store.openDrawDocument(3);
    expect(store.state.view).toBe('documents');
    expect(documentsVM(store).detail!.ddTitle).toBe(a.documentsById['lab-3'].title);
    store.goBack();
    expect(store.state.view).toBe('biomarkers');
  });
});
