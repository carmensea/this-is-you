import { useEffect, useRef, type KeyboardEvent } from 'react';
import { KEYS_HINT, ResultList, Tick, fieldInput, outlined } from '../components/ResultRows';
import { Segmented } from '../components/controls';
import { ObservationForm } from '../components/ObservationForm';
import { OriginalFile } from '../components/OriginalFile';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { s } from '../components/styles';
import { shellVM } from '../viewmodels/shell';
import { reviewVM } from '../viewmodels/review';

type VM = ReturnType<typeof shellVM> & NonNullable<ReturnType<typeof reviewVM>>;

function OriginalDocument({ v }: { v: VM }) {
  return (
    <section aria-label="Original document" className="review-original" style={{ flex: '1 1 460px', minWidth: 0, alignSelf: 'flex-start', paddingTop: 10 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}
      >
        <span style={s.eyebrow}>Original document, read only</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted, overflowWrap: 'anywhere' }}>{v.rvFile}</span>
      </div>
      {v.rvContentUrl ? (
        <OriginalFile title={v.rvFile} url={v.rvContentUrl} height="calc(100vh - 150px)" target={v.rvPdfTarget} />
      ) : (
        <>
          <div style={{ marginTop: 8, background: '#FFFEFB', border: `1px solid ${C.rule}`, padding: '26px 28px' }}>
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
              <span style={{ fontSize: 14, fontWeight: 600 }}>{v.rvHead}</span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted }}>SYNTHETIC SAMPLE RECORD</span>
            </div>
            <div style={{ fontSize: 12, color: C.ink2, marginTop: 8 }}>{v.patientLine}</div>
            <div style={s.sub12}>{v.rvSub}</div>
            {v.rvScanned && (
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.rust, marginTop: 6 }}>
                SCANNED PAGE · TEXT RECOGNIZED
              </div>
            )}{' '}
            {v.rvHasLines && (
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
                {v.rvPrev.map((l, i0) => (
                  <button
                    key={i0}
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
                    <span style={{ textAlign: 'right' }}>{l.value}</span>
                    <span style={{ color: C.rust, fontWeight: 500 }}>{l.flag}</span>
                    <span>{l.ref}</span>
                    <span>{l.unit}</span>
                  </button>
                ))}
              </div>
            )}{' '}
            {v.rvNoLines && (
              <div
                style={{
                  marginTop: 18,
                  background: C.hover,
                  border: `1px solid ${C.rule2}`,
                  minHeight: 260,
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
                    maxWidth: 340,
                  }}
                >
                  Original document text is preserved in the source file. Confirm the details on the right against it.
                </span>
              </div>
            )}
          </div>
          {!v.rvIsReal && (
            <p style={{ fontSize: 12, color: C.muted, margin: '10px 0 0', lineHeight: 1.5 }}>
              Select a line to find its extracted value. The original is never changed by your review.
            </p>
          )}
        </>
      )}
    </section>
  );
}

type Field = VM['rvFields'][number];

function Progress({ v }: { v: VM }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 2, background: C.paper, padding: '10px 0', borderBottom: `1px solid ${C.ink}` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'baseline' }}>
        <span role="status" style={{ display: 'contents' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{v.rvProgressHead}</span>
          <span style={s.body125}>{v.rvProgressDetail}</span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
          {v.rvHasLeft && (
            <button onClick={() => v.rvGoNext()} style={s.link125}>
              Go to next undecided
            </button>
          )}
        </span>
      </div>
      <div role="progressbar" aria-label="Measurements decided" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(v.rvPctA) + Number(v.rvPctR)} style={{ display: 'flex', height: 4, marginTop: 8, background: C.rule2 }}>
        <span style={{ display: 'block', height: 4, width: `${v.rvPctA}%`, background: C.green }} />
        <span style={{ display: 'block', height: 4, width: `${v.rvPctR}%`, background: C.ink3 }} />
      </div>
      {(v.rvError || v.rvGroupError) && (
        <p role="alert" style={{ margin: '8px 0 0', fontSize: 12.5, color: C.rust }}>
          {v.rvError || v.rvGroupError}
        </p>
      )}
    </div>
  );
}

