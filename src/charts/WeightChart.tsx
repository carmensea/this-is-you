import type { ReactElement } from 'react';
import { useState } from 'react';
import { fShort, toT } from '../domain/dates';
import { niceTicks } from '../domain/format';
import type { WeightReading, ISODate } from '../domain/types';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { hatchDef, overviewDomain, xAxis } from './scale';

export function WeightChart({ width, cur, lb }: { width: number; cur: ISODate; lb: boolean }) {
  const store = useStore(),
    archive = store.archive;
  const [hover, setHover] = useState<number | null>(null);
  const wIsVis = (w: WeightReading) => w.date <= cur;
  const W = width,
    H = 220,
    L = 52,
    R = 18,
    T = 24,
    B = 30;
  const ct = toT(cur),
    [T0, T1] = overviewDomain(store, ct);
  const x = (t: number) => L + ((t - T0) / (T1 - T0)) * (W - L - R);
  const conv = (v: number) => (lb ? v * 2.20462 : v);
  const unit = lb ? 'lb' : 'kg';
  const hidden = store.state.future === 'hidden';
  const inD = archive.weight.filter((w) => {
    const t = toT(w.date);
    return t >= T0 && t <= T1;
  });
  const vs = (inD.length ? inD : archive.weight).map((w) => conv(w.v));
  let lo = Math.min(...vs),
    hi = Math.max(...vs);
  const pad = Math.max(0.5, (hi - lo) * 0.1);
  const nt = niceTicks(lo - pad, hi + pad, 4);
  const y = (v: number) => T + (1 - (v - nt.a) / (nt.b - nt.a)) * (H - T - B);
  const k: ReactElement[] = [<defs key="d">{hatchDef('wt-hatch')}</defs>];
  nt.t.forEach((v) => {
    k.push(<line key={'yg' + v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.rule2} />);
    k.push(
      <text key={'yl' + v} x={L - 8} y={y(v) + 4} textAnchor="end" fontFamily={MONO} fontSize={11} fill={C.ink3}>
        {String(v)}
      </text>,
    );
  });
  k.push(
    <text key="unit" x={L} y={12} fontFamily={MONO} fontSize={11} fill={C.ink2}>
      {unit}
    </text>,
  );
  xAxis(k, x, T0, T1, W, L, R, H - B, 'wt');
  [
    [archive.gaps[0][0], archive.gaps[0][1], 'No records in archive'],
    ['2022-06-02', '2022-11-20', 'No scale readings'],
  ].forEach(([a, b, l], i) => {
    const xa = Math.max(L, x(toT(a))),
      xb = Math.min(W - R, x(toT(b)));
    if (xb <= xa) return;
    k.push(<rect key={'g' + i} x={xa} y={T} width={xb - xa} height={H - T - B} fill="url(#wt-hatch)" opacity={0.8} />);
    if (xb - xa > 150)
      k.push(
        <text
          key={'gt' + i}
          x={(xa + xb) / 2}
          y={T + 16}
          textAnchor="middle"
          fontFamily={SERIF}
          fontStyle="italic"
          fontSize={13}
          fill={C.ink2}
        >
          {l}
        </text>,
      );
  });
  const dots: ReactElement[] = [];
  inD.forEach((w, i) => {
    const v = wIsVis(w);
    if (hidden && !v) return;
    const px = x(toT(w.date)),
      py = y(conv(w.v));
    if (w.src === 'clinic')
      dots.push(
        <rect
          key={'c' + i}
          x={px - 3.5}
          y={py - 3.5}
          width={7}
          height={7}
          fill={C.paper}
          stroke={v ? C.ink : C.ink3}
          strokeWidth={1.3}
        />,
      );
    else
      dots.push(<circle key={'s' + i} cx={px} cy={py} r={1.7} fill={v ? C.ink2 : C.ink3} opacity={v ? 0.85 : 0.5} />);
  });
  k.push(<g key="dots">{dots}</g>);
  const xc = x(ct);
  if (xc < W - R)
    k.push(
      <rect
        key="fut"
        x={Math.max(L, xc)}
        y={T - 6}
        width={Math.max(0, W - R - Math.max(L, xc))}
        height={H - B - T + 6}
        fill={C.paper}
        opacity={hidden ? 1 : 0.62}
      />,
    );
  if (xc >= L && xc <= W - R)
    k.push(<line key="cur" x1={xc} x2={xc} y1={T - 10} y2={H - B} stroke={C.green} strokeWidth={1.5} />);
  let tip = null;
  const hw = hover != null ? inD[hover] : null;
  if (hw && !(hidden && !wIsVis(hw))) {
    const px = x(toT(hw.date)),
      py = y(conv(hw.v));
    k.push(<circle key="hw" cx={px} cy={py} r={6} fill="none" stroke={C.green} strokeWidth={1.5} />);
    tip = (
      <div
        style={{
          position: 'absolute',
          left: Math.max(0, Math.min(W - 200, px - 100)),
          top: py > 110 ? py - 78 : py + 14,
          width: 200,
          background: C.paper,
          border: '1px solid ' + C.ink,
          padding: '7px 10px',
          fontFamily: SANS,
          fontSize: 12,
          pointerEvents: 'none',
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.ink2 }}>{fShort(hw.date)}</div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{conv(hw.v).toFixed(1) + ' ' + unit}</div>
        <div style={{ color: C.ink2 }}>
          {hw.src === 'clinic' ? 'Clinic visit measurement' : 'Smart scale, VeSync export'}
        </div>
      </div>
    );
  }
  k.push(
    <rect
      key="hit"
      x={L}
      y={T}
      width={W - L - R}
      height={H - T - B}
      fill="transparent"
      onMouseMove={(e) => {
        const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
        const px = e.clientX - r.left;
        let bi = null,
          bd = 14;
        inD.forEach((w, i) => {
          const d = Math.abs(x(toT(w.date)) - px);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        });
        if (bi !== hover) setHover(bi);
      }}
      onMouseLeave={() => setHover(null)}
    />,
  );
  return (
    <div style={{ position: 'relative' }}>
      <svg width={W} height={H} style={{ display: 'block' }} role="img" aria-label="Weight readings over time">
        {k}
      </svg>
      {tip}
    </div>
  );
}
