import { s } from '../components/styles';
import { openDemoArchive } from '../services/archiveMode';
import { C, MONO, SERIF } from '../theme';

/** The local service is not answering. Says so plainly and shows no records. */
export function ArchiveUnavailable({ onRetry }: { onRetry: () => void }) {
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
        Your archive is not reachable
      </h1>
      <p style={{ margin: '18px 0 0', fontSize: 14, lineHeight: 1.55, color: C.ink2, maxWidth: 560 }}>
        The local archive service is not running, so your documents cannot be shown. They are still safe on this
        computer. Start the service, then try again.
      </p>
      <pre style={{ fontFamily: MONO, fontSize: 13, margin: '16px 0 0' }}>npm run backend</pre>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 16 }}>
        <button onClick={onRetry} style={s.link13}>
          Try again
        </button>
        <button onClick={openDemoArchive} style={s.link13}>
          Open the fictional demo archive
        </button>
      </div>
    </main>
  );
}
