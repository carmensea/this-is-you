import { fShort } from './dates';
import type { LabResult, Marker, Medication, TreatmentPeriod, ISODate } from './types';

export const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : many || one + 's');

type Range = { lo: number | null; hi: number | null; unit: string; referenceText?: string | null };
export const rangeOnly = (r: Range) =>
  r.referenceText !== undefined
    ? (r.referenceText ?? 'Not printed')
    : r.lo == null
      ? '< ' + r.hi
      : r.hi == null
        ? '≥ ' + r.lo
        : r.lo + '–' + r.hi;
export const refText = (r: Range) => (r.referenceText === null ? 'Not printed' : rangeOnly(r) + ' ' + r.unit);
export const fmtV = (m: Marker, v: number) => v.toFixed(m.dp);
export const fmtR = (r: LabResult) => r.displayValue ?? r.value.toFixed(r.dp);

/** The date on the report, never another date standing in for it. */
export const reportedText = (r: LabResult) =>
  r.reportedOn === undefined ? fShort(r.documented) : r.reportedOn ? fShort(r.reportedOn) : 'Not printed';

export const USER_ENTERED = 'User-entered';

/** Where a real result came from. Empty in the demo. */
export const provenanceText = (r: LabResult) =>
  r.reportedName === undefined
    ? ''
    : r.userEntered
      ? 'User-entered, not from a laboratory report'
      : 'Read from a laboratory report, accepted by you';

/** What a printed flag means, in words. Nothing beyond what the laboratory printed. */
export const flagText = (flag: string) =>
  !flag
    ? 'None'
    : flag === 'H'
      ? 'H, above printed range'
      : flag === 'L'
        ? 'L, below printed range'
        : `${flag}, as printed`;

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
  // One value, or several identical ones, still needs an axis with some height.
  if (hi <= lo) {
    const room = Math.abs(lo) * 0.1 || 1;
    lo -= room;
    hi += room;
  }
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
