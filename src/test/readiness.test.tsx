import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { IdentityCheck } from '../domain/types';
import { ArchiveUnavailable } from '../screens/ArchiveUnavailable';
import { ArchiveReadError, type DocumentsBackend } from '../services/archiveApi';
import { droppedPath, walkEntry } from '../services/droppedFiles';
import { connectLocalArchive, emptyPersonalArchive, READ_RETRY_DELAYS_MS, toArchiveDocument, withDocuments, type DocumentDto } from '../services/localArchiveApi';
import { UPLOAD_RETRY_DELAYS_MS } from '../state/batchImport';
import { AppStore, type AppState } from '../state/store';
import { StoreContext } from '../state/useStore';
import { fakeImportServer, type Answer } from './fakeBackend';

const noField = { state: 'missing', value: null, decided_at: null, proposal: null } as const;
const dto = (over: Partial<DocumentDto> = {}): DocumentDto => ({
  id: 'd0', original_filename: 'a.pdf', imported_at: '2026-11-01T12:00:00Z', media_type: 'application/pdf', byte_size: 10, sha256: 'ab', content_url: '/x',
  extraction_status: 'extracted', review_status: 'not_started', verification_status: 'unverified', page_count: 1, pages_read: 1, pages_with_text: 1, truncated: false,
  metadata: { document_type: noField, service_date: noField, provider: noField, report_title: noField }, possible_duplicates: [], ...over,
});

function backendWith(answer: Answer = {}, documents: DocumentDto[] = []) {
  return {
    ...fakeImportServer(answer),
    maxUploadBytes: 1000,
    listDocuments: vi.fn(async () => documents.map(toArchiveDocument)),
    decide: vi.fn(), setReview: vi.fn(), readAgain: vi.fn(),
    listObservations: vi.fn(async () => []),
    correctObservation: vi.fn(), setObservationStatus: vi.fn(), verifyObservations: vi.fn(), createObservation: vi.fn(),
  } as unknown as DocumentsBackend & { rows: ReturnType<typeof fakeImportServer>['rows']; down: boolean };
}

function mount(backend = backendWith(), state: Partial<AppState> = {}, documents: DocumentDto[] = []) {
  window.location.hash = '';
  const store = new AppStore(withDocuments(emptyPersonalArchive('2026-11-01'), documents.map(toArchiveDocument)), { view: 'import', cur: '2026-11-01', ...state }, backend);
  const ui = render(<StoreContext.Provider value={store}><App /></StoreContext.Provider>);
  return { store, backend, ...ui };
}

const file = (path: string, bytes = 10) => {
  const f = new File(['x'.repeat(bytes)], path.split('/').pop()!, { type: 'application/pdf' });
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
};

function respond(status: number, body: unknown, service = true) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: service ? { 'x-content-type-options': 'nosniff' } : {} });
}

describe('reading from the service', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const settle = async <T,>(p: Promise<T>) => {
    const outcome = p.then((v) => ({ v }), (e) => ({ e }));
    await vi.runAllTimersAsync();
    return outcome as Promise<{ v?: T; e?: ArchiveReadError }>;
  };
  const routes = (status: () => Response) =>
    vi.fn(async (url: string) => (url === '/api/status' ? respond(200, { max_upload_bytes: 10 }) : status()));

  it('recovers from a passing failure without showing anything', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/status') return respond(200, { max_upload_bytes: 10 });
      if (url === '/api/documents' && ++calls < 3) throw new TypeError('connection reset');
      return url === '/api/documents' ? respond(200, { documents: [dto()] }) : url === '/api/observations' ? respond(200, { observations: [] }) : respond(200, []);
    });
    vi.stubGlobal('fetch', fetcher);
    const { api } = await connectLocalArchive();
    const { v } = await settle(api.loadArchive());
    expect(v!.documents.map((d) => d.id)).toEqual(['d0']);
    expect(calls).toBe(3);
  });
  it('gives up after a bounded number of tries', async () => {
    const fetcher = routes(() => respond(500, '', false));
    vi.stubGlobal('fetch', fetcher);
    const { api } = await connectLocalArchive();
    fetcher.mockClear();
    const { e } = await settle(api.loadArchive());
    expect(e).toBeInstanceOf(ArchiveReadError);
    expect(e!.kind).toBe('unreachable');
    // Three reads at once, each with a first try and its retries. Never unbounded.
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3 * (READ_RETRY_DELAYS_MS.length + 1));
  });
  it('tells an error from the service apart from no service at all', async () => {
    vi.stubGlobal('fetch', routes(() => respond(500, { message: 'x' })));
    const { api } = await connectLocalArchive();
    expect((await settle(api.loadArchive())).e!.kind).toBe('error');
  });
  it('does not retry what the service refused', async () => {
    const fetcher = routes(() => respond(404, { message: 'x' }));
    vi.stubGlobal('fetch', fetcher);
    const { api } = await connectLocalArchive();
    fetcher.mockClear();
    expect((await settle(api.loadArchive())).e!.kind).toBe('error');
    expect(fetcher.mock.calls.length).toBe(3);
  });
  it('does not take a proxy page for an answer', async () => {
    vi.stubGlobal('fetch', routes(() => respond(200, '<html>not the service</html>', false)));
    const { api } = await connectLocalArchive();
    expect((await settle(api.loadArchive())).e!.kind).toBe('unreachable');
  });
  it('reads an empty archive as empty, not as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(200, url === '/api/status' ? { max_upload_bytes: 10 } : url === '/api/documents' ? { documents: [] } : url === '/api/observations' ? { observations: [] } : [])));
    const { api } = await connectLocalArchive();
    const { v } = await settle(api.loadArchive());
    expect(v!.documents).toEqual([]);
    expect(v!.kind).toBe('personal');
  });
});

