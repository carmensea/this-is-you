import type { CSSProperties } from 'react';
import { C, MONO, SERIF } from '../theme';

/** Style recipes the prototype repeats across screens. */
export const s = {
  eyebrow: { fontSize: 11, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: C.ink3 },
  heading3: { fontFamily: SERIF, fontWeight: 400, fontSize: 22, margin: 0 },
  heading2: { fontFamily: SERIF, fontWeight: 400, fontSize: 30, margin: 0, letterSpacing: '-0.01em' },
  link12: { fontSize: 12, borderBottom: `1px solid ${C.ink}` },
  link13: { fontSize: 13, borderBottom: `1px solid ${C.ink}` },
  link125: { fontSize: 12.5, borderBottom: `1px solid ${C.ink}` },
  monoNote: { fontFamily: MONO, fontSize: 11, color: C.ink3 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6 },
  minW0: { minWidth: 0 },
  alignRight: { textAlign: 'right' },
  body13: { fontSize: 13, color: C.ink2 },
  meta12: { fontSize: 12, color: C.ink3 },
  muted12: { fontSize: 12, color: C.muted },
  meta115: { fontSize: 11.5, color: C.ink3 },
  muted115: { fontSize: 11.5, color: C.muted },
  body125: { fontSize: 12.5, color: C.ink2 },
  sub12: { fontSize: 12, color: C.ink2, marginTop: 2 },
  subBlock: { display: 'block', fontSize: 11.5, color: C.ink3, marginTop: 2 },
  stepBtn9: { background: C.paper, padding: '5px 9px', fontSize: 12 },
  stepBtn8: { background: C.paper, padding: '5px 8px', fontSize: 12 },
  kicker: {
    display: 'block',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: C.ink3,
  },
} satisfies Record<string, CSSProperties>;
