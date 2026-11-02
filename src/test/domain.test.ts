import { describe, expect, it } from 'vitest';
import { addMonths, fLong, fromT, span, toT } from '../domain/dates';
import { kindOf, niceTicks, plural, rangeOnly } from '../domain/format';

describe('dates', () => {
  it('converts dates to fractional years and back', () => {
    for (const d of ['2009-01-01', '2016-02-29', '2018-05-08', '2026-11-01']) expect(fromT(toT(d) + 1e-6)).toBe(d);
  });
  it('clamps month steps to the end of the month', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2023-03-31', -1)).toBe('2023-02-28');
  });
  it('describes spans in years and months', () => {
    expect(span('2018-05-08', '2026-11-01')).toBe('8 years, 5 months');
    expect(span('2018-05-08', '2018-05-20')).toBe('less than a month');
  });
  it('formats long dates', () => expect(fLong('2018-05-08')).toBe('8 May 2018'));
});

describe('format', () => {
  it('pluralizes', () => {
    expect(plural(1, 'visit')).toBe('1 visit');
    expect(plural(2, 'record was', 'records were')).toBe('2 records were');
  });
  it('writes one-sided reference ranges', () => {
    expect(rangeOnly({ lo:null, hi:100, unit:'mg/dL' })).toBe('< 100');
    expect(rangeOnly({ lo:40, hi:null, unit:'mg/dL' })).toBe('≥ 40');
    expect(rangeOnly({ lo:4, hi:6, unit:'%' })).toBe('4–6');
  });
  it('builds axis ticks that cover the data', () => {
    const { a, b, t } = niceTicks(87, 163, 5);
    expect(a).toBeLessThanOrEqual(87);
    expect(b).toBeGreaterThanOrEqual(163);
    expect(t[0]).toBe(a);
    expect(t[t.length - 1]).toBe(b);
  });
  it('names unknown file types honestly', () => expect(kindOf('IMG_2041.HEIC')).toBe('Unrecognized format'));
});
