import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { Segmented } from './controls';
import { ObservationForm } from './ObservationForm';
import { s } from './styles';
import { C, MONO } from '../theme';
import { isTypingTarget } from '../domain/reviewRows';
import type { resultLines } from '../viewmodels/review';

/** Results decided one at a time, the same way wherever they come from: a document's measurements or a provider's results. */
export type Line = ReturnType<typeof resultLines>['lines'][number];

const ROW_COLUMNS = 'minmax(0,1.5fr) 96px 72px minmax(0,0.9fr) 28px 112px';
export const fieldInput = {
  width: '100%',
  padding: '6px 8px',
  border: `1px solid ${C.ink}`,
  borderRadius: 0,
  background: C.field,
  fontFamily: MONO,
  fontSize: 13,
  color: C.ink,
  marginTop: 4,
} as const;
export const outlined = (color: string) => ({ border: `1px solid ${color}`, color, padding: '4px 10px', fontSize: 12.5, fontWeight: 500 });

export function Tick() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M2 6.5 5 9.5 10 3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

const PRIMARY: Record<string, CSSProperties> = {
  accept: { background: C.green, color: C.paper, border: `1px solid ${C.green}` },
  check: { color: C.rust, border: `1px solid ${C.rust}` },
  enter: { color: C.ink, border: `1px solid ${C.ink}` },
  accepted: { color: C.green, border: '1px solid transparent' },
  rejected: { color: C.muted, border: '1px solid transparent' },
};

function DemoEditor({ l }: { l: Line }) {
  return (
    <div data-editing style={{ margin: '0 0 10px', padding: 12, background: C.hover }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '10px 14px' }}>
        <label style={s.muted115}>
          Value
          <input data-field="value_text" value={l.dValue} onChange={l.onDValue} style={fieldInput} />
        </label>
        <label style={s.muted115}>
          Unit
          <input value={l.dUnit} onChange={l.onDUnit} style={fieldInput} />
        </label>
        <label style={s.muted115}>
          Reference range
          <input value={l.dRef} onChange={l.onDRef} style={fieldInput} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={s.muted115}>Flag on report</span>
        <Segmented items={l.flagOpts} />
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={l.onSave} style={{ background: C.ink, color: C.paper, padding: '7px 12px', fontSize: 12.5 }}>
          Save and accept
        </button>
        <button onClick={l.onCancel} style={s.link125}>
          Cancel
        </button>
        <span style={s.muted115}>The extracted value is kept alongside your correction.</span>
      </div>
    </div>
  );
}

