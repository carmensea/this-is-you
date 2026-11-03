import { useState, type CSSProperties } from 'react';
import { s } from '../components/styles';
import { fShort } from '../domain/dates';
import { fmtSize, plural } from '../domain/format';
import type { BackupEntry } from '../domain/types';
import { useStore } from '../state/useStore';
import { C, MONO, SERIF } from '../theme';

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

const head: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '8px 24px',
  borderBottom: `1px solid ${C.ink}`,
  paddingBottom: 8,
};

/** Details used only to flag documents that may belong to someone else. They stay on this computer. */
export function IdentitySection() {
  const store = useStore();
  const { identity, identityOpen, safetyError } = store.state;
  const [draft, setDraft] = useState<{ name: string; birth: string; earlier: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const open = () => {
    setDraft({ name: identity?.full_name ?? '', birth: identity?.date_of_birth ?? '', earlier: identity?.previous_names.join('\n') ?? '' });
    setError(null);
    store.setState({ identityOpen: true });
  };
  const close = () => store.setState({ identityOpen: false });
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const problem = await store.saveIdentity({
      full_name: draft.name,
      date_of_birth: draft.birth || null,
      previous_names: draft.earlier.split('\n').map((n) => n.trim()).filter(Boolean),
    });
    setSaving(false);
    setError(problem);
  };
  return (
    <section aria-label="Identity check" style={{ marginTop: 40 }}>
      <div style={head}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0 }}>Identity check</h2>
        <button onClick={open} style={s.link13}>
          {identity?.configured ? 'Edit your details' : 'Enter your details'}
        </button>
      </div>
      <p style={{ margin: '12px 0', fontSize: 13, lineHeight: 1.5, color: C.ink2, maxWidth: 820 }}>
        Your name and birth date are compared with what documents print under a patient label, to flag files that may
        belong to someone else. A flag is a suggestion for you to check. It never verifies, refuses or removes a
        document. These details stay in the archive on this computer, and are also in your backups.
      </p>
      {identity?.configured && !identityOpen && (
        <p style={{ margin: '0 0 12px', fontFamily: MONO, fontSize: 13 }}>
          {identity.full_name}
          {identity.date_of_birth ? ` · born ${fShort(identity.date_of_birth)}` : ' · no birth date set'}
          {identity.previous_names.length ? ` · also ${identity.previous_names.join(', ')}` : ''}
        </p>
      )}
      {safetyError && (
        <p role="alert" style={{ margin: '0 0 12px', fontSize: 13, color: C.rust }}>
          {safetyError}{' '}
          <button onClick={store.loadArchiveSafety} style={s.link13}>
            Retry
          </button>
        </p>
      )}
      {identityOpen && draft && (
        <div style={{ padding: 14, background: C.hover, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '10px 14px' }}>
            <label style={s.muted115}>
              Full name
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} />
            </label>
            <label style={s.muted115}>
              Date of birth
              <input type="date" value={draft.birth} onChange={(e) => setDraft({ ...draft, birth: e.target.value })} style={inputStyle} />
            </label>
            <label style={s.muted115}>
              Previous names, one per line (optional)
              <textarea rows={2} value={draft.earlier} onChange={(e) => setDraft({ ...draft, earlier: e.target.value })} style={inputStyle} />
            </label>
          </div>
          {error && (
            <p role="alert" style={{ margin: '10px 0 0', fontSize: 12.5, color: C.rust }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
            <button onClick={save} disabled={saving} style={{ background: C.ink, color: C.paper, padding: '7px 12px', fontSize: 12.5, fontWeight: 500 }}>
              Save details
            </button>
            <button onClick={close} style={s.link125}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function backupStatus(b: BackupEntry) {
  if (b.state === 'encrypted') {
    if (!b.last_check) return { text: 'Encrypted, not checked yet', color: C.amber };
    if (!b.last_check.ok) return { text: 'Encrypted, failed its last check', color: C.rust };
    return { text: `Encrypted, tested ${fShort(b.last_check.checked_at.slice(0, 10))}`, color: C.green };
  }
  if (b.state === 'incomplete') return { text: 'Did not finish, cannot be used', color: C.rust };
  if (b.state === 'damaged') return { text: 'Damaged, cannot be used', color: C.rust };
  if (!b.last_check) return { text: 'Not checked yet', color: C.amber };
  if (!b.last_check.ok) return { text: 'Failed its last check', color: C.rust };
  return { text: `Restore tested ${fShort(b.last_check.checked_at.slice(0, 10))}`, color: C.green };
}

/** The only time the passphrase comes near this machine: sent for this one test, used in memory and not kept. */
function TestSealed({ name, disabled }: { name: string; disabled: boolean }) {
  const store = useStore();
  const [passphrase, setPassphrase] = useState<string | null>(null);
  if (passphrase === null) {
    return (
      <button onClick={() => setPassphrase('')} disabled={disabled} style={s.link12}>
        Test restore
      </button>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void store.checkBackup(name, passphrase);
        setPassphrase(null);
      }}
      style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'baseline', flexBasis: '100%' }}
    >
      <label style={{ ...s.muted115, flex: '1 1 240px' }}>
        Backup passphrase, used only for this test
        <input type="password" autoComplete="off" autoFocus value={passphrase} onChange={(e) => setPassphrase(e.target.value)} style={inputStyle} />
      </label>
      <button type="submit" disabled={!passphrase} style={s.link12}>
        Test restore
      </button>
      <button type="button" onClick={() => setPassphrase(null)} style={s.link12}>
        Cancel
      </button>
    </form>
  );
}

/** Writes and tests backups. Restoring over an archive is on the command line, with the service stopped. */
export function BackupsSection() {
  const store = useStore();
  const { backups } = store.state;
  const running = backups?.running ?? null;
  const last = backups?.last_result ?? null;
  return (
    <section aria-label="Backups" style={{ marginTop: 40 }}>
      <div style={head}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0 }}>Backups</h2>
        <button
          onClick={store.startBackup}
          disabled={!backups?.key_configured || !!running}
          style={{ background: C.ink, color: C.paper, padding: '6px 12px', fontSize: 13, fontWeight: 500 }}
        >
          Back up now
        </button>
      </div>
      <p style={{ margin: '12px 0', fontSize: 13, lineHeight: 1.5, color: C.ink2, maxWidth: 820 }}>
        A backup holds the database, every original file, your decisions and correction history, and a manifest of
        hashes. It is encrypted, and tested before it is reported as good. This machine can write backups but cannot open
        them: only your backup passphrase can, and it is not stored here. Lose it and those backups are gone for good.{' '}
        {backups?.same_drive ? 'They are on the same drive as your archive, so losing that drive loses both. Keep them on another drive.' : 'They are on a different drive from your archive.'}
      </p>
      {backups && !backups.key_configured && (
        <p role="status" style={{ fontSize: 13, color: C.rust, margin: '0 0 8px', maxWidth: 820 }}>
          Back up now is off until you choose a backup passphrase. On the computer that holds the archive, run: npm run backend -- backup-key set
        </p>
      )}
      {backups && <p style={{ margin: '0 0 8px', fontFamily: MONO, fontSize: 12, overflowWrap: 'anywhere', color: C.ink2 }}>{backups.location}</p>}
      {running && (
        <p role="status" style={{ fontFamily: MONO, fontSize: 11.5, color: C.muted, margin: '0 0 8px' }}>
          {running.kind === 'backup' ? `Backing up${running.total ? `: ${running.done} of ${running.total} originals` : ''}, then testing a restore.` : 'Testing a restore into a temporary folder.'}
        </p>
      )}
      {!running && last && !last.ok && (
        <p role="alert" style={{ fontSize: 13, color: C.rust, margin: '0 0 8px', maxWidth: 820 }}>
          {last.problems.join(' ') || 'This did not finish.'}
        </p>
      )}
      {backups?.backups.map((b) => {
        const status = backupStatus(b);
        return (
          <div
            key={b.name}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', padding: '11px 4px', borderBottom: `1px solid ${C.rule2}`, alignItems: 'baseline', justifyContent: 'space-between' }}
          >
            <span style={{ flex: '1 1 300px', minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: MONO, fontSize: 12, overflowWrap: 'anywhere' }}>{b.name}</span>
              {b.state === 'encrypted' && <span style={s.subBlock}>{fmtSize(b.bytes ?? 0)}</span>}
              {b.documents !== null && (
                <span style={s.subBlock}>
                  {plural(b.documents, 'document')} · {fmtSize(b.bytes ?? 0)}
                </span>
              )}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: status.color }}>{status.text}</span>
            {b.state === 'complete' ? (
              <button onClick={() => store.checkBackup(b.name)} disabled={!!running} style={s.link12}>
                Test restore
              </button>
            ) : b.state === 'encrypted' ? (
              <TestSealed name={b.name} disabled={!!running} />
            ) : (
              <span style={s.muted115}>Cleared by the next backup</span>
            )}
          </div>
        );
      })}
      {backups && !backups.backups.length && <p style={{ fontSize: 13, color: C.ink2, margin: '8px 0' }}>No backups yet.</p>}
      <p style={{ fontFamily: MONO, fontSize: 11, color: C.ink3, margin: '8px 0 0' }}>
        To restore: stop the service, then npm run backend -- restore BACKUP --to FOLDER. A folder that holds files is
        replaced only after you type its name, and it is moved aside, not deleted.
        <br />
        To write one elsewhere: npm run backend -- backup --to FOLDER. An unencrypted copy needs --plain, and anyone who can read it can read every record.
      </p>
    </section>
  );
}

