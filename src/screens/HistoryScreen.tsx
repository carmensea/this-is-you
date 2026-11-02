import { Fragment } from 'react';
import { Timeline } from '../charts/Timeline';
import { ChartFrame } from '../components/ChartFrame';
import { Footer, Segmented, Checkbox, YearRange } from '../components/controls';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { s } from '../components/styles';
import { shellVM } from '../viewmodels/shell';
import { historyVM } from '../viewmodels/history';

type VM = ReturnType<typeof shellVM> & ReturnType<typeof historyVM>;

function Filters({ v }: { v: VM }) {
  return (
    <aside
      aria-label="Filters"
      style={{ flex: '0 1 290px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 26 }}
    >
      <div>
        <label
          htmlFor="hx-search"
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: C.ink3,
          }}
        >
          Search events
        </label>
        <input
          id="hx-search"
          type="search"
          value={v.hxQuery}
          onChange={v.onHxQuery}
          placeholder="Title, provider or clinician"
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
      </div>
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: C.ink3,
            borderBottom: `1px solid ${C.ink}`,
            paddingBottom: 6,
          }}
        >
          Category
        </div>
        {v.hxCats.map((c, i0) => (
          <button
            key={i0}
            role="checkbox"
            aria-checked={c.checked}
            onClick={c.onClick}
            style={{
              width: '100%',
              display: 'grid',
              gridTemplateColumns: '14px 18px minmax(0,1fr) auto',
              gap: 10,
              alignItems: 'center',
              padding: '8px 0',
              borderBottom: `1px solid ${C.rule2}`,
              fontSize: 13,
            }}
          >
            <span style={{ width: 14, height: 14, border: `1px solid ${C.ink}`, background: c.box }} />
            <span style={{ display: 'flex', justifyContent: 'center' }}>
              <span
                style={{
                  width: `${c.gw}px`,
                  height: `${c.gh}px`,
                  borderRadius: c.gr,
                  background: c.gbg,
                  border: c.gbd,
                  transform: `rotate(${c.grot}deg)`,
                  flex: 'none',
                }}
              />
            </span>
            <span>{c.label}</span>
            <span style={s.monoNote}>{c.count}</span>
          </button>
        ))}
      </div>
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: C.ink3,
            borderBottom: `1px solid ${C.ink}`,
            paddingBottom: 6,
          }}
        >
          Source
        </div>
        {v.hxSources.map((c, i1) => (
          <button
            key={i1}
            role="radio"
            aria-checked={c.checked}
            onClick={c.onClick}
            style={{
              width: '100%',
              display: 'grid',
              gridTemplateColumns: '12px minmax(0,1fr) auto',
              gap: 10,
              alignItems: 'center',
              padding: '7px 0',
              borderBottom: `1px solid ${C.rule2}`,
              fontSize: 12.5,
            }}
          >
            <span
              style={{ width: 10, height: 10, border: `1px solid ${C.ink}`, borderRadius: '50%', background: c.box }}
            />
            <span style={{ fontWeight: c.weight }}>{c.label}</span>
            <span style={s.monoNote}>{c.count}</span>
          </button>
        ))}
      </div>
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: C.ink3,
            borderBottom: `1px solid ${C.ink}`,
            paddingBottom: 6,
          }}
        >
          Years
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: 12,
            color: C.muted,
            marginTop: 10,
            flexWrap: 'wrap',
          }}
        >
          <YearRange
            from={v.hxFromTxt}
            to={v.hxToTxt}
            onFromDown={v.hxFromDown}
            onFromUp={v.hxFromUp}
            onToDown={v.hxToDown}
            onToUp={v.hxToUp}
          />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: C.ink3,
            borderBottom: `1px solid ${C.ink}`,
            paddingBottom: 6,
          }}
        >
          Display
        </div>
        <Segmented items={v.hxOrder} />
        <Checkbox
          checked={v.hxAfterA}
          box={v.hxAfterBg}
          onClick={v.toggleAfter}
          boxStyle={{ width: 13, height: 13, border: `1px solid ${C.ink}`, flex: 'none' }}
          style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12.5 }}
        >
          {v.hxAfterLabel}
        </Checkbox>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <button onClick={v.hxExpandAll} style={s.link125}>
            Expand all
          </button>
          <button onClick={v.hxCollapseAll} style={s.link125}>
            Collapse all
          </button>
          <button onClick={v.hxReset} style={s.link125}>
            Reset filters
          </button>
        </div>
      </div>
    </aside>
  );
}