function Row({ l, testNames, bind }: { l: Line; testNames: string[]; bind: (key: string, el: HTMLButtonElement | null) => void }) {
  const dim = l.isRejected ? C.ink3 : C.ink;
  const box = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  // A form that opens takes the focus, and gives it back to its row when it closes, so the keyboard never loses its place.
  useEffect(() => {
    // The value is what a correction is nearly always about, and all an unread result needs.
    if (l.isEditing) box.current?.querySelector<HTMLInputElement>('[data-editing] [data-field="value_text"]')?.focus();
    else if (wasEditing.current && !box.current?.contains(document.activeElement)) box.current?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus();
    wasEditing.current = l.isEditing;
  }, [l.isEditing]);
  const escape = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && l.isEditing) {
      e.stopPropagation();
      l.onCancel();
    }
  };
  return (
    <div
      ref={box}
      role="listitem"
      onKeyDown={escape}
      data-row={l.key}
      aria-current={l.isSelected || undefined}
      style={{ borderTop: `1px solid ${C.rule2}`, background: l.isSelected || l.isOpen ? C.selected : 'transparent', boxShadow: l.isSelected ? `inset 3px 0 0 ${C.ink}` : 'none' }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: ROW_COLUMNS, gap: 10, alignItems: 'center', padding: '3px 8px', minHeight: 38 }}>
        <button ref={(el) => bind(l.key, el)} onClick={l.onSelect} onFocus={l.onFocus} aria-expanded={l.isOpen} aria-label={l.rowLabel} style={{ minWidth: 0, padding: '3px 0' }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: dim, textDecoration: l.isRejected ? 'line-through' : 'none' }}>{l.measure}</span>
          {l.tag && (
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 11, color: l.hasProblem ? C.rust : C.ink3 }}>
              {l.hasProblem && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: C.rust }} />}
              {l.tag}
            </span>
          )}
        </button>
        <span style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 500, textAlign: 'right', color: l.kind === 'missing' ? C.ink3 : dim, textDecoration: l.isRejected ? 'line-through' : 'none' }}>{l.value}</span>
        <span style={{ fontSize: 12, color: C.ink2 }}>{l.unit}</span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink3 }}>{l.ref}</span>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600 }}>{l.flag}</span>
        <button onClick={l.primary.act} aria-label={l.primary.aria} style={{ justifySelf: 'end', display: 'inline-flex', gap: 5, alignItems: 'center', padding: '4px 10px', fontSize: 12.5, fontWeight: 500, ...PRIMARY[l.primary.tone] }}>
          {l.primary.tone === 'accepted' && <Tick />}
          {l.primary.label}
        </button>
      </div>
      {l.isOpen && (
        <div style={{ padding: '0 8px 10px' }}>
          {l.problems.map((p) => (
            <p key={p} style={{ margin: '0 0 6px', fontSize: 12.5, color: C.rust }}>
              {p}
            </p>
          ))}
          {l.isEditing && l.observation && (
            <div data-editing>
              <ObservationForm initial={l.observation} testNames={testNames} saveLabel="Save and accept" onSave={l.onSaveForm} onCancel={l.onCancel} />
            </div>
          )}
          {l.isEditing && !l.observation && <DemoEditor l={l} />}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center' }}>
            {l.canAcceptAsRead && (
              <button onClick={l.onAccept} style={outlined(C.green)}>
                Accept as read
              </button>
            )}
            {l.canCorrect && (
              <button onClick={l.onEdit} style={s.link125}>
                {l.correctLabel}
              </button>
            )}
            {l.isPending && !l.isEditing && (
              <button onClick={l.onReject} style={{ ...s.link125, color: C.muted }}>
                Reject
              </button>
            )}
            {!l.isPending && (
              <button onClick={l.onUndo} style={{ ...s.link125, color: C.muted }}>
                {l.isRejected ? 'Restore' : 'Undo acceptance'}
              </button>
            )}
            {l.onChart && (
              <button onClick={l.onChart} aria-label={`Chart ${l.measure}`} style={{ fontSize: 12.5, color: C.green, borderBottom: `1px solid ${C.green}` }}>
                Chart
              </button>
            )}
            <span style={s.body125}>{l.statusText}</span>
          </div>
          <details style={{ marginTop: 6, fontSize: 12, color: C.ink2 }}>
            <summary style={{ color: C.muted, cursor: 'pointer' }}>Source and details</summary>
            <div style={{ padding: '4px 0 0 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {l.evidence && <span style={{ overflowWrap: 'anywhere' }}>{l.evidence}</span>}
              {l.dates && <span>{l.dates}</span>}
              {l.notes.map((n) => (
                <span key={n}>{n}</span>
              ))}
              {l.groupNote && <span>{l.groupNote}</span>}
              {l.duplicateNote && <span>{l.duplicateNote}</span>}
              {l.isEdited && <span>{l.realEditedText || l.editedText}</span>}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

/** The list, with keys that move and decide. A key typed into a form, or held with a modifier, never decides anything. */
export function ResultList({ lines, onKey, testNames, label, keysId }: { lines: Line[]; onKey: (key: string) => string | null | undefined; testNames: string[]; label: string; keysId: string }) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const bind = (key: string, el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(key, el);
    else buttons.current.delete(key);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    const moved = onKey(e.key);
    if (moved === undefined) return;
    e.preventDefault();
    if (moved) buttons.current.get(moved)?.focus();
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <div role="list" aria-label={label} aria-describedby={keysId} onKeyDown={onKeyDown} style={{ minWidth: 600 }}>
        {lines.map((l) => (
          <Row key={l.key} l={l} testNames={testNames} bind={bind} />
        ))}
      </div>
    </div>
  );
}

export const KEYS_HINT = '↑ ↓ move · A accept · R reject · C correct · U undo';
