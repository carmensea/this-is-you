/** Owns the one pdf.js worker that open files share. Closing a file never ends the worker; only this does, and it tells every file still using it. */

export class WorkerLost extends Error {
  constructor() {
    super('The PDF worker stopped.');
    this.name = 'WorkerLost';
  }
}

export const LIMITS = {
  /** Only without a way to see the worker end: a big scan can decode for minutes without a word, and switching away is caught by closeMs. */
  silentMs: 600_000,
  /** A closing file is answered as soon as the worker is free, so no answer this long means it is stuck. */
  closeMs: 10_000,
  /** Nothing open for this long gives the memory back. */
  idleMs: 120_000,
  /** Its caches are cleared per file, so this only bounds what they might miss. */
  filesPerWorker: 25,
};

export interface WorkerParts<W> {
  handle: W;
  stop(): void;
  onCrash(tell: () => void): void;
  /** True once the worker's end will be seen directly, so its silence only means it is busy. */
  seesDeath?(): boolean;
}

export interface Lease<W> {
  worker: W;
  /** Settles if this worker ends while the file is using it. */
  lost: Promise<void>;
  /** Fails with WorkerLost if the worker ends or goes silent before the work finishes. */
  watch<T>(work: Promise<T>): Promise<T>;
  /** Call once, with the promise of the file finishing its goodbye on the worker. */
  release(finished: Promise<unknown>): void;
}

interface Generation<W> {
  parts: WorkerParts<W>;
  users: number;
  served: number;
  retired: boolean;
  lost: Promise<void>;
  lose(): void;
}

// A hidden tab pauses drawing, which is not the worker being stuck.
let lastHidden = 0;
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { lastHidden = Date.now(); });
const hiddenWithin = (ms: number) => typeof document !== 'undefined' && (document.hidden || Date.now() - lastHidden < ms);

export function workerOwner<W>(start: () => WorkerParts<W>, limits = LIMITS) {
  let current: Generation<W> | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const retire = (generation: Generation<W>) => {
    if (generation.retired) return;
    generation.retired = true;
    if (current === generation) {
      current = null;
      clearTimeout(idle);
    }
    generation.lose();
    generation.parts.stop();
  };

  const begin = () => {
    const parts = start();
    let lose = () => {};
    const lost = new Promise<void>((resolve) => { lose = resolve; });
    const generation: Generation<W> = { parts, users: 0, served: 0, retired: false, lost, lose };
    parts.onCrash(() => retire(generation));
    return generation;
  };

  return {
    /** Ends the worker now. Everything still on it is told, as if it had died. */
    stop() {
      if (current) retire(current);
    },
    acquire(): Lease<W> {
      clearTimeout(idle);
      // Only ever with nobody on it, so a file in use is never cut off.
      if (current && !current.users && current.served >= limits.filesPerWorker) retire(current);
      const generation = (current ??= begin());
      generation.users += 1;
      generation.served += 1;
      const dead = generation.lost.then(() => { throw new WorkerLost(); });
      dead.catch(() => {});
      return {
        worker: generation.parts.handle,
        lost: generation.lost,
        watch<T>(work: Promise<T>) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const arm = () => {
            timer = setTimeout(() => {
              if (generation.parts.seesDeath?.() || hiddenWithin(limits.silentMs)) arm();
              else retire(generation);
            }, limits.silentMs);
          };
          arm();
          return Promise.race([work, dead]).finally(() => clearTimeout(timer));
        },
        release(finished) {
          const stuck = setTimeout(() => retire(generation), limits.closeMs);
          const done = () => {
            clearTimeout(stuck);
            generation.users -= 1;
            if (current === generation && !generation.users) {
              clearTimeout(idle);
              idle = setTimeout(() => retire(generation), limits.idleMs);
            }
          };
          finished.then(done, done);
        },
      };
    },
  };
}