function DetailEditor({ l }: { l: Field }) {
  return (
    <div data-editing style={{ marginTop: 8, padding: 10, background: C.hover, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      {l.editKind === 'type' ? (
        <div style={{ flex: '1 1 100%' }}>
          <div style={s.muted115}>Corrected value</div>
          <Segmented items={l.typeOptions} role="group" aria-label="Document type" />
        </div>
      ) : (
        <label style={{ flex: '1 1 180px', ...s.muted115 }}>
          Corrected value
          <input type={l.editKind === 'date' ? 'date' : 'text'} value={l.dValue} onChange={l.onDValue} style={fieldInput} />
        </label>
      )}
      <button onClick={l.onSave} style={{ background: C.ink, color: C.paper, padding: '7px 12px', fontSize: 12.5 }}>
        Save correction
      </button>
      <button onClick={l.onCancel} style={s.link125}>
        Cancel
      </button>
    </div>
  );
}

function DetailCell({ l, v }: { l: Field; v: VM }) {
  const box = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  // The editor takes the focus when it opens, and hands it back to this detail's own action when it closes.
  useEffect(() => {
    if (l.isEditing) box.current?.querySelector<HTMLElement>('[data-editing] input, [data-editing] button')?.focus();
    else if (wasEditing.current && !box.current?.contains(document.activeElement)) box.current?.querySelector<HTMLButtonElement>('[data-field-action]')?.focus();
    wasEditing.current = l.isEditing;
  }, [l.isEditing]);
  const escape = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && l.isEditing) {
      e.stopPropagation();
      l.onCancel();
    }
  };
  return (
    <div ref={box} onKeyDown={escape} style={{ padding: '8px 12px 10px', borderBottom: `1px solid ${C.rule2}`, borderRight: `1px solid ${C.rule2}`, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={s.muted115}>{l.label}</span>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11, fontWeight: 500, color: l.isConfirmed ? C.green : C.ink2 }}>
          {l.isConfirmed && <Tick />}
          {l.badge}
        </span>
      </div>
      <div style={{ fontSize: 14, marginTop: 2, overflowWrap: 'anywhere' }}>{l.value}</div>
      {l.note && <div style={{ ...s.body125, fontSize: 11.5, marginTop: 2 }}>{l.note}</div>}
      {l.isEditing && <DetailEditor l={l} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', marginTop: 6 }}>
        {l.showActions && !l.isEditing && (
          <>
            {l.canConfirm && (
              <button onClick={l.onConfirm} style={outlined(C.green)}>
                Confirm
              </button>
            )}
            <button data-field-action onClick={l.onEdit} style={s.link125}>
              Correct
            </button>
            {l.canNotStated && (
              <button onClick={l.onNotStated} style={{ ...s.link125, color: C.muted }}>
                Not stated
              </button>
            )}
            {!l.isPending && (
              <button onClick={l.onCancel} style={{ ...s.link125, color: C.muted }}>
                Keep as it is
              </button>
            )}
          </>
        )}
        {l.canChange && (
          <button data-field-action onClick={v.rvIsReal ? l.onChange : l.onUndoDemo} style={{ ...s.link125, color: C.muted }}>
            {v.rvIsReal ? 'Change' : 'Undo'}
          </button>
        )}
        <details style={{ fontSize: 11.5, color: C.ink2 }}>
          <summary style={{ color: C.muted, cursor: 'pointer' }}>Source</summary>
          <div style={{ paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>{l.statusText}</span>
            {l.evidence && (
              <span style={{ overflowWrap: 'anywhere' }}>
                {l.evidence}
                {l.evidencePage > 0 && (
                  <>
                    {' '}
                    <button onClick={l.onShowPage} style={s.link12}>
                      Show page {l.evidencePage}
                    </button>
                  </>
                )}
              </span>
            )}
            {l.isLow && !l.note && <span>{l.reason}</span>}
            {l.isEdited && <span>{l.editedText}</span>}
          </div>
        </details>
      </div>
    </div>
  );
}

function DocumentDetails({ v }: { v: VM }) {
  return (
    <section aria-label="Document details" style={{ marginTop: 14, border: `1px solid ${C.rule}` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline', padding: '8px 12px' }}>
        <h2 style={{ ...s.heading3, fontSize: 19 }}>Document details</h2>
        <span style={{ fontSize: 12, color: v.rvDetailsDone ? C.green : C.ink2 }}>{v.rvDetailsSummary}</span>
        <button onClick={v.rvToggleDetails} aria-expanded={v.rvDetailsOpen} style={{ ...s.link125, marginLeft: 'auto' }}>
          {v.rvDetailsOpen ? 'Hide' : 'Show'}
        </button>
      </div>
      {!v.rvDetailsOpen && <p style={{ ...s.body125, margin: 0, padding: '0 12px 8px' }}>{v.rvDetailsLine}</p>}
      {v.rvDetailsOpen && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', borderTop: `1px solid ${C.rule2}` }}>
          {v.rvFields.map((l) => (
            <DetailCell key={l.label} l={l} v={v} />
          ))}
        </div>
      )}
    </section>
  );
}

function Measurements({ v }: { v: VM }) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '4px 16px', marginTop: 22, paddingBottom: 6, borderBottom: `1px solid ${C.ink}` }}>
        <h2 style={s.heading3}>Measurements</h2>
        <span id="review-keys" style={s.monoNote}>{KEYS_HINT}</span>
      </div>
      {v.rvApprovedGroups.map((g) => (
        <p key={g.id} style={{ ...s.body125, margin: '8px 0 0' }}>
          {g.text}{' '}
          <button onClick={g.onUndo} style={s.link12}>
            Undo group approval
          </button>
        </p>
      ))}
      {v.rvNoneRecognized && (
        <p style={{ margin: '12px 4px', fontSize: 13, color: C.ink2 }}>
          No measurements were recognized in this document. If it contains results, add them by hand.
        </p>
      )}
      <ResultList lines={v.rvLines} onKey={v.rvKey} testNames={v.testNames} label="Measurements, in the order printed" keysId="review-keys" />
      {v.rvIsReal && (
        <div style={{ borderTop: `1px solid ${C.rule2}`, padding: '10px 8px 0' }}>
          <button onClick={v.rvToggleAdd} style={s.link125}>
            Add a measurement the reader missed
          </button>
        </div>
      )}
      {v.rvAdding && <ObservationForm testNames={v.testNames} saveLabel="Add measurement" onSave={v.rvAddMeasurement} onCancel={v.rvToggleAdd} />}
    </>
  );
}

