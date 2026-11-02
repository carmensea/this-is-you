import { Timeline } from '../charts/Timeline';
import { MarkerChart } from '../charts/MarkerChart';
import { WeightChart } from '../charts/WeightChart';
import { ChartFrame } from '../components/ChartFrame';
import { Footer } from '../components/controls';
import { useStore } from '../state/useStore';
import { C, HATCH_BG, MONO, SERIF } from '../theme';
import { s } from '../components/styles';
import { shellVM } from '../viewmodels/shell';
import { overviewVM } from '../viewmodels/overview';

type VM = ReturnType<typeof shellVM> & ReturnType<typeof overviewVM>;

function TimeMachine({ v }: { v: VM }) {
  return (
    <section aria-label="Time machine" style={{ paddingTop: 36 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: '24px 48px',
        }}
      >
        <div style={s.minW0}>
          <div style={s.eyebrow}>The record as of</div>
          <h1
            style={{
              fontFamily: SERIF,
              fontWeight: 400,
              fontSize: 'clamp(44px, 12vw, 68px)',
              lineHeight: 1,
              letterSpacing: '-0.02em',
              margin: '10px 0 12px',
              fontVariantNumeric: 'lining-nums',
            }}
          >
            {v.curLong}
          </h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 14, color: C.ink2 }}>
            <span>Age {v.age}</span>
            <span style={{ color: C.faint }}>/</span>
            <span>{v.agoText}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 440 }}>
          <div
            role="group"
            aria-label="Snapshot mode"
            style={{ display: 'flex', border: `1px solid ${C.ink}`, alignSelf: 'flex-start' }}
          >
            <button
              onClick={v.setKnown}
              aria-pressed={v.knownPressed}
              style={{ padding: '8px 14px', fontSize: 13, fontWeight: 500, background: v.knownBg, color: v.knownFg }}
            >
              As known then
            </button>
            <button
              onClick={v.setNow}
              aria-pressed={v.nowPressed}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
                borderLeft: `1px solid ${C.ink}`,
                background: v.nowBg,
                color: v.nowFg,
              }}
            >
              As understood now
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: C.ink2, textWrap: 'pretty' }}>{v.modeText}</p>
        </div>
      </div>
      <div
        style={{
          marginTop: 28,
          borderTop: `1px solid ${C.ink}`,
          borderBottom: `1px solid ${C.rule}`,
          padding: '12px 0 6px',
        }}
      >
        <ChartFrame style={{ width: '100%', minHeight: 290, overflow: 'hidden' }}>
          {(w) => <Timeline width={w} cur={v.cur} />}
        </ChartFrame>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '14px 32px',
          alignItems: 'center',
          padding: '14px 0',
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        <div style={{ display: 'flex', gap: 1, background: C.ink, border: `1px solid ${C.ink}` }}>
          <button onClick={v.prevEvent} style={{ background: C.paper, padding: '8px 12px', fontSize: 13 }}>
            Previous event
          </button>
          <button onClick={v.nextEvent} style={{ background: C.paper, padding: '8px 12px', fontSize: 13 }}>
            Next event
          </button>
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: C.ink2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 220,
            flex: '1 1 260px',
          }}
        >
          <span>{v.prevLabel}</span>
          <span>{v.nextLabel}</span>
        </div>
        <div
          role="group"
          aria-label="Jump to year"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 0', alignItems: 'baseline' }}
        >
          {v.years.map((y, i0) => (
            <button
              key={i0}
              onClick={y.onClick}
              title={y.title}
              style={{
                fontFamily: MONO,
                fontSize: 12,
                padding: '4px 5px',
                color: y.color,
                borderBottom: `2px solid ${y.border}`,
                textDecoration: y.deco,
              }}
            >
              {y.short}
            </button>
          ))}
        </div>
        <button onClick={v.goToday} style={s.link13}>
          Today
        </button>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 24px',
          padding: '10px 0 0',
          fontSize: 12,
          color: C.muted,
          alignItems: 'center',
        }}
      >
        <span style={s.monoNote}>Drag or click the ruler. Arrow keys move one month, Shift + arrow one year.</span>
        <span style={s.legendItem}>
          <span style={{ width: 16, height: 10, background: HATCH_BG, border: `1px solid ${C.rule}` }} />
          No records in archive
        </span>
        <span style={s.legendItem}>
          <span style={{ width: 16, height: 10, background: C.sunk, border: `1px solid ${C.rule}` }} />
          After the snapshot date
        </span>
        <span style={s.legendItem}>
          <span style={{ width: 9, height: 9, border: `1.5px dashed ${C.ink}`, borderRadius: '50%' }} />
          Onset recorded later
        </span>
      </div>
    </section>
  );
}

