import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { openPdf, stopPdfWorker, type PdfFile } from '../services/pdfViewer';
import { WorkerLost } from '../services/pdfWorker';
import type { PageBox } from '../domain/locateRow';
import type { PdfTarget } from '../state/store';
import { C } from '../theme';
import { s } from './styles';

const LENS_SIZE = 240;
const LENS_ZOOM = 2.5;
const MAX_PIXEL_WIDTH = 3000;
const NEAR = '800px';
const SLOW_MS = 15_000;
const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 3]; // Of the panel's width. 1 fits the page to it.
const FIT = 1;

const canHover = () => window.matchMedia?.('(hover: hover)').matches ?? true;

/** Whether an element is on or near the screen. Without an observer to ask, it counts as near. */
export function useNear(ref: RefObject<Element | null>, root?: RefObject<Element | null>) {
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !ref.current) return;
    const seen = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root?.current ?? null, rootMargin: NEAR });
    seen.observe(ref.current);
    return () => seen.disconnect();
  }, [ref, root]);
  return near;
}

interface PageProps {
  pdf: PdfFile;
  page: number;
  width: number;
  title: string;
  scroller: RefObject<HTMLDivElement | null>;
  lens: RefObject<HTMLCanvasElement | null>;
  onOpen?: (page: number) => void;
  onFail: (problem?: unknown) => void;
  onDrawing?: (change: number) => void;
  /** The source line to show, as fractions of the page. */
  mark?: PageBox | null;
}

function Page({ pdf, page, width, title, scroller, lens, onOpen, onFail, onDrawing, mark }: PageProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const near = useNear(holder, scroller);

  useEffect(() => {
    const target = canvas.current;
    if (!near || !width || !target) return;
    const scale = (window.devicePixelRatio || 1) * (canHover() ? LENS_ZOOM : 1);
    const job = pdf.render(page, target, Math.min(Math.round(width * scale), MAX_PIXEL_WIDTH));
    job.done.catch(onFail);
    onDrawing?.(1);
    const finished = () => onDrawing?.(-1); // Every job settles, at the latest when its file closes.
    job.done.then(finished, finished);
    return () => {
      job.cancel();
      target.width = 0; // Pages far from view give their memory back.
    };
  }, [pdf, page, width, near, onFail, onDrawing]);

  const hideLens = () => {
    if (lens.current) lens.current.style.display = 'none';
  };
  const moveLens = (e: PointerEvent) => {
    const glass = lens.current;
    const source = canvas.current;
    if (!glass || !source || e.pointerType !== 'mouse' || !source.width) return;
    const box = source.getBoundingClientRect();
    const across = source.width / box.width;
    const down = source.height / box.height;
    const seenWidth = (LENS_SIZE / LENS_ZOOM) * across;
    const seenHeight = (LENS_SIZE / LENS_ZOOM) * down;
    const dpr = window.devicePixelRatio || 1;
    glass.width = glass.height = LENS_SIZE * dpr;
    const ctx = glass.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#FFFEFB';
    ctx.fillRect(0, 0, glass.width, glass.height);
    ctx.drawImage(source, (e.clientX - box.left) * across - seenWidth / 2, (e.clientY - box.top) * down - seenHeight / 2, seenWidth, seenHeight, 0, 0, glass.width, glass.height);
    glass.style.display = 'block';
    glass.style.left = `${e.clientX - LENS_SIZE / 2}px`;
    glass.style.top = `${e.clientY - LENS_SIZE / 2}px`;
  };

  const sheet = (
    <canvas ref={canvas} role="img" aria-label={`Page ${page} of ${pdf.pages}, ${title}`} style={{ display: 'block', width: '100%', height: '100%' }} />
  );
  const size = { display: 'block', position: 'relative' as const, width, height: Math.round(width * pdf.ratio(page)), padding: 0, background: '#FFFEFB', border: 0 };
  const highlight = mark && (
    <span
      data-source-mark
      aria-hidden="true"
      style={{ position: 'absolute', left: `${(mark.left - 0.006) * 100}%`, top: `${(mark.top - 0.004) * 100}%`, width: `${(mark.right - mark.left + 0.012) * 100}%`, height: `${(mark.bottom - mark.top + 0.008) * 100}%`, background: C.greenT, mixBlendMode: 'multiply', outline: `1px solid ${C.green}`, pointerEvents: 'none' }}
    />
  );
  const hover = { onPointerMove: moveLens, onPointerLeave: hideLens };
  return (
    <div ref={holder} data-pdf-page={page}>
      {onOpen ? (
        <button aria-label={`Open page ${page} larger`} onClick={() => { hideLens(); onOpen(page); }} style={{ ...size, cursor: 'zoom-in' }} {...hover}>
          {sheet}
          {highlight}
        </button>
      ) : (
        <div style={{ ...size, cursor: 'zoom-in' }} {...hover}>
          {sheet}
          {highlight}
        </div>
      )}
      <p style={{ margin: '4px 0 12px', fontSize: 11, color: C.ink3, textAlign: 'center' }}>
        Page {page} of {pdf.pages}
      </p>
    </div>
  );
}

