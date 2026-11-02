import { Fragment } from 'react';
import { CompareRuler } from '../charts/CompareRuler';
import { CompareChart } from '../charts/CompareChart';
import { CompareWeight } from '../charts/CompareWeight';
import { ChartFrame } from '../components/ChartFrame';
import { Footer, Segmented, Checkbox } from '../components/controls';
import { useStore } from '../state/useStore';
import { C, HATCH_BG, MONO, SERIF } from '../theme';
import { s } from '../components/styles';
import { shellVM } from '../viewmodels/shell';
import { compareVM } from '../viewmodels/compare';

type VM = ReturnType<typeof shellVM> & ReturnType<typeof compareVM>;

function SnapshotPicker({
  snap,
  letter,
  title,
  min,
  max,
}: {
  snap: VM['cA'];
  letter: string;
  title: string;
  min: string;
  max: string;
}) {
  return (
    <div style={s.minW0}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span
          style={{
            background: C.green,
            color: '#FFFFFF',
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 500,
            padding: '2px 7px',
          }}
        >
          {letter}
        </span>
        <span style={s.eyebrow}>{title}</span>
      </div>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 44,
          lineHeight: 1.05,
          letterSpacing: '-0.015em',
          margin: '10px 0 6px',
          fontVariantNumeric: 'lining-nums',
        }}
      >
        {snap.date}
      </div>
      <div style={s.body13}>{snap.meta}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px', alignItems: 'center', marginTop: 14 }}>
        <div
          role="group"
          aria-label={`Move ${title.toLowerCase()}`}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 1, background: C.ink, border: `1px solid ${C.ink}` }}
        >
          <button onClick={snap.yb} style={s.stepBtn8}>
            − 1 yr
          </button>
          <button onClick={snap.mb} style={s.stepBtn8}>
            − 1 mo
          </button>
          <button onClick={snap.mf} style={s.stepBtn8}>
            + 1 mo
          </button>
          <button onClick={snap.yf} style={s.stepBtn8}>
            + 1 yr
          </button>
        </div>
        <input
          type="date"
          aria-label={`${title} date`}
          value={snap.dVal}
          min={min}
          max={max}
          onChange={snap.onDate}
          style={{
            padding: '4px 8px',
            border: `1px solid ${C.ink}`,
            borderRadius: 0,
            background: C.field,
            fontFamily: MONO,
            fontSize: 12.5,
            color: C.ink,
          }}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 10, fontSize: 12 }}>
        <button onClick={snap.useTm} style={s.link12}>
          Use time machine date
        </button>
        <button onClick={snap.setTm} style={s.link12}>
          Set time machine to this date
        </button>
      </div>
    </div>
  );
}

/** One snapshot's value in the measurements table. */
function SnapshotCell({ c }: { c: VM['cGroups'][number]['rows'][number]['a'] }) {
  return (
    <span role="cell" style={s.minW0}>
      {c.has && (
        <>
          <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <span style={{ fontFamily: MONO, fontSize: 14 }}>{c.value}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500, color: C.rust }}>{c.flag}</span>
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: C.ink2, marginTop: 2 }}>
            {c.date} · {c.lag}
          </span>
          <span style={{ display: 'block', fontSize: 11, color: C.ink3, marginTop: 1 }}>{c.ref}</span>
          <a href="#" onClick={c.onDoc} style={{ fontSize: 11.5 }}>
            Source
          </a>
        </>
      )}{' '}
      {c.none && (
        <>
          <span
            style={{
              display: 'block',
              color: C.muted,
              fontStyle: 'italic',
              fontFamily: SERIF,
              fontSize: 14,
            }}
          >
            No recorded value
          </span>
          <span style={{ display: 'block', fontSize: 11, color: C.ink3, marginTop: 2 }}>{c.lag}</span>
        </>
      )}
    </span>
  );
}

