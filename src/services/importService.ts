// Import is simulated. No file is read, uploaded or stored by anything in this module.
// A real ingestion backend replaces simulateProcessing with upload and status polling.
import type { ImportFile, ImportJob } from '../domain/types';
import { fmtSize, kindOf } from '../domain/format';

const TICK_MS = 240;
const MAX_CONCURRENT = 2;

/** One progress step. Files finish oldest first, two at a time. Returns null when all are done. */
export function advanceJobs(jobs: ImportJob[], random: () => number = Math.random): ImportJob[] | null {
  const next = jobs.slice();
  let active = 0,
    any = false;
  for (let i = next.length - 1; i >= 0; i--) {
    const f = next[i];
    if (f.done) continue;
    any = true;
    if (active >= MAX_CONCURRENT) continue;
    active++;
    const inc = f.outcome === 'unsupported' || f.outcome === 'local' ? 30 : 6 + Math.round(random() * 12);
    const pct = Math.min(100, f.pct + inc);
    next[i] = { ...f, pct, done: pct >= 100 };
  }
  return any ? next : null;
}

/** Drives advanceJobs on a timer until nothing is left. Returns a stop function. */
export function simulateProcessing(read: () => ImportJob[], write: (jobs: ImportJob[]) => void): () => void {
  const timer = setInterval(() => {
    const next = advanceJobs(read());
    if (next) write(next);
    else clearInterval(timer);
  }, TICK_MS);
  return () => clearInterval(timer);
}

/** Lists a browser File by name and size only. Its contents are never opened. */
export const listOnly = (f: { name: string; size: number; webkitRelativePath?: string }): ImportFile => ({
  name: f.webkitRelativePath || f.name,
  size: fmtSize(f.size),
  kind: kindOf(f.name),
  outcome: 'local',
  result: 'Prototype: this file was listed only. Its contents were not read or stored.',
});
