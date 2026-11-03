import { useState } from 'react';
import { s } from '../components/styles';
import { openDemoArchive } from '../services/archiveMode';
import { C, MONO, SERIF } from '../theme';

/** A read failed, after a few short tries. Says which kind of failure, shows no records, and offers Retry. */
export function ArchiveUnavailable({ onRetry, kind = 'unreachable' }: { onRetry: () => void | Promise<void>; kind?: 'unreachable' | 'error' | 'setup_required' }) {
  const [retrying, setRetrying] = useState(false);
  const [tries, setTries] = useState(0);
  const retry = async () => {
    setRetrying(true);
    await onRetry();
    setRetrying(false);
    setTries((n) => n + 1);
  };
  return (
    <main
      style={{
        maxWidth: 1480,
        margin: '0 auto',
        padding: '64px var(--gutter)',
        minHeight: '100vh',
        background: C.paper,
      }}
    >
      <h1
        style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 52, lineHeight: 1, letterSpacing: '-0.02em', margin: 0 }}
      >
        {kind === 'setup_required' ? 'Set a passphrase first' : kind === 'error' ? 'Your archive could not be read' : 'Your archive is not reachable'}
      </h1>
      <p style={{ margin: '18px 0 0', fontSize: 14, lineHeight: 1.55, color: C.ink2, maxWidth: 560 }}>
        {kind === 'setup_required'
          ? 'Your archive stays closed until it has a passphrase. Nothing can set one from this page: that keeps anything else that reaches the service from claiming your archive. Run this on the computer that holds it, then Retry.'
          : kind === 'error'
          ? 'The local archive service answered with an error, so your documents cannot be shown right now. This does not mean your archive is empty. Nothing was changed. Retry, or restart the service if this continues.'
          : 'The local archive service did not answer, so your documents cannot be shown. This does not mean your archive is empty, and your documents are still safe on this computer. Check that the service is running, then retry.'}
      </p>
      {kind !== 'error' && <pre style={{ fontFamily: MONO, fontSize: 13, margin: '16px 0 0', whiteSpace: 'pre-wrap' }}>{kind === 'setup_required' ? 'npm run backend -- set-passphrase' : 'npm run backend'}</pre>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 16, alignItems: 'baseline' }}>
        <button onClick={retry} disabled={retrying} style={s.link13}>
          {retrying ? 'Retrying' : 'Retry'}
        </button>
        <button onClick={openDemoArchive} style={s.link13}>
          Open the fictional demo archive
        </button>
        {tries > 0 && !retrying && (
          <span role="status" style={s.muted12}>
            Still not available after {tries === 1 ? 'that retry' : `${tries} retries`}.
          </span>
        )}
      </div>
    </main>
  );
}