function SummaryOfRecords({ v }: { v: VM }) {
  return (
    <section aria-label="Summary of records">
      <div style={s.eyebrow}>On record by this date</div>
      <p
        style={{
          fontFamily: SERIF,
          fontSize: 25,
          lineHeight: 1.38,
          margin: '12px 0 0',
          maxWidth: 820,
          textWrap: 'pretty',
          color: C.ink,
        }}
      >
        {v.summarySentence}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14, fontSize: 13, color: C.ink2 }}>
        <span>{v.lastLabText}</span>
        {v.inGap && (
          <span style={{ color: C.rust }}>
            This date falls inside a gap. The archive has no records between July 2012 and February 2015.
          </span>
        )}
        {v.hasLater && (
          <span>
            {v.laterText}{' '}
            <button onClick={v.setNow} style={{ color: C.green, borderBottom: `1px solid ${C.green}`, fontSize: 13 }}>
              {v.laterAction}
            </button>
          </span>
        )}
      </div>
    </section>
  );
}

function BiomarkerTrend({ v }: { v: VM }) {
  return (
    <section aria-label="Biomarker trend" style={{ marginTop: 44, borderTop: `1px solid ${C.ink}`, paddingTop: 18 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '8px 24px',
        }}
      >
        <h2 style={s.heading2}>{v.markerName}</h2>
        <button onClick={v.openBiomarkers} style={s.link13}>
          Open in Biomarker Explorer
        </button>
      </div>
      <div style={{ fontSize: 13, color: C.ink2, marginTop: 4 }}>{v.markerMeta}</div>
      <div
        role="tablist"
        aria-label="Biomarker"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginTop: 18, borderBottom: `1px solid ${C.rule}` }}
      >
        {v.markerTabs.map((m, i1) => (
          <button
            key={i1}
            role="tab"
            aria-selected={m.selected}
            onClick={m.onClick}
            style={{
              padding: '8px 16px 9px 0',
              marginRight: 16,
              marginBottom: -1,
              borderBottom: `2px solid ${m.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: m.color }}>{m.label}</span>
            <span style={s.monoNote}>{m.sub}</span>
          </button>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px 24px',
          margin: '14px 0 6px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 18px',
            fontSize: 12,
            color: C.muted,
            alignItems: 'center',
          }}
        >
          <span style={s.legendItem}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.ink }} />
            Result within printed range
          </span>
          <span style={s.legendItem}>
            <span style={{ width: 8, height: 8, background: C.rust }} />
            Flagged by lab (H or L)
          </span>
          <span style={s.legendItem}>
            <span style={{ width: 16, height: 10, background: C.greenT }} />
            Reference range printed on each report
          </span>
          <span style={s.legendItem}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', border: `1.3px solid ${C.ink3}` }} />
            Not known at snapshot
          </span>
        </div>
        <div role="group" aria-label="Time range" style={{ display: 'flex', border: `1px solid ${C.ink}` }}>
          <button
            onClick={v.rangeAll}
            style={{ padding: '5px 10px', fontSize: 12, background: v.rAllBg, color: v.rAllFg }}
          >
            All years
          </button>
          <button
            onClick={v.rangeWin}
            style={{
              padding: '5px 10px',
              fontSize: 12,
              borderLeft: `1px solid ${C.ink}`,
              background: v.rWinBg,
              color: v.rWinFg,
            }}
          >
            Around snapshot
          </button>
        </div>
      </div>
      <ChartFrame style={{ width: '100%', minHeight: 300, overflow: 'hidden' }}>
        {(w) => <MarkerChart width={w} {...v.markerChart} />}
      </ChartFrame>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.ink3, marginTop: 2 }}>{v.axisNote}</div>
      <div style={{ marginTop: 20, borderTop: `1px solid ${C.rule}`, paddingTop: 14 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: '6px 20px',
            alignItems: 'baseline',
          }}
        >
          <div style={s.eyebrow}>Selected result</div>
          <span style={{ fontSize: 12.5, color: C.rust }}>{v.selStatus}</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
            gap: '14px 24px',
            marginTop: 12,
          }}
        >
          {v.selFields.map((f, i2) => (
            <div key={i2} style={s.minW0}>
              <div style={s.meta12}>{f.k}</div>
              <div style={{ fontSize: 14, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{f.v}</div>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 20px',
            alignItems: 'baseline',
            fontSize: 13,
          }}
        >
          <span style={{ color: C.ink3 }}>Source document</span>
          <a href="#" onClick={v.openDoc}>
            {v.selDoc}
          </a>
        </div>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 12.5,
            lineHeight: 1.5,
            color: C.muted,
            maxWidth: 760,
            textWrap: 'pretty',
          }}
        >
          {v.rangeNote}
        </p>
      </div>
    </section>
  );
}

function WeightHistory({ v }: { v: VM }) {
  return (
    <section aria-label="Weight history" style={{ marginTop: 44, borderTop: `1px solid ${C.ink}`, paddingTop: 18 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '8px 24px',
        }}
      >
        <h2 style={s.heading2}>Weight</h2>
        <span style={s.body13}>{v.weightSummary}</span>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 18px',
          fontSize: 12,
          color: C.muted,
          margin: '12px 0 6px',
          alignItems: 'center',
        }}
      >
        <span style={s.legendItem}>
          <span style={{ width: 7, height: 7, border: `1.3px solid ${C.ink}`, background: C.paper }} />
          Measured at a clinic visit
        </span>
        <span style={s.legendItem}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: C.ink2 }} />
          Smart scale reading (VeSync export)
        </span>
        <span style={s.monoNote}>Readings are shown individually and are not joined.</span>
      </div>
      <ChartFrame style={{ width: '100%', minHeight: 220, overflow: 'hidden' }}>
        {(w) => <WeightChart width={w} cur={v.cur} lb={v.weightLb} />}
      </ChartFrame>
    </section>
  );
}

function LatestKnownValues({ v }: { v: VM }) {
  return (
    <section aria-label="Latest known values">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          borderBottom: `1px solid ${C.ink}`,
          paddingBottom: 8,
        }}
      >
        <h3 style={s.heading3}>Latest known values</h3>
        <span style={s.meta12}>as of {v.curShort}</span>
      </div>
      <div role="table" aria-label="Latest known values" style={{ fontSize: 13 }}>
        <div
          role="row"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,0.9fr) minmax(0,1.1fr)',
            gap: '0 12px',
            fontSize: 11.5,
            fontWeight: 500,
            color: C.ink3,
            padding: '8px 0 6px',
          }}
        >
          <span role="columnheader">Measure</span>
          <span role="columnheader" style={s.alignRight}>
            Value
          </span>
          <span role="columnheader">Collected</span>
        </div>
        {v.valueRows.map((r, i3) => (
          <button
            key={i3}
            role="row"
            onClick={r.onClick}
            style={{
              width: '100%',
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,0.9fr) minmax(0,1.1fr)',
              gap: '0 12px',
              borderTop: `1px solid ${C.rule2}`,
              padding: '10px 0',
              background: r.bg,
            }}
          >
            <span role="cell" style={s.minW0}>
              <span style={{ display: 'block', fontWeight: 500 }}>{r.name}</span>
              <span style={s.subBlock}>{r.ref}</span>
            </span>
            <span role="cell" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontFamily: MONO, fontSize: 13.5, color: r.valColor }}>{r.value}</span>{' '}
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500, color: C.rust, marginLeft: 4 }}>
                {r.flag}
              </span>
              <span style={{ display: 'block', fontSize: 11, color: C.ink3, marginTop: 2 }}>{r.unit}</span>
            </span>
            <span role="cell" style={s.minW0}>
              <span style={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}>{r.date}</span>
              <span style={s.subBlock}>{r.ago}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Medications({ v }: { v: VM }) {
  return (
    <section aria-label="Medications">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          borderBottom: `1px solid ${C.ink}`,
          paddingBottom: 8,
        }}
      >
        <h3 style={s.heading3}>Medications on record</h3>
        <span style={s.meta12}>active on this date</span>
      </div>
      {v.medRows.map((m, i4) => (
        <div
          key={i4}
          style={{
            borderBottom: `1px solid ${C.rule2}`,
            padding: '10px 0',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={s.minW0}>
            <div style={{ fontWeight: 500, fontSize: 13.5 }}>{m.name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{m.dose}</div>
          </div>
          <div style={{ fontSize: 12, color: C.muted, textAlign: 'right', whiteSpace: 'nowrap' }}>{m.since}</div>
        </div>
      ))}{' '}
      {v.noMeds && (
        <div style={{ padding: '10px 0', fontSize: 13, color: C.ink3, borderBottom: `1px solid ${C.rule2}` }}>
          No medications recorded as active on this date.
        </div>
      )}
    </section>
  );
}

function Conditions({ v }: { v: VM }) {
  return (
    <section aria-label="Conditions">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          borderBottom: `1px solid ${C.ink}`,
          paddingBottom: 8,
        }}
      >
        <h3 style={s.heading3}>Documented conditions</h3>
        <span style={s.meta12}>as written in records</span>
      </div>
      {v.dxRows.map((d, i5) => (
        <div key={i5} style={{ borderBottom: `1px solid ${C.rule2}`, padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
            <span style={{ fontWeight: 500, fontSize: 13.5 }}>{d.name}</span>
            <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>{d.status}</span>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{d.meta}</div>
          {d.isLater && <div style={{ fontSize: 12, color: C.rust, marginTop: 3 }}>{d.laterText}</div>}
        </div>
      ))}{' '}
      {v.noDx && (
        <div style={{ padding: '10px 0', fontSize: 13, color: C.ink3, borderBottom: `1px solid ${C.rule2}` }}>
          No conditions documented by this date.
        </div>
      )}
    </section>
  );
}

function EventsLeadingUpToThisDate({ v }: { v: VM }) {
  return (
    <section aria-label="Events leading up to this date">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          borderBottom: `1px solid ${C.ink}`,
          paddingBottom: 8,
        }}
      >
        <h3 style={s.heading3}>Leading up to this date</h3>
        <button onClick={v.openHistory} style={s.link12}>
          Full history
        </button>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {v.eventRows.map((e, i6) => (
          <li key={i6} style={{ borderBottom: `1px solid ${C.rule2}` }}>
            <button
              onClick={e.onClick}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '88px minmax(0,1fr)',
                gap: 12,
                padding: '10px 0',
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.ink2, paddingTop: 2 }}>{e.date}</span>
              <span style={s.minW0}>
                <span style={s.kicker}>{e.type}</span>
                <span style={{ display: 'block', fontSize: 13.5, marginTop: 2 }}>{e.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>{e.source}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.rust, marginTop: 2 }}>{e.later}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TheArchiveToday({ v }: { v: VM }) {
  return (
    <section aria-label="The archive today" style={{ marginTop: 64, borderTop: `1px solid ${C.ink}`, paddingTop: 18 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '8px 24px',
        }}
      >
        <h2 style={s.heading2}>The archive today</h2>
        <span style={{ fontSize: 13, color: C.muted }}>Independent of the selected date</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
          gap: '40px 56px',
          marginTop: 22,
        }}
      >
        <div style={s.minW0}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              borderBottom: `1px solid ${C.rule}`,
              paddingBottom: 8,
            }}
          >
            <span style={s.eyebrow}>Recently imported</span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink3 }}>uploaded / parsed / reviewed</span>
          </div>
          {v.imports.map((d, i7) => (
            <div
              key={i7}
              style={{
                borderBottom: `1px solid ${C.rule2}`,
                padding: '11px 0',
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) auto',
                gap: '4px 16px',
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{d.title}</span>
              <span title={d.stageLabel} style={{ display: 'flex', gap: 3, alignItems: 'center', paddingTop: 4 }}>
                <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: d.s1 }} />
                <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: d.s2 }} />
                <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: d.s3 }} />
              </span>
              <span style={s.muted12}>{d.meta}</span>
              <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'right', color: d.stageColor }}>
                {d.stageLabel}
              </span>
              <span style={{ fontSize: 12, color: C.ink3, gridColumn: '1 / -1' }}>{d.note}</span>
            </div>
          ))}
        </div>
        <div style={s.minW0}>
          <div style={{ borderBottom: `1px solid ${C.rule}`, paddingBottom: 8 }}>
            <span style={s.eyebrow}>Known gaps and limits</span>
          </div>
          {v.gaps.map((g, i8) => (
            <div key={i8} style={{ borderBottom: `1px solid ${C.rule2}`, padding: '11px 0' }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{g.title}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{g.detail}</div>
            </div>
          ))}
        </div>
        <div style={s.minW0}>
          <div style={{ borderBottom: `1px solid ${C.rule}`, paddingBottom: 8 }}>
            <span style={s.eyebrow}>Go to</span>
          </div>
          {v.explore.map((x, i9) => (
            <button
              key={i9}
              onClick={x.onClick}
              className="row-hover"
              style={{
                width: '100%',
                borderBottom: `1px solid ${C.rule2}`,
                padding: '11px 0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 16,
              }}
            >
              <span style={{ fontFamily: SERIF, fontSize: 19 }}>{x.label}</span>
              <span style={{ fontSize: 12, color: C.muted, textAlign: 'right' }}>{x.detail}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function OverviewScreen() {
  const store = useStore();
  const v: VM = { ...shellVM(store), ...overviewVM(store) };
  return (
    <main style={{ maxWidth: 1480, margin: '0 auto', padding: '0 var(--gutter) 64px' }}>
      <TimeMachine v={v} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '48px 56px', marginTop: 40 }}>
        <div style={{ flex: '1 1 620px', minWidth: 0 }}>
          <SummaryOfRecords v={v} />
          <BiomarkerTrend v={v} />
          <WeightHistory v={v} />
        </div>
        <aside
          style={{ flex: '1 1 340px', maxWidth: 480, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 40 }}
        >
          <LatestKnownValues v={v} />
          <Medications v={v} />
          <Conditions v={v} />
          <EventsLeadingUpToThisDate v={v} />
        </aside>
      </div>
      <TheArchiveToday v={v} />
      <Footer />
    </main>
  );
}