/** One snapshot's list of conditions, medications or procedures. */
function HistoryItems({ items, empty, more }: { items: VM['cHxRows'][number]['a']; empty: boolean; more: string }) {
  return (
    <span style={s.minW0}>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {items.map((i, n) => (
          <button
            key={n}
            onClick={i.onClick}
            className="row-hover"
            style={{
              padding: '7px 0',
              borderBottom: '1px solid #EEEAE1',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <span style={{ fontSize: 13.5 }}>{i.text}</span>
            <span style={s.muted115}>{i.sub}</span>
            <span style={{ fontSize: 11.5, color: i.tagColor }}>{i.tag}</span>
          </button>
        ))}
        {empty && (
          <span style={{ padding: '7px 0', color: C.ink3, fontFamily: SERIF, fontStyle: 'italic', fontSize: 14 }}>
            None recorded by this date
          </span>
        )}
      </span>
      <span style={s.meta115}>{more}</span>
    </span>
  );
}

function SnapshotDates({ v }: { v: VM }) {
  return (
    <section aria-label="Snapshot dates" style={{ marginTop: 24, borderTop: `1px solid ${C.ink}`, paddingTop: 20 }}>
      <div className="snapshot-pair" style={{ display: 'grid', gap: '24px 32px', alignItems: 'start' }}>
        <SnapshotPicker snap={v.cA} letter="A" title="Earlier snapshot" min={v.minDate} max={v.maxDate} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            paddingTop: 34,
            minWidth: 120,
          }}
        >
          <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 18, color: C.ink, textAlign: 'center' }}>
            {v.cGapText}
          </span>
          <span style={{ width: '100%', height: 2, background: C.green }} />
          <span style={{ fontSize: 11.5, color: C.ink3, textAlign: 'center', maxWidth: 160, lineHeight: 1.4 }}>
            Dates stay in order. Moving one past the other exchanges them.
          </span>
        </div>
        <SnapshotPicker snap={v.cB} letter="B" title="Later snapshot" min={v.minDate} max={v.maxDate} />
      </div>
      {v.cSameDate && (
        <p style={{ margin: '14px 0 0', fontSize: 13, color: C.muted }}>
          Both snapshots are on the same date, so every value below is identical.
        </p>
      )}
      <ChartFrame
        style={{
          width: '100%',
          minHeight: 108,
          overflow: 'hidden',
          marginTop: 22,
          borderTop: `1px solid ${C.rule}`,
          paddingTop: 10,
        }}
      >
        {(w) => <CompareRuler width={w} {...v.cRuler} />}
      </ChartFrame>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 24px',
          alignItems: 'center',
          padding: '12px 0',
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        <span style={s.muted12}>Presets</span>
        <Segmented items={v.cPresets} />
        <span style={s.monoNote}>Drag either line on the ruler. {v.cTmText}.</span>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 12.5, color: C.ink2 }}>{v.cModeNote}</p>
    </section>
  );
}

function AtAGlance({ v }: { v: VM }) {
  return (
    <section aria-label="At a glance" style={{ marginTop: 36, display: 'flex', flexWrap: 'wrap', gap: '28px 48px' }}>
      <div style={{ flex: '1 1 520px', minWidth: 0 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.6fr) 90px 90px 110px',
            gap: '0 14px',
            borderBottom: `1px solid ${C.ink}`,
            paddingBottom: 6,
            fontSize: 11.5,
            fontWeight: 500,
            color: C.ink3,
          }}
        >
          <span style={s.eyebrow}>On record at each snapshot</span>
          <span style={s.alignRight}>A · {v.cAShort}</span>
          <span style={s.alignRight}>B · {v.cBShort}</span>
          <span style={s.alignRight}>Added between</span>
        </div>
        {v.cLedger.map((l, i0) => (
          <div
            key={i0}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1.6fr) 90px 90px 110px',
              gap: '0 14px',
              padding: '8px 0',
              borderBottom: `1px solid ${C.rule2}`,
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: 13.5 }}>{l.label}</span>
            <span
              style={{
                fontFamily: SERIF,
                fontSize: 20,
                textAlign: 'right',
                fontVariantNumeric: 'lining-nums tabular-nums',
              }}
            >
              {l.a}
            </span>
            <span
              style={{
                fontFamily: SERIF,
                fontSize: 20,
                textAlign: 'right',
                fontVariantNumeric: 'lining-nums tabular-nums',
              }}
            >
              {l.b}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 12.5, textAlign: 'right', color: C.ink2 }}>{l.diff}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: '1 1 360px', minWidth: 0, borderTop: `1px solid ${C.ink}`, paddingTop: 6 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: C.ink3,
            paddingBottom: 4,
          }}
        >
          Between A and B
        </div>
        {v.cFacts.map((f, i1) => (
          <p
            key={i1}
            style={{
              margin: 0,
              padding: '9px 0',
              borderBottom: `1px solid ${C.rule2}`,
              fontSize: 13.5,
              lineHeight: 1.5,
              color: C.ink,
              textWrap: 'pretty',
            }}
          >
            {f}
          </p>
        ))}
      </div>
    </section>
  );
}

