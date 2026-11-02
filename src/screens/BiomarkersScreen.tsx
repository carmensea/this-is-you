import { ExplorerChart } from '../charts/ExplorerChart';
import { ChartFrame } from '../components/ChartFrame';
import { Footer, Segmented, Checkbox, YearRange } from '../components/controls';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { s } from '../components/styles';
import { shellVM } from '../viewmodels/shell';
import { biomarkersVM } from '../viewmodels/biomarkers';

type VM = ReturnType<typeof shellVM> & ReturnType<typeof biomarkersVM>;

function Measures({ v }: { v: VM }) {
  return (
    <aside aria-label="Measures" style={{ flex: '0 1 290px', minWidth: 240 }}>
      <label
        htmlFor="bx-search"
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: C.ink3,
        }}
      >
        Find a measure
      </label>
      <input
        id="bx-search"
        type="search"
        value={v.bxQuery}
        onChange={v.onBxQuery}
        placeholder="Name, abbreviation or panel"
        style={{
          width: '100%',
          marginTop: 8,
          padding: '9px 10px',
          border: `1px solid ${C.ink}`,
          borderRadius: 0,
          background: C.field,
          fontFamily: SANS,
          fontSize: 14,
          color: C.ink,
        }}
      />
      <Checkbox
        checked={v.bxFlaggedA}
        box={v.bxFlaggedBg}
        onClick={v.toggleFlagged}
        boxStyle={{ width: 14, height: 14, border: `1px solid ${C.ink}`, flex: 'none' }}
        style={{ display: 'flex', gap: 9, alignItems: 'center', marginTop: 12, fontSize: 13 }}
      >
        Only measures flagged at least once{' '}
      </Checkbox>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink3, marginTop: 14 }}>
        Counts: known by snapshot / full archive
      </div>
      <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {v.bxGroups.map((g, i0) => (
          <div key={i0}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                borderBottom: `1px solid ${C.ink}`,
                paddingBottom: 6,
              }}
            >
              <span style={s.eyebrow}>{g.name}</span>
              <span style={s.monoNote}>{g.n}</span>
            </div>
            {g.items.map((it, i1) => (
              <button
                key={i1}
                onClick={it.onClick}
                aria-current={it.current}
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) auto',
                  gap: '2px 10px',
                  padding: 8,
                  borderBottom: `1px solid ${C.rule2}`,
                  background: it.bg,
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: it.weight }}>{it.label}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500, color: C.rust }}>{it.flag}</span>
                <span style={{ fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{it.sub}</span>
                <span style={{ fontSize: 11, color: C.ink3, textAlign: 'right' }}>{it.count}</span>
              </button>
            ))}
          </div>
        ))}
        {v.bxNone && <p style={{ margin: 0, fontSize: 13, color: C.muted }}>No measures match this search.</p>}
      </div>
    </aside>
  );
}

function SelectedMeasurement({ v }: { v: VM }) {
  return (
    <section
      aria-label="Selected measurement"
      style={{ flex: '1 1 420px', minWidth: 0, borderTop: `1px solid ${C.ink}`, paddingTop: 12 }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: '6px 16px',
          alignItems: 'baseline',
        }}
      >
        <h2 style={s.heading3}>Selected measurement</h2>
        <span style={{ fontSize: 12.5, color: v.bxSelStatusColor }}>{v.bxSelStatus}</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))',
          gap: '14px 24px',
          marginTop: 14,
        }}
      >
        {v.bxSelFields.map((f, i2) => (
          <div key={i2} style={s.minW0}>
            <div style={s.meta12}>{f.k}</div>
            <div style={{ fontSize: 14, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{f.v}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 24px',
          marginTop: 16,
          fontSize: 13,
          alignItems: 'baseline',
        }}
      >
        <a href="#" onClick={v.bxOpenDoc}>
          Open source document: {v.bxSelDoc}
        </a>
        <button onClick={v.bxSnapHere} style={s.link13}>
          Set snapshot to this result
        </button>
      </div>
    </section>
  );
}

function NotesOnThisSeries({ v }: { v: VM }) {
  return (
    <section
      aria-label="Notes on this series"
      style={{ flex: '1 1 300px', minWidth: 0, borderTop: `1px solid ${C.ink}`, paddingTop: 12 }}
    >
      <h2 style={s.heading3}>About this series</h2>
      {v.bxNotes.map((n, i3) => (
        <p key={i3} style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.55, color: C.ink2, textWrap: 'pretty' }}>
          {n}
        </p>
      ))}
    </section>
  );
}

