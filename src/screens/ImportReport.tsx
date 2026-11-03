import { useState } from 'react';
import { s } from '../components/styles';
import { useStore } from '../state/useStore';
import { C, MONO, SERIF } from '../theme';
import { importReportVM } from '../viewmodels/importReport';

const COLUMNS = 'minmax(0,1.3fr) 130px 86px minmax(0,1.7fr) 170px';

/** What happened to every file of an import, read from the service. It is here again after a closed browser. */
export function ImportReport({ pickFolder }: { pickFolder: () => void }) {
  const store = useStore();
  const v = importReportVM(store);
  const [confirming, setConfirming] = useState(false);
  if (!v.show) return null;
  return (
    <section aria-label="Import report" style={{ marginTop: 36 }}>
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
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0 }}>Import report</h2>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'baseline' }}>
          {v.batchOptions.length > 1 && (
            <label style={s.body125}>
              Import{' '}
              <select
                value={v.selected}
                onChange={(e) => v.onSelect(e.target.value)}
                style={{ fontSize: 12.5, background: C.field, border: `1px solid ${C.ink}`, borderRadius: 0, padding: '2px 4px' }}
              >
                {v.batchOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {v.canRetry && (
            <button onClick={v.onRetryAll} style={s.link125}>
              Retry failures
            </button>
          )}
          {v.hasBatch && (
            confirming ? (
              <>
                <button onClick={() => { setConfirming(false); void v.onRemove(); }} style={s.link125}>
                  Delete the report, keep the documents
                </button>
                <button onClick={() => setConfirming(false)} style={s.link125}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)} style={s.link125}>
                Remove this report
              </button>
            )
          )}
        </span>
      </div>
      {v.unavailable && (
        <p role="alert" style={{ fontSize: 13, color: C.rust, margin: '10px 0 0' }}>
          The saved report could not be loaded from the archive service. It has not been lost.{' '}
          <button onClick={v.onRetryLoad} style={s.link13}>
            Retry
          </button>
        </p>
      )}
      {v.problem && (
        <p role="alert" style={{ fontSize: 13, color: C.rust, margin: '10px 0 0', maxWidth: 820 }}>
          {v.problem}
        </p>
      )}
      {v.interrupted && (
        <p style={{ fontSize: 13, color: C.ink2, margin: '10px 0 0', maxWidth: 820 }}>
          {v.interrupted}{' '}
          <button onClick={pickFolder} style={s.link13}>
            Choose folder
          </button>
        </p>
      )}
      {v.progress && (
        <p role="status" style={{ fontFamily: MONO, fontSize: 11.5, color: C.muted, margin: '10px 0 0' }}>
          {v.progress}
        </p>
      )}
      <p style={{ fontSize: 13, color: C.ink2, margin: '10px 0 6px' }}>{v.summary}</p>
      {v.identityNotSet && (
        <p style={{ fontSize: 12.5, color: C.ink3, margin: '0 0 6px' }}>
          Identity was not compared, because your details are not set. See Identity check below.
        </p>
      )}
      <div role="group" aria-label="Filter the report" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', margin: '8px 0' }}>
        {v.filters.map((f) => (
          <button
            key={f.key}
            onClick={f.onClick}
            aria-pressed={f.active}
            style={{ fontSize: 12.5, color: f.active ? C.ink : C.ink2, fontWeight: f.active ? 600 : 400, borderBottom: `1px solid ${f.active ? C.ink : C.rule}` }}
          >
            {f.label} <span style={{ fontFamily: MONO, fontSize: 11.5 }}>{f.n}</span>
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 860 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: COLUMNS,
              gap: '0 16px',
              padding: '6px 4px',
              fontSize: 11.5,
              fontWeight: 500,
              color: C.ink3,
              borderBottom: `1px solid ${C.rule}`,
            }}
          >
            <span>File</span>
            <span>Type</span>
            <span>Pipeline</span>
            <span>Result</span>
            <span>Status</span>
          </div>
          {v.rows.map((f) => (
            <div
              key={f.id}
              style={{
                display: 'grid',
                gridTemplateColumns: COLUMNS,
                gap: '0 16px',
                padding: '11px 4px',
                borderBottom: `1px solid ${C.rule2}`,
                alignItems: 'start',
              }}
            >
              <span style={s.minW0}>
                <span style={{ display: 'block', fontFamily: MONO, fontSize: 12, overflowWrap: 'anywhere' }}>{f.name}</span>
                <span style={s.subBlock}>
                  {f.size}
                  {f.attempts ? ` · ${f.attempts}` : ''}
                </span>
              </span>
              <span style={s.body125}>{f.kind}</span>
              <span title="Stored, read, extracted, reviewed" style={{ display: 'flex', gap: 3, paddingTop: 3 }}>
                {[f.p1, f.p2, f.p3, f.p4].map((fill, i) => (
                  <span key={i} style={{ width: 10, height: 10, border: `1px solid ${C.ink}`, background: fill }} />
                ))}
              </span>
              <span style={s.minW0}>
                <span style={{ fontSize: 12.5, color: C.ink2, lineHeight: 1.45 }}>{f.result}</span>
                {f.identity && (
                  <span style={{ display: 'block', fontSize: 12, color: f.identityColor, lineHeight: 1.45, marginTop: 3 }}>{f.identity}</span>
                )}
                <span style={{ display: 'flex', gap: 12, marginTop: 3 }}>
                  {f.documentId && (
                    <button onClick={f.onView} style={s.link12}>
                      View in Documents
                    </button>
                  )}
                  {f.canRetry && (
                    <button onClick={f.onRetry} style={s.link12}>
                      Retry
                    </button>
                  )}
                </span>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: f.color }}>{f.label}</span>
            </div>
          ))}
        </div>
      </div>
      {v.canShowMore && (
        <p style={{ margin: '10px 0 0' }}>
          <button onClick={v.onShowMore} style={s.link125}>
            Show more ({v.shown} of {v.total})
          </button>
        </p>
      )}
      {v.atLimit && (
        <p style={{ ...s.muted12, margin: '10px 0 0' }}>
          Showing {v.shown} of {v.total}. Use the filters above to reach the rest.
        </p>
      )}
      <p style={{ fontFamily: MONO, fontSize: 11, color: C.ink3, margin: '8px 0 0' }}>
        Pipeline squares: stored, read, extracted, reviewed.
      </p>
    </section>
  );
}
