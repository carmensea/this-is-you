import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { C, MONO } from '../theme';

export function Footer() {
  return (
    <footer
      style={{
        marginTop: 56,
        borderTop: `1px solid ${C.rule}`,
        paddingTop: 14,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 24px',
        fontSize: 12,
        color: C.ink3,
      }}
    >
      <span>This Is You, open-source personal health archive</span>
      <span>Synthetic demonstration data</span>
      <span>Shows documented information as recorded. It does not interpret results or give medical advice.</span>
    </footer>
  );
}

export interface SegmentItem {
  label: string;
  onClick: () => void;
  pressed: boolean;
  bg: string;
  fg: string;
}

/** A row of joined buttons where the pressed one is inverted. */
export function Segmented({ items, ...rest }: { items: SegmentItem[] } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        background: C.ink,
        border: `1px solid ${C.ink}`,
        alignSelf: 'flex-start',
        width: 'fit-content',
      }}
    >
      {items.map((b) => (
        <button
          key={b.label}
          onClick={b.onClick}
          aria-pressed={b.pressed}
          style={{ padding: '5px 10px', fontSize: 12, background: b.bg, color: b.fg }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

/** Square checkbox drawn in the archive style. */
export function Checkbox({
  checked,
  box,
  onClick,
  style,
  boxStyle,
  children,
}: {
  checked: boolean;
  box: string;
  onClick: () => void;
  style: CSSProperties;
  boxStyle: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button role="checkbox" aria-checked={checked} onClick={onClick} style={style}>
      <span style={{ ...boxStyle, background: box }} />
      {children}
    </button>
  );
}

function YearStepper({
  value,
  label,
  onDown,
  onUp,
}: {
  value: string;
  label: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${C.ink}` }}>
      <button onClick={onDown} aria-label={`Earlier ${label} year`} style={{ padding: '4px 9px' }}>
        ‹
      </button>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12,
          padding: '4px 8px',
          borderLeft: `1px solid ${C.ink}`,
          borderRight: `1px solid ${C.ink}`,
        }}
      >
        {value}
      </span>
      <button onClick={onUp} aria-label={`Later ${label} year`} style={{ padding: '4px 9px' }}>
        ›
      </button>
    </div>
  );
}

/** "From [2009] to [2026]" with a stepper on each year. Renders as children of a flex row. */
export function YearRange(p: {
  from: string;
  to: string;
  onFromDown: () => void;
  onFromUp: () => void;
  onToDown: () => void;
  onToUp: () => void;
}) {
  return (
    <>
      <span>From</span>
      <YearStepper value={p.from} label="start" onDown={p.onFromDown} onUp={p.onFromUp} />
      <span>to</span>
      <YearStepper value={p.to} label="end" onDown={p.onToDown} onUp={p.onToUp} />
    </>
  );
}
