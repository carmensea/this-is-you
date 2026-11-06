import { useState, type CSSProperties } from 'react';
import { s } from './styles';
import { C, MONO } from '../theme';
import type { LabObservation } from '../domain/types';

export type ObservationFields = Partial<Record<(typeof FIELDS)[number]['key'], string | null>>;

const FIELDS = [
  { key: 'reported_name', label: 'Test name', type: 'text' },
  { key: 'value_text', label: 'Value', type: 'text' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'reference_text', label: 'Reference range', type: 'text' },
  { key: 'flag', label: 'Flag on report', type: 'text' },
  { key: 'lab_name', label: 'Laboratory', type: 'text' },
  { key: 'collected_on', label: 'Collection date', type: 'date' },
  { key: 'reported_on', label: 'Report date', type: 'date' },
  { key: 'documented_on', label: 'Date documented', type: 'date' },
] as const;

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: `1px solid ${C.ink}`,
  borderRadius: 0,
  background: C.field,
  fontFamily: MONO,
  fontSize: 13,
  color: C.ink,
  marginTop: 4,
};

/** Entering or correcting one result. Leave a date empty when it is not known: nothing fills it in. */
export function ObservationForm({
  initial,
  testNames,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial?: LabObservation;
  testNames: string[];
  saveLabel: string;
  /** Resolves to an error message, or null when saved. */
  onSave: (changed: ObservationFields) => Promise<string | null>;
  onCancel: () => void;
}) {
  const start = (key: (typeof FIELDS)[number]['key']) => initial?.[key] ?? '';
  const [draft, setDraft] = useState(
    () =>
      Object.fromEntries(FIELDS.map((f) => [f.key, start(f.key)])) as Record<(typeof FIELDS)[number]['key'], string>,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const changed = Object.fromEntries(
      FIELDS.filter((f) => draft[f.key] !== start(f.key)).map((f) => [f.key, draft[f.key] || null]),
    ) as ObservationFields;
    const problem = await onSave(changed);
    setSaving(false);
    setError(problem);
  };
  return (
    <div style={{ margin: '0 6px 12px 30px', padding: 14, background: C.hover }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px 14px' }}>
        {FIELDS.map((f) => (
          <label key={f.key} style={s.muted115}>
            {f.label}
            <input
              type={f.type}
              list={f.key === 'reported_name' ? 'lab-test-names' : undefined}
              data-field={f.key}
              value={draft[f.key]}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              style={inputStyle}
            />
          </label>
        ))}
      </div>
      <datalist id="lab-test-names">
        {testNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {error && (
        <p role="alert" style={{ margin: '10px 0 0', fontSize: 12.5, color: C.rust }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{ background: C.ink, color: C.paper, padding: '7px 12px', fontSize: 12.5, fontWeight: 500 }}
        >
          {saveLabel}
        </button>
        <button onClick={onCancel} style={s.link125}>
          Cancel
        </button>
        <span style={{ fontSize: 11.5, color: C.muted }}>
          Enter only what the report states. Leave anything unknown empty.
        </span>
      </div>
    </div>
  );
}
