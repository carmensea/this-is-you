import { useCallback, useEffect, useState } from 'react';
import { Footer } from '../components/controls';
import { s } from '../components/styles';
import { KEYS_HINT, ResultList } from '../components/ResultRows';
import { ArchiveRequestError } from '../services/archiveApi';
import {
  confirmIdentity,
  deleteImported,
  disconnect,
  listConnections,
  startConnect,
  synchronize,
  type ProviderEntry,
  type SyncRun,
} from '../services/connectionsApi';
import { useStore } from '../state/useStore';
import { providerResultsVM } from '../viewmodels/sources';
import { C, MONO, SERIF } from '../theme';

// Only these fixed words come back from a provider's sign-in page, so nothing it sent is ever shown.
const RESULT_TEXT: Record<string, string> = {
  connected: 'Signed in at the provider. Check the connection below.',
  declined: 'The sign-in was cancelled at the provider. Nothing was saved.',
  expired: 'That sign-in had expired or was already used. Start again.',
  failed: 'The sign-in could not be completed. Nothing was imported.',
  no_patient: 'The provider did not say which patient record this is, so nothing was saved.',
};

const COUNT_LABELS: [string, string][] = [
  ['results_proposed', 'results to review'],
  ['documents_stored', 'PDFs stored'],
  ['documents_already_stored', 'PDFs already stored'],
  ['Observation_unchanged', 'results unchanged'],
  ['notes_kept_as_records_only', 'notes kept as records only'],
  ['results_not_final', 'results not final'],
  ['records_for_another_patient', 'records for another patient, not kept'],
  ['attachments_refused', 'attachments refused'],
];

