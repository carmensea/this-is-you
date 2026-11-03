import { Fragment, useEffect } from 'react';
import { Footer } from '../components/controls';
import { ObservationForm } from '../components/ObservationForm';
import { useStore } from '../state/useStore';
import { C, MONO, SERIF } from '../theme';
import { s } from '../components/styles';
import { shellVM } from '../viewmodels/shell';
import { importVM } from '../viewmodels/importQueue';
import { AccessSection, BackupsSection, IdentitySection } from './ArchiveSafety';
import { ImportReport } from './ImportReport';

type VM = ReturnType<typeof shellVM> & ReturnType<typeof importVM>;

function CurrentBatch({ v }: { v: VM }) {
  return (
    <section aria-label="Current batch" style={{ marginTop: 36 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '8px 24px',
          borderBottom: `1px solid ${C.ink}`,
          paddingBottom: 8,
        }}
      >
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0 }}>Current batch</h2>
        <button onClick={v.clearBatch} style={s.link125}>
          Clear list
        </button>
      </div>
      <p style={{ fontSize: 13, color: C.ink2, margin: '10px 0 6px' }}>{v.impSummary}</p>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 860 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1.3fr) 170px 86px minmax(0,1.6fr) 170px',
              gap: '0 16px',
              padding: '6px 4px',
              fontSize: 11.5,
              fontWeight: 500,
              color: C.ink3,
              borderBottom: `1px solid ${C.rule}`,
            }}
          >
            <span>File</span>
            <span>Detected type</span>
            <span>Pipeline</span>
            <span>Progress and result</span>
            <span>Status</span>
          </div>
          {v.impRows.map((f, i0) => (
            <div
              key={i0}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1.3fr) 170px 86px minmax(0,1.6fr) 170px',
                gap: '0 16px',
                padding: '11px 4px',
                borderBottom: `1px solid ${C.rule2}`,
                alignItems: 'start',
              }}
            >
              <span style={s.minW0}>
                <span style={{ display: 'block', fontFamily: MONO, fontSize: 12, overflowWrap: 'anywhere' }}>
                  {f.name}
                </span>
                <span style={s.subBlock}>{f.size}</span>
              </span>
              <span style={s.body125}>{f.kind}</span>
              <span title="Stored, read, extracted, reviewed" style={{ display: 'flex', gap: 3, paddingTop: 3 }}>
                <span style={{ width: 10, height: 10, border: `1px solid ${C.ink}`, background: f.p1 }} />
                <span style={{ width: 10, height: 10, border: `1px solid ${C.ink}`, background: f.p2 }} />
                <span style={{ width: 10, height: 10, border: `1px solid ${C.ink}`, background: f.p3 }} />
                <span style={{ width: 10, height: 10, border: `1px solid ${C.ink}`, background: f.p4 }} />
              </span>
              <span style={s.minW0}>
                {f.isRunning && (
                  <>
                    <span style={{ display: 'block', height: 4, background: C.rule2, marginTop: 6 }}>
                      <span style={{ display: 'block', height: 4, width: `${f.pct}%`, background: C.ink }} />
                    </span>
                    <span style={{ display: 'block', fontFamily: MONO, fontSize: 11, color: C.muted, marginTop: 5 }}>
                      {f.stage} · {f.pct}%
                    </span>
                  </>
                )}{' '}
                {f.isDone && <span style={{ fontSize: 12.5, color: C.ink2, lineHeight: 1.45 }}>{f.result}</span>}{' '}
                {f.isDone && f.documentId && (
                  <button onClick={f.onView} style={s.link12}>
                    View in Documents
                  </button>
                )}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: f.statusColor }}>{f.statusLabel}</span>
            </div>
          ))}
        </div>
      </div>
      <p style={{ fontFamily: MONO, fontSize: 11, color: C.ink3, margin: '8px 0 0' }}>
        Pipeline squares: stored, read, extracted, reviewed. Review happens in the queue below.
      </p>
    </section>
  );
}

