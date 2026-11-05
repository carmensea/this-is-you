/** Draws a stored PDF on this computer. pdf.js is loaded only when an original is first shown. */
import type { PDFWorker } from 'pdfjs-dist';
import { locateRow, toTextLines, type RowBox, type TextLine } from '../domain/locateRow';
import { workerOwner } from './pdfWorker';

export interface PdfRender {
  done: Promise<void>;
  cancel(): void;
}

export interface PdfFile {
  pages: number;
  /** Height over width of a page, known before it is drawn so the list does not jump. */
  ratio(page: number): number;
  render(page: number, canvas: HTMLCanvasElement, pixelWidth: number): PdfRender;
  /** Where a stored source line sits on its page, or null if the page's text cannot say for sure. */
  findRow(page: number, source: string, value: string): Promise<RowBox | null>;
  /** Settles if the worker ended while this file was open. Nothing more can be read from it then. */
  lost: Promise<void>;
  close(): void;
}

// shortcut: past this many pages the rest use the last known shape, upgrade if a long report's pages differ.
const MEASURED_PAGES = 300;
const FALLBACK_RATIO = 1.294;

class FileClosed extends Error {}

let owner: ReturnType<typeof workerOwner<PDFWorker>> | null = null;

/** Ends the worker for a file stuck on it. Any other open file reopens by itself. */
export function stopPdfWorker() {
  owner?.stop();
}

export async function openPdf(url: string, signal?: AbortSignal): Promise<PdfFile> {
  const [pdfjs, { default: PdfWorker }] = await Promise.all([import('pdfjs-dist'), import('./pdfWorkerEntry?worker')]);
  if (signal?.aborted) throw new FileClosed();
  // pdf.js only ends a worker it made itself. This one is handed in, so closing a file cannot break the next one opening.
  owner ??= workerOwner(() => {
    // Tabs share locks, so the name is this worker's alone. No lock (not HTTPS or localhost) leaves the silence limit in charge.
    const name = `pdf-worker-${Date.now()}-${Math.random()}`;
    const port = new PdfWorker({ name });
    const worker = pdfjs.PDFWorker.create({ port });
    let watching = false;
    return {
      handle: worker,
      stop: () => {
        worker.destroy();
        port.terminate();
      },
      onCrash: (tell) => {
        port.addEventListener('error', tell);
        port.addEventListener('messageerror', tell);
        // Asked only once the worker holds the lock, so it is granted when the worker ends, not before.
        const held = (event: MessageEvent) => {
          if (event.data !== 'pdf-worker-lock-held') return;
          port.removeEventListener('message', held);
          watching = true;
          navigator.locks.request(name, tell).catch(() => { watching = false; });
        };
        port.addEventListener('message', held);
      },
      seesDeath: () => watching,
    };
  });
  const lease = owner.acquire();
  const base = import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : '/assets/pdfjs/';
  const task = pdfjs.getDocument({
    url,
    worker: lease.worker,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${base}wasm/`,
  });
  let closed = false;
  let shut = () => {};
  const closing = new Promise<never>((_, reject) => { shut = () => reject(new FileClosed()); });
  closing.catch(() => {});
  const close = () => {
    if (closed) return;
    closed = true;
    shut();
    lease.release(task.destroy());
  };
  signal?.addEventListener('abort', close, { once: true });
  // Nothing from this file can reach a caller once it is closed, and the worker's silence is noticed.
  const guard = <T>(work: Promise<T>) => lease.watch(Promise.race([work, closing]));
  let doc: Awaited<typeof task.promise>;
  let measured: number[];
  try {
    doc = await guard(task.promise);
    measured = await guard(Promise.all(
      Array.from({ length: Math.min(doc.numPages, MEASURED_PAGES) }, async (_, i) => {
        const view = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
        return view.height / view.width;
      }),
    ));
  } catch (problem) {
    close();
    throw problem;
  }
  signal?.removeEventListener('abort', close);
  const textLines = new Map<number, Promise<TextLine[]>>();
  const linesOf = (page: number) => {
    if (!textLines.has(page)) {
      textLines.set(page, guard(doc.getPage(page).then(async (p) => {
        const view = p.getViewport({ scale: 1 });
        const { items } = await p.getTextContent();
        const pieces = items.flatMap((item) => {
          if (!('str' in item) || !item.str.trim()) return [];
          const [, , c, d, x, baseline] = pdfjs.Util.transform(view.transform, item.transform);
          return [{ text: item.str, x, baseline, width: item.width, height: Math.hypot(c, d) || item.height }];
        });
        return toTextLines(pieces, view.width, view.height);
      })));
    }
    return textLines.get(page)!;
  };
  return {
    pages: doc.numPages,
    lost: lease.lost,
    ratio: (page) => measured[page - 1] ?? measured[measured.length - 1] ?? FALLBACK_RATIO,
    findRow: (page, source, value) => (page >= 1 && page <= doc.numPages ? linesOf(page).then((lines) => locateRow(lines, source, value)) : Promise.resolve(null)),
    render(page, canvas, pixelWidth) {
      let cancelled = false;
      let inner: { cancel(): void } | null = null;
      const done = guard(doc.getPage(page)).then(async (p) => {
        if (cancelled) return;
        const unit = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: pixelWidth / unit.width });
        const off = document.createElement('canvas');
        off.width = Math.ceil(viewport.width);
        off.height = Math.ceil(viewport.height);
        const job = p.render({ canvas: off, viewport });
        inner = job;
        await guard(job.promise);
        if (cancelled) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d')?.drawImage(off, 0, 0);
      }).catch((problem: Error) => {
        inner?.cancel();
        if (!cancelled && !closed && problem?.name !== 'RenderingCancelledException') throw problem;
      });
      return {
        done,
        cancel() {
          cancelled = true;
          inner?.cancel();
        },
      };
    },
    close,
  };
}
