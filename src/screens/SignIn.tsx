import { useState, type FormEvent } from 'react';
import { s } from '../components/styles';
import { openDemoArchive } from '../services/archiveMode';
import { signIn } from '../services/localArchiveApi';
import { C, MONO, SERIF } from '../theme';

/** Shown instead of any record until a session exists. The passphrase goes to the service and is not kept here. */
export function SignIn({ onSignedIn, expired = false }: { onSignedIn: () => void | Promise<void>; expired?: boolean }) {
  const [passphrase, setPassphrase] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const refused = await signIn(passphrase);
    setBusy(false);
    setProblem(refused);
    if (!refused) {
      setPassphrase('');
      await onSignedIn();
    }
  };
  return (
    <main style={{ maxWidth: 1480, margin: '0 auto', padding: '64px var(--gutter)', minHeight: '100vh', background: C.paper }}>
      <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 52, lineHeight: 1, letterSpacing: '-0.02em', margin: 0 }}>Sign in to your archive</h1>
      <p style={{ margin: '18px 0 0', fontSize: 14, lineHeight: 1.55, color: C.ink2, maxWidth: 560 }}>
        {expired
          ? 'You were signed out. Nothing was lost, and an import that paused can carry on after you sign in.'
          : 'Your records stay hidden until you enter your passphrase.'}
      </p>
      <form onSubmit={submit} style={{ marginTop: 20, maxWidth: 420 }}>
        <label style={s.muted115}>
          Passphrase
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            style={{ display: 'block', width: '100%', padding: '6px 8px', border: `1px solid ${C.ink}`, borderRadius: 0, background: C.field, fontFamily: MONO, fontSize: 16, color: C.ink, marginTop: 4 }}
          />
        </label>
        {problem && (
          <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: C.rust }}>
            {problem}
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 14, alignItems: 'baseline' }}>
          <button type="submit" disabled={busy || !passphrase} style={{ background: C.ink, color: C.paper, padding: '7px 12px', fontSize: 13, fontWeight: 500 }}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
          <button type="button" onClick={openDemoArchive} style={s.link13}>
            Open the fictional demo archive
          </button>
        </div>
      </form>
      <p style={{ fontFamily: MONO, fontSize: 11, color: C.ink3, margin: '20px 0 0', maxWidth: 560 }}>
        Forgotten it? On the computer that holds the archive, run npm run backend -- set-passphrase. Your records are not affected.
      </p>
    </main>
  );
}
