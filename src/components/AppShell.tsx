import { C, MONO, SERIF } from '../theme';
import { s } from './styles';
import { shellVM } from '../viewmodels/shell';
type VM = ReturnType<typeof shellVM>;
export function Header({ v }: { v: VM }) {
  return (
    <header style={{ borderBottom: `1px solid ${C.rule}` }}>
      <div
        style={{
          maxWidth: 1480,
          margin: '0 auto',
          padding: '0 var(--gutter)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'stretch',
          columnGap: 44,
          minHeight: 60,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, alignSelf: 'center', padding: '12px 0' }}>
          <span style={{ fontFamily: SERIF, fontSize: 25, fontWeight: 500, letterSpacing: '-0.01em' }}>
            This Is You
          </span>
          <span style={s.meta12}>Personal health archive</span>
        </div>
        <nav aria-label="Primary" style={{ display: 'flex', gap: 28, overflowX: 'auto' }}>
          {v.nav.map((n, i10) => (
            <button
              key={i10}
              onClick={n.onClick}
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: n.color,
                borderBottom: `2px solid ${n.border}`,
                padding: '0 0 2px',
                whiteSpace: 'nowrap',
              }}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 20, padding: '12px 0' }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>Archive: {v.patientName} (sample)</span>
          <button
            onClick={v.openSettings}
            style={{ fontSize: 13, color: C.muted, borderBottom: `1px solid ${C.faint}` }}
          >
            Settings
          </button>
        </div>
      </div>
    </header>
  );
}
export function DemoBanner() {
  return (
    <div style={{ background: C.banner, borderBottom: `1px solid ${C.rule}` }}>
      <div
        style={{
          maxWidth: 1480,
          margin: '0 auto',
          padding: '8px var(--gutter)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 16px',
          alignItems: 'baseline',
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500, letterSpacing: '0.08em' }}>
          DEMONSTRATION DATA
        </span>
        <span style={s.body125}>
          Every person, provider, value and document in this prototype is fictional. Nothing here describes a real
          patient or offers medical interpretation.
        </span>
      </div>
    </div>
  );
}
export function Notice({ v }: { v: VM }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.rule}` }}>
      <div
        style={{
          maxWidth: 1480,
          margin: '0 auto',
          padding: '10px var(--gutter)',
          display: 'flex',
          gap: 16,
          alignItems: 'baseline',
          fontSize: 13,
          color: C.ink2,
        }}
      >
        <span>{v.noticeText}</span>
        <button onClick={v.closeNotice} style={{ fontSize: 13, color: C.ink, borderBottom: `1px solid ${C.ink}` }}>
          Back to Overview
        </button>
      </div>
    </div>
  );
}
export function SnapshotBar({ v }: { v: VM }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.rule}` }}>
      <div
        style={{
          maxWidth: 1480,
          margin: '0 auto',
          padding: '12px var(--gutter)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px 28px',
        }}
      >
        <nav
          aria-label="Breadcrumb"
          style={{ display: 'flex', gap: 8, fontSize: 13, color: C.muted, alignItems: 'baseline' }}
        >
          {v.hasReturn && (
            <button
              onClick={v.goBack}
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: C.green,
                borderBottom: `1px solid ${C.green}`,
                marginRight: 14,
              }}
            >
              ‹ Back to {v.returnLabel}
            </button>
          )}
          <button onClick={v.goOverview} style={{ fontSize: 13, borderBottom: `1px solid ${C.faint}` }}>
            Overview
          </button>
          <span>/</span>
          <span style={{ color: C.ink }}>{v.crumb}</span>
        </nav>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={s.eyebrow}>Record as of</span>
          <span style={{ fontFamily: SERIF, fontSize: 23 }}>{v.curLong}</span>
        </div>
        <div
          role="group"
          aria-label="Move snapshot date"
          style={{ display: 'flex', gap: 1, background: C.ink, border: `1px solid ${C.ink}` }}
        >
          <button onClick={v.stepYB} style={s.stepBtn9}>
            − 1 yr
          </button>
          <button onClick={v.stepMB} style={s.stepBtn9}>
            − 1 mo
          </button>
          <button onClick={v.stepMF} style={s.stepBtn9}>
            + 1 mo
          </button>
          <button onClick={v.stepYF} style={s.stepBtn9}>
            + 1 yr
          </button>
          <button onClick={v.goToday} style={s.stepBtn9}>
            Today
          </button>
        </div>
        <div
          role="group"
          aria-label="Snapshot mode"
          style={{ display: 'flex', border: `1px solid ${C.ink}`, marginLeft: 'auto' }}
        >
          <button
            onClick={v.setKnown}
            aria-pressed={v.knownPressed}
            style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 500, background: v.knownBg, color: v.knownFg }}
          >
            As known then
          </button>
          <button
            onClick={v.setNow}
            aria-pressed={v.nowPressed}
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              fontWeight: 500,
              borderLeft: `1px solid ${C.ink}`,
              background: v.nowBg,
              color: v.nowFg,
            }}
          >
            As understood now
          </button>
        </div>
      </div>
    </div>
  );
}
