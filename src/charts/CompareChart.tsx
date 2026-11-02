import type { ReactElement } from 'react';
import { useState } from 'react';
import { fShort, toT } from '../domain/dates';
import { USER_ENTERED, fmtR, niceTicks, refText } from '../domain/format';
import type { LabResult, Marker, ISODate } from '../domain/types';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { gapLabel, hatchDef, xAxis } from './scale';

export function CompareChart({
  width,
  m,
  A,
  B,
  vB,
  ra,
  rb,
}: {
  width: number;
  m: Marker;
  A: ISODate;
  B: ISODate;
  vB: (r: LabResult) => boolean;
  ra?: LabResult;
  rb?: LabResult;
}) {
  const store = useStore(),
    archive = store.archive;
  const { chartStart: T0A, chartEnd: T1A } = archive;
  const [hover, setHover] = useState<number | null>(null);
  const W = width,
    H = 380,
    L = 60,
    R = 24,
    T = 56,
    Bm = 34;
  const x = (t: number) => L + ((t - T0A) / (T1A - T0A)) * (W - L - R);
  const unit = (rb || ra || { unit: m.unit }).unit,
    series = m.results.filter((r) => r.unit === unit);
  const vals: number[] = [];
  series.forEach((r) => {
    vals.push(r.value);
    if (r.hi != null) vals.push(r.hi);
    if (r.lo != null) vals.push(r.lo);
  });
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.12,
    nt = niceTicks(lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad, 5),
    y = (v: number) => T + (1 - (v - nt.a) / (nt.b - nt.a)) * (H - T - Bm);
  const k: ReactElement[] = [
    <defs key="d">
      {hatchDef('cc-hatch')}
      <clipPath id="cc-clip">
        <rect x={L} y={0} width={W - L - R} height={H} />
      </clipPath>
    </defs>,
  ];
  const xa = x(toT(A)),
    xb = x(toT(B));
  k.push(<rect key="span" x={xa} y={T - 8} width={Math.max(0, xb - xa)} height={H - Bm - T + 8} fill="#EFEBE2" />);
  const band: ReactElement[] = [];
  series.forEach((r, i) => {
    if (r.hi == null && r.lo == null) return; // No printed range: no band.
    const t = toT(r.date),
      tp = i ? toT(series[i - 1].date) : t - 0.6,
      tn = i < series.length - 1 ? toT(series[i + 1].date) : t + 0.6;
    const a = i ? (t + tp) / 2 : tp,
      b = i < series.length - 1 ? (t + tn) / 2 : tn;
    const yt = y(r.hi != null ? Math.min(r.hi, nt.b) : nt.b),
      yb = y(r.lo != null ? Math.max(r.lo, nt.a) : nt.a);
    if (yb > yt)
      band.push(
        <rect
          key={'b' + i}
          x={x(a)}
          y={yt}
          width={Math.max(0, x(b) - x(a))}
          height={yb - yt}
          fill={C.greenT}
          opacity={0.75}
        />,
      );
    if (r.hi != null && r.hi <= nt.b)
      band.push(<line key={'bh' + i} x1={x(a)} x2={x(b)} y1={y(r.hi)} y2={y(r.hi)} stroke={C.green} opacity={0.6} />);
    if (r.lo != null && r.lo >= nt.a)
      band.push(<line key={'bl' + i} x1={x(a)} x2={x(b)} y1={y(r.lo)} y2={y(r.lo)} stroke={C.green} opacity={0.6} />);
  });
  k.push(
    <g key="band" clipPath="url(#cc-clip)">
      {band}
    </g>,
  );
  nt.t.forEach((v) => {
    k.push(<line key={'yg' + v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.rule2} />);
    k.push(
      <text key={'yl' + v} x={L - 10} y={y(v) + 4} textAnchor="end" fontFamily={MONO} fontSize={11} fill={C.ink3}>
        {String(v)}
      </text>,
    );
  });
  k.push(
    <text key="unit" x={L - 10} y={T - 26} textAnchor="end" fontFamily={MONO} fontSize={11.5} fill={C.ink2}>
      {unit}
    </text>,
  );
  xAxis(k, x, T0A, T1A, W, L, R, H - Bm, 'cc');
  if (m.method) {
    const tm = x(toT(m.method.date));
    k.push(<line key="mth" x1={tm} x2={tm} y1={T - 8} y2={H - Bm} stroke={C.ink} strokeDasharray="4 3" />);
    k.push(
      <text key="mtht" x={tm + 6} y={T + 6} fontFamily={MONO} fontSize={10.5} fill={C.ink}>
        {m.method.label}
      </text>,
    );
  }
  const ln: ReactElement[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1],
      b = series[i],
      ta = toT(a.date),
      tb = toT(b.date);
    if (tb - ta > 2.2) {
      const ga = x(ta) + 10,
        gb = x(tb) - 10;
      ln.push(
        <rect
          key={'gh' + i}
          x={ga}
          y={T}
          width={Math.max(0, gb - ga)}
          height={H - T - Bm}
          fill="url(#cc-hatch)"
          opacity={0.7}
        />,
      );
      if (gb - ga > 150) {
        ln.push(<rect key={'gr' + i} x={(ga + gb) / 2 - 76} y={T + 10} width={152} height={20} fill={C.paper} />);
        ln.push(
          <text
            key={'gt' + i}
            x={(ga + gb) / 2}
            y={T + 24}
            textAnchor="middle"
            fontFamily={SERIF}
            fontStyle="italic"
            fontSize={13}
            fill={C.ink2}
          >
            {gapLabel(archive.draws, a.date, b.date)}
          </text>,
        );
      }
    } else
      ln.push(
        <line key={'l' + i} x1={x(ta)} x2={x(tb)} y1={y(a.value)} y2={y(b.value)} stroke={C.ink} strokeWidth={1.3} />,
      );
  }
  k.push(
    <g key="ln" clipPath="url(#cc-clip)">
      {ln}
    </g>,
  );
  if (xb < W - R)
    k.push(
      <rect key="fut" x={xb} y={T - 8} width={W - R - xb} height={H - Bm - T + 8} fill={C.paper} opacity={0.62} />,
    );
  (
    [
      [xa, 'A', A, ra, T - 34],
      [xb, 'B', B, rb, T - 18],
    ] as [number, string, ISODate, LabResult | undefined, number][]
  ).forEach(([xx, l, d, r, ly]) => {
    k.push(<line key={'s' + l} x1={xx} x2={xx} y1={ly - 10} y2={H - Bm} stroke={C.green} strokeWidth={2} />);
    const right = xx > W - 200;
    k.push(
      <text
        key={'st' + l}
        x={right ? xx - 6 : xx + 6}
        y={ly}
        textAnchor={right ? 'end' : 'start'}
        fontFamily={MONO}
        fontSize={11}
        fontWeight={500}
        fill={C.green}
      >
        {l + '  ' + fShort(d)}
      </text>,
    );
    if (r && r.unit === unit) {
      const xr = x(toT(r.date));
      if (Math.abs(xx - xr) > 3) {
        k.push(
          <line
            key={'br' + l}
            x1={xr}
            x2={xx}
            y1={H - Bm - 5}
            y2={H - Bm - 5}
            stroke={C.green}
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />,
        );
        k.push(<circle key={'bt' + l} cx={xr} cy={H - Bm - 5} r={2.5} fill={C.green} />);
      }
    }
  });
  const pts: ReactElement[] = [];
  series.forEach((r) => {
    const px = x(toT(r.date)),
      py = y(r.value),
      vz = vB(r),
      used = (ra && ra.i === r.i) || (rb && rb.i === r.i);
    if (used) pts.push(<circle key={'u' + r.i} cx={px} cy={py} r={10} fill="none" stroke={C.green} strokeWidth={2} />);
    if (!vz)
      pts.push(<circle key={'p' + r.i} cx={px} cy={py} r={4} fill={C.paper} stroke={C.ink3} strokeWidth={1.4} />);
    else if (r.flag) pts.push(<rect key={'p' + r.i} x={px - 4.5} y={py - 4.5} width={9} height={9} fill={C.rust} />);
    else pts.push(<circle key={'p' + r.i} cx={px} cy={py} r={4.5} fill={C.ink} />);
    if (used || r.flag)
      pts.push(
        <text
          key={'v' + r.i}
          x={px}
          y={py - 13}
          textAnchor="middle"
          fontFamily={MONO}
          fontSize={used ? 12 : 10.5}
          fontWeight={500}
          fill={r.flag ? C.rust : C.ink}
        >
          {(used ? (ra && ra.i === r.i ? 'A ' : '') + (rb && rb.i === r.i ? 'B ' : '') : '') +
            fmtR(r) +
            (r.flag ? ' ' + r.flag : '')}
        </text>,
      );
    pts.push(
      <circle
        key={'h' + r.i}
        cx={px}
        cy={py}
        r={13}
        fill="transparent"
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHover(r.i)}
        onMouseLeave={() => setHover(null)}
        onClick={() => store.openDrawDocument(r.i)}
      >
        <title>{fShort(r.date) + ': ' + fmtR(r) + ' ' + r.unit + '. Click to open the report.'}</title>
      </circle>,
    );
  });
  k.push(<g key="pts">{pts}</g>);
  let tip = null;
  const hr = series.find((r) => r.i === hover);
  if (hr) {
    const px = x(toT(hr.date)),
      py = y(hr.value);
    tip = (
      <div
        style={{
          position: 'absolute',
          left: Math.max(0, Math.min(W - 240, px - 120)),
          top: py > 170 ? py - 120 : py + 20,
          width: 240,
          background: C.paper,
          border: '1px solid ' + C.ink,
          padding: '9px 11px',
          fontFamily: SANS,
          fontSize: 12,
          color: C.ink,
          pointerEvents: 'none',
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.ink2 }}>
          {fShort(hr.date) + ', ' + archive.labs[hr.lab]}
        </div>
        <div style={{ fontSize: 16, fontWeight: 500, margin: '2px 0' }}>
          {fmtR(hr) + ' ' + hr.unit + (hr.flag ? '  ' + hr.flag : '')}
        </div>
        <div style={{ color: C.ink2 }}>{'Range on report: ' + refText(hr)}</div>
        {hr.userEntered && <div style={{ color: C.ink2 }}>{USER_ENTERED}</div>}
        <div style={{ color: C.ink3 }}>{'Click to open the report'}</div>
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
        aria-label={m.name + ' history with snapshots A and B'}
      >
        {k}
      </svg>
      {tip}
    </div>
  );
}
