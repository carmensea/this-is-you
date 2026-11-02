import type { LabResult, Marker, Medication, TreatmentPeriod, ISODate } from './types';

export const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : many || one + 's');

type Range = { lo: number | null; hi: number | null; unit: string };
export const rangeOnly = (r: Range) => (r.lo == null ? '< ' + r.hi : r.hi == null ? '≥ ' + r.lo : r.lo + '–' + r.hi);
export const refText = (r: Range) => rangeOnly(r) + ' ' + r.unit;
export const fmtV = (m: Marker, v: number) => v.toFixed(m.dp);
export const fmtR = (r: LabResult) => r.value.toFixed(r.dp);

export const doseAt = (m: Medication | TreatmentPeriod, cur: ISODate) =>
  m.doses ? (m.doses.filter((d) => d[0] <= cur).pop() || m.doses[0])[1] : m.dose;

export const kindOf = (n: string) => {
  const e = (n.split('.').pop() || '').toLowerCase();
  return (
    (
      { pdf: 'PDF document', csv: 'CSV table', xml: 'XML record', json: 'JSON record', zip: 'ZIP archive' } as Record<
        string,
        string
      >
    )[e] || 'Unrecognized format'
  );
};
export const fmtSize = (b: number) =>
  b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

/** Round axis bounds and ticks covering lo to hi in about n steps. */
export const niceTicks = (lo: number, hi: number, n: number) => {
  const raw = (hi - lo) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw)!;
  const a = Math.max(lo >= 0 ? 0 : -Infinity, Math.floor(lo / step) * step),
    b = Math.ceil(hi / step) * step;
  const t: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) t.push(+v.toFixed(6));
  return { a, b, t };
};

/** The axis extent the overview chart uses, for its caption. */
export function axisExtentLabel(m: Marker) {
  const vals: number[] = [];
  m.results
    .filter((r) => r.unit === m.unit)
    .forEach((r) => {
      vals.push(r.value);
      if (r.hi != null) vals.push(r.hi);
      if (r.lo != null) vals.push(r.lo);
    });
  const lo = Math.min(...vals),
    hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1;
  const nt = niceTicks(lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad, 5);
  return 'from ' + nt.a + ' to ' + nt.b;
}
