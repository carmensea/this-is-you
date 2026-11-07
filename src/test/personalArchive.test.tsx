import { StrictMode } from 'react';
import { fakeImportServer, type Answer } from './fakeBackend';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../App';
import { viewFromHash } from '../services/archiveMode';
import { ArchiveUnavailable } from '../screens/ArchiveUnavailable';
import { ArchiveRequestError, type DocumentsBackend } from '../services/archiveApi';
import { emptyPersonalArchive, toArchiveDocument, withDocuments, type DocumentDto } from '../services/localArchiveApi';
import { AppStore, VIEWS, type AppState } from '../state/store';
import { StoreContext } from '../state/useStore';

type Proposal = NonNullable<DocumentDto['metadata']['provider']['proposal']>;
const field = (state: DocumentDto['metadata']['provider']['state'], value: string | null = null, proposal: Proposal | null = null) => ({ state, value, decided_at: value ? '2026-10-21T00:00:00Z' : null, proposal });

const dto = (over: Partial<DocumentDto> = {}): DocumentDto => ({
  id: 'a'.repeat(32),
  original_filename: 'blood work 2024.pdf',
  imported_at: '2026-10-20T15:30:00Z',
  media_type: 'application/pdf',
  byte_size: 2048,
  sha256: 'b'.repeat(64),
  content_url: `/api/documents/${'a'.repeat(32)}/content`,
  extraction_status: 'extracted',
  review_status: 'not_started',
  verification_status: 'unverified',
  page_count: 2,
  pages_read: 2,
  pages_with_text: 2,
  truncated: false,
  possible_duplicates: [],
  metadata: {
    document_type: field('proposed', null, { id: 1, value: 'lab', confidence: 'high', reason: 'Found "laboratory report".', page: 1, snippet: 'LABORATORY REPORT', method: 'rules-v1' }),
    service_date: field('proposed', null, { id: 2, value: '2024-03-11', confidence: 'low', reason: 'The numbers could be read two ways.', page: 2, snippet: 'Date of Service: 03/11/2024', method: 'rules-v1' }),
    provider: field('missing'),
    report_title: field('proposed', null, { id: 4, value: 'Fictional Panel Report', confidence: 'medium', reason: 'Looks like a heading.', page: 1, snippet: 'Fictional Panel Report', method: 'rules-v1' }),
  },
  ...over,
});

const FICTIONAL = ['DEMONSTRATION DATA', 'Jordan Vale', 'SYNTHETIC SAMPLE RECORD', 'Northfield', 'Synthetic demonstration data', 'Load sample batch'];

function backendWith(answer: Answer = { state: 'stored' }, documents = [toArchiveDocument(dto())]): DocumentsBackend {
  return {
    ...fakeImportServer(answer),
    maxUploadBytes: 1000,
    listDocuments: vi.fn(async () => documents),
    decide: vi.fn(async () => toArchiveDocument(dto())),
    setReview: vi.fn(async () => toArchiveDocument(dto())),
    readAgain: vi.fn(async () => toArchiveDocument(dto())),
    listObservations: vi.fn(async () => []),
    correctObservation: vi.fn(),
    setObservationStatus: vi.fn(),
    approveGroup: vi.fn(),
    undoGroup: vi.fn(),
    createObservation: vi.fn(),
  };
}

