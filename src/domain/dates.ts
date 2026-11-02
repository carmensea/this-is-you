import type { ISODate } from './types';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const pd = (s: ISODate) => s.split('-').map(Number);

/** Date to fractional year, the x axis of every chart. */
export const toT = (s: ISODate) => {
  const [y, m, d] = pd(s);
  const a = Date.UTC(y, 0, 1),
    b = Date.UTC(y + 1, 0, 1);
  return y + (Date.UTC(y, m - 1, d) - a) / (b - a);
};
export const fromT = (t: number): ISODate => {
  const y = Math.floor(t);
  const a = Date.UTC(y, 0, 1),
    b = Date.UTC(y + 1, 0, 1);
  return new Date(a + (t - y) * (b - a)).toISOString().slice(0, 10);
};
export const fLong = (s: ISODate) => {
  const [y, m, d] = pd(s);
  return d + ' ' + MONL[m - 1] + ' ' + y;
};
export const fShort = (s: ISODate) => {
  const [y, m, d] = pd(s);
  return d + ' ' + MON[m - 1] + ' ' + y;
};
export const fMY = (s: ISODate) => {
  const [y, m] = pd(s);
  return MON[m - 1] + ' ' + y;
};
export const addDays = (s: ISODate, n: number): ISODate => {
  const [y, m, d] = pd(s);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const addMonths = (s: ISODate, n: number): ISODate => {
  const [y, m, d] = pd(s);
  const dim = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, dim))).toISOString().slice(0, 10);
};
export const monthsBetween = (a: ISODate, b: ISODate) => {
  const [y1, m1, d1] = pd(a),
    [y2, m2, d2] = pd(b);
  let m = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) m--;
  return m;
};
export const span = (a: ISODate, b: ISODate) => {
  const m = monthsBetween(a, b);
  if (m < 1) return 'less than a month';
  const y = Math.floor(m / 12),
    r = m % 12;
  const p: string[] = [];
  if (y) p.push(y + (y === 1 ? ' year' : ' years'));
  if (r) p.push(r + (r === 1 ? ' month' : ' months'));
  return p.join(', ');
};