function AllMeasurements({ v }: { v: VM }) {
  return (
    <section aria-label="All measurements" style={{ marginTop: 40, borderTop: `1px solid ${C.ink}`, paddingTop: 12 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: '8px 24px',
          alignItems: 'baseline',
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h2 style={s.heading3}>All measurements</h2>
          <span style={{ fontSize: 12.5, color: C.muted }}>{v.bxRowsNote}</span>
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <Checkbox
            checked={v.bxMissingA}
            box={v.bxMissingBg}
            onClick={v.toggleMissing}
            boxStyle={{ width: 13, height: 13, border: `1px solid ${C.ink}` }}
            style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}
          >
            Show draws where not measured
          </Checkbox>
          <button onClick={v.toggleSort} style={s.link125}>
            Order: {v.bxSortLabel}
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 10 }}>
        <div role="table" aria-label="All measurements" style={{ minWidth: 900, fontSize: 13 }}>
          <div
            role="row"
            style={{
              display: 'grid',
              gridTemplateColumns: '110px 90px 40px minmax(110px,1fr) minmax(170px,1.4fr) 100px 100px 70px',
              gap: '0 12px',
              padding: '6px 8px',
              fontSize: 11.5,
              fontWeight: 500,
              color: C.ink3,
              borderBottom: `1px solid ${C.ink}`,
            }}
          >
            <span role="columnheader">Collected</span>
            <span role="columnheader" style={s.alignRight}>
              Value
            </span>
            <span role="columnheader">Flag</span>
            <span role="columnheader">Range on report</span>
            <span role="columnheader">Laboratory</span>
            <span role="columnheader">Reported</span>
            <span role="columnheader">At snapshot</span>
            <span role="columnheader">Source</span>
          </div>
          {v.bxRows.map((r, i4) => (
            <div
              key={i4}
              role="row"
              onClick={r.onClick}
              style={{
                display: 'grid',
                gridTemplateColumns: '110px 90px 40px minmax(110px,1fr) minmax(170px,1.4fr) 100px 100px 70px',
                gap: '0 12px',
                padding: '9px 8px',
                borderBottom: `1px solid ${C.rule2}`,
                cursor: 'pointer',
                background: r.bg,
                alignItems: 'baseline',
              }}
            >
              <span role="cell" style={{ fontFamily: MONO, fontSize: 12 }}>
                {r.date}
              </span>
              <span role="cell" style={s.alignRight}>
                <span style={{ fontFamily: MONO, fontSize: 13, color: r.valColor }}>{r.value}</span>
                <span style={{ display: 'block', fontSize: 11, color: C.ink3 }}>{r.unit}</span>
              </span>
              <span role="cell" style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: C.rust }}>
                {r.flag}
              </span>
              <span role="cell" style={{ fontFamily: MONO, fontSize: 12, color: C.ink2 }}>
                {r.ref}
              </span>
              <span role="cell" style={s.body125}>
                {r.lab}
              </span>
              <span role="cell" style={{ fontFamily: MONO, fontSize: 12, color: C.ink2 }}>
                {r.reported}
              </span>
              <span role="cell" style={{ fontSize: 12, color: r.knownColor }}>
                {r.known}
              </span>
              <span role="cell" style={{ fontSize: 12.5 }}>
                <a href="#" onClick={r.onDoc}>
                  {r.docLabel}
                </a>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function BiomarkersScreen() {
  const store = useStore();
  const v: VM = { ...shellVM(store), ...biomarkersVM(store) };
  return (
    <main style={{ maxWidth: 1480, margin: '0 auto', padding: '28px var(--gutter) 64px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px 48px', alignItems: 'flex-start' }}>
        <Measures v={v} />
        <div style={{ flex: '1 1 640px', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: '16px 40px',
            }}
          >
            <div style={s.minW0}>
              <div style={s.eyebrow}>{v.bxCat}</div>
              <h1
                style={{
                  fontFamily: SERIF,
                  fontWeight: 400,
                  fontSize: 48,
                  lineHeight: 1.05,
                  letterSpacing: '-0.02em',
                  margin: '8px 0 8px',
                }}
              >
                {v.bxName}
              </h1>
              <div style={s.body13}>{v.bxMeta}</div>
            </div>
            <div style={s.alignRight}>
              <div style={s.meta12}>Latest known on {v.curShort}</div>
              <div
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'flex-end', marginTop: 2 }}
              >
                <span
                  style={{
                    fontFamily: SERIF,
                    fontSize: 42,
                    lineHeight: 1,
                    fontVariantNumeric: 'lining-nums tabular-nums',
                  }}
                >
                  {v.bxNowVal}
                </span>
                <span style={s.body13}>{v.bxNowUnit}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: C.rust }}>{v.bxNowFlag}</span>
              </div>
              <div style={{ fontSize: 12, color: C.ink2, marginTop: 4 }}>{v.bxNowDate}</div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px 28px',
              alignItems: 'center',
              marginTop: 20,
              padding: '12px 0',
              borderTop: `1px solid ${C.ink}`,
              borderBottom: `1px solid ${C.rule}`,
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={s.muted12}>Range</span>
              <Segmented items={v.bxRanges} />
            </div>
            {v.bxCustom && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: C.muted }}>
                <YearRange
                  from={v.bxFromTxt}
                  to={v.bxToTxt}
                  onFromDown={v.bxFromDown}
                  onFromUp={v.bxFromUp}
                  onToDown={v.bxToDown}
                  onToUp={v.bxToUp}
                />
              </div>
            )}
            {v.bxMultiUnit && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={s.muted12}>Unit</span>
                <Segmented items={v.bxUnits} />
              </div>
            )}
            {v.bxHasCompat && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={s.muted12}>Compare with</span>
                <Segmented items={v.bxCmps} />
              </div>
            )}
            {v.bxNoCompat && (
              <span style={{ fontSize: 12, color: C.ink3, maxWidth: 420 }}>
                Comparison is offered only for measures reported in the same unit on the same panel. None apply here.
              </span>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 18px',
              fontSize: 12,
              color: C.muted,
              alignItems: 'center',
              margin: '12px 0 4px',
            }}
          >
            <span style={s.legendItem}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.ink }} />
              Within printed range
            </span>
            <span style={s.legendItem}>
              <span style={{ width: 8, height: 8, background: C.rust }} />
              Flagged by lab, H or L
            </span>
            <span style={s.legendItem}>
              <span style={{ width: 16, height: 10, background: C.greenT }} />
              Range printed on each report
            </span>
            <span style={s.legendItem}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', border: `1.3px solid ${C.ink3}` }} />
              Not known at snapshot
            </span>
            {v.bxHasCm && (
              <span style={s.legendItem}>
                <span style={{ width: 8, height: 8, border: `1.3px solid ${C.ink2}`, transform: 'rotate(45deg)' }} />
                {v.bxCmLabel}
              </span>
            )}
          </div>
          <ChartFrame style={{ width: '100%', minHeight: 420, overflow: 'hidden' }}>
            {(w) => <ExplorerChart width={w} {...v.bxChart} />}
          </ChartFrame>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.ink3, marginTop: 4 }}>{v.bxAxisNote}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 48px', marginTop: 28 }}>
            <SelectedMeasurement v={v} />
            <NotesOnThisSeries v={v} />
          </div>
          <AllMeasurements v={v} />
        </div>
      </div>
      <Footer />
    </main>
  );
}