function Measurements({ v }: { v: VM }) {
  return (
    <section aria-label="Measurements" style={{ marginTop: 44 }}>
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
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, margin: 0 }}>Measurements</h2>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={s.muted12}>
            Each value is the latest result on or before the snapshot. Select a row to chart it.
          </span>
          <Checkbox
            checked={v.cHideA}
            box={v.cHideBg}
            onClick={v.cToggleHide}
            boxStyle={{ width: 12, height: 12, border: `1px solid ${C.ink}` }}
            style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}
          >
            Hide measures with no value at either date
          </Checkbox>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div role="table" aria-label="Measurements at A and B" style={{ minWidth: 900 }}>
          <div
            role="row"
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(170px,1.2fr) minmax(190px,1fr) minmax(190px,1fr) minmax(170px,0.9fr)',
              gap: '0 20px',
              padding: '10px 8px 6px',
              fontSize: 11.5,
              fontWeight: 500,
              color: C.ink3,
            }}
          >
            <span role="columnheader">Measure</span>
            <span role="columnheader">
              <span
                style={{
                  background: C.green,
                  color: '#FFFFFF',
                  fontFamily: MONO,
                  fontSize: 10.5,
                  padding: '1px 5px',
                  marginRight: 6,
                }}
              >
                A
              </span>
              {v.cAShort}
            </span>
            <span role="columnheader">
              <span
                style={{
                  background: C.green,
                  color: '#FFFFFF',
                  fontFamily: MONO,
                  fontSize: 10.5,
                  padding: '1px 5px',
                  marginRight: 6,
                }}
              >
                B
              </span>
              {v.cBShort}
            </span>
            <span role="columnheader">Difference, B minus A</span>
          </div>
          {v.cGroups.map((g, i2) => (
            <Fragment key={i2}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: '18px 8px 6px',
                  borderBottom: `1px solid ${C.ink}`,
                }}
              >
                <span style={s.eyebrow}>{g.name}</span>
                <span style={s.meta115}>{g.count}</span>
              </div>
              {g.rows.map((r, i3) => (
                <div
                  key={i3}
                  role="row"
                  onClick={r.onClick}
                  aria-current={r.current}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(170px,1.2fr) minmax(190px,1fr) minmax(190px,1fr) minmax(170px,0.9fr)',
                    gap: '0 20px',
                    padding: '11px 8px',
                    borderBottom: `1px solid ${C.rule2}`,
                    cursor: 'pointer',
                    background: r.bg,
                    alignItems: 'start',
                  }}
                >
                  <span role="cell" style={s.minW0}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{r.name}</span>
                    <span style={s.subBlock}>{r.unit}</span>
                    <a href="#" onClick={r.onExplore} style={{ fontSize: 11.5 }}>
                      Full history
                    </a>
                  </span>
                  <SnapshotCell c={r.a} />
                  <SnapshotCell c={r.b} />
                  <span role="cell" style={s.minW0}>
                    <span style={{ display: 'block', fontFamily: MONO, fontSize: 14 }}>{r.change}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2 }}>{r.note}</span>
                  </span>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <p style={{ fontFamily: MONO, fontSize: 11, color: C.ink3, margin: '10px 0 0' }}>
        Differences are not computed across different units or calculation methods. Reference ranges are those printed
        on each report.
      </p>
    </section>
  );
}

