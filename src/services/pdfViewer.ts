/** Draws a stored PDF on this computer. pdf.js is loaded only when an original is first shown. */
import { locateRow, toTextLines, type RowBox, type TextLine } from '../domain/locateRow';

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
  close(): void;
}

// shortcut: past this many pages the rest use the last known shape, upgrade if a long report's pages differ.
const MEASURED_PAGES = 300;
const FALLBACK_RATIO = 1.294;

export async function openPdf(url: string): Promise<PdfFile> {
  const [pdfjs, { default: PdfWorker }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?worker')]);
  // One worker for each file, so closing a file cannot break the next one opening.
  const port = new PdfWorker();
  const worker = pdfjs.PDFWorker.create({ port });
  const base = import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : '/assets/pdfjs/';
  const task = pdfjs.getDocument({
    url,
    worker,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${base}wasm/`,
  });
  const doc = await task.promise;
  const measured = await Promise.all(
    Array.from({ length: Math.min(doc.numPages, MEASURED_PAGES) }, async (_, i) => {
      const view = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
      return view.height / view.width;
    }),
  );
  const textLines = new Map<number, Promise<TextLine[]>>();
  const linesOf = (page: number) => {
    if (!textLines.has(page)) {
      textLines.set(page, doc.getPage(page).then(async (p) => {
        const view = p.getViewport({ scale: 1 });
        const { items } = await p.getTextContent();
        const pieces = items.flatMap((item) => {
          if (!('str' in item) || !item.str.trim()) return [];
          const [, , c, d, x, baseline] = pdfjs.Util.transform(view.transform, item.transform);
          return [{ text: item.str, x, baseline, width: item.width, height: Math.hypot(c, d) || item.height }];
        });
        return toTextLines(pieces, view.width, view.height);
      }));
    }
    return textLines.get(page)!;
  };
  return {
    pages: doc.numPages,
    ratio: (page) => measured[page - 1] ?? measured[measured.length - 1] ?? FALLBACK_RATIO,
    findRow: (page, source, value) => (page >= 1 && page <= doc.numPages ? linesOf(page).then((lines) => locateRow(lines, source, value)) : Promise.resolve(null)),
    render(page, canvas, pixelWidth) {
      let cancelled = false;
      let inner: { cancel(): void } | null = null;
      const done = doc.getPage(page).then(async (p) => {
        if (cancelled) return;
        const unit = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: pixelWidth / unit.width });
        const off = document.createElement('canvas');
        off.width = Math.ceil(viewport.width);
        off.height = Math.ceil(viewport.height);
        const job = p.render({ canvas: off, viewport });
        inner = job;
        await job.promise;
        if (cancelled) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d')?.drawImage(off, 0, 0);
      }).catch((problem: Error) => {
        if (!cancelled && problem?.name !== 'RenderingCancelledException') throw problem;
      });
      return {
        done,
        cancel() {
          cancelled = true;
          inner?.cancel();
        },
      };
    },
    close: () => {
      void task.destroy().finally(() => {
        worker.destroy();
        port.terminate();
      });
    },
  };
}
