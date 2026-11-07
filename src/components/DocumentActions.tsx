import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { s } from './styles';
import type { documentsVM } from '../viewmodels/documents';

type Detail = NonNullable<ReturnType<typeof documentsVM>['detail']>;

const link = { fontSize: 13, borderBottom: `1px solid ${C.ink}`, alignSelf: 'center' } as const;

/** What a document has besides its measurements: where it stands, its note, and what can be done with the file. */
export function DocumentActions({ d }: { d: Detail }) {
  return (
    <section aria-label="This document" style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center' }}>
        <span style={s.eyebrow}>{d.ddCat}</span>
        <span style={{ display: 'flex', gap: 3, alignItems: 'center' }} aria-hidden>
          <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: d.s1 }} />
          <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: d.s2 }} />
          <span style={{ width: 9, height: 9, border: `1px solid ${C.ink}`, background: d.s3 }} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: d.ddStatusColor }}>{d.ddStatusLabel}</span>
        <span style={s.body125}>{d.ddStatusDesc}</span>
      </div>
      <div style={{ fontSize: 12.5, color: d.ddKnownColor, marginTop: 6 }}>{d.ddKnown}</div>
      {d.ddHasNote && <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.5, color: C.ink2, textWrap: 'pretty' }}>{d.ddNote}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px', marginTop: 10, fontSize: 13 }}>
        {d.ddCanReread && (
          <button onClick={d.ddReread} style={s.link125}>
            {d.ddRereadLabel}
          </button>
        )}
        {d.ddHasEvent && (
          <button onClick={d.ddShowHistory} style={link}>
            Show in Medical history
          </button>
        )}
        {d.ddHasDup && (
          <button onClick={d.ddOpenDup} style={link}>
            {d.ddDupLabel}
          </button>
        )}
        <button onClick={d.ddSnap} style={link}>
          Set snapshot to this date
        </button>
        {d.ddCanDelete && <DeleteDocument name={d.ddDeleteName} what={d.ddDeleteWhat} onDelete={d.ddDelete} />}
      </div>
      {d.ddRereadResult && (
        <p
          role="status"
          style={{ margin: '10px 0 0', padding: '6px 0 6px 10px', borderLeft: `2px solid ${d.ddRereadResult.ok ? C.green : C.rust}`, fontSize: 13, color: C.ink2 }}
        >
          {d.ddRereadResult.text}
        </p>
      )}
    </section>
  );
}

/** Asks first, by name, and starts on Cancel. Deleting is permanent, so one stray click must not do it. */
function DeleteDocument({ name, what, onDelete }: { name: string; what: string; onDelete: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal?.();
  }, [open]);
  const close = () => {
    setOpen(false);
    setProblem(null);
  };
  const confirm = async () => {
    setBusy(true);
    const failed = await onDelete();
    setBusy(false);
    if (failed) setProblem(failed);
    else close();
  };
  return (
    <>
      <button onClick={() => setOpen(true)} style={{ fontSize: 13, color: C.rust, borderBottom: `1px solid ${C.rust}`, alignSelf: 'center' }}>
        Delete document
      </button>
      {open && (
        <dialog ref={dialog} aria-label="Delete this document" onClose={close} style={{ maxWidth: 480, padding: 20, border: `1px solid ${C.rule}`, background: C.paper, color: C.ink }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, overflowWrap: 'anywhere' }}>Delete {name}?</h2>
          <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5 }}>{what}</p>
          <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5, color: C.ink2 }}>
            Backups you already made still hold it. Choosing the same folder again would import it again unless you move the file.
          </p>
          {problem && (
            <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: C.rust }}>
              {problem}
            </p>
          )}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 16 }}>
            <button autoFocus onClick={close} style={s.link125}>
              Cancel
            </button>
            <button onClick={confirm} disabled={busy} style={{ background: C.rust, color: C.paper, padding: '7px 12px', fontSize: 13, fontWeight: 500 }}>
              Delete permanently
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