function MedicationsAndTreatmentPeriods({ v }: { v: VM }) {
  return (
    <section aria-label="Medications and treatment periods" style={{ borderTop: `1px solid ${C.ink}`, paddingTop: 12 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: '6px 20px',
          alignItems: 'baseline',
        }}
      >
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 24, margin: 0 }}>
          Medications and treatment periods
        </h2>
        <span style={s.muted12}>
          Solid green: recorded by the snapshot date. Pale green: recorded afterward. The dark line marks the snapshot.
        </span>
      </div>
      <div style={{ marginTop: 12 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px,210px) minmax(0,1fr) minmax(90px,150px)',
            gap: '0 16px',
          }}
        >
          <span />
          <span style={{ position: 'relative', height: 16, display: 'block' }}>
            {v.treatTicks.map((t, i2) => (
              <span
                key={i2}
                style={{
                  position: 'absolute',
                  left: `${t.left}%`,
                  top: 0,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: C.ink3,
                }}
              >
                {t.label}
              </span>
            ))}
          </span>
          <span />
        </div>
        {v.treat.map((t, i3) => (
          <div
            key={i3}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px,210px) minmax(0,1fr) minmax(90px,150px)',
              gap: '0 16px',
              alignItems: 'center',
              padding: '7px 0',
              borderBottom: `1px solid ${C.rule2}`,
            }}
          >
            <span style={s.minW0}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: t.nameWeight }}>{t.name}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: C.ink3 }}>{t.dose}</span>
            </span>
            <span style={{ position: 'relative', height: 16, display: 'block' }}>
              <span style={{ position: 'absolute', left: 0, right: 0, top: 8, height: 1, background: C.rule2 }} />{' '}
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  height: 9,
                  left: `${t.left}%`,
                  width: `${t.width}%`,
                  background: C.green,
                }}
              />{' '}
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  height: 9,
                  left: `${t.lleft}%`,
                  width: `${t.lwidth}%`,
                  background: '#C3D2C0',
                  border: '1px solid #9DB59A',
                  boxSizing: 'border-box',
                }}
              />{' '}
              <span
                style={{ position: 'absolute', top: -6, bottom: -6, width: 2, left: `${t.snap}%`, background: C.ink }}
              />
            </span>
            <span style={{ fontSize: 12, color: C.ink2, textAlign: 'right' }}>
              <span style={{ display: 'block' }}>{t.period}</span>
              <span style={{ display: 'block', fontSize: 11, color: C.green }}>{t.act}</span>
              <span style={{ display: 'block', fontSize: 11, color: C.ink3 }}>{t.later}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Events({ v }: { v: VM }) {
  return (
    <section aria-label="Events" style={{ marginTop: 36 }}>
      {v.hxRows.map((r, i4) => (
        <Fragment key={i4}>
          {r.isYear && (
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                borderTop: `1px solid ${C.ink}`,
                padding: '22px 0 6px',
                marginTop: 10,
              }}
            >
              <span style={{ fontFamily: SERIF, fontSize: 40, lineHeight: 1, fontVariantNumeric: 'lining-nums' }}>
                {r.year}
              </span>
              <span style={s.meta12}>{r.count}</span>
            </div>
          )}{' '}
          {r.isSnap && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
              <span
                style={{
                  background: C.green,
                  color: '#FFFFFF',
                  fontFamily: MONO,
                  fontSize: 11.5,
                  fontWeight: 500,
                  padding: '4px 8px',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.label}
              </span>
              <span style={{ flex: 1, height: 2, background: C.green }} />
              <span style={{ fontSize: 12, color: C.green, whiteSpace: 'nowrap' }}>{r.sub}</span>
            </div>
          )}{' '}
          {r.isEv && (
            <div style={{ borderBottom: `1px solid ${C.rule2}` }}>
              <button
                onClick={r.onToggle}
                aria-expanded={r.expanded}
                className="row-hover"
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '96px 18px minmax(0,1fr) auto 16px',
                  gap: 12,
                  alignItems: 'start',
                  padding: '12px 4px',
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink2, paddingTop: 3 }}>{r.date}</span>
                <span style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
                  <span
                    style={{
                      width: `${r.gw}px`,
                      height: `${r.gh}px`,
                      borderRadius: r.gr,
                      background: r.gbg,
                      border: r.gbd,
                      transform: `rotate(${r.grot}deg)`,
                      flex: 'none',
                    }}
                  />
                </span>
                <span style={s.minW0}>
                  <span style={s.kicker}>{r.type}</span>
                  <span style={{ display: 'block', fontSize: 15, marginTop: 2, color: r.titleColor }}>{r.title}</span>
                  <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>{r.source}</span>
                </span>
                <span style={{ fontSize: 12, color: r.statusColor, textAlign: 'right', paddingTop: 3 }}>
                  {r.status}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 15, color: C.ink }}>{r.sign}</span>
              </button>
              {r.isOpen && (
                <div style={{ padding: '2px 4px 22px clamp(0px,9vw,130px)' }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: C.ink2,
                      maxWidth: 720,
                      textWrap: 'pretty',
                    }}
                  >
                    {r.note}
                  </p>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))',
                      gap: '12px 24px',
                      marginTop: 14,
                    }}
                  >
                    {r.fields.map((f, i5) => (
                      <div key={i5} style={s.minW0}>
                        <div style={s.meta115}>{f.k}</div>
                        <div style={{ fontSize: 13, marginTop: 2 }}>{f.v}</div>
                      </div>
                    ))}
                  </div>
                  {r.hasResults && (
                    <div style={{ marginTop: 16 }}>
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
                        {r.resultsTitle}
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))',
                          gap: '0 24px',
                        }}
                      >
                        {r.results.map((x, i6) => (
                          <button
                            key={i6}
                            onClick={x.onClick}
                            className="row-hover"
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0,1fr) auto 18px',
                              gap: 8,
                              padding: '7px 0',
                              borderBottom: `1px solid ${C.rule2}`,
                              alignItems: 'baseline',
                            }}
                          >
                            <span style={{ fontSize: 12.5 }}>
                              <span style={{ display: 'block' }}>{x.name}</span>
                              <span style={{ display: 'block', fontSize: 11, color: C.ink3 }}>{x.ref}</span>
                            </span>
                            <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{x.value}</span>
                            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500, color: C.rust }}>
                              {x.flag}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', marginTop: 16, fontSize: 13 }}>
                    {r.hasDoc && (
                      <button
                        onClick={r.onDoc}
                        style={{ fontSize: 13, color: C.green, borderBottom: `1px solid ${C.green}` }}
                      >
                        Open original document
                      </button>
                    )}
                    <button onClick={r.onSnap} style={s.link13}>
                      Set snapshot to this date
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Fragment>
      ))}{' '}
      {v.hxEmpty && (
        <p style={{ fontSize: 14, color: C.ink2, borderTop: `1px solid ${C.ink}`, paddingTop: 16 }}>
          No events match these filters.{' '}
          <button onClick={v.hxReset} style={{ fontSize: 14, borderBottom: `1px solid ${C.ink}` }}>
            Reset filters
          </button>
        </p>
      )}
    </section>
  );
}

export function HistoryScreen() {
  const store = useStore();
  const v: VM = { ...shellVM(store), ...historyVM(store) };
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
          Medical history
        </h1>
        <span style={s.body13}>{v.hxCountText}</span>
      </div>
      <div
        style={{
          marginTop: 22,
          borderTop: `1px solid ${C.ink}`,
          borderBottom: `1px solid ${C.rule}`,
          padding: '12px 0 6px',
        }}
      >
        <ChartFrame style={{ width: '100%', minHeight: 290, overflow: 'hidden' }}>
          {(w) => <Timeline width={w} cur={v.cur} />}
        </ChartFrame>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px 48px', marginTop: 28, alignItems: 'flex-start' }}>
        <Filters v={v} />
        <div style={{ flex: '1 1 640px', minWidth: 0 }}>
          <MedicationsAndTreatmentPeriods v={v} />
          <Events v={v} />
        </div>
      </div>
      <Footer />
    </main>
  );
}
