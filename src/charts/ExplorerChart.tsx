import type { ReactElement } from 'react';
import { useState } from 'react';
import { fShort, toT } from '../domain/dates';
import { USER_ENTERED, reportedText, fmtR, niceTicks, refText } from '../domain/format';
import type { LabResult, Marker, ISODate } from '../domain/types';
import { useStore } from '../state/useStore';
import { C, MONO, SANS, SERIF } from '../theme';
import { gapLabel, hatchDef, xAxis } from './scale';

export function ExplorerChart({
  width,
  m,
  unit,
  series,
  cm,
  cur,
  sel,
}: {
  width: number;
  m: Marker;
  unit: string;
  series: LabResult[];
  cm: Marker | null;
  cur: ISODate;
  sel?: LabResult;
}) {
  const store = useStore(),
    archive = store.archive;
  const { chartStart: T0A, chartEnd: T1A } = archive;
  const [hover, setHover] = useState<number | null>(null);
  const rVis = store.isVisible;
  const explorerDomain = (): [number, number] => {
    const s = store.state,
      tt = toT(archive.today);

    if (s.bxRange === '10') return [tt - 10, tt + 0.2];
    if (s.bxRange === '5') return [tt - 5, tt + 0.2];
    if (s.bxRange === 'custom') {
      const a = Math.min(s.bxFrom, s.bxTo),
        b = Math.max(s.bxFrom, s.bxTo);
      return [a, b + 1];
    }
    return [T0A, T1A];
  };
  const W = width,
    H = 420,
    L = 60,
    R = 90,
    T = 44,
    B = 34;
  const [T0, T1] = explorerDomain(),
    ct = toT(cur);
  const x = (t: number) => L + ((t - T0) / (T1 - T0)) * (W - L - R);
  const inD = (r: LabResult) => {
    const t = toT(r.date);
    return t >= T0 && t <= T1;
  };
  const hidden = store.state.future === 'hidden';
  const sD = series.filter(inD),
    cAll = cm ? cm.results.filter((r) => r.unit === unit) : [],
    cD = cAll.filter(inD);
  const vals: number[] = [];
  sD.concat(cD).forEach((r) => vals.push(r.value));
  sD.forEach((r) => {
    if (r.hi != null) vals.push(r.hi);
    if (r.lo != null) vals.push(r.lo);
  });
  const k: ReactElement[] = [
    <defs key="d">
      {hatchDef('bx-hatch')}
      <clipPath id="bx-clip">
        <rect x={L} y={0} width={W - L - R} height={H} />
      </clipPath>
    </defs>,
  ];
  xAxis(k, x, T0, T1, W, L, R, H - B, 'bx');
  const pxY = (W - L - R) / (T1 - T0);
  if (pxY > 110)
    for (let yy = Math.ceil(T0); yy < T1; yy++)
      [0.25, 0.5, 0.75].forEach((q) => {
        const t = yy + q;
        if (t > T0 && t < T1)
          k.push(<line key={'q' + t} x1={x(t)} x2={x(t)} y1={H - B} y2={H - B + 3} stroke={C.ink3} />);
      });
  if (!vals.length) {
    k.push(
      <text
        key="none"
        x={(L + W - R) / 2}
        y={H / 2}
        textAnchor="middle"
        fontFamily={SERIF}
        fontStyle="italic"
        fontSize={16}
        fill={C.ink2}
      >
        {'No records in archive for this measure in the selected range'}
      </text>,
    );
    return (
      <svg width={W} height={H} style={{ display: 'block' }}>
        {k}
      </svg>
    );
  }
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.12,
    nt = niceTicks(lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad, 6);
  const y = (vv: number) => T + (1 - (vv - nt.a) / (nt.b - nt.a)) * (H - T - B);
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
        <rect key={'b' + i} x={x(a)} y={yt} width={Math.max(0, x(b) - x(a))} height={yb - yt} fill={C.greenT} />,
      );
    if (r.hi != null && r.hi <= nt.b)
      band.push(<line key={'bh' + i} x1={x(a)} x2={x(b)} y1={y(r.hi)} y2={y(r.hi)} stroke={C.green} opacity={0.6} />);
    if (r.lo != null && r.lo >= nt.a)
      band.push(<line key={'bl' + i} x1={x(a)} x2={x(b)} y1={y(r.lo)} y2={y(r.lo)} stroke={C.green} opacity={0.6} />);
  });
  k.push(
    <g key="band" clipPath="url(#bx-clip)">
      {band}
    </g>,
  );
  nt.t.forEach((vv) => {
    k.push(<line key={'yg' + vv} x1={L} x2={W - R} y1={y(vv)} y2={y(vv)} stroke={C.rule2} />);
    k.push(
      <text key={'yl' + vv} x={L - 10} y={y(vv) + 4} textAnchor="end" fontFamily={MONO} fontSize={11} fill={C.ink3}>
        {String(vv)}
      </text>,
    );
  });
  k.push(
    <text key="unit" x={L} y={14} fontFamily={MONO} fontSize={11.5} fill={C.ink2}>
      {unit}
    </text>,
  );
  if (m.method) {
    const tm = toT(m.method.date);
    if (tm > T0 && tm < T1) {
      k.push(<line key="mth" x1={x(tm)} x2={x(tm)} y1={T - 8} y2={H - B} stroke={C.ink} strokeDasharray="4 3" />);
      k.push(
        <text key="mtht" x={x(tm) + 6} y={T + 4} fontFamily={MONO} fontSize={10.5} fill={C.ink}>
          {m.method.label}
        </text>,
      );
    }
  }
  const ln: ReactElement[] = [];
  const drawSeries = (arr: LabResult[], pre: string, dash: string | undefined, color: string) => {
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1],
        b = arr[i],
        ta = toT(a.date),
        tb = toT(b.date);
      if (tb - ta > 2.2) {
        if (pre !== 'p') continue;
        const xa = x(ta) + 10,
          xb = x(tb) - 10;
        ln.push(
          <rect
            key={pre + 'gh' + i}
            x={xa}
            y={T}
            width={Math.max(0, xb - xa)}
            height={H - T - B}
            fill="url(#bx-hatch)"
            opacity={0.7}
          />,
        );
        if (xb - xa > 150) {
          ln.push(
            <rect key={pre + 'gr' + i} x={(xa + xb) / 2 - 76} y={T + 10} width={152} height={20} fill={C.paper} />,
          );
          ln.push(
            <text
              key={pre + 'gt' + i}
              x={(xa + xb) / 2}
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
      } else if (!(hidden && !rVis(b)))
        ln.push(
          <line
            key={pre + 'l' + i}
            x1={x(ta)}
            x2={x(tb)}
            y1={y(a.value)}
            y2={y(b.value)}
            stroke={color}
            strokeWidth={1.4}
            strokeDasharray={dash}
          />,
        );
    }
  };
  drawSeries(series, 'p', undefined, C.ink);
  if (cm) drawSeries(cAll, 'c', '4 3', C.ink2);
  k.push(
    <g key="lines" clipPath="url(#bx-clip)">
      {ln}
    </g>,
  );
  const xc = x(ct);
  if (xc < W - R) {
    const x0 = Math.max(L, xc);
    k.push(
      <rect
        key="fut"
        x={x0}
        y={T - 12}
        width={Math.max(0, W - R - x0)}
        height={H - B - T + 12}
        fill={C.paper}
        opacity={hidden ? 1 : 0.7}
      />,
    );
    if (hidden && W - R - x0 > 140)
      k.push(
        <text
          key="futl"
          x={x0 + (W - R - x0) / 2}
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
  const pts = [],
    labels = sD.length && (W - L - R) / sD.length > 46;
  cm &&
    cD.forEach((r, i) => {
      if (hidden && !rVis(r)) return;
      const px = x(toT(r.date)),
        py = y(r.value);
      pts.push(
        <polygon
          key={'c' + i}
          points={
            px + ',' + (py - 5) + ' ' + (px + 5) + ',' + py + ' ' + px + ',' + (py + 5) + ' ' + (px - 5) + ',' + py
          }
          fill={C.paper}
          stroke={C.ink2}
          strokeWidth={1.3}
        >
          <title>{cm.short + ', ' + fShort(r.date) + ': ' + fmtR(r) + ' ' + r.unit}</title>
        </polygon>,
      );
    });
  if (cm && cD.length) {
    const lr = cD[cD.length - 1];
    pts.push(
      <text
        key="cl"
        x={Math.min(W - R + 8, x(toT(lr.date)) + 10)}
        y={y(lr.value) + 4}
        fontFamily={SANS}
        fontSize={11.5}
        fill={C.ink2}
      >
        {cm.short}
      </text>,
    );
  }
  if (cm && sD.length) {
    const lr = sD[sD.length - 1];
    pts.push(
      <text
        key="pl"
        x={Math.min(W - R + 8, x(toT(lr.date)) + 10)}
        y={y(lr.value) + 4}
        fontFamily={SANS}
        fontSize={11.5}
        fontWeight={600}
        fill={C.ink}
      >
        {m.short}
      </text>,
    );
  }
  sD.forEach((r) => {
    const px = x(toT(r.date)),
      py = y(r.value),
      vz = rVis(r),
      isSel = sel && sel.i === r.i;
    if (hidden && !vz) return;
    if (isSel) pts.push(<circle key="sel" cx={px} cy={py} r={10} fill="none" stroke={C.green} strokeWidth={2} />);
    if (!vz)
      pts.push(<circle key={'p' + r.i} cx={px} cy={py} r={4} fill={C.paper} stroke={C.ink3} strokeWidth={1.4} />);
    else if (r.flag) pts.push(<rect key={'p' + r.i} x={px - 4.5} y={py - 4.5} width={9} height={9} fill={C.rust} />);
    else pts.push(<circle key={'p' + r.i} cx={px} cy={py} r={4.5} fill={C.ink} />);
    if (labels || isSel || r.flag)
      pts.push(
        <text
          key={'v' + r.i}
          x={px}
          y={py - 11}
          textAnchor="middle"
          fontFamily={MONO}
          fontSize={isSel ? 12 : 10.5}
          fontWeight={isSel || r.flag ? 500 : 400}
          fill={vz ? (r.flag ? C.rust : C.ink2) : C.ink3}
        >
          {fmtR(r) + (r.flag ? ' ' + r.flag : '')}
        </text>,
      );
    pts.push(
      <circle
        key={'hit' + r.i}
        cx={px}
        cy={py}
        r={13}
        fill="transparent"
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHover(r.i)}
        onMouseLeave={() => setHover(null)}
        onClick={() => store.setState({ sel: r.i })}
      >
        <title>{fShort(r.date) + ': ' + fmtR(r) + ' ' + r.unit + (r.flag ? ', flagged ' + r.flag : '')}</title>
      </circle>,
    );
  });
  if (xc >= L && xc <= W - R) {
    k.push(<line key="cur" x1={xc} x2={xc} y1={T - 18} y2={H - B} stroke={C.green} strokeWidth={2} />);
    const right = xc > W - 160;
    k.push(
      <text
        key="curl"
        x={right ? xc - 6 : xc + 6}
        y={T - 8}
        textAnchor={right ? 'end' : 'start'}
        fontFamily={MONO}
        fontSize={10.5}
        fill={C.green}
      >
        {'Snapshot ' + fShort(cur)}
      </text>,
    );
  }
  k.push(<g key="pts">{pts}</g>);
  let tip = null;
  const hr = sD.find((r) => r.i === hover);
  if (hr) {
    const px = x(toT(hr.date)),
      py = y(hr.value),
      left = Math.max(0, Math.min(W - 240, px - 120)),
      top = py > 170 ? py - 128 : py + 20;
    tip = (
      <div
        style={{
          position: 'absolute',
          left,
          top,
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
        <div style={{ color: C.ink2 }}>{'Reported ' + reportedText(hr)}</div>
        {hr.userEntered && <div style={{ color: C.ink2 }}>{USER_ENTERED}</div>}
        {!rVis(hr) ? (
          <div style={{ color: C.rust }}>{hr.date > cur ? 'Collected after snapshot' : 'Reported after snapshot'}</div>
        ) : null}
        <div style={{ color: C.ink3, marginTop: 2 }}>{'Click to inspect'}</div>
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
        aria-label={m.name + ' in ' + unit + ', ' + series.length + ' results, with printed reference ranges'}
      >
        {k}
      </svg>
      {tip}
    </div>
  );
}
