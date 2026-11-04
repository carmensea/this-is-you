import { useEffect, useMemo, useRef, useState } from 'react';
import { ObservationForm } from '../components/ObservationForm';
import { PageModal, useNear, usePdf } from '../components/OriginalFile';
import { s } from '../components/styles';
import type { PageBox, RowBox } from '../domain/locateRow';
import type { PdfFile } from '../services/pdfViewer';
import { C, MONO } from '../theme';
import type { reviewVM } from '../viewmodels/review';

type VM = NonNullable<ReturnType<typeof reviewVM>>;
type Group = VM['rvGroups'][number];

const CHECK_COLUMN = '40px minmax(0,1fr)';
const STRIP_PIXEL_WIDTH = 2400;
const STRIP_MARGIN = 0.0015; // Of the page, so the line's edges are not cut off and the next line stays out.
const STRIP_WIDTH_PER_PAGE = 900; // Pixels a whole page's width would take, so a narrow table is not blown up.

type DrawPage = (page: number) => Promise<HTMLCanvasElement>;

const stripMaxWidth = (left: number, right: number) => (right - left) * STRIP_WIDTH_PER_PAGE;
const NAME_WIDTH = 120; // When the value's place on the page is not known.
const CELL_GAP = 8;

/** One row of the PDF itself, cut from the drawn page. */
function RowStrip({ draw, page, box, left, right, label, onOpen, onFail }: { draw: DrawPage; page: number; box: PageBox; left: number; right: number; label: string; onOpen: () => void; onFail: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const near = useNear(canvas);
  useEffect(() => {
    if (!near) return;
    let current = true;
    draw(page).then((sheet) => {
      const target = canvas.current;
      if (!current || !target || !sheet.width) return;
      const sx = left * sheet.width;
      const sy = (box.top - STRIP_MARGIN) * sheet.height;
      const sw = (right - left) * sheet.width;
      const sh = (box.bottom - box.top + STRIP_MARGIN * 2) * sheet.height;
      target.width = Math.ceil(sw);
      target.height = Math.ceil(sh);
      target.getContext('2d')?.drawImage(sheet, sx, sy, sw, sh, 0, 0, target.width, target.height);
    }, onFail);
    return () => {
      current = false;
    };
  }, [near, draw, page, box, left, right, onFail]);
  return (
    <button aria-label={`Enlarge the page with ${label}`} onClick={onOpen} style={{ display: 'block', width: '100%', padding: 0, background: '#FFFEFB', cursor: 'zoom-in' }}>
      <canvas ref={canvas} data-row-strip role="img" aria-label={`${label} as printed in the original`} style={{ display: 'block', width: '100%', maxWidth: stripMaxWidth(left, right), height: 'auto', minHeight: 14 }} />
    </button>
  );
}

function GroupTable({ g, v, pdf, draw, onOpenPage }: { g: Group; v: VM; pdf: PdfFile | null; draw: DrawPage; onOpenPage: (page: number) => void }) {
  const [boxes, setBoxes] = useState<Record<string, RowBox | null>>({});
  // Tied to the version, so a result that changes has to be checked again.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const tickOf = (r: Group['rows'][number]) => `${r.id}:${r.version}`;
  const sources = g.rows.map((r) => `${r.id}\0${r.page}\0${r.sourceText}`).join('\n');

  useEffect(() => {
    if (!pdf) return;
    let current = true;
    void Promise.all(g.rows.map(async (r) => [r.id, await pdf.findRow(r.page, r.sourceText, r.value).catch(() => null)] as const)).then((found) => {
      if (current) setBoxes(Object.fromEntries(found));
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sources says when the rows' lookups change.
  }, [pdf, sources]);

  const shown = g.rows.filter((r) => boxes[r.id]);
  const allBoxes = shown.map((r) => boxes[r.id]!);
  // Every strip of a table is cut to the same width, so its columns line up as they do on the page.
  const left = Math.max(0, Math.min(...allBoxes.map((b) => b.left)) - STRIP_MARGIN);
  const right = Math.min(1, Math.max(...allBoxes.map((b) => b.right)) + STRIP_MARGIN);
  const isTicked = (r: Group['rows'][number]) => ticked.has(tickOf(r));
  const tickedCount = g.rows.filter(isTicked).length;
  const allTicked = tickedCount === g.rows.length;
  const allShownTicked = shown.length > 0 && shown.every(isTicked);
  const notShown = g.rows.length - shown.length;
  const toggle = (key: string, on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const tickAll = (on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      for (const r of shown) {
        if (on) next.add(tickOf(r));
        else next.delete(tickOf(r));
      }
      return next;
    });
  const aggregate = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (aggregate.current) aggregate.current.indeterminate = tickedCount > 0 && !allShownTicked;
  }, [tickedCount, allShownTicked]);
  const failStrip = (id: string) => setBoxes((was) => ({ ...was, [id]: null }));

  return (
    <section aria-label={g.label} style={{ marginTop: 18 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 4px' }}>{g.label}</h3>
      <p style={{ margin: '2px 4px 8px', fontSize: 12, color: C.ink2, maxWidth: 620 }}>
        Each row of the original is printed above what was read from it. Tick the ones that match.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', alignItems: 'center', padding: '8px 4px', borderTop: `1px solid ${C.ink}`, borderBottom: `1px solid ${C.ink}` }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 500 }}>
          <input ref={aggregate} type="checkbox" checked={allShownTicked} disabled={!shown.length} onChange={(e) => tickAll(e.target.checked)} />
          {notShown ? `All ${shown.length} shown match the original` : `All ${g.rows.length} match the original`}
        </label>
        <button
          onClick={g.onApprove}
          disabled={!allTicked}
          style={{ background: allTicked ? C.ink : C.sunk, color: allTicked ? C.paper : C.ink3, padding: '8px 14px', fontSize: 13, fontWeight: 500 }}
        >
          {g.approveLabel}
        </button>
        {!allTicked && <span style={{ fontSize: 12, color: C.ink2 }}>{tickedCount} of {g.rows.length} ticked. If one does not match, edit or reject it.</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 560 }}>
          <div style={{ padding: '4px 4px', fontSize: 11, fontWeight: 500, color: C.ink3 }}>Match</div>
          {g.rows.map((r) => {
            const box = boxes[r.id];
            // The value starts directly under the PDF's value, so the two read straight down.
            const at = box && box.valueLeft !== null ? (box.valueLeft - left) / (right - left) : null;
            return (
              <div key={r.id} role="row" style={{ display: 'grid', gridTemplateColumns: CHECK_COLUMN, alignItems: 'center', borderTop: `1px solid ${C.rule2}`, padding: '6px 4px', background: isTicked(r) ? C.greenT : 'transparent' }}>
                <input type="checkbox" aria-label={`${r.name} matches the original`} checked={isTicked(r)} onChange={(e) => toggle(tickOf(r), e.target.checked)} />
                <div style={{ minWidth: 0 }}>
                  {box ? (
                    <RowStrip draw={draw} page={r.page} box={box} left={left} right={right} label={r.name} onOpen={() => onOpenPage(r.page)} onFail={() => failStrip(r.id)} />
                  ) : (
                    pdf && r.id in boxes && (
                      <p style={{ margin: 0, padding: '2px 0', fontSize: 12, color: C.amber }}>
                        This row could not be cut from page {r.page}. Check it in the original before ticking it.
                      </p>
                    )
                  )}
                  <div style={{ display: 'flex', gap: CELL_GAP, alignItems: 'baseline', padding: '4px 0 2px', maxWidth: box ? stripMaxWidth(left, right) : undefined }}>
                    <span style={{ flex: 'none', width: at !== null && at > 0.05 ? `calc(${at * 100}% - ${CELL_GAP}px)` : NAME_WIDTH, minWidth: 'max-content', fontSize: 13, fontWeight: 500 }}>{r.name}</span>
                    <span style={{ flex: 'none', fontFamily: MONO, fontSize: 13 }}>{r.value}</span>
                    <span style={{ flex: 'none', fontSize: 12, color: C.ink2 }}>{r.unit}</span>
                    <span style={{ flex: 'none', fontFamily: MONO, fontSize: 12, color: C.ink2 }}>{r.range}</span>
                    <span style={{ flex: 'none', fontFamily: MONO, fontSize: 12, fontWeight: 500, color: C.rust }}>{r.flag}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline', padding: '0 0 2px' }}>
                    <span style={{ fontSize: 12, color: C.ink2 }}>{r.collected}</span>
                    <button onClick={r.onShowPage} title={r.sourceText} style={{ ...s.link12, fontFamily: MONO, whiteSpace: 'nowrap' }}>
                      {r.source}
                    </button>
                    <span style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                      <button onClick={r.onAccept} style={{ fontSize: 12, color: C.green, borderBottom: `1px solid ${C.green}` }}>
                        Accept
                      </button>
                      <button onClick={r.onEdit} style={s.link12}>
                        Edit
                      </button>
                      <button onClick={r.onReject} style={s.link12}>
                        Reject
                      </button>
                    </span>
                  </div>
                  {r.note && <p style={{ margin: '0 0 3px', fontSize: 12, color: C.amber }}>{r.note}</p>}
                  {r.isEditing && <ObservationForm initial={r.observation} testNames={v.testNames} saveLabel="Save correction" onSave={r.onSaveForm} onCancel={r.onCancelForm} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Clean results for a person to check row by row against the PDF, then approve as exactly this set. */
export function ReviewGroups({ v }: { v: VM }) {
  const { pdf } = usePdf(v.rvFileUrl, v.rvGroups.length > 0);
  const [enlarged, setEnlarged] = useState<number | null>(null);
  const draw = useMemo<DrawPage>(() => {
    const sheets = new Map<number, Promise<HTMLCanvasElement>>();
    return (page) => {
      if (!sheets.has(page)) {
        const sheet = document.createElement('canvas');
        sheets.set(page, pdf ? pdf.render(page, sheet, STRIP_PIXEL_WIDTH).done.then(() => sheet) : Promise.reject(new Error('No file')));
      }
      return sheets.get(page)!;
    };
  }, [pdf]);
  return (
    <>
      {v.rvGroupError && (
        <p role="alert" style={{ margin: '12px 4px 0', fontSize: 13, lineHeight: 1.5, color: C.rust }}>
          {v.rvGroupError}
        </p>
      )}
      {v.rvApprovedGroups.map((g) => (
        <p key={g.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline', margin: '12px 4px 0', fontSize: 13, color: C.green }}>
          <span>{g.text}</span>
          <button onClick={g.onUndo} style={s.link12}>
            Undo group approval
          </button>
        </p>
      ))}
      {v.rvGroups.map((g) => (
        <GroupTable key={g.key} g={g} v={v} pdf={pdf} draw={draw} onOpenPage={setEnlarged} />
      ))}
      {pdf && enlarged !== null && <PageModal pdf={pdf} title={v.rvFile} page={enlarged} onClose={() => setEnlarged(null)} onFail={() => setEnlarged(null)} />}
      {v.rvHasIndividual && v.rvGroups.length + v.rvApprovedGroups.length > 0 && (
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: '24px 4px 2px' }}>Review individually</h3>
      )}
    </>
  );
}