function ManualResults({ v }: { v: VM }) {
  return (
    <section aria-label="User-entered results" style={{ marginTop: 40 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '8px 24px',
          borderBottom: `1px solid ${C.ink}`,
          paddingBottom: 8,
        }}
      >
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0 }}>User-entered results</h2>
        <button onClick={v.toggleManual} style={s.link13}>
          Enter a result
        </button>
      </div>
      {v.manualOpen && (
        <div style={{ marginTop: 12 }}>
          <ObservationForm
            testNames={v.testNames}
            saveLabel="Save result"
            onSave={v.saveManual}
            onCancel={v.toggleManual}
          />
        </div>
      )}
      {v.manualRows.map((r) => (
        <div key={r.id} style={{ borderBottom: `1px solid ${C.rule2}` }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 18px',
              padding: '12px 4px',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ flex: '1 1 240px', minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{r.name}</span>
              <span style={s.muted115}>{r.history}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 13 }}>{r.value}</span>
            <span style={{ fontSize: 12.5, color: C.ink2 }}>{r.date}</span>
            <span style={{ fontSize: 12.5, color: r.statusColor }}>{r.status}</span>
            <span style={{ display: 'flex', gap: 12 }}>
              <button onClick={r.onEdit} style={s.link12}>
                Edit
              </button>
              {r.isRejected ? (
                <button onClick={r.onRestore} style={s.link12}>
                  Restore
                </button>
              ) : (
                <button onClick={r.onRemove} style={s.link12}>
                  Remove
                </button>
              )}
            </span>
          </div>
          {r.isEditing && (
            <ObservationForm
              initial={r.observation}
              testNames={v.testNames}
              saveLabel="Save correction"
              onSave={r.onSave}
              onCancel={r.onCancel}
            />
          )}
        </div>
      ))}
      {!v.manualRows.length && !v.manualOpen && (
        <p style={{ margin: '12px 0', fontSize: 13, color: C.ink2 }}>
          None yet. Use this when a report cannot be read, or to add a result with no document. Each one keeps its
          editing history and stays marked as user-entered, never as coming from a laboratory report.
        </p>
      )}
    </section>
  );
}

function ReviewQueue({ v }: { v: VM }) {
  return (
    <section aria-label="Review queue" style={{ marginTop: 40 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '8px 24px',
          borderBottom: `1px solid ${C.ink}`,
          paddingBottom: 8,
        }}
      >
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0 }}>Review queue</h2>
        <span style={s.body13}>{v.impQueueCount}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 820 }}>
          {v.impQueue.map((q, i1) => (
            <div
              key={i1}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr) 150px 180px auto',
                gap: '6px 18px',
                padding: '12px 4px',
                borderBottom: `1px solid ${C.rule2}`,
                alignItems: 'baseline',
              }}
            >
              <span style={s.minW0}>
                <span style={{ display: 'block', fontSize: 14 }}>{q.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {q.date} · {q.format}
                </span>
              </span>
              <span style={s.body125}>{q.source}</span>
              <span style={s.body125}>
                <span style={{ display: 'block' }}>{q.values}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.ink3 }}>{q.progress}</span>
              </span>
              <span style={{ fontSize: 12.5, color: q.attColor }}>{q.attention}</span>
              <button
                onClick={q.onReview}
                style={{ fontSize: 13, fontWeight: 500, background: C.ink, color: C.paper, padding: '6px 12px' }}
              >
                Review
              </button>
            </div>
          ))}{' '}
        </div>
      </div>
      {v.impQueueEmpty && <p style={{ fontSize: 14, color: C.ink2 }}>Nothing is waiting for review.</p>}
    </section>
  );
}

