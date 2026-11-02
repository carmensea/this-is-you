import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../App';
import { ArchiveUnavailable } from '../screens/ArchiveUnavailable';
import type { DocumentsBackend, UploadResult } from '../services/archiveApi';
import { emptyPersonalArchive, toArchiveDocument, withDocuments, type DocumentDto } from '../services/localArchiveApi';
import { AppStore, VIEWS, type AppState } from '../state/store';
import { StoreContext } from '../state/useStore';

const dto = (over: Partial<DocumentDto> = {}): DocumentDto => ({
  id: 'a'.repeat(32),
  original_filename: 'blood work 2024.pdf',
  imported_at: '2026-10-20T15:30:00Z',
  document_type: 'unclassified',
  processing_status: 'uploaded',
  media_type: 'application/pdf',
  byte_size: 2048,
  sha256: 'b'.repeat(64),
  content_url: `/api/documents/${'a'.repeat(32)}/content`,
  ...over,
});

const FICTIONAL = ['DEMONSTRATION DATA', 'Jordan Vale', 'SYNTHETIC SAMPLE RECORD', 'Northfield', 'Synthetic demonstration data', 'Load sample batch'];

function backendWith(result: UploadResult, documents = [toArchiveDocument(dto())]): DocumentsBackend {
  return { maxUploadBytes: 1000, listDocuments: vi.fn(async () => documents), upload: vi.fn(async () => result) };
}

function mount(state: Partial<AppState> = {}, documents: DocumentDto[] = [dto()], backend = backendWith({ kind: 'failed', message: 'x' })) {
  window.location.hash = '';
  const archive = withDocuments(emptyPersonalArchive('2026-11-01'), documents.map(toArchiveDocument));
  const store = new AppStore(archive, { view: 'documents', cur: archive.today, ...state }, backend);
  const ui = render(<StoreContext.Provider value={store}><App /></StoreContext.Provider>);
  return { store, backend, ...ui };
}

const pdf = (name = 'a.pdf', bytes = 10) => new File(['x'.repeat(bytes)], name, { type: 'application/pdf' });

