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
    <section aria-label="Original document" style={{ flex: '1 1 460px', minWidth: 0 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}
      >
        <span style={s.eyebrow}>Original document, read only</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted, overflowWrap: 'anywhere' }}>{v.rvFile}</span>
      </div>
      {v.rvContentUrl ? (
        <OriginalFile title={v.rvFile} url={v.rvContentUrl} height={820} />
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
                    <span style={{ textAlign: 'right', textDecoration: l.deco }}>{l.value}</span>
                    <span style={{ color: C.rust, fontWeight: 500 }}>{l.flag}</span>
                    <span>{l.ref}</span>
                    <span style={{ textDecoration: l.deco }}>{l.unit}</span>
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
              Dotted underlines mark text read with low confidence. Select a line to find its extracted value. The
              original is never changed by your review.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ExtractedValues({ v }: { v: VM }) {
  return (
    <section aria-label="Extracted values" style={{ flex: '1 1 560px', minWidth: 0 }}>
      <h2
        style={{
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: 22,
          margin: 0,
          borderBottom: `1px solid ${C.ink}`,
          paddingBottom: 6,
        }}
      >
        Document details
      </h2>
      {v.rvFields.map((l, i1) => (
        <div key={i1} style={{ borderBottom: `1px solid ${C.rule2}`, padding: '10px 4px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '14px minmax(0,0.9fr) minmax(0,1.3fr) auto',
              gap: 10,
              alignItems: 'baseline',
            }}
          >
            <span style={{ width: 12, height: 12, background: l.sq, border: l.sqb, alignSelf: 'center' }} />
            <span style={{ fontSize: 12.5, color: C.muted }}>{l.label}</span>
            <span style={{ fontSize: 13.5 }}>{l.value}</span>
            <span style={{ display: 'flex', gap: 12, fontSize: 12 }}>
              {l.canConfirm && (
                <button
                  onClick={l.onConfirm}
                  style={{ fontSize: 12, color: C.green, borderBottom: `1px solid ${C.green}` }}
                >
                  Confirm
                </button>
              )}
              <button onClick={l.onEdit} style={s.link12}>
                Edit
              </button>
              {l.canNotStated && (
                <button onClick={l.onNotStated} style={s.link12}>
                  Not stated
                </button>
              )}
            </span>
          </div>
          <div style={{ padding: '4px 0 0 24px', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: l.statusColor }}>{l.statusText}</span>
            {l.isLow && <span style={{ color: C.rust }}>{l.reason}</span>}
            {l.isEdited && <span style={{ color: C.muted }}>{l.editedText}</span>}
            {l.evidence && (
              <span style={{ color: C.muted, overflowWrap: 'anywhere' }}>
                {l.evidence}
                {l.evidencePage > 0 && (
                  <>
                    {' '}
                    <button onClick={l.onShowPage} style={{ fontSize: 12, borderBottom: `1px solid ${C.faint}` }}>
                      Show page {l.evidencePage}
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
          {l.isEditing && (
            <div
              style={{
                margin: '10px 0 0 24px',
                padding: 12,
                background: C.hover,
                display: 'flex',
                gap: 10,
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              {l.editKind === 'type' ? (
                <div style={{ flex: '1 1 100%' }}>
                  <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 4 }}>Corrected value</div>
                  <Segmented items={l.typeOptions} role="group" aria-label="Document type" />
                </div>
              ) : (
                <label style={{ flex: '1 1 220px', fontSize: 11.5, color: C.muted }}>
                  Corrected value
                  <input
                    type={l.editKind === 'date' ? 'date' : 'text'}
                    value={l.dValue}
                    onChange={l.onDValue}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      border: `1px solid ${C.ink}`,
                      borderRadius: 0,
                      background: C.field,
                      fontFamily: MONO,
                      fontSize: 13,
                      color: C.ink,
                      marginTop: 4,
                    }}
                  />
                </label>
              )}
              <button
                onClick={l.onSave}
                style={{ background: C.ink, color: C.paper, padding: '7px 12px', fontSize: 12.5 }}
              >
                Save correction
              </button>
              <button onClick={l.onCancel} style={s.link125}>
                Cancel
              </button>
            </div>
          )}
        </div>
      ))}{' '}
      {(v.rvHasLines || v.rvIsReal) && (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '10px 18px',
              marginTop: 28,
              borderBottom: `1px solid ${C.ink}`,
              paddingBottom: 8,
            }}
          >
            <h2 style={s.heading3}>Measurements</h2>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              {v.rvIsReal && (
                <button onClick={v.rvToggleAdd} style={s.link125}>
                  Add a measurement
                </button>
              )}
              <Segmented items={v.rvFilters} />
              {v.rvHasHigh && (
                <button
                  onClick={v.rvConfirmHigh}
                  style={{ fontSize: 12.5, color: C.green, borderBottom: `1px solid ${C.green}` }}
                >
                  {v.rvHighLabel}
                </button>
              )}
            </div>
          </div>
          {v.rvAdding && (
            <ObservationForm
              testNames={v.testNames}
              saveLabel="Add measurement"
              onSave={v.rvAddMeasurement}
              onCancel={v.rvToggleAdd}
            />
          )}
          {v.rvNoneRecognized && (
            <p style={{ margin: '12px 4px', fontSize: 13, color: C.ink2 }}>
              No measurements were recognized in this document. If it contains results, add them by hand.
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 640 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '14px minmax(0,1.4fr) 70px 92px minmax(0,0.9fr) 24px 176px',
                  gap: 10,
                  padding: '6px 6px',
                  fontSize: 11,
                  fontWeight: 500,
                  color: C.ink3,
                }}
              >
                <span />
                <span>Measure</span>
                <span style={s.alignRight}>Value</span>
                <span>Unit</span>
                <span>Range</span>
                <span>Flag</span>
                <span />
              </div>
              {v.rvLines.map((l, i2) => (
                <div key={i2} style={{ borderTop: `1px solid ${C.rule2}`, background: l.rowBg }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '14px minmax(0,1.4fr) 70px 92px minmax(0,0.9fr) 24px 176px',
                      gap: 10,
                      alignItems: 'baseline',
                      padding: '10px 6px 4px',
                    }}
                  >
                    <span style={{ width: 12, height: 12, background: l.sq, border: l.sqb, alignSelf: 'center' }} />
                    <button onClick={l.onFocus} style={{ fontSize: 13, fontWeight: 500, textDecoration: l.deco }}>
                      {l.measure}
                    </button>
                    <span style={{ fontFamily: MONO, fontSize: 13, textAlign: 'right', textDecoration: l.deco }}>
                      {l.value}
                    </span>
                    <span style={{ fontSize: 12, color: C.ink2 }}>{l.unit}</span>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink2 }}>{l.ref}</span>
                    <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: C.rust }}>{l.flag}</span>
                    <span style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', fontSize: 12 }}>
                      {l.canConfirm && (
                        <button
                          onClick={l.onConfirm}
                          style={{ fontSize: 12, color: C.green, borderBottom: `1px solid ${C.green}` }}
                        >
                          {v.rvIsReal ? 'Accept' : 'Confirm'}
                        </button>
                      )}
                      <button onClick={l.onEdit} style={s.link12}>
                        Edit
                      </button>
                      {l.canExclude && (
                        <button
                          onClick={l.onExclude}
                          style={{ fontSize: 12, color: C.muted, borderBottom: '1px solid #9C978C' }}
                        >
                          {v.rvIsReal ? 'Reject' : 'Exclude'}
                        </button>
                      )}
                      {l.isExcluded && (
                        <button onClick={l.onRestore} style={s.link12}>
                          Restore
                        </button>
                      )}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: '0 6px 10px 30px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: l.statusColor }}>{l.statusText}</span>
                    {l.dates && <span style={{ color: C.ink2 }}>{l.dates}</span>}
                    {l.isLow && <span style={{ color: C.rust }}>{l.reason}</span>}
                    {l.isEdited && <span style={{ color: C.muted }}>{l.realEditedText || l.editedText}</span>}
                    {l.duplicateNote && <span style={{ color: C.amber }}>{l.duplicateNote}</span>}
                    {l.evidence && (
                      <span style={{ color: C.muted, overflowWrap: 'anywhere' }}>
                        {l.evidence}
                        {l.evidencePage > 0 && (
                          <>
                            {' '}
                            <button
                              onClick={l.onShowPage}
                              style={{ fontSize: 12, borderBottom: `1px solid ${C.faint}` }}
                            >
                              Show page {l.evidencePage}
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  {l.isEditing && l.observation && (
                    <ObservationForm
                      initial={l.observation}
                      testNames={v.testNames}
                      saveLabel="Save correction"
                      onSave={l.onSaveForm}
                      onCancel={l.onCancelForm}
                    />
                  )}
                  {l.isEditing && !l.observation && (
                    <div style={{ margin: '0 6px 12px 30px', padding: 14, background: C.hover }}>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
                          gap: '10px 14px',
                        }}
                      >
                        <label style={s.muted115}>
                          Value
                          <input
                            value={l.dValue}
                            onChange={l.onDValue}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              border: `1px solid ${C.ink}`,
                              borderRadius: 0,
                              background: C.field,
                              fontFamily: MONO,
                              fontSize: 13,
                              color: C.ink,
                              marginTop: 4,
                            }}
                          />
                        </label>
                        <label style={s.muted115}>
                          Unit
                          <input
                            value={l.dUnit}
                            onChange={l.onDUnit}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              border: `1px solid ${C.ink}`,
                              borderRadius: 0,
                              background: C.field,
                              fontFamily: MONO,
                              fontSize: 13,
                              color: C.ink,
                              marginTop: 4,
                            }}
                          />
                        </label>
                        <label style={s.muted115}>
                          Reference range
                          <input
                            value={l.dRef}
                            onChange={l.onDRef}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              border: `1px solid ${C.ink}`,
                              borderRadius: 0,
                              background: C.field,
                              fontFamily: MONO,
                              fontSize: 13,
                              color: C.ink,
                              marginTop: 4,
                            }}
                          />
                        </label>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                        <span style={s.muted115}>Flag on report</span>
                        <Segmented items={l.flagOpts} />
                      </div>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
                        <button
                          onClick={l.onSave}
                          style={{ background: C.ink, color: C.paper, padding: '7px 12px', fontSize: 12.5 }}
                        >
                          Save correction
                        </button>
                        <button onClick={l.onCancel} style={s.link125}>
                          Cancel
                        </button>
                        <span style={s.muted115}>
                          Check the value in the original on the left. The extracted value is kept alongside your
                          correction.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}{' '}
              {v.rvLinesEmpty && (
                <p style={{ fontSize: 13, color: C.muted, padding: '12px 6px', borderTop: `1px solid ${C.rule2}` }}>
                  No measurements in this view.
                </p>
              )}
            </div>
          </div>
        </>
      )}
      <div
        style={{
          marginTop: 24,
          borderTop: `1px solid ${C.ink}`,
          paddingTop: 14,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px 24px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 13, color: v.rvPendingColor, maxWidth: 420 }}>{v.rvPendingText}</span>
        {v.rvIdentity && (
          <p role="note" style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.5, color: C.rust, maxWidth: 720 }}>
            {v.rvIdentity}
          </p>
        )}
        {v.rvError && (
          <span role="alert" style={{ fontSize: 13, color: C.rust }}>
            {v.rvError}
          </span>
        )}
        <button
          onClick={v.rvContinue}
          disabled={v.rvContinueDisabled}
          style={{
            background: v.rvContinueBg,
            color: v.rvContinueFg,
            padding: '9px 16px',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
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
            Excluded, not added
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
          <div style={{ marginTop: 18, borderTop: `1px solid ${C.ink}`, paddingTop: 10 }}>
            <div style={{ display: 'flex', height: 6, background: C.rule2 }}>
              <span style={{ display: 'block', height: 6, width: `${v.rvPctC}%`, background: C.green }} />
              <span style={{ display: 'block', height: 6, width: `${v.rvPctE}%`, background: '#9C978C' }} />
            </div>
            <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 8 }}>{v.rvProgress}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 44px', marginTop: 22, alignItems: 'flex-start' }}>
            <OriginalDocument v={v} />
            <ExtractedValues v={v} />
          </div>
        </>
      )}{' '}
      {v.rvIsConfirm && <Confirm v={v} />} {v.rvIsDone && <Accepted v={v} />}
    </main>
  );
}