function mount(state: Partial<AppState> = {}, documents: DocumentDto[] = [dto()], backend = backendWith()) {
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
    expect(container.textContent).toContain('laboratory results you have verified, and there are none yet');
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });
  it('tells the truth about what import does', () => {
    const { container } = mount({ view: 'import' });
    expect(container.textContent).toContain('Nothing is sent anywhere');
    expect(container.textContent).toContain('Nothing is verified until you accept it');
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
    const { container } = mount({ rvDoc: dto().id, dSel: dto().id });
    expect(screen.getAllByText('blood work 2024.pdf').length).toBeGreaterThan(0);
    expect(container.querySelector('[aria-label^="Original file"]')!.getAttribute('data-file')).toBe(dto().content_url);
    expect(container.textContent).toContain('b'.repeat(64));
    expect(container.textContent).toContain('Proposed, not verified · low confidence');
    expect(container.textContent).toContain('Nothing found');
    expect(container.textContent).toContain('VerificationNot verified');
    expect(container.textContent).toContain('ReviewNot started');
    expect(container.textContent).toContain('ReadingText read');
    expect(screen.queryByText('Open original in a new tab')).toBeNull();
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(screen.getByText('Download original').getAttribute('href')).toBe(`${dto().content_url}?download=true`);
  });
  it('does not offer review while a file is still being read', () => {
    mount({}, [dto({ extraction_status: 'running' })]);
    expect(screen.queryByText('Review details')).toBeNull();
  });
  it('opens a document straight into its workspace, and back to the list with it still marked', () => {
    const { store } = mount();
    fireEvent.click(screen.getByRole('button', { name: /blood work 2024\.pdf/ }));
    expect(store.state.view).toBe('documents');
    expect(store.state.rvDoc).toBe(dto().id);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(store.archive.documents[0].title);
    expect(screen.queryByText('Review measurements')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '‹ Documents' }));
    expect(store.state.rvDoc).toBeNull();
    expect(screen.getByRole('button', { name: /blood work 2024\.pdf/ }).getAttribute('aria-current')).toBe('true');
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
  it('reads the screen from the address, ignoring anything unknown', () => {
    expect(viewFromHash('#/compare')).toBe('compare');
    expect(viewFromHash('')).toBeNull();
    expect(viewFromHash('#/../../etc')).toBeNull();
  });
  it('opens the screen named in the address, so a reload stays put', () => {
    window.location.hash = '/import';
    const archive = emptyPersonalArchive('2026-11-01');
    const store = new AppStore(archive, { view: 'documents', cur: archive.today }, backendWith());
    // StrictMode matches main.tsx, and re-runs effects the way that exposed this bug.
    render(<StrictMode><StoreContext.Provider value={store}><App /></StoreContext.Provider></StrictMode>);
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(store.state.view).toBe('import');
    expect(window.location.hash).toBe('#/import');
  });
});

describe('inferred details never pass as verified', () => {
  const decidedDto = dto({
    review_status: 'in_progress',
    verification_status: 'partially_verified',
    metadata: {
      ...dto().metadata,
      document_type: field('confirmed', 'imaging', dto().metadata.document_type.proposal),
      service_date: field('corrected', '2024-11-03', dto().metadata.service_date.proposal),
      provider: field('not_stated'),
    },
  });
  it('a proposal changes nothing the app treats as fact', () => {
    const d = toArchiveDocument(dto());
    expect(d.title).toBe('blood work 2024.pdf');
    expect(d.source).toBe('Uploaded file');
    expect(d.cat).toBe('other');
    expect(d.dateUnknown).toBe(true);
    expect(d.date).toBe(d.documented);
  });
  it('only a decision does', () => {
    const d = toArchiveDocument(decidedDto);
    expect(d.cat).toBe('imaging');
    expect(d.date).toBe('2024-11-03');
    expect(d.dateUnknown).toBe(false);
    expect(d.title).toBe('blood work 2024.pdf');
  });
  it('labels a proposed type as proposed in the list', () => {
    const { container } = mount();
    expect(container.textContent).toContain('Proposed: Laboratory report');
    expect(container.textContent).toContain('3 proposed');
  });
  it('shows how each detail was decided', () => {
    mount({ rvDoc: decidedDto.id, dSel: decidedDto.id, rvDetailsOpen: true }, [decidedDto]);
    const details = screen.getByRole('region', { name: 'Document details' }).textContent!;
    expect(details).toContain('ConfirmedImaging report');
    expect(details).toContain('Corrected by you3 November 2024');
    expect(details).toContain('Read from the document as 11 March 2024. Your correction is kept beside it.');
    expect(details).toContain('Not stated in the document');
  });
  it('explains files it could not read', () => {
    for (const [status, text] of [['image_only', 'Image-only PDF'], ['encrypted', 'password protected'], ['too_complex', 'safety limits']] as const) {
      const { container, unmount } = mount({ rvDoc: dto().id, dSel: dto().id }, [dto({ extraction_status: status, metadata: { document_type: field('missing'), service_date: field('missing'), provider: field('missing'), report_title: field('missing') } })]);
      expect(container.textContent).toContain(text);
      expect(container.querySelector('[aria-label^="Original file"]')).not.toBeNull();
      unmount();
    }
  });
  it('flags possible duplicates without merging them', () => {
    const { container, store } = mount({}, [dto({ possible_duplicates: ['c'.repeat(32)] }), dto({ id: 'c'.repeat(32), sha256: 'c'.repeat(64), possible_duplicates: ['a'.repeat(32)] })]);
    expect(container.textContent).toContain('Possible duplicate');
    expect(store.archive.documents).toHaveLength(2);
  });
});