describe('the failed read screen', () => {
  it('offers a visible Retry that reloads, says what failed, and shows no records', async () => {
    let finish = () => {};
    const onRetry = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { container } = render(<ArchiveUnavailable onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    // A second press while one is running does nothing.
    expect((screen.getByRole('button', { name: 'Retrying' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
    expect(screen.getByRole('status').textContent).toContain('Still not available');
    expect(container.textContent).toContain('does not mean your archive is empty');
    expect(container.textContent).not.toContain('Jordan Vale');
  });
  it('does not blame a stopped service for an error it answered with', () => {
    const { container } = render(<ArchiveUnavailable onRetry={() => {}} kind="error" />);
    expect(container.textContent).toContain('answered with an error');
    expect(container.textContent).not.toContain('npm run backend');
  });
});

describe('a refresh that fails during use', () => {
  it('keeps the records on screen, flags them, and recovers on Retry', async () => {
    const backend = backendWith({}, [dto()]);
    const { store, container } = mount(backend, { view: 'documents' }, [dto()]);
    backend.listDocuments = vi.fn(async () => { throw new Error('down'); });
    await act(async () => { await store.refreshDocuments(backend); });
    expect(store.archive.documents).toHaveLength(1);
    expect(store.archive.kind).toBe('personal');
    expect(screen.getByRole('alert').textContent).toContain('may be out of date');
    backend.listDocuments = vi.fn(async () => [toArchiveDocument(dto())]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor(() => expect(store.state.archiveStale).toBe(false));
    expect(container.textContent).not.toContain('may be out of date');
  });
});

describe('the import report', () => {
  it('is loaded when Import opens, and not by other screens, so it cannot delay their charts', async () => {
    const server = backendWith();
    const { store } = mount(server, { view: 'documents' });
    await act(async () => {});
    expect(server.listBatches).not.toHaveBeenCalled();
    expect(server.listBackups).not.toHaveBeenCalled();
    await act(async () => { store.go('import'); });
    expect(server.listBatches).toHaveBeenCalled();
    expect(server.listBackups).toHaveBeenCalled();
  });
  it('lists every file of a nested folder, with non-PDFs in the report and not sent', async () => {
    const { store, backend, container } = mount();
    await act(async () => { await store.imports.receive([file('Records/2019/a.pdf'), file('Records/2019/deep/b.pdf'), file('Records/notes.docx')]); });
    expect(backend.uploadBatchItem).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Records/2019/deep/b.pdf');
    expect(container.textContent).toContain('Records/notes.docx');
    expect(container.textContent).toContain('Only PDF files');
    expect(container.textContent).toContain('3 files listed, 3 received');
  });
  it('comes back after the page is closed, from the service alone', async () => {
    const server = backendWith();
    const first = mount(server);
    await act(async () => { await first.store.imports.receive([file('Records/a.pdf')]); });
    first.unmount();
    const second = mount(server);
    expect(second.container.textContent).not.toContain('Records/a.pdf');
    await act(async () => { await second.store.imports.load(); });
    expect(second.container.textContent).toContain('Records/a.pdf');
  });
  it('resumes from the same folder and sends only what did not finish', async () => {
    const server = backendWith();
    const first = mount(server);
    server.rows.set('b0', []);
    await server.addBatchItems('b0', [{ path: 'Records/a.pdf', size: 10, modified: 1 }, { path: 'Records/b.pdf', size: 10, modified: 1 }]);
    await server.uploadBatchItem('b0', 1, file('Records/a.pdf'));
    vi.mocked(server.uploadBatchItem).mockClear();
    await act(async () => { await first.store.imports.load(); });
    expect(first.container.textContent).toContain('stopped with 1 file not received');
    await act(async () => { await first.store.imports.receive([file('Records/a.pdf'), file('Records/b.pdf')]); });
    expect(server.uploadBatchItem).toHaveBeenCalledOnce();
    expect(server.rows.size).toBe(1);
    expect(first.container.textContent).not.toContain('not received. Choose');
  });
  it('tries a dropped connection again, without counting it as a second file', async () => {
    vi.useFakeTimers();
    try {
      const server = backendWith({ unreachable: 1 });
      const { store } = mount(server);
      const run = store.imports.receive([file('Records/a.pdf')]);
      await act(async () => { await vi.advanceTimersByTimeAsync(UPLOAD_RETRY_DELAYS_MS[0] + 1); await run; });
      expect(server.uploadBatchItem).toHaveBeenCalledTimes(2);
      expect(server.rows.get('b0')![0].state).toBe('stored');
      expect(store.state.report.problem).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('pauses when the service stops answering, and says nothing was lost', async () => {
    vi.useFakeTimers();
    try {
      const server = backendWith();
      const { store, container } = mount(server);
      const files = Array.from({ length: 30 }, (_, i) => file(`Records/${i}.pdf`));
      vi.mocked(server.uploadBatchItem).mockResolvedValue({ kind: 'unreachable' });
      const run = store.imports.receive(files);
      await act(async () => { await vi.runAllTimersAsync(); await run; });
      expect(vi.mocked(server.uploadBatchItem).mock.calls.length).toBeLessThan(30);
      expect(container.textContent).toContain('stopped answering');
      expect(container.textContent).toContain('Everything already stored is safe');
    } finally {
      vi.useRealTimers();
    }
  });
  it('retries a failure from the row while the file is still in hand', async () => {
    const server = backendWith({ state: 'rejected', message: 'This file is not a readable PDF. Nothing was stored.' });
    const { store } = mount(server);
    await act(async () => { await store.imports.receive([file('Records/a.pdf')]); });
    vi.mocked(server.uploadBatchItem).mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor(() => expect(server.uploadBatchItem).toHaveBeenCalledOnce());
  });
  it('after a reload, says the folder has to be chosen again instead of pretending to retry', async () => {
    const server = backendWith({ state: 'rejected', message: 'refused' });
    const first = mount(server);
    await act(async () => { await first.store.imports.receive([file('Records/a.pdf')]); });
    first.unmount();
    const second = mount(server);
    await act(async () => { await second.store.imports.load(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry failures' })); });
    await waitFor(() => expect(second.container.textContent).toContain('choosing again'));
  });
  it('separates storing, reading and verifying on each line', async () => {
    const { store, container } = mount(backendWith({ state: 'stored', extraction: 'image_only' }));
    await act(async () => { await store.imports.receive([file('Records/scan.pdf')]); });
    expect(container.textContent).toContain('Stored, scanned, not read');
    expect(container.textContent).toContain('Stored unchanged.');
    expect(container.textContent).toContain('text recognition is not part of this version');
    expect(container.textContent).toContain('None verified yet.');
  });
  it('filters by what happened', async () => {
    const server = backendWith();
    const { store } = mount(server);
    await act(async () => { await store.imports.receive([file('Records/a.pdf'), file('Records/b.jpg')]); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Unsupported/ })); });
    await waitFor(() => expect(store.state.report.items.map((i) => i.path)).toEqual(['Records/b.jpg']));
  });
  it('tells an unavailable report apart from having none', async () => {
    const server = backendWith();
    const { store, container } = mount(server);
    await act(async () => { await store.imports.load(); });
    expect(container.textContent).not.toContain('Import report');
    vi.mocked(server.listBatches).mockRejectedValue(new Error('down'));
    await act(async () => { await store.imports.load(); });
    expect(container.textContent).toContain('could not be loaded');
    expect(container.textContent).toContain('has not been lost');
  });
  it('is absent in the demo, which has no backend', async () => {
    const store = new AppStore(emptyPersonalArchive('2026-11-01'), { view: 'import' }, null);
    await act(async () => { await store.imports.receive([file('Records/a.pdf')]); });
    expect(store.state.report.batches).toEqual([]);
  });
});

describe('folders that are dropped', () => {
  const fileEntry = (name: string): FileSystemEntry => ({ name, isFile: true, isDirectory: false, file: (ok: (f: File) => void) => ok(new File(['x'], name)) } as unknown as FileSystemEntry);
  const dirEntry = (name: string, children: FileSystemEntry[]): FileSystemEntry =>
    ({
      name, isFile: false, isDirectory: true,
      createReader: () => {
        // As browsers do: part of the list per call, then an empty answer.
        const left = [...children];
        return { readEntries: (ok: (e: FileSystemEntry[]) => void) => ok(left.splice(0, 100)) };
      },
    }) as unknown as FileSystemEntry;
  it('walks nested folders, past the 100 entries a reader hands over at once', async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`${i}.pdf`));
    const out: File[] = [];
    await walkEntry(dirEntry('Records', [dirEntry('2019', many), fileEntry('top.pdf')]), '', out);
    expect(out).toHaveLength(251);
    expect(droppedPath(out[249])).toBe('Records/2019/249.pdf');
    expect(droppedPath(out[250])).toBe('Records/top.pdf');
  });
});

describe('identity flags', () => {
  const mismatch: IdentityCheck = { status: 'possible_mismatch', reason: 'Check this document: it prints the name "Morgan Otherperson", which differs from your details.', names_found: ['Morgan Otherperson'], birth_dates_found: [] };
  it('marks a document for a person to check, and keeps every way to open and review it', () => {
    const { container, store } = mount(backendWith(), { view: 'documents', dSel: 'd0' }, [dto({ identity: mismatch })]);
    expect(container.textContent).toContain('Check whose document this is');
    expect(container.textContent).toContain('Morgan Otherperson');
    expect(store.archive.documents).toHaveLength(1);
    expect(store.archive.documents[0].review!.verification).toBe('unverified');
  });
  it('shows on the review screen, which still opens', () => {
    const { container } = mount(backendWith(), { view: 'import', rvDoc: 'd0' }, [dto({ identity: mismatch })]);
    expect(container.textContent).toContain('Morgan Otherperson');
  });
  it('says when identity could not be determined, and says nothing when no details are set', () => {
    const undetermined: IdentityCheck = { status: 'undetermined', reason: 'Could not be determined: no readable text to compare.', names_found: [], birth_dates_found: [] };
    expect(toArchiveDocument(dto({ identity: undetermined })).note).toContain('Could not be determined');
    expect(toArchiveDocument(dto({ identity: { ...undetermined, status: 'not_configured', reason: 'Your details are not set.' } })).note).not.toContain('Your details');
  });
  it('saves details and shows them, with no birth date required', async () => {
    const server = backendWith();
    const { store, container } = mount(server);
    await act(async () => { await store.loadArchiveSafety(); });
    fireEvent.click(screen.getByRole('button', { name: 'Enter your details' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Avery Testperson' } });
    fireEvent.change(screen.getByLabelText(/Previous names/), { target: { value: 'Avery Oldname\n' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save details' })); });
    expect(server.saveIdentity).toHaveBeenCalledWith({ full_name: 'Avery Testperson', date_of_birth: null, previous_names: ['Avery Oldname'] });
    expect(container.textContent).toContain('also Avery Oldname');
  });
});

describe('backups', () => {
  const entry = (over = {}) => ({ name: 'this-is-you-backup-20261102T100000Z', state: 'complete', created_at: 't', documents: 3, bytes: 2048, last_check: null, ...over });
  const withBackups = (backups: unknown[], extra = {}) => {
    const server = backendWith();
    server.listBackups = vi.fn(async () => ({ location: '/private/backups', backups, running: null, last_result: null, ...extra })) as never;
    return server;
  };
  it('shows only what a check has shown about each backup', async () => {
    const server = withBackups([entry(), entry({ name: 'b', last_check: { checked_at: '2026-11-02T10:00:00Z', ok: true, problems: [] } }), entry({ name: 'c', last_check: { checked_at: '2026-11-02T10:00:00Z', ok: false, problems: ['x'] } }), entry({ name: 'd', state: 'incomplete', documents: null })]);
    const { store, container } = mount(server);
    await act(async () => { await store.loadArchiveSafety(); });
    for (const text of ['Not checked yet', 'Restore tested', 'Failed its last check', 'Did not finish, cannot be used']) expect(container.textContent).toContain(text);
    expect(container.textContent).toContain('not encrypted');
    expect(screen.getAllByRole('button', { name: 'Test restore' })).toHaveLength(3);
  });
  it('starts a backup, names its problem, and offers no restore over the archive from the browser', async () => {
    const server = withBackups([], { last_result: { kind: 'backup', name: null, ok: false, problems: ['There is not enough free space for this backup.'] } });
    const { store, container } = mount(server);
    await act(async () => { await store.loadArchiveSafety(); });
    expect(container.textContent).toContain('not enough free space');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back up now' })); });
    expect(server.startBackup).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();
  });
});
