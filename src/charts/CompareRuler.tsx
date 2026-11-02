import type { PointerEvent as RPointerEvent } from 'react';
import type { ReactElement } from 'react';
import { useRef } from 'react';
import { fLong, fShort, fromT, toT } from '../domain/dates';
import type { ISODate } from '../domain/types';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { T0A, T1A, rulerStep, hatchDef } from './scale';

export function CompareRuler({
  width,
  A,
  B,
  aKey,
  bKey,
}: {
  width: number;
  A: ISODate;
  B: ISODate;
  aKey: SnapKey;
  bKey: SnapKey;
}) {
  const store = useStore(),
    archive = store.archive;
  const dragKey = useRef<SnapKey | null>(null);
  const W = width,
    L = 104,
    R = 16,
    H = 108;
  const x = (t: number) => L + ((t - T0A) / (T1A - T0A)) * (W - L - R);
  const k: ReactElement[] = [<defs key="d">{hatchDef('cr-hatch')}</defs>];
  const pxY = (W - L - R) / (T1A - T0A),
    step = rulerStep(pxY);
  const xa = x(toT(A)),
    xb = x(toT(B));
  k.push(<rect key="span" x={xa} y={28} width={Math.max(0, xb - xa)} height={H - 28} fill={C.greenT} opacity={0.7} />);
  for (let y = T0A; y < T1A; y++) {
    k.push(<line key={'g' + y} x1={x(y)} x2={x(y)} y1={30} y2={H} stroke={y % 5 === 0 ? C.rule : C.rule2} />);
    if ((y - T0A) % step === 0)
      k.push(
        <text key={'y' + y} x={x(y) + 5} y={46} fontFamily={SERIF} fontSize={14} fill={C.ink2}>
          {String(y)}
        </text>,
      );
  }
  k.push(
    <text
      key="lbl"
      x={0}
      y={92}
      fontFamily={SANS}
      fontSize={10.5}
      fontWeight={600}
      letterSpacing="0.08em"
      fill={C.ink3}
    >
      {'RECORDS'}
    </text>,
  );
  const counts: Record<string, number> = {};
  archive.events.forEach((e) => {
    const kk = e.date.slice(0, 7);
    counts[kk] = (counts[kk] || 0) + 1;
  });
  const bw = Math.max(1, pxY / 12 - 1);
  Object.keys(counts).forEach((kk) => {
    const [y, m] = kk.split('-').map(Number);
    const hh = (Math.min(5, counts[kk]) / 5) * 34;
    k.push(<rect key={'c' + kk} x={x(y + (m - 1) / 12)} y={100 - hh} width={bw} height={hh} fill={C.ink2} />);
  });
  k.push(<line key="base" x1={L} x2={W - R} y1={100} y2={100} stroke={C.ink3} />);
  archive.gaps.forEach(([a, b], i) => {
    const ga = x(toT(a)),
      gb = x(toT(b));
    k.push(<rect key={'gap' + i} x={ga} y={54} width={gb - ga} height={46} fill="url(#cr-hatch)" />);
  });
  const xt = x(toT(archive.today));
  k.push(<line key="today" x1={xt} x2={xt} y1={28} y2={H} stroke={C.ink} strokeDasharray="1 3" />);
  (
    [
      [xa, 'A', A, true],
      [xb, 'B', B, false],
    ] as [number, string, ISODate, boolean][]
  ).forEach(([xx, l, d, left]) => {
    k.push(<line key={'l' + l} x1={xx} x2={xx} y1={22} y2={H} stroke={C.green} strokeWidth={2} />);
    const fw = 134;
    let fx = left ? xx - fw : xx;
    if (fx < 0) fx = 0;
    if (fx + fw > W) fx = W - fw;
    k.push(<rect key={'f' + l} x={fx} y={0} width={fw} height={22} fill={C.green} style={{ cursor: 'ew-resize' }} />);
    k.push(
      <text key={'t' + l} x={fx + 8} y={15} fontFamily={MONO} fontSize={11.5} fontWeight={500} fill="#FFFFFF">
        {l + '  ' + fShort(d)}
      </text>,
    );
  });
  const dateAt = (e: RPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = T0A + ((e.clientX - r.left - L) / (W - L - R)) * (T1A - T0A);
    return fromT(Math.max(T0A, Math.min(T1A - 0.001, t)));
  };
  const setK = (key: SnapKey, d: ISODate) => {
    if (d < archive.start) d = archive.start;
    if (d > archive.today) d = archive.today;
    const st = store.state,
      oA = st.cA || store.state.cur,
      oB = st.cB || archive.today;
    const n = Object.assign({ cA: oA, cB: oB }, { [key]: d });
    if (n.cA > n.cB) {
      dragKey.current = key === 'cA' ? 'cB' : 'cA';
      store.setState({ cA: n.cB, cB: n.cA });
    } else store.setState({ [key]: d });
  };
  return (
    <svg
      width={W}
      height={H}
      style={{ display: 'block', touchAction: 'pan-y', cursor: 'ew-resize', userSelect: 'none' }}
      role="img"
      aria-label={
        'Ruler showing snapshot A on ' + fLong(A) + ' and snapshot B on ' + fLong(B) + '. Drag either line to move it.'
      }
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect(),
          px = e.clientX - r.left;
        dragKey.current = Math.abs(px - xa) <= Math.abs(px - xb) ? aKey : bKey;
        setK(dragKey.current, dateAt(e));
      }}
      onPointerMove={(e) => {
        if (dragKey.current) setK(dragKey.current, dateAt(e));
      }}
      onPointerUp={() => {
        dragKey.current = null;
      }}
      onPointerCancel={() => {
        dragKey.current = null;
      }}
    >
      {k}
    </svg>
  );
}

type SnapKey = 'cA' | 'cB';