describe('the review workflow', () => {
  const open = () => {
    const backend = backendWith();
    const view = mount({ view: 'import', rvDoc: dto().id }, [dto()], backend);
    return { ...view, backend };
  };
  it('shows the proposal, its confidence, its source, and the real file', () => {
    const { container } = open();
    expect(container.textContent).toContain('Proposed, not verified · low confidence');
    expect(container.textContent).toContain('The numbers could be read two ways.');
    expect(container.textContent).toContain('Source, page 2: "Date of Service: 03/11/2024" · rules-v1');
    expect(container.querySelector('[aria-label^="Original file"]')!.getAttribute('data-file')).toBe(dto().content_url);
    expect(container.textContent).not.toContain('SYNTHETIC SAMPLE RECORD');
  });
  it('follows a proposal back to its page in the original', () => {
    const { container } = open();
    fireEvent.click(screen.getByText('Show page 2'));
    expect(container.querySelector('[aria-label^="Original file"]')!.getAttribute('data-page')).toBe('2');
  });
  it('sends the exact proposal a person confirmed', async () => {
    const { backend } = open();
    await act(async () => { fireEvent.click(screen.getAllByText('Confirm')[1]); });
    expect(backend.decide).toHaveBeenCalledWith(dto().id, 'service_date', { action: 'confirmed', proposal_id: 2 });
  });
  it('offers no Confirm when nothing was proposed', () => {
    open();
    expect(screen.getAllByText('Confirm')).toHaveLength(3);
    expect(screen.getByText('Nothing was found. Enter it, or mark it as not stated.')).toBeTruthy();
  });
  it('edits a date with a date input and saves the correction', async () => {
    const { backend, container } = open();
    fireEvent.click(screen.getAllByText('Correct')[1]);
    const input = container.querySelector('input[type=date]') as HTMLInputElement;
    expect(input.value).toBe('2024-03-11');
    fireEvent.change(input, { target: { value: '2024-11-03' } });
    await act(async () => { fireEvent.click(screen.getByText('Save correction')); });
    expect(backend.decide).toHaveBeenCalledWith(dto().id, 'service_date', { action: 'corrected', value: '2024-11-03' });
  });
  it('edits the type by choosing from the known types', async () => {
    const { backend } = open();
    fireEvent.click(screen.getAllByText('Correct')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Imaging report' }));
    await act(async () => { fireEvent.click(screen.getByText('Save correction')); });
    expect(backend.decide).toHaveBeenCalledWith(dto().id, 'document_type', { action: 'corrected', value: 'imaging' });
  });
  it('marks a detail as not stated', async () => {
    const { backend } = open();
    await act(async () => { fireEvent.click(screen.getAllByText('Not stated')[2]); });
    expect(backend.decide).toHaveBeenCalledWith(dto().id, 'provider', { action: 'not_stated' });
  });
  it('shows a refused save and keeps the editor open', async () => {
    const { backend } = open();
    backend.decide = vi.fn(async () => { throw new ArchiveRequestError('The date must be between 1900 and today.', 'invalid_value'); });
    fireEvent.click(screen.getAllByText('Correct')[1]);
    await act(async () => { fireEvent.click(screen.getByText('Save correction')); });
    expect(screen.getByRole('alert').textContent).toContain('between 1900 and today');
    expect(screen.getByText('Save correction')).toBeTruthy();
  });
  it('catches up after a stale proposal rather than confirming blindly', async () => {
    const { backend } = open();
    backend.decide = vi.fn(async () => { throw new ArchiveRequestError('This proposal has changed.', 'stale_proposal'); });
    await act(async () => { fireEvent.click(screen.getAllByText('Confirm')[0]); });
    expect(backend.listDocuments).toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('This proposal has changed');
  });
  it('folds the details away once all are decided, and shows them again on request', () => {
    const decided = { document_type: field('confirmed', 'lab'), service_date: field('confirmed', '2024-03-11'), provider: field('not_stated'), report_title: field('corrected', 'A Title') };
    mount({ view: 'import', rvDoc: dto().id }, [dto({ metadata: decided })], backendWith());
    const details = screen.getByRole('region', { name: 'Document details' });
    expect(details.textContent).toContain('All 4 decided, 1 corrected by you');
    expect(screen.queryByText('Correct')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(details.textContent).toContain('Corrected by you');
    expect(details.textContent).toContain('Marked not stated');
  });
  it('changes a decided detail as a new decision, never by erasing the old one', async () => {
    const backend = backendWith();
    const decided = { document_type: field('confirmed', 'lab'), service_date: field('confirmed', '2024-03-11'), provider: field('not_stated'), report_title: field('corrected', 'A Title') };
    mount({ view: 'import', rvDoc: dto().id, rvDetailsOpen: true }, [dto({ metadata: decided })], backend);
    fireEvent.click(screen.getAllByRole('button', { name: 'Change' })[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Correct' }));
    fireEvent.change(screen.getByLabelText('Corrected value'), { target: { value: 'Fictional Lab' } });
    await act(async () => { fireEvent.click(screen.getByText('Save correction')); });
    expect(backend.decide).toHaveBeenCalledWith(dto().id, 'provider', { action: 'corrected', value: 'Fictional Lab' });
  });
  it('puts the focus in a detail editor, and Escape closes it and gives the focus back', () => {
    const { backend, container } = open();
    fireEvent.click(screen.getAllByText('Correct')[1]);
    const input = container.querySelector('input[type=date]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('input[type=date]')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Correct');
    expect(backend.decide).not.toHaveBeenCalled();
  });
  it('offers no way to finish until every detail is decided', () => {
    open();
    expect(screen.queryByRole('button', { name: 'Mark document as reviewed' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Finish this review' }).textContent).toContain('4 document details to decide');
  });
  it('completes the review through the service', async () => {
    const backend = backendWith();
    const all = field('confirmed', 'lab');
    const view = mount({ view: 'import', rvDoc: dto().id }, [dto({ metadata: { document_type: all, service_date: field('confirmed', '2024-03-11'), provider: field('not_stated'), report_title: field('corrected', 'A Title') } })], backend);
    // Inline at the end of the workspace, with nothing left to decide: no separate confirmation page.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark document as reviewed' })); });
    expect(backend.setReview).toHaveBeenCalledWith(dto().id, true);
    expect(view.store.state.rvDoc).toBe(dto().id);
  });
  it('lists read documents in the review queue, and not reviewed ones', () => {
    const { container, unmount } = mount({ view: 'import' });
    expect(container.textContent).toContain('1 document waiting for review');
    expect(container.textContent).toContain('2 items need attention');
    unmount();
    expect(mount({ view: 'import' }, [dto({ review_status: 'completed' })]).container.textContent).toContain('0 documents waiting');
  });
});

describe('uploading', () => {
  async function send(answer: Answer, files: File[], documents = [toArchiveDocument(dto())]) {
    const backend = backendWith(answer, documents);
    const view = mount({ view: 'import' }, [], backend);
    await act(async () => { await view.store.imports.receive(files); });
    return view;
  }
  it('stores a file and shows it in Documents', async () => {
    const { store, container, backend } = await send({ state: 'stored', extraction: 'extracted' }, [pdf()]);
    expect(backend.uploadBatchItem).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Stored, ready for review');
    expect(container.textContent).toContain('None verified yet');
    expect(container.textContent).toContain('1 file listed, 1 received');
    expect(store.archive.documents.map(d => d.id)).toEqual([dto().id]);
    fireEvent.click(screen.getByText('View in Documents'));
    expect(store.state.view).toBe('documents');
    expect(store.state.dSel).toBe('d0');
  });
  it('explains a duplicate and names the original', async () => {
    const { container } = await send({ state: 'duplicate' }, [pdf()]);
    expect(container.textContent).toContain('Duplicate, set aside');
    expect(container.textContent).toContain('Identical to blood work 2024.pdf');
    expect(container.textContent).toContain('nothing was added');
  });
  it('shows the reason a file was refused', async () => {
    const { container } = await send({ state: 'rejected', message: 'This file is not a readable PDF. Nothing was stored.' }, [pdf()]);
    expect(container.textContent).toContain('Not accepted, nothing stored');
    expect(container.textContent).toContain('not a readable PDF');
  });
  it('lists other formats and oversized files without sending them', async () => {
    const { backend, container } = await send({ state: 'stored' }, [pdf('photo.heic'), pdf('huge.pdf', 2000)]);
    expect(backend.uploadBatchItem).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Only PDF files can be imported');
    expect(container.textContent).toContain('larger than the 0 MB limit');
  });
  it('uploads a whole batch', async () => {
    const { backend } = await send({ state: 'stored' }, [pdf('1.pdf'), pdf('2.pdf'), pdf('3.pdf'), pdf('4.pdf'), pdf('5.pdf')]);
    expect(backend.uploadBatchItem).toHaveBeenCalledTimes(5);
  });
  it('still shows the upload result if the list cannot refresh, and says the screen may be behind', async () => {
    const backend = backendWith({ state: 'stored', extraction: 'extracted' });
    backend.listDocuments = vi.fn(async () => { throw new Error('down'); });
    const view = mount({ view: 'import' }, [], backend);
    await act(async () => { await view.store.imports.receive([pdf()]); });
    expect(view.container.textContent).toContain('Stored, ready for review');
    expect(view.container.textContent).toContain('may be out of date');
  });
});