function ExtractedValues({ v }: { v: VM }) {
  return (
    <section aria-label="Extracted values" style={{ flex: '1 1 560px', minWidth: 0 }}>
      <Progress v={v} />
      <DocumentDetails v={v} />
      {(v.rvHasLines || v.rvIsReal) && <Measurements v={v} />}
      <div style={{ marginTop: 22, borderTop: `1px solid ${C.ink}`, paddingTop: 14, display: 'flex', flexWrap: 'wrap', gap: '12px 24px', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, color: C.ink2, maxWidth: 420 }}>{v.rvPendingText}</span>
        {v.rvIdentity && (
          <p role="note" style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.5, color: C.rust, maxWidth: 720 }}>
            {v.rvIdentity}
          </p>
        )}
        <button onClick={v.rvContinue} disabled={v.rvContinueDisabled} style={{ background: v.rvContinueBg, color: v.rvContinueFg, padding: '9px 16px', fontSize: 13, fontWeight: 500 }}>
          Continue to confirmation
        </button>
      </div>
    </section>
  );
}

function Confirm({ v }: { v: VM }) {
  return (
    <section
      aria-label="Confirm"
      style={{ marginTop: 24, borderTop: `1px solid ${C.ink}`, paddingTop: 18, maxWidth: 820 }}
    >
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 28, margin: 0 }}>
        {v.rvIsReal ? 'Finish this review' : 'Accept into the archive'}
      </h2>
      <p style={{ fontSize: 15, lineHeight: 1.55, margin: '12px 0 0' }}>{v.rvSumAdd}</p>
      {v.rvHasEdits && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: C.ink3,
              borderBottom: `1px solid ${C.rule}`,
              paddingBottom: 6,
            }}
          >
            Your corrections
          </div>
          {v.rvEdits.map((x, i3) => (
            <p
              key={i3}
              style={{ fontSize: 13, color: C.ink2, margin: 0, padding: '8px 0', borderBottom: `1px solid ${C.rule2}` }}
            >
              {x.text}
            </p>
          ))}
        </div>
      )}{' '}
      {v.rvHasExcl && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: C.ink3,
              borderBottom: `1px solid ${C.rule}`,
              paddingBottom: 6,
            }}
          >
            {v.rvIsReal ? 'Rejected, left out of your verified records' : 'Excluded, not added'}
          </div>
          {v.rvExcl.map((x, i4) => (
            <p
              key={i4}
              style={{ fontSize: 13, color: C.ink2, margin: 0, padding: '8px 0', borderBottom: `1px solid ${C.rule2}` }}
            >
              {x.text}
            </p>
          ))}
        </div>
      )}
      <p style={{ fontSize: 13, color: C.ink2, margin: '18px 0 0', lineHeight: 1.55 }}>
        The original file stays in the archive unchanged and remains linked to every accepted value. Extracted values
        you corrected are kept in the review record, so the change can always be traced.
      </p>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 20, flexWrap: 'wrap' }}>
        <button
          onClick={v.rvAccept}
          style={{ background: C.ink, color: C.paper, padding: '10px 16px', fontSize: 13.5, fontWeight: 500 }}
        >
          {v.rvAcceptLabel}
        </button>
        <button onClick={v.rvBackToReview} style={s.link13}>
          Back to review
        </button>
      </div>
    </section>
  );
}

