import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../services/pdfViewer');

interface Task { promise: Promise<unknown>; destroy: ReturnType<typeof vi.fn>; resolve(doc: unknown): void; reject(e: Error): void; worker: unknown }
const tasks: Task[] = [];
const workers: { port: unknown; destroy: ReturnType<typeof vi.fn> }[] = [];
const ports: { terminate: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> }[] = [];

vi.mock('pdfjs-dist', () => ({
  PDFWorker: { create: ({ port }: { port: unknown }) => { const w = { port, destroy: vi.fn() }; workers.push(w); return w; } },
  Util: { transform: () => [0, 0, 0, 0, 0, 0] },
  getDocument: ({ worker }: { worker: unknown }) => {
    let resolve = (_: unknown) => {};
    let reject = (_: Error) => {};
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => {});
    const task: Task = { promise, destroy: vi.fn(async () => {}), resolve, reject, worker };
    tasks.push(task);
    return task;
  },
}));
vi.mock('../services/pdfWorkerEntry?worker', () => ({
  default: class { terminate = vi.fn(); addEventListener = vi.fn(); removeEventListener = vi.fn(); constructor() { ports.push(this); } },
}));

const page = (finish: Promise<void> = Promise.resolve()) => ({
  getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 130 * scale }),
  render: vi.fn(() => ({ promise: finish, cancel: vi.fn() })),
  getTextContent: async () => ({ items: [] }),
});
const doc = (p = page()) => ({ numPages: 2, getPage: vi.fn(async () => p) });

async function load() {
  vi.resetModules();
  tasks.length = workers.length = ports.length = 0;
  return import('../services/pdfViewer');
}
const started = () => vi.waitFor(() => expect(tasks.length).toBeGreaterThan(0));

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never); });
afterEach(() => vi.restoreAllMocks());

