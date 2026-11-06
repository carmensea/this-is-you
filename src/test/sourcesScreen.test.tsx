import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticArchive } from '../data/syntheticArchive';
import { SourcesScreen } from '../screens/SourcesScreen';
import * as api from '../services/connectionsApi';
import type { LabObservation } from '../domain/types';
import type { DocumentsBackend } from '../services/archiveApi';
import { AppStore } from '../state/store';
import { readinessStub } from './fakeBackend';
import { StoreContext } from '../state/useStore';

vi.mock('../services/connectionsApi', () => ({
  listConnections: vi.fn(),
  startConnect: vi.fn(),
  confirmIdentity: vi.fn(),
  synchronize: vi.fn(),
  disconnect: vi.fn(),
  deleteImported: vi.fn(),
}));

// Fictional throughout: the sandbox provider, a made-up patient and made-up results.
const sandbox = (connection: api.Connection | null = null): api.ProviderEntry => ({
  key: 'epic-sandbox', name: 'Epic sandbox', place: 'Fictional test patients', organization_id: null,
  fhir_base: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4', state: 'available', note: null, registered: true, allowed_here: true, connection,
});
// A health system someone might add in their own provider file. Invented.
const planned: api.ProviderEntry = {
  key: 'fictional-health', name: 'Fictional Health System', place: 'Example City', organization_id: '4242',
  fhir_base: 'https://fhir.example.com/interconnect/api/FHIR/R4', state: 'planned', note: null, registered: false, allowed_here: true, connection: null,
};
const linked = (over: Partial<api.Connection> = {}): api.Connection => ({
  status: 'connected', patient_fhir_id: 'eFictional1', patient_name: 'Avery Fictional', patient_birth_date: '1987-09-12',
  identity_status: 'possible_match', identity_reason: null, connected_at: '2026-11-05T10:00:00Z', disconnected_at: null,
  record_versions: { Observation: 3 }, runs: [], ...over,
});

// A result read from the fictional sandbox, as the service lists it.
const fromProvider = (over: Partial<LabObservation> = {}): LabObservation => ({
  id: 'a'.repeat(32), document_id: null, origin: 'fhir', extraction_status: 'parsed', verification_status: 'proposed', confidence: null,
  reported_name: 'Hemoglobin', test_code: 'hgb', value_text: '14.2', value_number: 14.2, unit: 'g/dL', reference_text: '11.1-15.9', flag: null,
  collected_on: '2026-03-04', reported_on: '2026-03-05', documented_on: null, imported_at: '2026-11-05T10:00:00Z',
  source_page: null, source_line: null, source_text: 'Epic sandbox: Observation eFictionalObs1', issues: [], edited: false,
  original: { reported_name: 'Hemoglobin', value_text: '14.2', unit: 'g/dL' }, possible_duplicates: [],
  revisions: [{ action: 'imported', values: {}, occurred_at: '2026-11-05T10:00:00Z' }], version: 1,
  source_resource: { provider: 'epic-sandbox', resource_type: 'Observation', fhir_id: 'eFictionalObs1', version_id: '2',
    last_updated: '2026-11-04T09:00:00Z', fetched_at: '2026-11-05T10:00:00Z', version_number: 2, versions_kept: 2 },
  ...over,
} as unknown as LabObservation);

function backend() {
  return { ...readinessStub(), maxUploadBytes: 1000, listDocuments: vi.fn(async () => []), listObservations: vi.fn(async () => []),
    setObservationStatus: vi.fn(async () => ({})), correctObservation: vi.fn(async () => ({})) } as never as DocumentsBackend;
}

function mount(providers: api.ProviderEntry[], results: LabObservation[] = [], service = backend()) {
  service.listObservations = vi.fn(async () => results);
  vi.mocked(api.listConnections).mockResolvedValue({ providers, redirect_uri: 'http://127.0.0.1:5180/api/connections/callback' });
  const archive = { ...syntheticArchive, kind: 'personal' as const, observations: results, testNames: ['Hemoglobin'] };
  const store = new AppStore(archive as never, { view: 'sources' }, service);
  store.retryRefresh = vi.fn(async () => {});
  return render(<StoreContext.Provider value={store}><SourcesScreen /></StoreContext.Provider>);
}

beforeEach(() => { vi.clearAllMocks(); window.location.hash = '#/sources'; });