const RUN_STATUS: Record<SyncRun['status'], string> = {
  running: 'Running',
  completed: 'Completed',
  partial: 'Completed, with problems',
  failed: 'Failed',
  interrupted: 'Interrupted',
  held: 'Held: patient details changed',
  stopped: 'Stopped: disconnected or signed in again',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

function counts(run: SyncRun) {
  const parts = COUNT_LABELS.filter(([k]) => run.counts[k]).map(([k, label]) => `${run.counts[k]} ${label}`);
  return parts.length ? parts.join(' · ') : 'Nothing new';
}

function status(p: ProviderEntry): string {
  const c = p.connection;
  if (p.state === 'planned') return 'Planned. Not connected.';
  if (!p.allowed_here) return 'Holds only fictional patients, so it connects only from a separate sandbox archive, never this one.';
  if (!p.registered) return 'Not set up yet: this installation has no client ID for it.';
  if (!c) return 'Not connected.';
  if (c.status === 'connected') return `Connected to the record of ${c.patient_name ?? 'an unnamed patient'}.`;
  if (c.status === 'awaiting_confirmation') return 'Waiting for you to confirm the patient record. Nothing is imported until then.';
  if (c.status === 'needs_sign_in') return 'The permission has ended. Sign in again to synchronize.';
  return `Disconnected ${when(c.disconnected_at)}. Imported records are kept.`;
}

function Provider({ p, busy, act }: { p: ProviderEntry; busy: boolean; act: (label: string, work: () => Promise<unknown>) => void }) {
  const c = p.connection;
  const connectable = p.state === 'available' && p.registered && p.allowed_here;
  const connect = () =>
    act('Opening the sign-in', async () => {
      window.location.assign(await startConnect(p.key));
    });
  const versions = c ? Object.entries(c.record_versions) : [];
  return (
    <section aria-label={p.name} style={{ borderTop: `1px solid ${C.ink}`, padding: '14px 0 22px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '6px 24px', alignItems: 'baseline' }}>
        <h3 style={s.heading3}>{p.name}</h3>
        <span style={s.monoNote}>{p.organization_id ? `Epic organization ${p.organization_id}` : p.fhir_base}</span>
      </div>
      <p style={{ ...s.meta12, margin: '4px 0 0' }}>
        {p.place}
        {p.note ? `. ${p.note}` : ''}
      </p>
      <p style={{ ...s.body13, margin: '10px 0 0' }}>{status(p)}</p>
      {c?.status === 'awaiting_confirmation' && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: C.banner, borderLeft: `2px solid ${C.amber}` }}>
          <p style={{ ...s.body13, margin: 0 }}>
            The provider says this record belongs to <strong>{c.patient_name ?? 'no name given'}</strong>, born{' '}
            <strong>{c.patient_birth_date ?? 'no date given'}</strong>.
          </p>
          {c.identity_reason && <p style={{ ...s.meta12, margin: '6px 0 0' }}>{c.identity_reason}</p>}
          <button
            disabled={busy}
            onClick={() => act('Confirming', () => confirmIdentity(p.key, c.patient_fhir_id ?? ''))}
            style={{ ...s.link13, marginTop: 8 }}
          >
            This is my record
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginTop: 12 }}>
        {connectable && (!c || c.status === 'disconnected' || c.status === 'needs_sign_in') && (
          <button disabled={busy} onClick={connect} style={s.link13}>
            {c ? 'Sign in again' : 'Connect'}
          </button>
        )}
        {c?.status === 'connected' && (
          <button disabled={busy} onClick={() => act('Synchronizing', () => synchronize(p.key))} style={s.link13}>
            Synchronize now
          </button>
        )}
        {c && c.status !== 'disconnected' && (
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Disconnect ${p.name}? The saved permission is removed and revoked where the provider allows it. Imported records stay, and can be deleted separately.`))
                act('Disconnecting', () => disconnect(p.key));
            }}
            style={s.link13}
          >
            Disconnect
          </button>
        )}
        {c?.status === 'disconnected' && versions.length > 0 && (
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete everything imported from ${p.name}? This removes its records and every result read from them, including verified ones. PDFs it stored stay in Documents. This cannot be undone.`))
                act('Deleting', () => deleteImported(p.key));
            }}
            style={{ ...s.link13, color: C.rust, borderBottomColor: C.rust }}
          >
            Delete imported records
          </button>
        )}
      </div>
      {versions.length > 0 && (
        <p style={{ ...s.meta12, margin: '12px 0 0' }}>
          Kept from this provider: {versions.map(([k, n]) => `${n} ${k}`).join(', ')}. Every version is kept as received.
        </p>
      )}
      {c && c.runs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <span style={s.kicker}>Synchronizations</span>
          {c.runs.map((r) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '170px 170px minmax(0,1fr)', gap: '0 14px', padding: '5px 0', borderBottom: `1px solid ${C.rule2}`, fontSize: 12.5 }}>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.ink3 }}>{when(r.started_at)}</span>
              <span style={{ color: r.status === 'failed' || r.status === 'held' ? C.rust : C.ink2 }}>{RUN_STATUS[r.status]}</span>
              <span style={{ color: C.ink2, minWidth: 0 }}>
                {counts(r)}
                {r.problems.map((m, i) => (
                  <span key={i} style={s.subBlock}>
                    {m}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ToReview() {
  const store = useStore();
  const v = providerResultsVM(store);
  return (
    <section aria-label="Results to review" style={{ marginTop: 36 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '4px 16px', borderBottom: `1px solid ${C.ink}`, paddingBottom: 8 }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0 }}>Results to review</h2>
        <span id="sources-keys" style={s.monoNote}>{KEYS_HINT}</span>
      </div>
      <p role="status" style={{ ...s.body13, margin: '10px 0' }}>
        {v.summary}
      </p>
      {store.state.rvError && (
        <p role="alert" style={{ ...s.body13, color: C.rust, margin: '0 0 10px' }}>
          {store.state.rvError}
        </p>
      )}
      <ResultList lines={v.lines} onKey={v.keys} testNames={v.testNames} label="Results read from connected sources" keysId="sources-keys" />
    </section>
  );
}

export function SourcesScreen() {
  const store = useStore();
  const isDemo = store.archive.kind === 'demo';
  const [providers, setProviders] = useState<ProviderEntry[] | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(() => RESULT_TEXT[new URLSearchParams(window.location.hash.split('?')[1]).get('result') ?? ''] ?? null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const listing = await listConnections();
    setProviders(listing.providers);
    setFileProblem(listing.provider_file_problem ?? null);
  }, []);

  useEffect(() => {
    if (window.location.hash.includes('?')) window.history.replaceState(null, '', '#/sources');
    if (!isDemo) load().catch(() => setMessage('Connected sources could not be loaded.'));
  }, [isDemo, load]);

  const act = (label: string, work: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(`${label}…`);
    work()
      .then(async () => {
        setMessage(null);
        await load();
        await store.retryRefresh();
      })
      .catch((problem) => setMessage(problem instanceof ArchiveRequestError ? problem.message : 'That did not work. Nothing was changed.'))
      .finally(() => setBusy(false));
  };

  return (
    <main style={{ maxWidth: 1480, margin: '0 auto', padding: '28px var(--gutter) 64px' }}>
      <h2 style={s.heading2}>Connected sources</h2>
      <p style={{ ...s.body13, maxWidth: 760, margin: '10px 0 0' }}>
        Read-only connections to healthcare providers. You sign in on the provider's own page, so this app never sees your password.
        Nothing is approved automatically: results arrive for review, and every record version is kept as received.
      </p>
      {message && (
        <p role="status" style={{ ...s.body13, margin: '16px 0 0', padding: '8px 12px', background: C.banner }}>
          {message}
        </p>
      )}
      {isDemo ? (
        <p style={{ ...s.body13, marginTop: 24 }}>Connected sources work with your own archive. The demo archive is fictional and has none.</p>
      ) : (
        <>
          {fileProblem && (
            <p role="note" style={{ ...s.body13, margin: '16px 0 0', padding: '8px 12px', background: C.banner }}>
              Your own provider list was not used, so only built-in providers are shown. {fileProblem}
            </p>
          )}
          <div style={{ marginTop: 28 }}>{providers?.map((p) => <Provider key={p.key} p={p} busy={busy} act={act} />)}</div>
          {providers && <ToReview />}
        </>
      )}
      <Footer />
    </main>
  );
}