interface PagesProps {
  pdf: PdfFile;
  title: string;
  startPage: number | null;
  height: number | string;
  onOpen?: (page: number) => void;
  onFail: (problem?: unknown) => void;
  onDrawing?: (change: number) => void;
  target?: PdfTarget | null;
}

function Pages({ pdf, title, startPage, height, onOpen, onFail, onDrawing, target }: PagesProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLCanvasElement>(null);
  const [fitWidth, setWidth] = useState(0);
  const [zoom, setZoom] = useState(FIT);
  const width = Math.round(fitWidth * zoom);
  const [mark, setMark] = useState<{ page: number; box: PageBox } | null>(null);
  const [missed, setMissed] = useState<number | null>(null);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measure = () => setWidth(box.clientWidth || 600);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    const box = scroller.current;
    const target = box?.querySelector<HTMLElement>(`[data-pdf-page="${startPage}"]`);
    if (box && target && width) box.scrollTop = target.offsetTop;
  }, [startPage, width]);

  // The selected source: its page in view, and its line marked and brought to the upper third, when the page's text can say where.
  useEffect(() => {
    const box = scroller.current;
    if (!target || !width || !box) return;
    let live = true;
    const show = (row: PageBox | null) => {
      const sheet = box.querySelector<HTMLElement>(`[data-pdf-page="${target.page}"]`);
      if (!live || !sheet) return;
      setMark(row ? { page: target.page, box: row } : null);
      setMissed(row || !target.text ? null : target.page);
      const pageHeight = Math.round(width * pdf.ratio(target.page));
      box.scrollTop = Math.max(0, sheet.offsetTop + (row ? row.top * pageHeight - box.clientHeight / 3 : 0));
      if (zoom > FIT) box.scrollLeft = row ? Math.max(0, row.left * width - 24) : 0;
    };
    if (!target.text) show(null);
    else pdf.findRow(target.page, target.text, target.value).then(show, () => show(null));
    return () => {
      live = false;
    };
  }, [pdf, target, width, zoom]);

  const step = (by: number) => setZoom((now) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(now) + by))]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height }}>
    <div role="toolbar" aria-label="Zoom" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 10px', borderBottom: `1px solid ${C.rule2}`, fontSize: 12, flexWrap: 'wrap' }}>
      <button onClick={() => step(-1)} disabled={zoom === ZOOMS[0]} aria-label="Zoom out" style={{ ...s.stepBtn8, border: `1px solid ${C.rule}` }}>−</button>
      <span aria-live="polite" style={{ ...s.monoNote, minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
      <button onClick={() => step(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in" style={{ ...s.stepBtn8, border: `1px solid ${C.rule}` }}>+</button>
      <button onClick={() => setZoom(FIT)} disabled={zoom === FIT} style={s.link12}>Fit width</button>
      {missed !== null && <span role="status" style={{ color: C.ink3 }}>That line could not be found in the page's text, so page {missed} is shown.</span>}
    </div>
    <div ref={scroller} style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: zoom > FIT ? 'auto' : 'hidden' }} onScroll={() => { if (lens.current) lens.current.style.display = 'none'; }}>
      {width > 0 &&
        Array.from({ length: pdf.pages }, (_, i) => (
          <Page key={i + 1} pdf={pdf} page={i + 1} width={width} title={title} scroller={scroller} lens={lens} onOpen={onOpen} onFail={onFail} onDrawing={onDrawing} mark={mark?.page === i + 1 ? mark.box : null} />
        ))}
      <canvas
        ref={lens}
        data-pdf-lens
        aria-hidden="true"
        style={{ display: 'none', position: 'fixed', width: LENS_SIZE, height: LENS_SIZE, border: `1px solid ${C.ink}`, background: '#FFFEFB', pointerEvents: 'none', zIndex: 10 }}
      />
    </div>
    </div>
  );
}

export function PageModal({ pdf, title, page, onClose, onFail, onDrawing }: { pdf: PdfFile; title: string; page: number; onClose: () => void; onFail: (problem?: unknown) => void; onDrawing?: (change: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const open = dialog.current;
    if (open && !open.open) open.showModal?.();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={`Original file, enlarged: ${title}`}
      onClose={onClose}
      onClick={(e) => { if (e.target === dialog.current) onClose(); }}
      style={{ width: 'min(1120px, calc(100vw - 32px))', height: 'calc(100vh - 32px)', maxWidth: 'none', maxHeight: 'none', padding: 0, border: `1px solid ${C.rule}`, background: C.paper, color: C.ink, overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', padding: '10px 14px', borderBottom: `1px solid ${C.rule}` }}>
          <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <button onClick={onClose} style={s.link12}>
            Close
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Pages pdf={pdf} title={title} startPage={page} height="100%" onFail={onFail} onDrawing={onDrawing} />
        </div>
      </div>
    </dialog>
  );
}

/** Opens a stored file once it is wanted, and closes it when done. A file is only ever returned for the address it was opened from. */
export function usePdf(file: string | null, wanted: boolean) {
  const [opened, setOpened] = useState<{ file: string; pdf: PdfFile } | null>(null);
  const [failedFile, setFailedFile] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const leave = useRef(() => {});
  // Losing the worker says nothing about the file, and usePdf opens it again below.
  const fail = useCallback((problem?: unknown) => {
    if (!(problem instanceof WorkerLost)) setFailedFile(file);
  }, [file]);

  useEffect(() => {
    if (!wanted || !file) return;
    const stop = new AbortController();
    let held: PdfFile | null = null;
    let tries = 1; // A file that keeps ending the worker goes to the browser's own viewer.
    const recover = () => {
      if (tries-- > 0) {
        setReopening(true);
        open();
      } else setFailedFile(file);
    };
    const open = () => {
      setOpened(null);
      openPdf(file, stop.signal).then(
        (found) => {
          if (stop.signal.aborted) {
            found.close();
            return;
          }
          held = found;
          setOpened({ file, pdf: found });
          setReopening(false);
          void found.lost.then(() => {
            if (stop.signal.aborted || held !== found) return;
            held = null;
            found.close();
            recover();
          });
        },
        (problem) => {
          if (stop.signal.aborted) return;
          if (problem instanceof WorkerLost) recover();
          else setFailedFile(file);
        },
      );
    };
    leave.current = () => {
      stop.abort();
      held?.close();
    };
    setFailedFile(null);
    setReopening(false);
    open();
    return () => leave.current();
  }, [file, wanted]);

  // Left first, so this file does not reopen when told its worker ended.
  const stop = useCallback(() => {
    leave.current();
    setFailedFile(file);
    stopPdfWorker();
  }, [file]);

  return { pdf: opened && opened.file === file ? opened.pdf : null, failed: failedFile !== null && failedFile === file, reopening, fail, stop };
}

/** The real stored file, drawn here with a magnifier. Clicking a page enlarges it in this tab. */
export function OriginalFile({ title, url, height = 720, target = null }: { title: string; url: string; height?: number | string; target?: PdfTarget | null }) {
  const [file, fragment] = url.split('#');
  const startPage = Number(fragment?.match(/^page=(\d+)$/)?.[1]) || null;
  const shownPage = target?.page ?? startPage;
  const frame = useRef<HTMLDivElement>(null);
  const near = useNear(frame);
  const [wanted, setWanted] = useState(false);
  const { pdf, failed, reopening, fail, stop } = usePdf(file, wanted);
  const [enlarged, setEnlarged] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(0);
  const onDrawing = useCallback((change: number) => setDrawing((now) => now + change), []);
  const [slow, setSlow] = useState(false);
  const working = wanted && !failed && (!pdf || drawing > 0);

  // Slowness is only ever reported. Nothing is cancelled unless asked.
  useEffect(() => {
    setSlow(false);
    if (!working) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [working, file]);

  useEffect(() => {
    if (near) setWanted(true);
  }, [near]);

  useEffect(() => setEnlarged(null), [pdf]);

  return (
    <>
      <div ref={frame} role="group" aria-label={`Original file: ${title}`} data-file={file} data-page={shownPage ?? undefined} style={{ marginTop: 8, background: '#FFFEFB', border: `1px solid ${C.rule}`, minHeight: height }}>
        {failed ? (
          // The browser's own viewer, so a file this page cannot draw can still be read.
          <iframe key={url} title={`Original file: ${title}`} src={url} style={{ display: 'block', width: '100%', height, border: 0 }} />
        ) : pdf ? (
          <Pages pdf={pdf} title={title} startPage={startPage} height={height} onOpen={setEnlarged} onFail={fail} onDrawing={onDrawing} target={target} />
        ) : (
          <p style={{ margin: 0, padding: 14, fontSize: 12, color: C.ink3 }}>{reopening ? 'The viewer stopped, so this file is opening again.' : 'Loading the original.'}</p>
        )}
      </div>
      {pdf && !failed && enlarged !== null && <PageModal pdf={pdf} title={title} page={enlarged} onClose={() => setEnlarged(null)} onFail={fail} onDrawing={onDrawing} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 10, fontSize: 12 }}>
        {pdf && !failed && <span style={{ color: C.ink3 }}>Scrolls on its own. Hover to magnify, click a page to enlarge it.</span>}
        {slow && !failed && (
          <span role="status" style={{ color: C.ink3 }}>
            Still working on this file. Large scans can take a few minutes.{' '}
            <button onClick={stop} style={s.link12}>Stop</button>
          </span>
        )}
        <a href={`${file}?download=true`}>Download original</a>
      </div>
    </>
  );
}