function Accepted({ v }: { v: VM }) {
  return (
    <section
      aria-label="Accepted"
      style={{ marginTop: 24, borderTop: `1px solid ${C.green}`, paddingTop: 18, maxWidth: 820 }}
    >
      <div
        style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: C.green }}
      >
        Reviewed
      </div>
      <p style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1.35, margin: '8px 0 0' }}>{v.rvDoneText}</p>
      <div style={{ display: 'flex', gap: 20, marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={v.rvOpenDoc} style={s.link13}>
          View document
        </button>
        <button onClick={v.rvNextQueue} style={s.link13}>
          Back to review queue
        </button>
      </div>
    </section>
  );
}

export function ReviewScreen() {
  const store = useStore();
  const vm = reviewVM(store);
  if (!vm) return null;
  const v: VM = { ...shellVM(store), ...vm };
  return (
    <main style={{ maxWidth: 1480, margin: '0 auto', padding: '24px var(--gutter) 64px' }}>
      <button onClick={v.rvBack} style={s.link13}>
        ‹ Review queue
      </button>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: C.ink3,
          marginTop: 18,
        }}
      >
        Reviewing extracted values
      </div>
      <h1
        style={{
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: 40,
          lineHeight: 1.1,
          letterSpacing: '-0.015em',
          margin: '8px 0 6px',
        }}
      >
        {v.rvTitle}
      </h1>
      <div style={s.body13}>{v.rvMeta}</div>
      {v.rvIsReview && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 36px', marginTop: 12, alignItems: 'flex-start' }}>
            <OriginalDocument v={v} />
            <ExtractedValues v={v} />
          </div>
        </>
      )}{' '}
      {v.rvIsConfirm && <Confirm v={v} />} {v.rvIsDone && <Accepted v={v} />}
    </main>
  );
}