describe('Connected sources', () => {
  it('shows a planned provider as never connectable, and the sandbox as connectable', async () => {
    mount([sandbox(), planned]);
    const plannedSection = await screen.findByRole('region', { name: 'Fictional Health System' });
    expect(plannedSection.textContent).toContain('Planned. Not connected.');
    expect(plannedSection.querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Epic sandbox' }).textContent).toContain('Connect');
  });

  it('asks the person to confirm the patient before anything is imported', async () => {
    vi.mocked(api.confirmIdentity).mockResolvedValue({} as never);
    mount([sandbox(linked({ status: 'awaiting_confirmation', identity_reason: 'The printed patient details resemble yours.' }))]);
    const section = await screen.findByRole('region', { name: 'Epic sandbox' });
    expect(section.textContent).toContain('Avery Fictional');
    expect(section.textContent).not.toContain('Synchronize now');
    fireEvent.click(screen.getByRole('button', { name: 'This is my record' }));
    await waitFor(() => expect(api.confirmIdentity).toHaveBeenCalledWith('epic-sandbox', 'eFictional1'));
  });

  it('synchronizes on request and shows what each run did', async () => {
    vi.mocked(api.synchronize).mockResolvedValue({} as never);
    const run: api.SyncRun = { id: 1, status: 'partial', started_at: '2026-11-05T10:00:00Z', finished_at: '2026-11-05T10:01:00Z',
      counts: { results_proposed: 3, documents_stored: 1 }, problems: ['DiagnosticReport records are not available from this provider (403).'] };
    mount([sandbox(linked({ runs: [run] }))]);
    const section = await screen.findByRole('region', { name: 'Epic sandbox' });
    expect(section.textContent).toContain('3 results to review · 1 PDFs stored');
    expect(section.textContent).toContain('Completed, with problems');
    fireEvent.click(screen.getByRole('button', { name: 'Synchronize now' }));
    await waitFor(() => expect(api.synchronize).toHaveBeenCalledWith('epic-sandbox'));
  });

  it('disconnects only after confirming, and offers deleting records as a separate choice', async () => {
    vi.mocked(api.disconnect).mockResolvedValue({} as never);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    mount([sandbox(linked())]);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(api.disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(api.disconnect).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Delete imported records' })).toBeNull();
    confirm.mockRestore();
  });

  it('a disconnected source keeps its records until they are deleted on purpose', async () => {
    vi.mocked(api.deleteImported).mockResolvedValue({} as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount([sandbox(linked({ status: 'disconnected', disconnected_at: '2026-11-05T11:00:00Z' }))]);
    const section = await screen.findByRole('region', { name: 'Epic sandbox' });
    expect(section.textContent).toContain('Imported records are kept.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete imported records' }));
    await waitFor(() => expect(api.deleteImported).toHaveBeenCalledWith('epic-sandbox'));
  });

  it('decides a provider result with one click, through the same service calls as a document', async () => {
    const service = backend();
    mount([sandbox(linked())], [fromProvider()], service);
    await screen.findByRole('region', { name: 'Results to review' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept Hemoglobin, 14.2 g/dL' })); });
    expect(service.setObservationStatus).toHaveBeenCalledWith('a'.repeat(32), 'verify');
  });

  it('shows the provider record and its stored version, and flags a possible duplicate without deciding it', async () => {
    mount([sandbox(linked())], [fromProvider({ possible_duplicates: ['b'.repeat(32)] })]);
    const list = await screen.findByRole('list', { name: 'Results read from connected sources' });
    expect(list.textContent).toContain('Possible duplicate');
    fireEvent.click(list.querySelector('button[aria-expanded]')!);
    expect(list.textContent).toContain('Read from epic-sandbox: Observation eFictionalObs1, version 2 of 2 kept');
    expect(list.textContent).toContain('also appears elsewhere');
  });

  it('asks for a look first when the provider says a result changed or is preliminary', async () => {
    const service = backend();
    mount([sandbox(linked())], [fromProvider({ issues: ['This result changed at the provider. The earlier version and any decision on it are kept unchanged.'] })], service);
    await screen.findByRole('region', { name: 'Results to review' });
    expect(screen.queryByRole('button', { name: /^Accept Hemoglobin/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check Hemoglobin before deciding' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept as read' })); });
    expect(service.setObservationStatus).toHaveBeenCalledWith('a'.repeat(32), 'verify');
  });

  it('corrects, keeping the provider reading, and reopens and rejects like any result', async () => {
    const service = backend();
    mount([sandbox(linked())], [fromProvider(), fromProvider({ id: 'c'.repeat(32), reported_name: 'Glucose', verification_status: 'verified', value_text: '92', unit: 'mg/dL' })], service);
    await screen.findByRole('region', { name: 'Results to review' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Glucose accepted. Select to undo.' })); });
    expect(service.setObservationStatus).toHaveBeenCalledWith('c'.repeat(32), 'reopen');
    fireEvent.click(document.querySelectorAll('[data-row] button[aria-expanded]')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Correct' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Value'));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '14.3' } });
    await act(async () => { fireEvent.click(screen.getByText('Save and accept')); });
    expect(service.correctObservation).toHaveBeenCalledWith('a'.repeat(32), { value_text: '14.3' });
    expect(service.setObservationStatus).toHaveBeenCalledWith('a'.repeat(32), 'verify');
  });

  it('says when nothing has been read yet', async () => {
    mount([sandbox()]);
    expect((await screen.findByRole('region', { name: 'Results to review' })).textContent).toContain('Nothing has been read from connected sources yet.');
  });

  it('says when its own provider list was left out, without repeating it', async () => {
    vi.mocked(api.listConnections).mockResolvedValue({ providers: [sandbox()], redirect_uri: 'x', provider_file_problem: 'connector-providers.json can be read or changed by other accounts. Run: chmod 600 connector-providers.json' });
    const archive = { ...syntheticArchive, kind: 'personal' as const, observations: [] };
    render(<StoreContext.Provider value={new AppStore(archive as never, { view: 'sources' }, backend())}><SourcesScreen /></StoreContext.Provider>);
    expect((await screen.findByRole('note')).textContent).toContain('Your own provider list was not used');
  });

  it('shows only a fixed message after returning from the provider', async () => {
    window.location.hash = '#/sources?result=declined';
    mount([sandbox()]);
    expect(await screen.findByText('The sign-in was cancelled at the provider. Nothing was saved.')).toBeTruthy();
    await act(async () => {});
    expect(window.location.hash).toBe('#/sources');
  });

  it('in a real archive, the sandbox explains it is not allowed here and offers nothing', async () => {
    mount([{ ...sandbox(), allowed_here: false }]);
    const section = await screen.findByRole('region', { name: 'Epic sandbox' });
    expect(section.textContent).toContain('connects only from a separate sandbox archive');
    expect(section.querySelectorAll('button')).toHaveLength(0);
  });

  it('a provider without a client ID explains instead of offering to connect', async () => {
    mount([{ ...sandbox(), registered: false }]);
    const section = await screen.findByRole('region', { name: 'Epic sandbox' });
    expect(section.textContent).toContain('no client ID');
    expect(section.querySelectorAll('button')).toHaveLength(0);
  });
});