export function ImportScreen() {
  const store = useStore();
  const v: VM = { ...shellVM(store), ...importVM(store) };
  // Only this screen shows these. Loading them at startup re-rendered the first screen and delayed its charts.
  useEffect(() => {
    void store.imports.load();
    void store.loadArchiveSafety();
  }, [store]);
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
          Import
        </h1>
        <span style={{ fontSize: 13, color: C.ink2, maxWidth: 560 }}>{v.copy.headNote}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 48px', marginTop: 24, alignItems: 'stretch' }}>
        <div
          onDragOver={v.onDragOver}
          onDragLeave={v.onDragLeave}
          onDrop={v.onDrop}
          style={{
            flex: '1.3 1 520px',
            minWidth: 0,
            border: `1.5px dashed ${v.dzBorder}`,
            background: v.dzBg,
            padding: '36px 36px 30px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 14,
            minHeight: 280,
          }}
        >
          <div style={{ fontFamily: SERIF, fontSize: 34, lineHeight: 1.1, letterSpacing: '-0.01em' }}>
            {v.copy.dropTitle}
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: C.ink2, maxWidth: 560, textWrap: 'pretty' }}>
            {v.copy.dropBody}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px', marginTop: 6 }}>
            <button
              onClick={v.pickFiles}
              style={{ background: C.ink, color: C.paper, padding: '9px 14px', fontSize: 13, fontWeight: 500 }}
            >
              Choose files
            </button>
            <button
              onClick={v.pickFolder}
              style={{ border: `1px solid ${C.ink}`, padding: '8px 14px', fontSize: 13, fontWeight: 500 }}
            >
              Choose folder
            </button>
            {v.isDemo && (
              <button
                onClick={v.loadSample}
                style={{ border: `1px solid ${C.ink}`, padding: '8px 14px', fontSize: 13, fontWeight: 500 }}
              >
                Load sample batch, 7 synthetic files
              </button>
            )}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.muted, marginTop: 4 }}>{v.copy.formats}</div>
        </div>
        <div style={{ flex: '1 1 420px', minWidth: 0, borderTop: `1px solid ${C.ink}`, paddingTop: 10 }}>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 22, margin: '0 0 6px' }}>{v.copy.readTitle}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '70px minmax(0,1fr)', gap: '0 14px', fontSize: 12.5 }}>
            {v.copy.readRows.map((r) => (
              <Fragment key={r.k}>
                <span
                  style={{
                    fontFamily: MONO,
                    fontWeight: 500,
                    padding: '8px 0',
                    borderBottom: `1px solid ${C.rule2}`,
                    color: r.warn ? C.rust : undefined,
                  }}
                >
                  {r.k}
                </span>
                <span style={{ padding: '8px 0', borderBottom: `1px solid ${C.rule2}`, color: C.ink2 }}>{r.text}</span>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
          marginTop: 32,
          borderTop: `1px solid ${C.ink}`,
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        <div style={{ padding: '14px 20px 14px 0', borderRight: `1px solid ${C.rule2}` }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink3 }}>1</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Stored</span>
          </div>
          <p style={{ margin: '4px 0 0 22px', fontSize: 12.5, color: C.ink2, lineHeight: 1.45 }}>{v.copy.steps[0]}</p>
        </div>
        <div style={{ padding: '14px 20px', borderRight: `1px solid ${C.rule2}` }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink3 }}>2</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Read</span>
          </div>
          <p style={{ margin: '4px 0 0 22px', fontSize: 12.5, color: C.ink2, lineHeight: 1.45 }}>{v.copy.steps[1]}</p>
        </div>
        <div style={{ padding: '14px 20px', borderRight: `1px solid ${C.rule2}` }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink3 }}>3</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Extracted</span>
          </div>
          <p style={{ margin: '4px 0 0 22px', fontSize: 12.5, color: C.ink2, lineHeight: 1.45 }}>{v.copy.steps[2]}</p>
        </div>
        <div style={{ padding: '14px 20px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink3 }}>4</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.green }}>Reviewed</span>
          </div>
          <p style={{ margin: '4px 0 0 22px', fontSize: 12.5, color: C.ink2, lineHeight: 1.45 }}>{v.copy.steps[3]}</p>
        </div>
      </div>
      {v.impHasBatch && <CurrentBatch v={v} />}
      {!v.isDemo && <ImportReport pickFolder={v.pickFolder} />}
      <ReviewQueue v={v} />
      {!v.isDemo && <ManualResults v={v} />}
      {!v.isDemo && <IdentitySection />}
      {!v.isDemo && <BackupsSection />}
      {!v.isDemo && <AccessSection />}
      <Footer />
    </main>
  );
}
