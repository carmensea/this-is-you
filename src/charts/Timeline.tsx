import { addMonths } from '../domain/dates';
import type { KeyboardEvent } from 'react';
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { addDays, fLong, fMY, fShort, fromT, toT } from '../domain/dates';
import type { ISODate } from '../domain/types';
import { TYPE_LABEL } from '../domain/vocabulary';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { T0A, T1A, rulerStep, hatchDef } from './scale';

export function Timeline({ width, cur }: { width: number; cur: ISODate }) {
  const store = useStore(),
    archive = store.archive;
  const [hover, setHover] = useState<ISODate | null>(null),
    drag = useRef(false);
  const onKey = (e: KeyboardEvent) => {
    let c = store.state.cur;
    if (e.key === 'ArrowRight') c = addMonths(c, e.shiftKey ? 12 : 1);
    else if (e.key === 'ArrowLeft') c = addMonths(c, e.shiftKey ? -12 : -1);
    else if (e.key === 'Home') c = archive.events[0].date;
    else if (e.key === 'End') c = archive.today;
    else if (e.key === 'PageDown') {
      e.preventDefault();
      return store.stepEvent(1);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      return store.stepEvent(-1);
    } else return;
    e.preventDefault();
    store.setCur(c);
  };
  const W = width,
    L = 104,
    R = 16,
    H = 290,
    T0 = T0A,
    T1 = T1A;
  const x = (t: number) => L + ((t - T0) / (T1 - T0)) * (W - L - R);
  const tlDate = (e: RPointerEvent<SVGSVGElement>, snap: boolean) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (snap) {
      let best: (typeof archive.events)[number] | null = null,
        bd = 6;
      archive.events.forEach((ev) => {
        const d = Math.abs(x(toT(ev.date)) - px);
        if (d < bd) {
          bd = d;
          best = ev;
        }
      });
      if (best) return store.evKey(best);
    }
    const t = T0 + ((px - L) / (W - L - R)) * (T1 - T0);
    return fromT(Math.max(T0, Math.min(T1 - 0.001, t)));
  };
  const ct = toT(cur),
    pxY = (W - L - R) / (T1 - T0),
    k = [];
  const lanes: Record<string, number> = {
    visit: 120,
    lab: 140,
    imaging: 160,
    procedure: 180,
    report: 180,
    diagnosis: 200,
  };
  const medTop = 214,
    wY = medTop + archive.medications.length * 7 + 12;
  k.push(<defs key="d">{hatchDef('tl-hatch')}</defs>);
  const step = rulerStep(pxY);
  for (let y = T0; y < T1; y++) {
    k.push(
      <line key={'g' + y} x1={x(y)} x2={x(y)} y1={30} y2={H} stroke={y % 5 === 0 ? C.rule : C.rule2} strokeWidth={1} />,
    );
    if ((y - T0) % step === 0)
      k.push(
        <text key={'y' + y} x={x(y) + 5} y={44} fontFamily={SERIF} fontSize={pxY > 60 ? 16 : 14} fill={C.ink2}>
          {String(y)}
        </text>,
      );
    if (pxY > 80)
      for (let m = 1; m < 12; m++)
        k.push(
          <line
            key={'m' + y + '-' + m}
            x1={x(y + m / 12)}
            x2={x(y + m / 12)}
            y1={50}
            y2={54}
            stroke={C.ink3}
            strokeWidth={0.75}
          />,
        );
  }
  const laneLabel = (t: string, y: number) => (
    <text
      key={'l' + t}
      x={0}
      y={y + 4}
      fontFamily={SANS}
      fontSize={10.5}
      fontWeight={600}
      letterSpacing="0.08em"
      fill={C.ink3}
    >
      {t.toUpperCase()}
    </text>
  );
  k.push(laneLabel('Records', 92));
  (
    [
      ['Visits', lanes.visit],
      ['Lab tests', lanes.lab],
      ['Imaging', lanes.imaging],
      ['Procedures', lanes.procedure],
      ['Diagnoses', lanes.diagnosis],
      ['Medications', medTop + 16],
      ['Weight', wY],
    ] as [string, number][]
  ).forEach(([t, y]) => {
    k.push(laneLabel(t, y));
    const sy = t === 'Medications' ? medTop + archive.medications.length * 7 + 1 : y + 10;
    k.push(<line key={'s' + t} x1={L} x2={W - R} y1={sy} y2={sy} stroke={C.rule2} />);
  });
  const counts: Record<string, number> = {};
  archive.events.forEach((e) => {
    const key = e.date.slice(0, 7);
    counts[key] = (counts[key] || 0) + 1;
  });
  const bw = Math.max(1, pxY / 12 - 1);
  Object.keys(counts).forEach((key) => {
    const [y, m] = key.split('-').map(Number);
    const hh = (Math.min(5, counts[key]) / 5) * 34;
    k.push(<rect key={'c' + key} x={x(y + (m - 1) / 12)} y={100 - hh} width={bw} height={hh} fill={C.ink2} />);
  });
  k.push(<line key="base" x1={L} x2={W - R} y1={100} y2={100} stroke={C.ink3} />);
  archive.gaps.forEach(([a, b], i) => {
    const xa = x(toT(a)),
      xb = x(toT(b));
    k.push(<rect key={'gap' + i} x={xa} y={58} width={xb - xa} height={H - 58} fill="url(#tl-hatch)" />);
    const cx = (xa + xb) / 2;
    if (xb - xa > 170) {
      k.push(<rect key={'gb' + i} x={cx - 82} y={136} width={164} height={38} fill={C.paper} stroke={C.rule} />);
      k.push(
        <text
          key={'gt' + i}
          x={cx}
          y={152}
          textAnchor="middle"
          fontFamily={SERIF}
          fontStyle="italic"
          fontSize={14}
          fill={C.ink}
        >
          {'No records in archive'}
        </text>,
      );
      k.push(
        <text key={'gd' + i} x={cx} y={167} textAnchor="middle" fontFamily={MONO} fontSize={10} fill={C.ink2}>
          {fMY(a) + ' to ' + fMY(b)}
        </text>,
      );
    }
  });
  archive.events.forEach((e, i) => {
    const ex = x(toT(e.date)),
      y = lanes[e.type];
    const tt = <title>{TYPE_LABEL[e.type] + ': ' + e.title + ', ' + fShort(e.date)}</title>;
    if (e.type === 'visit')
      k.push(
        <circle key={'e' + i} cx={ex} cy={y} r={3.5} fill={C.ink}>
          {tt}
        </circle>,
      );
    else if (e.type === 'lab')
      k.push(
        <rect key={'e' + i} x={ex - 3.5} y={y - 3.5} width={7} height={7} fill={C.ink}>
          {tt}
        </rect>,
      );
    else if (e.type === 'imaging')
      k.push(
        <polygon
          key={'e' + i}
          points={`${ex},${y - 5} ${ex + 5},${y} ${ex},${y + 5} ${ex - 5},${y}`}
          fill={e.documented > addDays(e.date, 30) ? C.paper : C.ink}
          stroke={C.ink}
          strokeWidth={1.2}
        >
          {tt}
        </polygon>,
      );
    else if (e.type === 'procedure' || e.type === 'report') {
      if (e.end)
        k.push(
          <rect key={'e' + i} x={ex} y={y - 3} width={Math.max(3, x(toT(e.end)) - ex)} height={6} fill={C.ink2}>
            {tt}
          </rect>,
        );
      else
        k.push(
          <rect key={'e' + i} x={ex - 1.5} y={y - 6} width={3} height={12} fill={C.ink}>
            {tt}
          </rect>,
        );
    }
  });
  archive.diagnoses.forEach((d, i) => {
    const xo = x(toT(d.onset)),
      xd = x(toT(d.documented)),
      y = lanes.diagnosis;
    const tt = <title>{'Diagnosis: ' + d.name + ', documented ' + fShort(d.documented)}</title>;
    if (d.onset !== d.documented) {
      k.push(<line key={'dl' + i} x1={xo + 5} x2={xd} y1={y} y2={y} stroke={C.ink} strokeDasharray="2 3" />);
      k.push(
        <circle
          key={'do' + i}
          cx={xo}
          cy={y}
          r={4.5}
          fill={C.paper}
          stroke={C.ink}
          strokeWidth={1.4}
          strokeDasharray="2 2"
        >
          {tt}
        </circle>,
      );
      k.push(
        <circle key={'dd' + i} cx={xd} cy={y} r={4.5} fill={C.paper} stroke={C.ink} strokeWidth={1.6}>
          {tt}
        </circle>,
      );
    } else
      k.push(
        <circle key={'dx' + i} cx={xo} cy={y} r={4.5} fill={C.paper} stroke={C.ink} strokeWidth={1.6}>
          {tt}
        </circle>,
      );
  });
  archive.medications.forEach((m, i) => {
    const xa = x(toT(m.start)),
      xb = x(toT(m.end || archive.today));
    k.push(
      <rect key={'md' + i} x={xa} y={medTop + i * 7} width={Math.max(3, xb - xa)} height={4} fill={C.green}>
        <title>{m.name + ', ' + fMY(m.start) + (m.end ? ' to ' + fMY(m.end) : ' onward')}</title>
      </rect>,
    );
  });
  archive.weight
    .filter((w) => w.src === 'clinic')
    .forEach((w, i) =>
      k.push(
        <line
          key={'wc' + i}
          x1={x(toT(w.date))}
          x2={x(toT(w.date))}
          y1={wY - 5}
          y2={wY + 5}
          stroke={C.ink}
          strokeWidth={1.5}
        />,
      ),
    );
  [
    ['2019-01-15', '2022-06-01'],
    ['2022-11-21', '2026-10-30'],
  ].forEach(([a, b], i) =>
    k.push(
      <rect key={'ws' + i} x={x(toT(a))} y={wY - 2} width={x(toT(b)) - x(toT(a))} height={4} fill={C.ink3}>
        <title>{'Smart scale readings, ' + fMY(a) + ' to ' + fMY(b)}</title>
      </rect>,
    ),
  );
  const xt = x(toT(archive.today));
  k.push(<line key="today" x1={xt} x2={xt} y1={28} y2={H} stroke={C.ink} strokeDasharray="1 3" />);
  const xc = x(ct);
  k.push(
    <rect key="fut" x={xc} y={28} width={Math.max(0, W - R - xc)} height={H - 28} fill={C.paper} opacity={0.68} />,
  );
  if (hover && !drag.current) {
    const xh = x(toT(hover));
    k.push(<line key="hv" x1={xh} x2={xh} y1={58} y2={H} stroke={C.ink3} strokeDasharray="2 2" />);
    k.push(
      <text key="hvt" x={xh + 4} y={H - 4} fontFamily={MONO} fontSize={10} fill={C.ink2}>
        {fMY(hover)}
      </text>,
    );
  }
  k.push(<line key="cur" x1={xc} x2={xc} y1={22} y2={H} stroke={C.green} strokeWidth={2} />);
  const fw = 104,
    fx = Math.max(L - 20, Math.min(W - R - fw, xc - fw / 2));
  k.push(<rect key="flag" x={fx} y={0} width={fw} height={22} fill={C.green} />);
  k.push(<polygon key="flagt" points={`${xc - 5},22 ${xc + 5},22 ${xc},28`} fill={C.green} />);
  k.push(
    <text
      key="flagx"
      x={fx + fw / 2}
      y={15}
      textAnchor="middle"
      fontFamily={MONO}
      fontSize={11.5}
      fontWeight={500}
      fill="#FFFFFF"
    >
      {fShort(cur)}
    </text>,
  );
  return (
    <svg
      width={W}
      height={H}
      style={{ display: 'block', touchAction: 'pan-y', cursor: 'ew-resize', userSelect: 'none' }}
      tabIndex={0}
      role="slider"
      aria-label="Snapshot date. Use arrow keys to move by month, Shift for year, Page Up and Page Down for events."
      aria-valuemin={2009}
      aria-valuemax={2026}
      aria-valuenow={Math.floor(ct)}
      aria-valuetext={fLong(cur)}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        drag.current = true;
        store.setCur(tlDate(e, true));
      }}
      onPointerMove={(e) => {
        if (drag.current) store.setCur(tlDate(e, false));
        else setHover(tlDate(e, false));
      }}
      onPointerUp={() => {
        drag.current = false;
      }}
      onPointerCancel={() => {
        drag.current = false;
      }}
      onPointerLeave={() => {
        if (!drag.current) setHover(null);
      }}
    >
      {k}
    </svg>
  );
}