describe('opening files on the shared worker', () => {
  it('uses one worker for many files, and closing them leaves it running', async () => {
    const { openPdf } = await load();
    for (let i = 0; i < 5; i++) {
      const opening = openPdf(`/file-${i}`);
      await vi.waitFor(() => expect(tasks).toHaveLength(i + 1));
      tasks[i].resolve(doc());
      (await opening).close();
      expect(tasks[i].destroy).toHaveBeenCalledTimes(1);
    }
    expect(ports).toHaveLength(1);
    expect(new Set(tasks.map((t) => t.worker)).size).toBe(1);
    expect(workers[0].destroy).not.toHaveBeenCalled();
    expect(ports[0].terminate).not.toHaveBeenCalled();
  });

  it('cancelling while it opens ends that file only, and the next opens', async () => {
    const { openPdf } = await load();
    const stop = new AbortController();
    const opening = openPdf('/first', stop.signal);
    await started();
    stop.abort();
    await expect(opening).rejects.toBeTruthy();
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(workers[0].destroy).not.toHaveBeenCalled();
    const next = openPdf('/second');
    await vi.waitFor(() => expect(tasks).toHaveLength(2));
    tasks[1].resolve(doc());
    expect((await next).pages).toBe(2);
  });

  it('asks the worker for nothing when already cancelled', async () => {
    const { openPdf } = await load();
    const stop = new AbortController();
    stop.abort();
    await expect(openPdf('/first', stop.signal)).rejects.toBeTruthy();
    expect(tasks).toHaveLength(0);
  });

  it('a file that cannot be read fails alone', async () => {
    const { openPdf } = await load();
    const opening = openPdf('/broken');
    await started();
    tasks[0].reject(new Error('Invalid PDF structure'));
    await expect(opening).rejects.toThrow('Invalid PDF structure');
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(workers[0].destroy).not.toHaveBeenCalled();
    const next = openPdf('/fine');
    await vi.waitFor(() => expect(tasks).toHaveLength(2));
    expect(tasks[1].worker).toBe(tasks[0].worker);
    tasks[1].resolve(doc());
    await next;
  });

  it('a page finished after its file closed draws nothing and reports nothing', async () => {
    const { openPdf } = await load();
    let finish = () => {};
    const slow = page(new Promise<void>((r) => { finish = r; }));
    const opening = openPdf('/first');
    await started();
    tasks[0].resolve(doc(slow));
    const file = await opening;
    const target = document.createElement('canvas');
    const job = file.render(1, target, 500);
    await vi.waitFor(() => expect(slow.render).toHaveBeenCalled());
    file.close();
    finish();
    await expect(job.done).resolves.toBeUndefined();
    expect(target.hasAttribute('width')).toBe(false);
  });

  it('a cancelled page draws nothing', async () => {
    const { openPdf } = await load();
    let finish = () => {};
    const slow = page(new Promise<void>((r) => { finish = r; }));
    const opening = openPdf('/first');
    await started();
    tasks[0].resolve(doc(slow));
    const target = document.createElement('canvas');
    const job = (await opening).render(1, target, 500);
    await vi.waitFor(() => expect(slow.render).toHaveBeenCalled());
    job.cancel();
    finish();
    await job.done;
    expect(target.hasAttribute('width')).toBe(false);
  });

  it('nothing more can be found in a closed file', async () => {
    const { openPdf } = await load();
    const opening = openPdf('/first');
    await started();
    tasks[0].resolve(doc());
    const file = await opening;
    file.close();
    await expect(file.findRow(1, 'WBC', '6.2')).rejects.toBeTruthy();
  });

  it('closing twice says goodbye once', async () => {
    const { openPdf } = await load();
    const opening = openPdf('/first');
    await started();
    tasks[0].resolve(doc());
    const file = await opening;
    file.close();
    file.close();
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('a worker crash fails what is waiting, tells the file, and the next file gets a new worker', async () => {
    const { openPdf } = await load();
    const opening = openPdf('/first');
    await started();
    tasks[0].resolve(doc(page(new Promise<void>(() => {}))));
    const file = await opening;
    const job = file.render(1, document.createElement('canvas'), 500);
    const crash = ports[0].addEventListener.mock.calls.find(([name]) => name === 'error')![1] as () => void;
    crash();
    await expect(job.done).rejects.toMatchObject({ name: 'WorkerLost' });
    await file.lost;
    expect(ports[0].terminate).toHaveBeenCalledTimes(1);
    const next = openPdf('/second');
    await vi.waitFor(() => expect(tasks).toHaveLength(2));
    expect(tasks[1].worker).not.toBe(tasks[0].worker);
    tasks[1].resolve(doc());
    await next;
  });

  describe('with a browser that can see a worker end', () => {
    const request = vi.fn();
    beforeEach(() => {
      request.mockReset();
      request.mockImplementation(() => new Promise(() => {}));
      Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    });
    afterEach(() => { Reflect.deleteProperty(navigator, 'locks'); });

    it('asks for the lock only once the worker holds it, and its release tells the file', async () => {
      const { openPdf } = await load();
      const opening = openPdf('/file');
      await started();
      tasks[0].resolve(doc());
      const file = await opening;
      const said = ports[0].addEventListener.mock.calls.find(([name]) => name === 'message')![1] as (e: { data: unknown }) => void;
      said({ data: { targetName: 'main' } });
      expect(request).not.toHaveBeenCalled();
      said({ data: 'pdf-worker-lock-held' });
      expect(request).toHaveBeenCalledTimes(1);
      expect(String(request.mock.calls[0][0])).toMatch(/^pdf-worker-/);
      request.mock.calls[0][1]();
      await file.lost;
      expect(ports[0].terminate).toHaveBeenCalledTimes(1);
    });
  });

  it('stopping ends the worker, and the next file gets a new one', async () => {
    const { openPdf, stopPdfWorker } = await load();
    stopPdfWorker();
    const opening = openPdf('/stuck');
    await started();
    tasks[0].resolve(doc());
    const file = await opening;
    stopPdfWorker();
    await file.lost;
    expect(ports[0].terminate).toHaveBeenCalledTimes(1);
    const next = openPdf('/next');
    await vi.waitFor(() => expect(tasks).toHaveLength(2));
    tasks[1].resolve(doc());
    await next;
    expect(ports).toHaveLength(2);
  });
});
