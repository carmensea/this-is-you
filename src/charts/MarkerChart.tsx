import type { ReactElement } from 'react';
import { useState } from 'react';
import { fMY, fShort, toT } from '../domain/dates';
import { USER_ENTERED, fmtR, niceTicks, refText } from '../domain/format';
import type { LabResult, Marker, ISODate } from '../domain/types';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { gapLabel, hatchDef, overviewDomain, xAxis } from './scale';

export function MarkerChart({ width, m, cur, selR }: { width: number; m: Marker; cur: ISODate; selR: LabResult }) {
  const store = useStore(),
    archive = store.archive;
  const [hover, setHover] = useState<number | null>(null);
  const isVis = store.isVisible;
  const W = width,
    H = 300,
    L = 52,
    R = 18,
    T = 30,
    B = 30;
  const ct = toT(cur),
    [T0, T1] = overviewDomain(store, ct);
  const x = (t: number) => L + ((t - T0) / (T1 - T0)) * (W - L - R);
  const all = m.results.filter((r) => r.unit === m.unit);
  const hidden = store.state.future === 'hidden';
  const vals: number[] = [];
  all.forEach((r) => {
    vals.push(r.value);
    if (r.hi != null) vals.push(r.hi);
    if (r.lo != null) vals.push(r.lo);
  });
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1;
  lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  hi += pad;
  const nt = niceTicks(lo, hi, 5);
  const y = (v: number) => T + (1 - (v - nt.a) / (nt.b - nt.a)) * (H - T - B);
  const k: ReactElement[] = [
    <defs key="d">
      {hatchDef('bm-hatch')}
      <clipPath id="bm-clip">
        <rect x={L} y={0} width={W - L - R} height={H} />
      </clipPath>
    </defs>,
  ];
  const band: ReactElement[] = [];
  all.forEach((r, i) => {
    if (r.hi == null && r.lo == null) return; // No printed range: no band.
    const t = toT(r.date),
      tp = i ? toT(all[i - 1].date) : t - 0.6,
      tn = i < all.length - 1 ? toT(all[i + 1].date) : t + 0.6;
    const a = i ? (t + tp) / 2 : tp,
      b = i < all.length - 1 ? (t + tn) / 2 : tn;
    const yt = y(r.hi != null ? r.hi : nt.b),
      yb = y(r.lo != null ? r.lo : nt.a);
    band.push(<rect key={'b' + i} x={x(a)} y={yt} width={Math.max(0, x(b) - x(a))} height={yb - yt} fill={C.greenT} />);
    if (r.hi != null)
      band.push(
        <line key={'bh' + i} x1={x(a)} x2={x(b)} y1={yt} y2={yt} stroke={C.green} strokeWidth={1} opacity={0.55} />,
      );
    if (r.lo != null)
      band.push(
        <line key={'bl' + i} x1={x(a)} x2={x(b)} y1={yb} y2={yb} stroke={C.green} strokeWidth={1} opacity={0.55} />,
      );
  });
  k.push(
    <g key="band" clipPath="url(#bm-clip)">
      {band}
    </g>,
  );
  nt.t.forEach((v) => {
    k.push(
      <line key={'yg' + v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.rule2} strokeWidth={1} opacity={0.9} />,
    );
    k.push(
      <text key={'yl' + v} x={L - 8} y={y(v) + 4} textAnchor="end" fontFamily={MONO} fontSize={11} fill={C.ink3}>
        {String(v)}
      </text>,
    );
  });
  k.push(
    <text key="unit" x={L} y={14} fontFamily={MONO} fontSize={11} fill={C.ink2}>
      {m.unit}
    </text>,
  );
  xAxis(k, x, T0, T1, W, L, R, H - B, 'bm');
  const lines: ReactElement[] = [];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1],
      b = all[i],
      ta = toT(a.date),
      tb = toT(b.date);
    if (tb - ta > 2.2) {
      const xa = x(ta) + 10,
        xb = x(tb) - 10;
      lines.push(
        <rect
          key={'gh' + i}
          x={xa}
          y={T}
          width={Math.max(0, xb - xa)}
          height={H - T - B}
          fill="url(#bm-hatch)"
          opacity={0.7}
        />,
      );
      const gl = gapLabel(archive.draws, a.date, b.date);
      if (xb - xa > 150) {
        lines.push(<rect key={'gr' + i} x={(xa + xb) / 2 - 74} y={T + 8} width={148} height={20} fill={C.paper} />);
        lines.push(
          <text
            key={'gt' + i}
            x={(xa + xb) / 2}
            y={T + 22}
            textAnchor="middle"
            fontFamily={SERIF}
            fontStyle="italic"
            fontSize={13}
            fill={C.ink2}
          >
            {gl}
          </text>,
        );
      }
    } else if (!(hidden && !isVis(b)))
      lines.push(
        <line key={'ln' + i} x1={x(ta)} x2={x(tb)} y1={y(a.value)} y2={y(b.value)} stroke={C.ink} strokeWidth={1.25} />,
      );
  }
  k.push(
    <g key="lines" clipPath="url(#bm-clip)">
      {lines}
    </g>,
  );
  const xc = x(ct);
  if (xc < W - R) {
    k.push(
      <rect
        key="fut"
        x={Math.max(L, xc)}
        y={T - 10}
        width={Math.max(0, W - R - Math.max(L, xc))}
        height={H - B - T + 10}
        fill={C.paper}
        opacity={hidden ? 1 : 0.72}
      />,
    );
    if (hidden && W - R - xc > 120)
      k.push(
        <text
          key="futl"
          x={xc + (W - R - xc) / 2}
          y={(T + H - B) / 2}
          textAnchor="middle"
          fontFamily={SERIF}
          fontStyle="italic"
          fontSize={14}
          fill={C.ink3}
        >
          {'After the snapshot date'}
        </text>,
      );
  }
  const pts: ReactElement[] = [];
  all.forEach((r, i) => {
    const t = toT(r.date);
    if (t < T0 || t > T1) return;
    const px = x(t),
      py = y(r.value),
      v = isVis(r);
    if (hidden && !v) return;
    if (selR && selR.i === r.i)
      pts.push(<circle key="sel" cx={px} cy={py} r={9} fill="none" stroke={C.green} strokeWidth={1.75} />);
    if (!v) pts.push(<circle key={'p' + i} cx={px} cy={py} r={3.5} fill={C.paper} stroke={C.ink3} strokeWidth={1.3} />);
    else if (r.flag) {
      pts.push(<rect key={'p' + i} x={px - 4} y={py - 4} width={8} height={8} fill={C.rust} />);
      pts.push(
        <text
          key={'f' + i}
          x={px}
          y={py - 9}
          textAnchor="middle"
          fontFamily={MONO}
          fontSize={10}
          fontWeight={500}
          fill={C.rust}
        >
          {r.flag}
        </text>,
      );
    } else pts.push(<circle key={'p' + i} cx={px} cy={py} r={4} fill={C.ink} />);
    if (selR && selR.i === r.i)
      pts.push(
        <text key="sv" x={px + 12} y={py + 4} fontFamily={MONO} fontSize={12} fontWeight={500} fill={C.ink}>
          {fmtR(r)}
        </text>,
      );
    pts.push(
      <circle
        key={'hit' + i}
        cx={px}
        cy={py}
        r={12}
        fill="transparent"
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHover(r.i)}
        onMouseLeave={() => setHover(null)}
        onClick={() => store.setState({ sel: r.i })}
      >
        <title>{fShort(r.date) + ': ' + fmtR(r) + ' ' + m.unit + (r.flag ? ', flagged ' + r.flag : '')}</title>
      </circle>,
    );
  });
  if (xc >= L && xc <= W - R) {
    k.push(<line key="cur" x1={xc} x2={xc} y1={T - 14} y2={H - B} stroke={C.green} strokeWidth={1.5} />);
    k.push(
      <text
        key="curl"
        x={xc > W - 120 ? xc - 6 : xc + 6}
        y={T - 4}
        textAnchor={xc > W - 120 ? 'end' : 'start'}
        fontFamily={MONO}
        fontSize={10.5}
        fill={C.green}
      >
        {'Snapshot ' + fMY(cur)}
      </text>,
    );
  }
  k.push(<g key="pts">{pts}</g>);
  let tip = null;
  const hr = all.find((r) => r.i === hover);
  if (hr) {
    const px = x(toT(hr.date)),
      py = y(hr.value),
      left = Math.max(0, Math.min(W - 220, px - 110)),
      top = py > 150 ? py - 112 : py + 18;
    tip = (
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width: 220,
          background: C.paper,
          border: '1px solid ' + C.ink,
          padding: '8px 10px',
          fontFamily: SANS,
          fontSize: 12,
          color: C.ink,
          pointerEvents: 'none',
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.ink2 }}>{fShort(hr.date)}</div>
        <div style={{ fontSize: 15, fontWeight: 500, margin: '2px 0' }}>
          {fmtR(hr) + ' ' + m.unit + (hr.flag ? '  ' + hr.flag : '')}
        </div>
        <div style={{ color: C.ink2 }}>{'Range on report: ' + refText(hr)}</div>
        {hr.userEntered && <div style={{ color: C.ink2 }}>{USER_ENTERED}</div>}
        <div style={{ color: C.ink2 }}>{archive.labs[hr.lab]}</div>
        {!isVis(hr) ? (
          <div style={{ color: C.rust }}>{hr.date > cur ? 'Collected after snapshot' : 'Reported after snapshot'}</div>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <svg
        width={W}
        height={H}
        style={{ display: 'block' }}
        role="img"
        aria-label={m.name + ' results over time with reference ranges'}
      >
        {k}
      </svg>
      {tip}
    </div>
  );
}