function Trend({ v }: { v: VM }) {
  return (
    <section
      id="cmp-chart"
      aria-label="Trend"
      style={{ marginTop: 44, borderTop: `1px solid ${C.ink}`, paddingTop: 14 }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '8px 24px',
        }}
      >
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, margin: 0 }}>{v.cMkName}</h2>
        <button onClick={v.cOpenExplorer} style={s.link13}>
          Open in Biomarker Explorer
        </button>
      </div>
      <div style={{ fontSize: 13, color: C.ink2, marginTop: 4 }}>{v.cMkMeta}</div>
      <div
        role="group"
        aria-label="Measure to chart"
        style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}
      >
        {v.cMkList.map((b, i4) => (
          <button
            key={i4}
            onClick={b.onClick}
            aria-pressed={b.pressed}
            style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${C.ink}`, background: b.bg, color: b.fg }}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 18px',
          fontSize: 12,
          color: C.muted,
          alignItems: 'center',
          margin: '14px 0 4px',
        }}
      >
        <span style={s.legendItem}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${C.green}` }} />
          Result used at A or B
        </span>
        <span style={s.legendItem}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green }} />
          <span style={{ width: 14, borderTop: `1.5px dashed ${C.green}` }} />
          Time from that result to the snapshot
        </span>
        <span style={s.legendItem}>
          <span style={{ width: 16, height: 10, background: C.hover }} />
          Period between A and B
        </span>
        <span style={s.legendItem}>
          <span style={{ width: 16, height: 10, background: C.greenT }} />
          Range printed on each report
        </span>
        <span style={s.legendItem}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', border: `1.3px solid ${C.ink3}` }} />
          Not documented by B
        </span>
      </div>
      <ChartFrame style={{ width: '100%', minHeight: 380, overflow: 'hidden' }}>
        {(w) => <CompareChart width={w} {...v.cChart} />}
      </ChartFrame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, fontSize: 13, color: C.ink }}>
        <span>
          {v.cUsedA}{' '}
          {v.cHasUsedA && (
            <button onClick={v.cDocA} style={{ fontSize: 13, color: C.green, borderBottom: `1px solid ${C.green}` }}>
              Open report
            </button>
          )}
        </span>
        <span>
          {v.cUsedB}{' '}
          {v.cHasUsedB && (
            <button onClick={v.cDocB} style={{ fontSize: 13, color: C.green, borderBottom: `1px solid ${C.green}` }}>
              Open report
            </button>
          )}
        </span>
        <span style={s.monoNote}>
          No value is estimated at either snapshot date. Hover a point for details; click it to open its report.
        </span>
      </div>
    </section>
  );
}

function Weight({ v }: { v: VM }) {
  return (
    <section
      id="cmp-weight"
      aria-label="Weight"
      style={{ marginTop: 44, borderTop: `1px solid ${C.ink}`, paddingTop: 14 }}
    >
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, margin: 0 }}>Weight</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
          gap: '16px 32px',
          marginTop: 14,
        }}
      >
        <div>
          <div style={s.eyebrow}>A, nearest reading on or before</div>
          <div style={{ fontFamily: SERIF, fontSize: 32, marginTop: 6 }}>{v.cWA}</div>
          <div style={s.sub12}>{v.cWAd}</div>
        </div>
        <div>
          <div style={s.eyebrow}>B, nearest reading on or before</div>
          <div style={{ fontFamily: SERIF, fontSize: 32, marginTop: 6 }}>{v.cWB}</div>
          <div style={s.sub12}>{v.cWBd}</div>
        </div>
        <div>
          <div style={s.eyebrow}>Difference, B minus A</div>
          <div style={{ fontFamily: MONO, fontSize: 22, marginTop: 10 }}>{v.cWCh}</div>
          <div style={{ fontSize: 12, color: C.ink2, marginTop: 4 }}>{v.cWNote}</div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 18px',
          fontSize: 12,
          color: C.muted,
          margin: '16px 0 6px',
          alignItems: 'center',
        }}
      >
        <span style={s.legendItem}>
          <span style={{ width: 7, height: 7, border: `1.3px solid ${C.ink}`, background: C.paper }} />
          Clinic visit measurement
        </span>
        <span style={s.legendItem}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: C.ink2 }} />
          Smart scale reading
        </span>
        <span style={s.legendItem}>
          <span style={{ width: 16, height: 10, background: HATCH_BG, border: `1px solid ${C.rule}` }} />
          No readings
        </span>
      </div>
      <ChartFrame style={{ width: '100%', minHeight: 230, overflow: 'hidden' }}>
        {(w) => <CompareWeight width={w} {...v.cWeightChart} />}
      </ChartFrame>
    </section>
  );
}

