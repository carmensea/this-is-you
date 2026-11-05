import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerLost, workerOwner, type WorkerParts } from '../services/pdfWorker';

const LIMITS = { silentMs: 1000, closeMs: 100, idleMs: 500, filesPerWorker: 3 };
const never = new Promise(() => {});

function fixture() {
  const made: (WorkerParts<number> & { crash(): void; stop: ReturnType<typeof vi.fn> })[] = [];
  const owner = workerOwner<number>(() => {
    let crash = () => {};
    const parts = { handle: made.length, stop: vi.fn(), onCrash: (tell: () => void) => { crash = tell; }, crash: () => crash() };
    made.push(parts);
    return parts;
  }, LIMITS);
  return { made, owner };
}
const settled = async (p: Promise<unknown>) => { let done = false; void p.then(() => { done = true; }, () => { done = true; }); await vi.advanceTimersByTimeAsync(0); return done; };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the shared PDF worker', () => {
  it('serves many files, and closing one leaves it running for the next', async () => {
    const { made, owner } = fixture();
    const a = owner.acquire();
    a.release(Promise.resolve());
    const b = owner.acquire();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.worker).toBe(a.worker);
    expect(made).toHaveLength(1);
    expect(made[0].stop).not.toHaveBeenCalled();
  });

  it('a file closed with another still open does not end it, however many times', async () => {
    const { made, owner } = fixture();
    const open = owner.acquire();
    for (let i = 0; i < 10; i++) owner.acquire().release(Promise.resolve());
    await vi.advanceTimersByTimeAsync(LIMITS.idleMs * 2);
    expect(made[0].stop).not.toHaveBeenCalled();
    expect(await settled(open.lost)).toBe(false);
  });

  it('is renewed after enough files, only with nobody on it', async () => {
    const { made, owner } = fixture();
    const held = owner.acquire();
    owner.acquire().release(Promise.resolve());
    owner.acquire().release(Promise.resolve());
    owner.acquire().release(Promise.resolve());
    await vi.advanceTimersByTimeAsync(0);
    expect(made).toHaveLength(1); // Past the limit, but one file is still open.
    held.release(Promise.resolve());
    await vi.advanceTimersByTimeAsync(0);
    const next = owner.acquire();
    expect(made).toHaveLength(2);
    expect(next.worker).toBe(1);
    expect(made[0].stop).toHaveBeenCalledTimes(1);
  });

  it('counts a file as using it until its goodbye has finished', async () => {
    const { made, owner } = fixture();
    for (let i = 0; i < 2; i++) owner.acquire().release(Promise.resolve());
    await vi.advanceTimersByTimeAsync(0);
    const closing = owner.acquire();
    let finish = () => {};
    closing.release(new Promise<void>((r) => { finish = r; }));
    owner.acquire();
    expect(made).toHaveLength(1);
    expect(made[0].stop).not.toHaveBeenCalled();
    finish();
  });

  it('gives its memory back when idle, and a new file cancels that', async () => {
    const { made, owner } = fixture();
    owner.acquire().release(Promise.resolve());
    await vi.advanceTimersByTimeAsync(LIMITS.idleMs - 1);
    const kept = owner.acquire();
    await vi.advanceTimersByTimeAsync(LIMITS.idleMs * 2);
    expect(made[0].stop).not.toHaveBeenCalled();
    kept.release(Promise.resolve());
    await vi.advanceTimersByTimeAsync(LIMITS.idleMs);
    expect(made[0].stop).toHaveBeenCalledTimes(1);
    owner.acquire();
    expect(made).toHaveLength(2);
  });

  it('a crash reaches every file on it, and the next file gets a new worker', async () => {
    const { made, owner } = fixture();
    const a = owner.acquire();
    const b = owner.acquire();
    const waiting = a.watch(never);
    made[0].crash();
    await expect(waiting).rejects.toBeInstanceOf(WorkerLost);
    expect(await settled(b.lost)).toBe(true);
    expect(made[0].stop).toHaveBeenCalledTimes(1);
    expect(owner.acquire().worker).toBe(1);
  });

  it('a worker that goes silent is ended', async () => {
    const { made, owner } = fixture();
    const waiting = owner.acquire().watch(never);
    const seen = expect(waiting).rejects.toBeInstanceOf(WorkerLost);
    await vi.advanceTimersByTimeAsync(LIMITS.silentMs);
    await seen;
    expect(made[0].stop).toHaveBeenCalledTimes(1);
  });

  it('work that answers in time ends no worker', async () => {
    const { made, owner } = fixture();
    await expect(owner.acquire().watch(Promise.resolve('fine'))).resolves.toBe('fine');
    await vi.advanceTimersByTimeAsync(LIMITS.silentMs * 3);
    expect(made[0].stop).not.toHaveBeenCalled();
  });

  it('a failing read is the file\'s problem, not the worker\'s', async () => {
    const { made, owner } = fixture();
    const a = owner.acquire();
    await expect(a.watch(Promise.reject(new Error('not a PDF')))).rejects.toThrow('not a PDF');
    a.release(Promise.reject(new Error('already gone')));
    await vi.advanceTimersByTimeAsync(LIMITS.closeMs * 2); // Past the stuck-file limit, short of idling.
    expect(made[0].stop).not.toHaveBeenCalled();
  });

  it('does not mistake a hidden tab for a stuck worker', async () => {
    const { made, owner } = fixture();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    void owner.acquire().watch(never).catch(() => {});
    await vi.advanceTimersByTimeAsync(LIMITS.silentMs * 5);
    expect(made[0].stop).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('a file stuck on its way out ends the worker, so the next file is not held up', async () => {
    const { made, owner } = fixture();
    owner.acquire().release(never);
    const next = owner.acquire();
    const waiting = next.watch(never);
    const seen = expect(waiting).rejects.toBeInstanceOf(WorkerLost);
    await vi.advanceTimersByTimeAsync(LIMITS.closeMs);
    await seen;
    expect(made[0].stop).toHaveBeenCalledTimes(1);
    expect(owner.acquire().worker).toBe(1);
  });

  it('ends a worker once, whatever happens to it afterwards', async () => {
    const { made, owner } = fixture();
    const a = owner.acquire();
    a.release(never);
    made[0].crash();
    made[0].crash();
    await vi.advanceTimersByTimeAsync(LIMITS.closeMs * 2);
    expect(made[0].stop).toHaveBeenCalledTimes(1);
  });

  it('silence ends no worker once its end can be seen, however long a slow file takes', async () => {
    let die = () => {};
    const stop = vi.fn();
    const owner = workerOwner<number>(() => ({ handle: 1, stop, onCrash: (tell) => { die = tell; }, seesDeath: () => true }), LIMITS);
    const waiting = owner.acquire().watch(never);
    const seen = expect(waiting).rejects.toBeInstanceOf(WorkerLost);
    await vi.advanceTimersByTimeAsync(LIMITS.silentMs * 20);
    expect(stop).not.toHaveBeenCalled();
    die();
    await seen;
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stopping ends the worker and tells whoever is on it, and the next file gets a new one', async () => {
    const { made, owner } = fixture();
    owner.stop(); // Nothing running yet.
    const a = owner.acquire();
    const seen = expect(a.watch(never)).rejects.toBeInstanceOf(WorkerLost);
    owner.stop();
    await seen;
    expect(made[0].stop).toHaveBeenCalledTimes(1);
    expect(owner.acquire().worker).toBe(1);
    expect(made).toHaveLength(2);
  });
});
