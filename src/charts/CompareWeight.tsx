import { type ReactElement } from 'react';
import { fShort, toT } from '../domain/dates';
import { niceTicks } from '../domain/format';
import type { WeightReading, ISODate } from '../domain/types';
import { useStore } from '../state/useStore';
import { C, MONO, SERIF } from '../theme';
import { hatchDef, xAxis } from './scale';

export function CompareWeight({
  width,
  A,
  B,
  wa,
  wb,
  lb,
}: {
  width: number;
  A: ISODate;
  B: ISODate;
  wa?: WeightReading;
  wb?: WeightReading;
  lb: boolean;
}) {
  const store = useStore(),
    archive = store.archive;
  const { chartStart: T0A, chartEnd: T1A } = archive;
  const W = width,
    H = 230,
    L = 60,
    R = 24,
    T = 40,
    Bm = 30;
  const x = (t: number) => L + ((t - T0A) / (T1A - T0A)) * (W - L - R);
  const conv = (v: number) => (lb ? v * 2.20462 : v),
    unit = lb ? 'lb' : 'kg';
  const vs = archive.weight.map((w) => conv(w.v));
  const lo = Math.min(...vs),
    hi = Math.max(...vs),
    pad = (hi - lo) * 0.1;
  const nt = niceTicks(lo - pad, hi + pad, 4),
    y = (v: number) => T + (1 - (v - nt.a) / (nt.b - nt.a)) * (H - T - Bm);
  const k: ReactElement[] = [<defs key="d">{hatchDef('cw-hatch')}</defs>];
  const xa = x(toT(A)),
    xb = x(toT(B));
  k.push(<rect key="span" x={xa} y={T - 6} width={Math.max(0, xb - xa)} height={H - Bm - T + 6} fill="#EFEBE2" />);
  nt.t.forEach((v) => {
    k.push(<line key={'yg' + v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.rule2} />);
    k.push(
      <text key={'yl' + v} x={L - 10} y={y(v) + 4} textAnchor="end" fontFamily={MONO} fontSize={11} fill={C.ink3}>
        {String(v)}
      </text>,
    );
  });
  k.push(
    <text key="unit" x={L - 10} y={T - 14} textAnchor="end" fontFamily={MONO} fontSize={11.5} fill={C.ink2}>
      {unit}
    </text>,
  );
  xAxis(k, x, T0A, T1A, W, L, R, H - Bm, 'cw');
  [
    [archive.gaps[0][0], archive.gaps[0][1], 'No records in archive'],
    ['2022-06-02', '2022-11-20', 'No scale readings'],
  ].forEach(([a, b, l], i) => {
    const ga = x(toT(a)),
      gb = x(toT(b));
    k.push(<rect key={'g' + i} x={ga} y={T} width={gb - ga} height={H - T - Bm} fill="url(#cw-hatch)" opacity={0.8} />);
    if (gb - ga > 150)
      k.push(
        <text
          key={'gt' + i}
          x={(ga + gb) / 2}
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
  const dots = archive.weight.map((w, i) => {
    const px = x(toT(w.date)),
      py = y(conv(w.v));
    return w.src === 'clinic' ? (
      <rect
        key={'c' + i}
        x={px - 3.5}
        y={py - 3.5}
        width={7}
        height={7}
        fill={C.paper}
        stroke={C.ink}
        strokeWidth={1.3}
      />
    ) : (
      <circle key={'s' + i} cx={px} cy={py} r={1.7} fill={C.ink2} opacity={0.8} />
    );
  });
  k.push(<g key="dots">{dots}</g>);
  if (xb < W - R)
    k.push(
      <rect key="fut" x={xb} y={T - 6} width={W - R - xb} height={H - Bm - T + 6} fill={C.paper} opacity={0.62} />,
    );
  (
    [
      [xa, 'A', A, wa, T - 22],
      [xb, 'B', B, wb, T - 8],
    ] as [number, string, ISODate, WeightReading | undefined, number][]
  ).forEach(([xx, l, d, w, ly]) => {
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
    if (w) {
      const px = x(toT(w.date)),
        py = y(conv(w.v));
      k.push(<circle key={'r' + l} cx={px} cy={py} r={7} fill="none" stroke={C.green} strokeWidth={2} />);
      if (Math.abs(px - xx) > 3) {
        k.push(
          <line
            key={'br' + l}
            x1={px}
            x2={xx}
            y1={H - Bm - 5}
            y2={H - Bm - 5}
            stroke={C.green}
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />,
        );
        k.push(<circle key={'bt' + l} cx={px} cy={H - Bm - 5} r={2.5} fill={C.green} />);
      }
    }
  });
  return (
    <svg
      width={W}
      height={H}
      style={{ display: 'block' }}
      role="img"
      aria-label="Weight readings with snapshots A and B"
    >
      {k}
    </svg>
  );
}