describe('a real archive shows no fictional data', () => {
  it.each(VIEWS)('%s contains none of it and does not crash', view => {
    const { container } = mount({ view });
    for (const text of FICTIONAL) expect(container.textContent).not.toContain(text);
    expect(container.textContent).toContain('your documents (local)');
  });
  it('explains why record screens are empty instead of inventing records', () => {
    const { container } = mount({ view: 'overview' });
    expect(container.textContent).toContain('does not read them yet');
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });
  it('tells the truth about what import does', () => {
    const { container } = mount({ view: 'import' });
    expect(container.textContent).toContain('Nothing in this version reads its contents');
    expect(container.textContent).not.toContain('simulated');
    expect(container.textContent).not.toContain('text recognition');
  });
  it('shows a message rather than demo data when the service is down', () => {
    const { container } = render(<ArchiveUnavailable onRetry={() => {}} />);
    expect(container.textContent).toContain('npm run backend');
    for (const text of ['Jordan Vale', 'DEMONSTRATION DATA']) expect(container.textContent).not.toContain(text);
  });
  it('keeps the dataset out of every module a real archive loads', () => {
    const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const importers = Object.entries(sources)
      .filter(([, text]) => /from '.*syntheticArchive'|import\(.*syntheticArchive/.test(text))
      .map(([path]) => path)
      .filter((path) => !path.includes('test/') && !path.includes('.test.'));
    expect(importers).toEqual(['../services/demoArchiveApi.ts']);
    const dynamicOnly = Object.entries(sources).filter(([path, text]) => !path.includes('.test.') && /from '.*demoArchiveApi'/.test(text));
    expect(dynamicOnly).toEqual([]);
  });
});

describe('real documents on the Documents screen', () => {
  it('shows the original file, and claims nothing unknown about it', () => {
    const { container } = mount();
    expect(screen.getAllByText('blood work 2024.pdf').length).toBeGreaterThan(0);
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe(dto().content_url);
    expect(container.textContent).toContain('b'.repeat(64));
    expect(container.textContent).toContain('Date of serviceNot recorded');
    expect(container.textContent).toContain('ExtractedNothing');
    expect(container.textContent).toContain('Original stored. Nothing extracted yet.');
    expect(screen.getByText('Open original in a new tab').getAttribute('href')).toBe(dto().content_url);
    expect(screen.getByText('Download original').getAttribute('href')).toBe(`${dto().content_url}?download=true`);
  });
  it('does not offer review for a file nothing has read', () => {
    mount();
    expect(screen.queryByText('Review extracted values')).toBeNull();
  });
  it('points to Import when the archive is empty', () => {
    const { store } = mount({}, []);
    fireEvent.click(screen.getByText('Go to Import'));
    expect(store.state.view).toBe('import');
  });
  it('finds documents by filename', () => {
    const { container } = mount({}, [dto(), dto({ id: 'c'.repeat(32), sha256: 'c'.repeat(64), original_filename: 'mri.pdf' })]);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'mri' } });
    expect(container.textContent).toContain('Showing 1.');
  });
  it('treats a filename as text, never as markup', () => {
    const { container } = mount({}, [dto({ original_filename: '<img src=x onerror=alert(1)>.pdf' })]);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('address bar', () => {
  it('opens the screen named in the address, so a reload stays put', () => {
    window.location.hash = '/import';
    const archive = emptyPersonalArchive('2026-11-01');
    const store = new AppStore(archive, { view: 'documents', cur: archive.today }, backendWith({ kind: 'failed', message: 'x' }));
    // StrictMode matches main.tsx, and re-runs effects the way that exposed this bug.
    render(<StrictMode><StoreContext.Provider value={store}><App /></StoreContext.Provider></StrictMode>);
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(store.state.view).toBe('import');
    expect(window.location.hash).toBe('#/import');
  });
});

describe('uploading', () => {
  const stored = toArchiveDocument(dto());
  async function send(result: UploadResult, files: File[], documents = [stored]) {
    const backend = backendWith(result, documents);
    const view = mount({ view: 'import' }, [], backend);
    await act(async () => { view.store.receiveFiles(files); });
    return view;
  }
  it('stores a file and shows it in Documents', async () => {
    const { store, container, backend } = await send({ kind: 'stored', document: stored }, [pdf()]);
    expect(backend.upload).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Stored, not read');
    expect(container.textContent).toContain('1 stored, 0 duplicate');
    expect(store.archive.documents.map(d => d.id)).toEqual([stored.id]);
    fireEvent.click(screen.getByText('View in Documents'));
    expect(store.state.view).toBe('documents');
    expect(store.state.dSel).toBe(stored.id);
  });
  it('explains a duplicate and names the original', async () => {
    const { container } = await send({ kind: 'duplicate', document: stored }, [pdf()]);
    expect(container.textContent).toContain('Duplicate, set aside');
    expect(container.textContent).toContain('Identical to blood work 2024.pdf');
    expect(container.textContent).toContain('nothing was added');
  });
  it('shows the reason a file was refused', async () => {
    const { container } = await send({ kind: 'rejected', message: 'This file is not a readable PDF. Nothing was stored.' }, [pdf()]);
    expect(container.textContent).toContain('Not accepted, nothing stored');
    expect(container.textContent).toContain('not a readable PDF');
  });
  it('reports a failed connection', async () => {
    const { container } = await send({ kind: 'failed', message: 'The upload did not finish. Nothing was stored. Try again.' }, [pdf()]);
    expect(container.textContent).toContain('Upload failed, nothing stored');
  });
  it('turns away other formats and oversized files without sending them', async () => {
    const { backend, container } = await send({ kind: 'stored', document: stored }, [pdf('photo.heic'), pdf('huge.pdf', 2000)]);
    expect(backend.upload).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Only PDF files can be imported');
    expect(container.textContent).toContain('larger than the 0 MB limit');
  });
  it('uploads a whole batch', async () => {
    const { backend } = await send({ kind: 'stored', document: stored }, [pdf('1.pdf'), pdf('2.pdf'), pdf('3.pdf'), pdf('4.pdf'), pdf('5.pdf')]);
    expect(backend.upload).toHaveBeenCalledTimes(5);
  });
  it('still shows the upload result if the list cannot refresh', async () => {
    const backend = backendWith({ kind: 'stored', document: stored });
    backend.listDocuments = vi.fn(async () => { throw new Error('down'); });
    const view = mount({ view: 'import' }, [], backend);
    await act(async () => { view.store.receiveFiles([pdf()]); });
    expect(view.container.textContent).toContain('Stored, not read');
  });
});