function MedicalHistory({ v }: { v: VM }) {
  return (
    <section aria-label="Medical history" style={{ marginTop: 44, borderTop: `1px solid ${C.ink}`, paddingTop: 14 }}>
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, margin: 0 }}>Medical history</h2>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 760 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '200px minmax(0,1fr) minmax(0,1fr)',
              gap: '0 28px',
              padding: '14px 0 6px',
              fontSize: 11.5,
              fontWeight: 500,
              color: C.ink3,
              borderBottom: `1px solid ${C.rule}`,
            }}
          >
            <span />
            <span>
              <span
                style={{
                  background: C.green,
                  color: '#FFFFFF',
                  fontFamily: MONO,
                  fontSize: 10.5,
                  padding: '1px 5px',
                  marginRight: 6,
                }}
              >
                A
              </span>
              As of {v.cAShort}
            </span>
            <span>
              <span
                style={{
                  background: C.green,
                  color: '#FFFFFF',
                  fontFamily: MONO,
                  fontSize: 10.5,
                  padding: '1px 5px',
                  marginRight: 6,
                }}
              >
                B
              </span>
              As of {v.cBShort}
            </span>
          </div>
          {v.cHxRows.map((r, i5) => (
            <div
              key={i5}
              style={{
                display: 'grid',
                gridTemplateColumns: '200px minmax(0,1fr) minmax(0,1fr)',
                gap: '0 28px',
                padding: '10px 0 14px',
                borderBottom: `1px solid ${C.ink}`,
                alignItems: 'start',
              }}
            >
              <span style={{ fontFamily: SERIF, fontSize: 19, paddingTop: 6 }}>{r.label}</span>
              <HistoryItems items={r.a} empty={r.aEmpty} more={r.aMore} />
              <HistoryItems items={r.b} empty={r.bEmpty} more={r.bMore} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 48px', marginTop: 28 }}>
        <div style={{ flex: '1.4 1 520px', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '8px 16px',
              borderBottom: `1px solid ${C.ink}`,
              paddingBottom: 6,
            }}
          >
            <h3 style={s.heading3}>{v.cBetweenTitle}</h3>
            <button onClick={v.cToggleAll} style={s.link12}>
              {v.cBetweenToggle}
            </button>
          </div>
          {v.cBetween.map((e, i8) => (
            <div
              key={i8}
              style={{
                display: 'grid',
                gridTemplateColumns: '96px minmax(0,1fr) auto',
                gap: 12,
                padding: '9px 0',
                borderBottom: `1px solid ${C.rule2}`,
                alignItems: 'baseline',
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.ink2 }}>{e.date}</span>
              <span style={s.minW0}>
                <span style={s.kicker}>{e.type}</span>
                <span style={{ display: 'block', fontSize: 13.5, marginTop: 1 }}>{e.title}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>{e.source}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.rust }}>{e.later}</span>
              </span>
              <span style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                <button onClick={e.onOpen} style={s.link12}>
                  History
                </button>
                <button
                  onClick={e.onDoc}
                  style={{ fontSize: 12, color: C.green, borderBottom: `1px solid ${C.green}` }}
                >
                  Document
                </button>
              </span>
            </div>
          ))}{' '}
          {v.cBetweenEmpty && (
            <p style={{ color: C.muted, fontFamily: SERIF, fontStyle: 'italic', fontSize: 15 }}>
              No events were documented between A and B.
            </p>
          )}
        </div>
        <div style={{ flex: '1 1 360px', minWidth: 0 }}>
          <div style={{ borderBottom: `1px solid ${C.ink}`, paddingBottom: 6 }}>
            <h3 style={s.heading3}>Added retrospectively</h3>
          </div>
          <p style={{ fontSize: 12.5, color: C.ink2, margin: '8px 0 4px', lineHeight: 1.5 }}>
            Records about the time before A that were only documented after A. They were not part of the record at A.
          </p>
          {v.cRetro.map((e, i9) => (
            <div
              key={i9}
              style={{
                display: 'grid',
                gridTemplateColumns: '96px minmax(0,1fr)',
                gap: 12,
                padding: '9px 0',
                borderBottom: `1px solid ${C.rule2}`,
                alignItems: 'baseline',
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.ink2 }}>{e.date}</span>
              <span style={s.minW0}>
                <span style={s.kicker}>{e.type}</span>
                <span style={{ display: 'block', fontSize: 13.5, marginTop: 1 }}>{e.title}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.rust }}>{e.documented}</span>
                <span style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <button onClick={e.onOpen} style={s.link12}>
                    History
                  </button>
                  <button
                    onClick={e.onDoc}
                    style={{ fontSize: 12, color: C.green, borderBottom: `1px solid ${C.green}` }}
                  >
                    Document
                  </button>
                </span>
              </span>
            </div>
          ))}{' '}
          {v.cNoRetro && (
            <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, color: C.muted }}>
              None for these dates.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function CompareScreen() {
  const store = useStore();
  const v: VM = { ...shellVM(store), ...compareVM(store) };
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
          Compare
        </h1>
        <span style={{ fontSize: 13, color: C.ink2, maxWidth: 560 }}>
          Two snapshots of the same record. Values are shown as recorded. Differences are arithmetic only and say
          nothing about whether a change is good or bad.
        </span>
      </div>
      <SnapshotDates v={v} />
      <AtAGlance v={v} />
      <Measurements v={v} />
      <Trend v={v} />
      <Weight v={v} />
      <MedicalHistory v={v} />
      <Footer />
    </main>
  );
}
