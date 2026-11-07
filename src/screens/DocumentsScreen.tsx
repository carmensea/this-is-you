import { Fragment, useEffect, useRef, useState } from 'react';
import { Footer, Checkbox } from '../components/controls';
import { OriginalFile } from '../components/OriginalFile';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { s } from '../components/styles';
import { shellVM } from '../viewmodels/shell';
import { documentsVM } from '../viewmodels/documents';

type VM = ReturnType<typeof shellVM> & ReturnType<typeof documentsVM>;

function DocumentList({ v }: { v: VM }) {
  return (
    <section aria-label="Document list" style={{ flex: '1 1 520px', minWidth: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 500 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '100px minmax(0,1fr) 120px 112px',
              gap: '0 14px',
              padding: '6px 8px',
              fontSize: 11.5,
              fontWeight: 500,
              color: C.ink3,
              borderBottom: `1px solid ${C.ink}`,
            }}
          >
            <span>Date</span>
            <span>Document</span>
            <span>Status</span>
            <span style={s.alignRight}>Extracted</span>
          </div>
          {v.dRows.map((r, i2) => (
            <Fragment key={i2}>
              {r.isYear && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    padding: '16px 8px 4px',
                    borderBottom: `1px solid ${C.rule}`,
                  }}
                >
                  <span style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1 }}>{r.year}</span>
                  <span style={s.meta115}>{r.count}</span>
                </div>
              )}{' '}
              {r.isDoc && (
                <button
                  onClick={r.onClick}
                  aria-current={r.current}
                  className="row-hover"
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '100px minmax(0,1fr) 120px 112px',
                    gap: '0 14px',
                    padding: '10px 8px',
                    borderBottom: `1px solid ${C.rule2}`,
                    background: r.bg,
                    alignItems: 'start',
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.ink2, paddingTop: 2 }}>{r.date}</span>
                  <span style={s.minW0}>
                    <span style={s.kicker}>{r.type}</span>
                    <span style={{ display: 'block', fontSize: 14, marginTop: 2, color: r.titleColor }}>{r.title}</span>
                    <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>{r.sub}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.rust, marginTop: 2 }}>{r.note}</span>
                    <span style={s.subBlock}>{r.snapTag}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 3 }}>
                    <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: r.s1 }} />
                      <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: r.s2 }} />
                      <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: r.s3 }} />
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: r.statusColor }}>{r.statusLabel}</span>
                  </span>
                  <span style={{ fontSize: 12, color: C.ink2, textAlign: 'right', paddingTop: 3 }}>{r.extracted}</span>
                </button>
              )}
            </Fragment>
          ))}{' '}
          {v.dNoDocuments && (
            <p style={{ margin: '24px 8px', fontSize: 14, color: C.ink2 }}>
              No documents yet.{' '}
              <button onClick={v.goImport} style={s.link13}>
                Go to Import
              </button>
            </p>
          )}
          {v.dEmpty && (
            <p style={{ fontSize: 14, color: C.ink2, padding: '16px 8px' }}>
              No documents match.{' '}
              <button onClick={v.dReset} style={{ fontSize: 14, borderBottom: `1px solid ${C.ink}` }}>
                Reset filters
              </button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function DocumentDetail({ v }: { v: VM }) {
  return (
    <section
      aria-label="Document detail"
      style={{ flex: '1 1 560px', minWidth: 0, borderTop: `1px solid ${C.ink}`, paddingTop: 14 }}
    >
      {!v.detail && <p style={{ fontSize: 14, color: C.ink2 }}>Select a document to see its details.</p>}{' '}
      {v.detail && (
        <>
          <div style={s.eyebrow}>{v.detail.ddCat}</div>
          <h2
            style={{
              fontFamily: SERIF,
              fontWeight: 400,
              fontSize: 32,
              lineHeight: 1.12,
              margin: '8px 0 6px',
              letterSpacing: '-0.01em',
            }}
          >
            {v.detail.ddTitle}
          </h2>
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink2, wordBreak: 'break-all' }}>{v.detail.ddFile}</div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 12px',
              alignItems: 'center',
              marginTop: 12,
              padding: '10px 0',
              borderTop: `1px solid ${C.rule2}`,
              borderBottom: `1px solid ${C.rule2}`,
            }}
          >
            <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: v.detail.s1 }} />
              <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: v.detail.s2 }} />
              <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: v.detail.s3 }} />
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: v.detail.ddStatusColor }}>
              {v.detail.ddStatusLabel}
            </span>
            <span style={s.body125}>{v.detail.ddStatusDesc}</span>
          </div>
          <div style={{ fontSize: 12.5, color: v.detail.ddKnownColor, marginTop: 8 }}>{v.detail.ddKnown}</div>
          {v.detail.ddHasNote && (
            <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5, color: C.ink2, textWrap: 'pretty' }}>
              {v.detail.ddNote}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px', marginTop: 14, fontSize: 13 }}>
            {v.detail.ddCanReview && (
              <button
                onClick={v.detail.ddReview}
                style={{ fontSize: 13, fontWeight: 500, background: C.ink, color: C.paper, padding: '7px 12px' }}
              >
                {v.detail.ddReviewLabel}
              </button>
            )}
            {v.detail.ddHasEvent && (
              <button
                onClick={v.detail.ddShowHistory}
                style={{ fontSize: 13, borderBottom: `1px solid ${C.ink}`, alignSelf: 'center' }}
              >
                Show in Medical history
              </button>
            )}
            {v.detail.ddCanReread && (
              <button onClick={v.detail.ddReread} style={s.link125}>
                Try reading again
              </button>
            )}
            {v.detail.ddHasDup && (
              <button
                onClick={v.detail.ddOpenDup}
                style={{ fontSize: 13, borderBottom: `1px solid ${C.ink}`, alignSelf: 'center' }}
              >
                {v.detail.ddDupLabel}
              </button>
            )}
            <button
              onClick={v.detail.ddSnap}
              style={{ fontSize: 13, borderBottom: `1px solid ${C.ink}`, alignSelf: 'center' }}
            >
              Set snapshot to this date
            </button>
            {v.detail.ddCanDelete && <DeleteDocument name={v.detail.ddDeleteName} what={v.detail.ddDeleteWhat} onDelete={v.detail.ddDelete} />}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))',
              gap: '12px 24px',
              marginTop: 20,
              borderTop: `1px solid ${C.ink}`,
              paddingTop: 14,
            }}
          >
            {v.detail.ddFields.map((f, i3) => (
              <div key={i3} style={s.minW0}>
                <div style={s.meta115}>{f.k}</div>
                <div style={{ fontSize: 13, marginTop: 2, overflowWrap: 'anywhere' }}>{f.v}</div>
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginTop: 26,
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span style={s.eyebrow}>Original file preview</span>
            {v.detail.ddMultiPage && (
              <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${C.ink}` }}>
                <button onClick={v.detail.ddPrev} aria-label="Previous page" style={{ padding: '3px 9px' }}>
                  ‹
                </button>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11.5,
                    padding: '3px 8px',
                    borderLeft: `1px solid ${C.ink}`,
                    borderRight: `1px solid ${C.ink}`,
                  }}
                >
                  {v.detail.ddPageText}
                </span>
                <button onClick={v.detail.ddNext} aria-label="Next page" style={{ padding: '3px 9px' }}>
                  ›
                </button>
              </div>
            )}
          </div>
          {v.detail.ddContentUrl ? (
            <OriginalFile title={v.detail.ddFile} url={v.detail.ddContentUrl} />
          ) : (
            <div
              style={{
                marginTop: 8,
                background: '#FFFEFB',
                border: `1px solid ${C.rule}`,
                padding: '26px 28px',
                minHeight: 340,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  borderBottom: `1.5px solid ${C.ink}`,
                  paddingBottom: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>{v.detail.ddHead}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted }}>SYNTHETIC SAMPLE RECORD</span>
              </div>
              <div style={{ fontSize: 12, color: C.ink2, marginTop: 8 }}>{v.patientLine}</div>
              <div style={s.sub12}>{v.detail.ddSub}</div>
              {v.detail.ddIsLab && (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0,1.6fr) 64px 26px minmax(0,1fr) 92px',
                      gap: 6,
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: C.muted,
                      borderBottom: `1px solid ${C.ink}`,
                      padding: '0 4px 4px',
                    }}
                  >
                    <span>Test</span>
                    <span style={s.alignRight}>Result</span>
                    <span>Flag</span>
                    <span>Reference</span>
                    <span>Units</span>
                  </div>
                  {v.detail.ddLines.map((l, i4) => (
                    <button
                      key={i4}
                      onClick={l.onClick}
                      style={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0,1.6fr) 64px 26px minmax(0,1fr) 92px',
                        gap: 6,
                        fontSize: 11.5,
                        padding: '5px 4px',
                        borderBottom: '1px solid #EEEAE1',
                        background: l.bg,
                        outline: l.outline,
                        fontFamily: MONO,
                      }}
                    >
                      <span style={{ fontFamily: SANS }}>{l.name}</span>
                      <span style={s.alignRight}>{l.value}</span>
                      <span style={{ color: C.rust, fontWeight: 500 }}>{l.flag}</span>
                      <span>{l.ref}</span>
                      <span>{l.unit}</span>
                    </button>
                  ))}
                </div>
              )}{' '}
              {v.detail.ddNoPreview && (
                <div
                  style={{
                    marginTop: 18,
                    background: C.hover,
                    border: `1px solid ${C.rule2}`,
                    minHeight: 220,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 24,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11.5,
                      color: C.muted,
                      textAlign: 'center',
                      lineHeight: 1.6,
                      maxWidth: 360,
                    }}
                  >
                    {v.detail.ddPlaceholder}
                  </span>
                </div>
              )}
            </div>
          )}
          {v.detail.ddHasLines && (
            <div style={{ marginTop: 26 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  borderBottom: `1px solid ${C.ink}`,
                  paddingBottom: 6,
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <h3 style={s.heading3}>Extracted measurements</h3>
                <span style={s.muted12}>{v.detail.ddLinesCount}</span>
              </div>
              {v.detail.ddCanReview && (
                <button
                  onClick={v.detail.ddReview}
                  style={{ fontSize: 13, fontWeight: 500, background: C.ink, color: C.paper, padding: '7px 12px', marginTop: 12 }}
                >
                  {v.detail.ddMeasuresLabel}
                </button>
              )}
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 560 }}>
                  {v.detail.ddExtracted.map((x, i5) => (
                    <div
                      key={i5}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0,1.5fr) 110px 80px 22px 104px auto',
                        gap: 10,
                        alignItems: 'baseline',
                        padding: '8px 4px',
                        borderBottom: `1px solid ${C.rule2}`,
                        background: x.bg,
                        fontSize: 12.5,
                      }}
                    >
                      <span>{x.name}</span>
                      <span style={{ fontFamily: MONO, fontSize: 12 }}>{x.value}</span>
                      <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.ink2 }}>{x.ref}</span>
                      <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, color: C.rust }}>{x.flag}</span>
                      <span style={{ fontSize: 11.5, color: x.statusColor }}>{x.status}</span>
                      <span style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button onClick={x.onLocate} style={s.link12}>
                          Locate in original
                        </button>
                        <button
                          onClick={x.onChart}
                          style={{ fontSize: 12, color: C.green, borderBottom: `1px solid ${C.green}` }}
                        >
                          Chart
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}{' '}
          {v.detail.ddHasRecord && (
            <div style={{ marginTop: 26, borderTop: `1px solid ${C.ink}`, paddingTop: 10 }}>
              <h3 style={s.heading3}>Structured record</h3>
              <p style={{ fontSize: 13, color: C.ink2, margin: '8px 0 0' }}>{v.detail.ddRecordText}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Asks first, by name, and starts on Cancel. Deleting is permanent, so one stray click must not do it. */
function DeleteDocument({ name, what, onDelete }: { name: string; what: string; onDelete: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal?.();
  }, [open]);
  const close = () => {
    setOpen(false);
    setProblem(null);
  };
  const confirm = async () => {
    setBusy(true);
    const failed = await onDelete();
    setBusy(false);
    if (failed) setProblem(failed);
    else close();
  };
  return (
    <>
      <button onClick={() => setOpen(true)} style={{ fontSize: 13, color: C.rust, borderBottom: `1px solid ${C.rust}`, alignSelf: 'center' }}>
        Delete document
      </button>
      {open && (
        <dialog ref={dialog} aria-label="Delete this document" onClose={close} style={{ maxWidth: 480, padding: 20, border: `1px solid ${C.rule}`, background: C.paper, color: C.ink }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, overflowWrap: 'anywhere' }}>Delete {name}?</h2>
          <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5 }}>{what}</p>
          <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5, color: C.ink2 }}>
            Backups you already made still hold it. Choosing the same folder again would import it again unless you move the file.
          </p>
          {problem && (
            <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: C.rust }}>
              {problem}
            </p>
          )}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 16 }}>
            <button autoFocus onClick={close} style={s.link125}>
              Cancel
            </button>
            <button onClick={confirm} disabled={busy} style={{ background: C.rust, color: C.paper, padding: '7px 12px', fontSize: 13, fontWeight: 500 }}>
              Delete permanently
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

export function DocumentsScreen() {
  const store = useStore();
  const v: VM = { ...shellVM(store), ...documentsVM(store) };
  return (
    <main style={{ maxWidth: 1480, margin: '0 auto', padding: '28px var(--gutter) 64px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: '12px 32px',
        }}
      >
        <h1
          style={{
            fontFamily: SERIF,
            fontWeight: 400,
            fontSize: 52,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          Documents
        </h1>
        <span style={s.body13}>{v.dCountText}</span>
      </div>
      <div
        role="group"
        aria-label="Filter by import status"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))',
          marginTop: 22,
          borderTop: `1px solid ${C.ink}`,
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        {v.dStatusList.map((x, i0) => (
          <button
            key={i0}
            role="checkbox"
            aria-checked={x.checked}
            onClick={x.onClick}
            className="row-hover"
            style={{
              padding: '14px 20px 14px 0',
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0,1fr) auto',
              gap: '4px 12px',
              alignItems: 'center',
              opacity: x.op,
              borderRight: `1px solid ${C.rule2}`,
            }}
          >
            <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: x.s1 }} />
              <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: x.s2 }} />
              <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: x.s3 }} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: x.color }}>{x.label}</span>
            <span style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1, fontVariantNumeric: 'lining-nums' }}>
              {x.count}
            </span>
            <span style={{ gridColumn: '2 / 4', fontSize: 12, color: C.ink2, lineHeight: 1.4 }}>{x.desc}</span>
            <span style={{ gridColumn: '2 / 4', fontSize: 11, color: C.ink3 }}>{x.state}</span>
          </button>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px 22px',
          alignItems: 'center',
          padding: '14px 0',
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        <label htmlFor="d-search" style={s.eyebrow}>
          Search
        </label>
        <input
          id="d-search"
          type="search"
          value={v.dQuery}
          onChange={v.onDQuery}
          placeholder="Title, provider, date, file name or test"
          style={{
            padding: '9px 10px',
            border: `1px solid ${C.ink}`,
            borderRadius: 0,
            background: C.field,
            fontFamily: SANS,
            fontSize: 14,
            color: C.ink,
            flex: '1 1 280px',
            maxWidth: 420,
          }}
        />
        <div role="group" aria-label="Document type" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
          {v.dTypeList.map((t, i1) => (
            <button
              key={i1}
              role="checkbox"
              aria-checked={t.checked}
              onClick={t.onClick}
              style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}
            >
              <span style={{ width: 12, height: 12, border: `1px solid ${C.ink}`, background: t.box }} />
              {t.label}
              <span style={s.monoNote}>{t.count}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <Checkbox
            checked={v.dSnapA}
            box={v.dSnapBg}
            onClick={v.toggleDSnap}
            boxStyle={{ width: 12, height: 12, border: `1px solid ${C.ink}` }}
            style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}
          >
            {v.dSnapLabel}
          </Checkbox>
          <button onClick={v.toggleDSort} style={s.link125}>
            Order: {v.dSortLabel}
          </button>
          <button onClick={v.dReset} style={s.link125}>
            Reset
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 44px', marginTop: 20, alignItems: 'flex-start' }}>
        <DocumentList v={v} />
        <DocumentDetail v={v} />
      </div>
      <Footer />
    </main>
  );
}