/** Signing out, and anything the archive found when it started that needs a person to look at it. */
export function AccessSection() {
  const store = useStore();
  const health = store.state.archiveHealth;
  const notes = [
    health?.recovered ? `${plural(health.recovered, 'file')} left by an interrupted import came back as documents named Recovered file. Importing the same file again restores its name.` : null,
    health?.set_aside ? `${plural(health.set_aside, 'file')} in the originals folder did not match their names and were moved to set-aside in the archive folder. Nothing was deleted.` : null,
    health?.missing ? `${plural(health.missing, 'original')} recorded in the archive could not be found on disk. Restore from a backup if you need them.` : null,
    health?.reader_isolation === 'unavailable' ? 'Reading is stopped: the PDF reader has no working sandbox here. New files are stored unread, and are read after this is fixed and the service restarts. Run doctor for details.' : null,
    health?.reader_isolation === 'basic' ? 'The PDF reader is running with limits only, with no sandbox. That suits trying this out with fictional files. A production deployment runs it in its own container.' : null,
  ].filter(Boolean);
  return (
    <section aria-label="Sign-in" style={{ marginTop: 40 }}>
      <div style={head}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0 }}>Sign-in</h2>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
          <button onClick={() => store.signOut(false)} style={s.link13}>
            Sign out
          </button>
          <button onClick={() => store.signOut(true)} style={s.link13}>
            Sign out everywhere
          </button>
        </span>
      </div>
      <p style={{ margin: '12px 0', fontSize: 13, lineHeight: 1.5, color: C.ink2, maxWidth: 820 }}>
        A device stays signed in for 14 days at most, or until it goes 3 days unused. Sign out everywhere after losing a
        device. To change the passphrase, run npm run backend -- set-passphrase on the computer that holds the archive.
      </p>
      {notes.map((note) => (
        <p key={note} role="status" style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.5, color: C.rust, maxWidth: 820 }}>
          {note}
        </p>
      ))}
    </section>
  );
}
