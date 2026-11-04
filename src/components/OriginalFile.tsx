import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { openPdf, type PdfFile } from '../services/pdfViewer';
import { C } from '../theme';
import { s } from './styles';

const LENS_SIZE = 240;
const LENS_ZOOM = 2.5;
const MAX_PIXEL_WIDTH = 3000;
const NEAR = '800px';

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
  onFail: () => void;
}

function Page({ pdf, page, width, title, scroller, lens, onOpen, onFail }: PageProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const near = useNear(holder, scroller);

  useEffect(() => {
    const target = canvas.current;
    if (!near || !width || !target) return;
    const scale = (window.devicePixelRatio || 1) * (canHover() ? LENS_ZOOM : 1);
    const job = pdf.render(page, target, Math.min(Math.round(width * scale), MAX_PIXEL_WIDTH));
    job.done.catch(onFail);
    return () => {
      job.cancel();
      target.width = 0; // Pages far from view give their memory back.
    };
  }, [pdf, page, width, near, onFail]);

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
  const size = { display: 'block', width, height: Math.round(width * pdf.ratio(page)), padding: 0, background: '#FFFEFB', border: 0 };
  const hover = { onPointerMove: moveLens, onPointerLeave: hideLens };
  return (
    <div ref={holder} data-pdf-page={page}>
      {onOpen ? (
        <button aria-label={`Open page ${page} larger`} onClick={() => { hideLens(); onOpen(page); }} style={{ ...size, cursor: 'zoom-in' }} {...hover}>
          {sheet}
        </button>
      ) : (
        <div style={{ ...size, cursor: 'zoom-in' }} {...hover}>
          {sheet}
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
  onFail: () => void;
}

function Pages({ pdf, title, startPage, height, onOpen, onFail }: PagesProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

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

  return (
    <div ref={scroller} style={{ position: 'relative', height, overflowY: 'auto', overflowX: 'hidden' }} onScroll={() => { if (lens.current) lens.current.style.display = 'none'; }}>
      {width > 0 &&
        Array.from({ length: pdf.pages }, (_, i) => (
          <Page key={i + 1} pdf={pdf} page={i + 1} width={width} title={title} scroller={scroller} lens={lens} onOpen={onOpen} onFail={onFail} />
        ))}
      <canvas
        ref={lens}
        data-pdf-lens
        aria-hidden="true"
        style={{ display: 'none', position: 'fixed', width: LENS_SIZE, height: LENS_SIZE, border: `1px solid ${C.ink}`, background: '#FFFEFB', pointerEvents: 'none', zIndex: 10 }}
      />
    </div>
  );
}

export function PageModal({ pdf, title, page, onClose, onFail }: { pdf: PdfFile; title: string; page: number; onClose: () => void; onFail: () => void }) {
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
          <Pages pdf={pdf} title={title} startPage={page} height="100%" onFail={onFail} />
        </div>
      </div>
    </dialog>
  );
}

/** Opens a stored file once it is wanted, and closes it when done. */
export function usePdf(file: string | null, wanted: boolean) {
  const [pdf, setPdf] = useState<PdfFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [fail] = useState(() => () => setFailed(true));

  useEffect(() => {
    if (!wanted || !file) return;
    let current = true;
    let opened: PdfFile | null = null;
    setPdf(null);
    setFailed(false);
    openPdf(file).then(
      (found) => {
        if (current) {
          opened = found;
          setPdf(found);
        } else found.close();
      },
      () => { if (current) setFailed(true); },
    );
    return () => {
      current = false;
      opened?.close();
    };
  }, [file, wanted]);

  return { pdf, failed, fail };
}

/** The real stored file, drawn here with a magnifier. Clicking a page enlarges it in this tab. */
export function OriginalFile({ title, url, height = 720 }: { title: string; url: string; height?: number }) {
  const [file, fragment] = url.split('#');
  const startPage = Number(fragment?.match(/^page=(\d+)$/)?.[1]) || null;
  const frame = useRef<HTMLDivElement>(null);
  const near = useNear(frame);
  const [wanted, setWanted] = useState(false);
  const { pdf, failed, fail } = usePdf(file, wanted);
  const [enlarged, setEnlarged] = useState<number | null>(null);

  useEffect(() => {
    if (near) setWanted(true);
  }, [near]);

  useEffect(() => setEnlarged(null), [pdf]);

  return (
    <>
      <div ref={frame} role="group" aria-label={`Original file: ${title}`} data-file={file} data-page={startPage ?? undefined} style={{ marginTop: 8, background: '#FFFEFB', border: `1px solid ${C.rule}`, minHeight: height }}>
        {failed ? (
          // The browser's own viewer, so a file this page cannot draw can still be read.
          <iframe key={url} title={`Original file: ${title}`} src={url} style={{ display: 'block', width: '100%', height, border: 0 }} />
        ) : pdf ? (
          <Pages pdf={pdf} title={title} startPage={startPage} height={height} onOpen={setEnlarged} onFail={fail} />
        ) : (
          <p style={{ margin: 0, padding: 14, fontSize: 12, color: C.ink3 }}>Loading the original.</p>
        )}
      </div>
      {pdf && !failed && enlarged !== null && <PageModal pdf={pdf} title={title} page={enlarged} onClose={() => setEnlarged(null)} onFail={fail} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 10, fontSize: 12 }}>
        {pdf && !failed && <span style={{ color: C.ink3 }}>Hover to magnify. Click a page to enlarge it.</span>}
        <a href={`${file}?download=true`}>Download original</a>
      </div>
    </>
  );
}
