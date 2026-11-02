import { createElement as h, type ReactElement } from 'react';
import { C, MONO } from '../theme';
import type { AppStore } from '../state/store';

export { h };

/** Years between axis labels on the record rulers, so labels never collide on a phone. */
export const rulerStep = (pxY: number) => (pxY >= 44 ? 1 : pxY >= 22 ? 2 : 5);

/** Fixed x-axis extent of every chart, in fractional years. */
export const T0A = 2009, T1A = 2027;

export function overviewDomain(store: AppStore, ct: number): [number, number] {
  if (store.state.range === 'all') return [T0A, T1A];
  let a = ct - 4, b = ct + 2.5;
  if (a < T0A) { b += T0A - a; a = T0A; }
  if (b > T1A) { a -= b - T1A; b = T1A; }
  return [Math.max(T0A, a), b];
}

/** Appends the year axis to a chart's children. */
export function xAxis(k: ReactElement[], x: (t: number) => number, T0: number, T1: number, W: number, L: number, R: number, yb: number, id: string) {
  const pxY = (W - L - R) / (T1 - T0), step = pxY >= 52 ? 1 : pxY >= 26 ? 2 : 5;
  k.push(h('line', { key:id+'ax', x1:L, x2:W-R, y1:yb, y2:yb, stroke:C.ink }));
  for (let y = Math.ceil(T0); y <= Math.floor(T1); y++) {
    if (y % step) continue;
    k.push(h('line', { key:id+'xt'+y, x1:x(y), x2:x(y), y1:yb, y2:yb+5, stroke:C.ink }));
    if (y < T1) k.push(h('text', { key:id+'xl'+y, x:x(y)+3, y:yb+18, fontFamily:MONO, fontSize:11, fill:C.ink3 }, String(y)));
  }
}

export const hatchDef = (id: string) => h('pattern', { id, width:6, height:6, patternUnits:'userSpaceOnUse', patternTransform:'rotate(45)' }, h('line', { x1:0, y1:0, x2:0, y2:6, stroke:C.hatch, strokeWidth:1 }));

/** Caption for a stretch with no results between two dates. */
export const gapLabel = (draws: [string, string][], a: string, b: string) => draws.some(([d]) => d > a && d < b) ? 'Not measured at ' + draws.filter(([d]) => d > a && d < b).length + ' draws' : 'No records in archive';
