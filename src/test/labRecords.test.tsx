import { describe, expect, it, vi, type Mock } from 'vitest';
import { readinessStub } from './fakeBackend';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../App';
import { fLong, fShort, toT } from '../domain/dates';
import type { ArchiveDocument, LabObservation } from '../domain/types';
import type { DocumentsBackend } from '../services/archiveApi';
import {
  buildPersonalArchive,
  emptyPersonalArchive,
  toArchiveDocument,
  type DocumentDto,
} from '../services/localArchiveApi';
import { AppStore, type AppState } from '../state/store';
import { StoreContext } from '../state/useStore';
import { compareVM } from '../viewmodels/compare';
import { overviewVM } from '../viewmodels/overview';

const TODAY = '2026-11-01';
let seq = 0;

const obs = (over: Partial<LabObservation> = {}): LabObservation => {
  const id = String(++seq).padStart(32, '0');
  return {
    id,
    document_id: 'd'.repeat(32),
    origin: 'extracted',
    extraction_status: 'parsed',
    verification_status: 'verified',
    confidence: 'high',
    reported_name: 'LDL Cholesterol',
    test_code: 'ldl',
    test_name: 'LDL cholesterol',
    test_short: 'LDL',
    category: 'lipid',
    compare_group: 'lipid',
    value_text: '118',
    value_number: 118,
    unit: 'mg/dL',
    display_unit: 'mg/dL',
    normalized_value: 118,
    normalized_unit: 'mg/dL',
    reference_text: '<100',
    reference_low: null,
    reference_high: 100,
    flag: null,
    lab_name: 'Fictional Lab',
    collected_on: '2020-06-15',
    reported_on: '2020-06-17',
    documented_on: '2020-06-17',
    imported_at: '2026-10-01T12:00:00Z',
    source_page: 1,
    source_line: 4,
    source_text: 'LDL Cholesterol 118 mg/dL <100',
    issues: [],
    edited: false,
    original: { reported_name: 'LDL Cholesterol', value_text: '118', unit: 'mg/dL', collected_on: '2020-06-15' },
    possible_duplicates: [],
    revisions: [],
    ...over,
  };
};

const fieldNone = { state: 'missing' as const, value: null, decided_at: null, proposal: null };
const docDto = (over: Partial<DocumentDto> = {}): DocumentDto => ({
  id: 'd'.repeat(32),
  original_filename: 'fictional report.pdf',
  imported_at: '2026-10-01T12:00:00Z',
  media_type: 'application/pdf',
  byte_size: 2048,
  sha256: 'b'.repeat(64),
  content_url: `/api/documents/${'d'.repeat(32)}/content`,
  extraction_status: 'extracted',
  review_status: 'in_progress',
  verification_status: 'unverified',
  page_count: 1,
  pages_read: 1,
  pages_with_text: 1,
  truncated: false,
  possible_duplicates: [],
  metadata: { document_type: fieldNone, service_date: fieldNone, provider: fieldNone, report_title: fieldNone },
  ...over,
});

function fakeBackend(): DocumentsBackend {
  return {
    maxUploadBytes: 1000,
    listDocuments: vi.fn(async (): Promise<ArchiveDocument[]> => [toArchiveDocument(docDto())]),
    ...readinessStub(),
    decide: vi.fn(),
    setReview: vi.fn(),
    readAgain: vi.fn(),
    listObservations: vi.fn(async () => []),
    correctObservation: vi.fn(async () => obs()),
    setObservationStatus: vi.fn(async () => obs()),
    approveGroup: vi.fn(async () => []),
    undoGroup: vi.fn(async () => []),
    createObservation: vi.fn(async () => obs()),
  };
}

const archiveWith = (observations: LabObservation[], docs = [docDto()]) => {
  const base = { ...emptyPersonalArchive(TODAY), testNames: ['Glucose'] };
  return buildPersonalArchive(base, docs.map(toArchiveDocument), observations, TODAY);
};

function storeWith(observations: LabObservation[], state: Partial<AppState> = {}, backend = fakeBackend()) {
  return new AppStore(archiveWith(observations), { cur: TODAY, ...state }, backend);
}

function mount(observations: LabObservation[], state: Partial<AppState> = {}, backend = fakeBackend()) {
  window.location.hash = '';
  const store = storeWith(observations, { view: 'biomarkers', ...state }, backend);
  const ui = render(
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>,
  );
  return { store, backend, ...ui };
}

describe('only verified results are published', () => {
  it('leaves out proposed and rejected results', () => {
    const a = archiveWith([
      obs({ verification_status: 'proposed' }),
      obs({ verification_status: 'rejected', value_text: '200' }),
    ]);
    expect(a.markers).toEqual([]);
    expect(a.draws).toEqual([]);
    expect(a.unplotted).toEqual([]);
  });
  it('keeps record screens explaining themselves until something is verified', () => {
    const { container } = mount([obs({ verification_status: 'proposed' })]);
    expect(container.textContent).toContain('there are none yet');
    expect(container.querySelector('svg')).toBeNull();
  });
  it('opens the record screens once a result is verified', () => {
    for (const view of ['overview', 'biomarkers', 'history', 'compare'] as const) {
      const { container, unmount } = mount([obs()], { view });
      expect(container.querySelector('main')).not.toBeNull();
      expect(container.textContent).not.toContain('there are none yet');
      expect(container.textContent).not.toContain('Jordan Vale');
      unmount();
    }
  });
});

describe('charts are accurate', () => {
  const points = (container: HTMLElement) => [...container.querySelectorAll('circle[fill="transparent"]')];

  it('places each point at its collection date, on an axis that starts with the data', () => {
    const results = [
      obs({ collected_on: '2003-03-01', value_text: '100', value_number: 100 }),
      obs({ collected_on: '2015-09-20', value_text: '130', value_number: 130 }),
    ];
    const { container, store } = mount(results);
    expect(store.archive.chartStart).toBe(2003);
    expect(store.archive.chartEnd).toBe(2027);
    const [first, second] = points(container);
    // The test environment gives charts a width of 1000. The explorer has left margin 60, right margin 90.
    const expected = (d: string) => 60 + ((toT(d) - 2003) / (2027 - 2003)) * (1000 - 60 - 90);
    expect(Number(first.getAttribute('cx'))).toBeCloseTo(expected('2003-03-01'), 5);
    expect(Number(second.getAttribute('cx'))).toBeCloseTo(expected('2015-09-20'), 5);
    expect(first.querySelector('title')!.textContent).toContain('1 Mar 2003: 100 mg/dL');
  });
  it('shows a higher value higher on the chart', () => {
    const { container } = mount([
      obs({ collected_on: '2018-01-01', value_text: '100', value_number: 100 }),
      obs({ collected_on: '2019-01-01', value_text: '150', value_number: 150 }),
    ]);
    const [low, high] = points(container);
    expect(Number(high.getAttribute('cy'))).toBeLessThan(Number(low.getAttribute('cy')));
  });
  it('keeps the value exactly as printed', () => {
    const { container } = mount([obs({ value_text: '14.20', value_number: 14.2 })]);
    expect(container.textContent).toContain('14.20');
  });
  it('draws no reference band for a report that printed no range', () => {
    const { container } = mount([obs({ reference_text: null, reference_low: null, reference_high: null })]);
    expect(container.querySelectorAll('g[clip-path] rect[fill="#E1E8DA"]')).toHaveLength(0);
    expect(container.textContent).toContain('Not printed');
  });
  it('keeps each report its own printed range', () => {
    const { container } = mount([
      obs({ collected_on: '2018-01-01', reference_text: '<130', reference_high: 130 }),
      obs({ collected_on: '2019-01-01', reference_text: '<100', reference_high: 100, lab_name: 'Another Lab' }),
    ]);
    expect(container.textContent).toContain('< 130'.replace('< ', '<'));
    expect(container.textContent).toContain('Reference ranges differ between Fictional Lab and Another Lab');
  });
});

describe('a report date is never confused with another date', () => {
  const noReport = obs({ reported_on: null, documented_on: null, collected_on: '2015-05-05' });
  it('says the report date was not printed, rather than showing the import date', () => {
    const { container } = mount([noReport]);
    expect(container.textContent).toContain('ReportedNot printed');
    expect(container.textContent).not.toContain('1 Oct 2026');
  });
  it('shows the printed report date when there is one', () => {
    const { container } = mount([obs({ reported_on: '2020-06-17', documented_on: '2020-08-01' })]);
    expect(container.textContent).toContain('Reported17 Jun 2020');
  });
  it('does the same on the Overview', () => {
    const { container } = mount([noReport], { view: 'overview' });
    expect(container.textContent).toContain('ReportedNot printed');
  });
});

describe('user-entered results keep their provenance', () => {
  const entered = (over: Partial<LabObservation> = {}) =>
    obs({
      document_id: null,
      origin: 'manual',
      confidence: null,
      extraction_status: 'not_extracted',
      source_page: null,
      source_line: null,
      source_text: null,
      reported_on: null,
      documented_on: null,
      ...over,
    });

  it('says so in the Biomarkers table and details', () => {
    const { container } = mount([entered()]);
    expect(screen.getAllByText('User-entered').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('ProvenanceUser-entered, not from a laboratory report');
    expect(container.textContent).toContain('Open source document: none, user-entered');
  });
  it('says a report-read result came from a report', () => {
    const { container } = mount([obs()]);
    expect(container.textContent).toContain('ProvenanceRead from a laboratory report, accepted by you');
    expect(screen.queryByText('User-entered')).toBeNull();
  });
  it('still says so when it is linked to a document', () => {
    const { container, store } = mount([entered({ document_id: 'd'.repeat(32) })]);
    expect(container.textContent).toContain('ProvenanceUser-entered, not from a laboratory report');
    fireEvent.click(screen.getAllByText('User-entered')[0]);
    expect(store.state.view).toBe('documents');
  });
  it('says so on the Overview', () => {
    const { container } = mount([entered()], { view: 'overview' });
    expect(container.textContent).toContain('ProvenanceUser-entered, not from a laboratory report');
    expect(container.textContent).toContain('Source documentNone, user-entered');
    expect(container.textContent).toContain('User-entered · Range');
  });
  it('says so in Compare', () => {
    const { container } = mount([entered({ collected_on: '2018-01-01' })], {
      view: 'compare',
      cA: '2019-01-01',
      mode: 'now',
    });
    expect(container.textContent).toContain('User-entered');
  });
  it('says so in Medical history, and does not claim it came from a report', () => {
    const { store, container } = mount([entered()], { view: 'history', mode: 'now' });
    expect(container.textContent).toContain('User-entered results');
    const eventId = store.archive.events[0].id;
    act(() => store.setState({ hxOpen: { [eventId]: true } }));
    expect(container.textContent).toContain('Not read from a laboratory report');
    expect(container.textContent).not.toContain('exactly as printed on the laboratory report');
    expect(screen.queryByText('Open original document')).toBeNull();
  });
  it('says so in the review table and on Import', () => {
    const inReview = mount([entered({ document_id: 'd'.repeat(32), verification_status: 'proposed' })], {
      view: 'import',
      rvDoc: 'd'.repeat(32),
      rvStage: 'review',
    });
    expect(inReview.container.textContent).toContain('User-entered, not read from this document');
    inReview.unmount();
    const onImport = mount([entered()], { view: 'import' });
    expect(onImport.container.textContent).toContain('User-entered results');
    expect(onImport.container.textContent).toContain('User-entered, shown in charts');
  });
  it('never counts as a laboratory source in the same collection', () => {
    const a = archiveWith([
      obs({ reported_name: 'HDL', test_code: 'hdl' }),
      entered({ document_id: 'd'.repeat(32), reported_name: 'TSH', test_code: 'tsh' }),
    ]);
    expect(a.draws).toHaveLength(2);
    expect(a.events.map((e) => e.provenance.format).sort()).toEqual(['PDF', 'User-entered']);
  });
  it('gives way to the report-read copy when both say the same thing', () => {
    const a = archiveWith([entered(), obs()]);
    expect(a.markers[0].results).toHaveLength(1);
    expect(a.markers[0].results[0].userEntered).toBe(false);
  });
});

describe('nothing from the demo leaks into a real archive', () => {
  it.each(['overview', 'biomarkers', 'history', 'compare', 'documents', 'import'] as const)(
    '%s shows no fictional records',
    (view) => {
      const { container, unmount } = mount([obs()], { view });
      for (const text of [
        'Smart scale',
        'smart scale',
        'VeSync',
        'Harbor',
        'Northfield',
        'Cedar Row',
        'Jordan Vale',
        'July 2012',
        'May 2009',
        'MyChart',
        'Apple Health',
        'Sep 2026',
      ]) {
        expect(container.innerHTML).not.toContain(text);
      }
      unmount();
    },
  );
  it('draws no weight or medication marks on the timeline when there are none', () => {
    const { container } = mount([obs()], { view: 'overview' });
    const titles = [...container.querySelectorAll('svg[role="slider"] title')].map((t) => t.textContent);
    expect(titles.filter((t) => !t!.startsWith('Laboratory'))).toEqual([]);
    expect(container.querySelectorAll('svg[role="slider"] rect[fill="#6E6A61"]')).toHaveLength(0);
  });
  it('keeps the timeline lane labels apart when there are no medications', () => {
    const { container } = mount([obs()], { view: 'overview' });
    const y = (label: string) =>
      Number(
        [...container.querySelectorAll('svg[role="slider"] text')]
          .find((t) => t.textContent === label)!
          .getAttribute('y'),
      );
    expect(y('WEIGHT') - y('MEDICATIONS')).toBeGreaterThanOrEqual(14);
  });
});

describe('a chart with one value', () => {
  const lone = obs({ reference_text: null, reference_low: null, reference_high: null });
  it.each(['overview', 'biomarkers', 'compare'] as const)(
    '%s draws a usable axis for a single result with no range',
    (view) => {
      const { container, unmount } = mount([lone], { view });
      expect(container.querySelector('svg')).not.toBeNull();
      expect(container.innerHTML).not.toContain('NaN');
      expect(container.textContent).not.toContain('NaN');
      unmount();
    },
  );
});

describe('results that cannot be drawn', () => {
  it('lists an undated result without drawing it or borrowing a date', () => {
    const { container, store } = mount([obs(), obs({ collected_on: null, value_text: '140', value_number: 140 })]);
    expect(store.archive.markers[0].results).toHaveLength(1);
    expect(container.textContent).toContain('Date unknown');
    expect(container.textContent).toContain('No collection date');
  });
  it('does not draw a limit like <0.5 as if it were a number', () => {
    const { store, container } = mount([
      obs(),
      obs({ collected_on: '2021-01-01', value_text: '<50', value_number: null }),
    ]);
    expect(store.archive.markers[0].results).toHaveLength(1);
    expect(container.textContent).toContain('<50');
    expect(container.textContent).toContain('Not an exact number');
  });
  it('does not lose a test whose only result cannot be drawn', () => {
    const { container } = mount([
      obs(),
      obs({
        test_code: 'tsh',
        reported_name: 'TSH',
        test_name: 'TSH',
        test_short: 'TSH',
        category: 'thyroid',
        collected_on: null,
        value_text: '2.1',
        value_number: 2.1,
        unit: 'mIU/L',
      }),
    ]);
    expect(container.textContent).toContain('Also verified but not plotted');
    expect(container.textContent).toContain('TSH 2.1 mIU/L');
  });
  it('cannot crash when every result is undated', () => {
    const { container } = mount([obs({ collected_on: null })]);
    expect(container.textContent).toContain('there are none yet');
  });
});

describe('incompatible results are kept apart', () => {
  const mgdl = obs({
    reported_name: 'Glucose',
    test_code: 'glu',
    test_name: 'Glucose',
    test_short: 'Glucose',
    category: 'cmp',
    compare_group: null,
    collected_on: '2018-01-01',
    value_text: '90',
    value_number: 90,
  });
  const mmol = obs({
    reported_name: 'Glucose',
    test_code: 'glu',
    test_name: 'Glucose',
    test_short: 'Glucose',
    category: 'cmp',
    compare_group: null,
    collected_on: '2020-01-01',
    value_text: '5.0',
    value_number: 5,
    unit: 'mmol/L',
    display_unit: 'mmol/L',
    reference_text: '3.9-5.5',
    reference_low: 3.9,
    reference_high: 5.5,
  });

  it('plots different units separately and converts nothing', () => {
    const { container, store } = mount([mgdl, mmol], { marker: 'glu' });
    expect(container.querySelectorAll('circle[fill="transparent"]')).toHaveLength(1);
    expect(container.textContent).toContain(
      'They are kept in their original units and plotted separately. No conversion has been applied.',
    );
    expect(store.archive.markers[0].results.map((r) => r.value)).toEqual([90, 5]);
  });
  it('treats two spellings of one unit as the same unit', () => {
    const a = archiveWith([obs({ unit: 'mg/dl' }), obs({ collected_on: '2021-01-01', unit: 'MG/DL' })]);
    expect(new Set(a.markers[0].results.map((r) => r.unit))).toEqual(new Set(['mg/dL']));
  });
  it('refuses to subtract across units in Compare', () => {
    const v = compareVM(storeWith([mgdl, mmol], { cA: '2019-01-01', cB: TODAY, mode: 'now' }));
    const row = v.cGroups.flatMap((g) => g.rows).find((r) => r.name === 'Glucose')!;
    expect(row.change).toBe('');
    expect(row.note).toContain('units differ');
  });
  it('offers overlays only between tests meant to share a chart', () => {
    const { container } = mount([mgdl], { marker: 'glu' });
    expect(container.textContent).toContain('Comparison is offered only for measures reported in the same unit');
  });
  it('never compares tests with unknown names', () => {
    const a = archiveWith([
      obs({ test_code: null, compare_group: null, reported_name: 'Fictional A' }),
      obs({ test_code: null, compare_group: null, reported_name: 'Fictional B' }),
    ]);
    expect(a.markers.map((m) => m.cmp)).toEqual([undefined, undefined]);
  });
  it('says nothing about a change being good or bad', () => {
    const { container, unmount } = mount(
      [
        obs({ collected_on: '2018-01-01', value_text: '100', value_number: 100 }),
        obs({ collected_on: '2020-01-01', value_text: '150', value_number: 150 }),
      ],
      { view: 'compare', cA: '2019-01-01' },
    );
    const text = container.textContent!.toLowerCase();
    for (const word of ['improv', 'worse', 'better', 'healthy', 'unhealthy', 'risk']) expect(text).not.toContain(word);
    unmount();
  });
});

describe('duplicate results', () => {
  it('draws the same result from two documents once', () => {
    const a = archiveWith([obs({ document_id: 'd'.repeat(32) }), obs({ document_id: 'e'.repeat(32) })]);
    expect(a.markers[0].results).toHaveLength(1);
  });
  it('keeps a same-day result with a different value, because that is a real conflict', () => {
    const a = archiveWith([obs(), obs({ value_text: '119', value_number: 119 })]);
    expect(a.markers[0].results.map((r) => r.value).sort()).toEqual([118, 119]);
    expect(new Set(a.markers[0].results.map((r) => r.i)).size).toBe(2);
  });
});

describe('when it happened and when it became known', () => {
  const late = obs({
    collected_on: '2015-05-05',
    reported_on: null,
    documented_on: null,
    imported_at: '2026-10-01T12:00:00Z',
  });

  it('never treats a late import as documented on its collection date', () => {
    const a = archiveWith([late]);
    expect(a.markers[0].results[0].date).toBe('2015-05-05');
    expect(a.markers[0].results[0].documented).toBe('2026-10-01');
  });
  it('hides it in "as known then" and shows it in "as understood now"', () => {
    const at2016 = (mode: 'known' | 'now') =>
      overviewVM(storeWith([late], { cur: '2016-01-01', mode })).valueRows.find((r) => r.name === 'LDL')!.value;
    expect(at2016('known')).toBe('Not measured');
    expect(at2016('now')).toBe('118');
  });
  it('uses the documented date when one is known', () => {
    const known = obs({ collected_on: '2015-05-05', documented_on: '2015-05-07' });
    const value = (cur: string) =>
      overviewVM(storeWith([known], { cur, mode: 'known' })).valueRows.find((r) => r.name === 'LDL')!.value;
    expect(value('2015-05-06')).toBe('Not measured');
    expect(value('2015-05-07')).toBe('118');
  });
  it('tells the reader a record is hidden', () => {
    const v = overviewVM(storeWith([late], { cur: '2016-01-01', mode: 'known' }));
    expect(v.hasLater).toBe(true);
  });
  it('counts draws by when they became known in Compare', () => {
    const v = compareVM(storeWith([late], { cA: '2016-01-01', cB: TODAY, mode: 'known' }));
    const draws = v.cLedger.find((l) => l.label === 'Laboratory draws')!;
    expect([draws.a, draws.b]).toEqual(['0', '1']);
  });
  it('shows no invented birth date or age', () => {
    const { container } = mount([obs()], { view: 'overview' });
    expect(container.textContent).not.toContain('Age ');
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('undefined');
  });
});

describe('source links', () => {
  it('opens the source document from a chart row', () => {
    const { store } = mount([obs()]);
    fireEvent.click(screen.getByText('Report'));
    expect(store.state.view).toBe('documents');
    expect(store.state.dSel).toBe('d'.repeat(32));
  });
  it('a hand-entered result has no document to open, and says so', () => {
    const { store, container } = mount([
      obs({ document_id: null, origin: 'manual', source_page: null, source_text: null }),
    ]);
    fireEvent.click(screen.getAllByText('User-entered')[0]);
    expect(store.state.view).toBe('biomarkers');
    expect(container.textContent).toContain('User-entered');
  });
  it('shows the name exactly as the report printed it', () => {
    const { container } = mount([obs({ reported_name: 'LDL Chol Calc (NIH)' })]);
    expect(container.textContent).toContain('Name on report');
    expect(container.textContent).toContain('LDL Chol Calc (NIH)');
  });
});

describe('the review table', () => {
  const open = (rows: LabObservation[]) => {
    const backend = fakeBackend();
    backend.listObservations = vi.fn(async () => rows);
    const view = mount(rows, { view: 'import', rvDoc: 'd'.repeat(32), rvStage: 'review' }, backend);
    return { ...view, backend };
  };
  const proposed = (over: Partial<LabObservation> = {}) => obs({ verification_status: 'proposed', ...over });

  it('shows source, dates, doubts and the original PDF together', () => {
    const { container } = open([
      proposed({
        collected_on: null,
        reported_on: null,
        documented_on: null,
        issues: ['No collection date was found.'],
        confidence: 'low',
      }),
    ]);
    expect(container.querySelector('[aria-label^="Original file"]')).not.toBeNull();
    expect(container.textContent).toContain('Collected unknown · Reported unknown · Documented unknown');
    expect(container.textContent).toContain('No collection date was found.');
    expect(container.textContent).toContain('Source, page 1, line 4: "LDL Cholesterol 118 mg/dL <100"');
    expect(container.textContent).toContain('Proposed, not verified · low confidence');
  });
  it('accepts and rejects individual results', async () => {
    const row = proposed();
    const { backend } = open([row]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    });
    expect(backend.setObservationStatus).toHaveBeenCalledWith(row.id, 'verify');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    });
    expect(backend.setObservationStatus).toHaveBeenCalledWith(row.id, 'reject');
  });
  it('corrects every editable part of a result, sending only what changed', async () => {
    const row = proposed();
    const { backend, container } = open([row]);
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Extracted values' }))
        .getAllByRole('button', { name: 'Edit' })
        .at(-1)!,
    );
    fireEvent.change(screen.getByLabelText('Test name'), { target: { value: 'LDL-C' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '119' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'mmol/L' } });
    fireEvent.change(screen.getByLabelText('Reference range'), { target: { value: '<3' } });
    fireEvent.change(screen.getByLabelText('Collection date'), { target: { value: '2020-06-16' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save correction'));
    });
    expect(backend.correctObservation).toHaveBeenCalledWith(row.id, {
      reported_name: 'LDL-C',
      value_text: '119',
      unit: 'mmol/L',
      reference_text: '<3',
      collected_on: '2020-06-16',
    });
    expect(container).toBeTruthy();
  });
  it('clearing a date sends empty, never a substitute', async () => {
    const row = proposed();
    const { backend } = open([row]);
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Extracted values' }))
        .getAllByRole('button', { name: 'Edit' })
        .at(-1)!,
    );
    fireEvent.change(screen.getByLabelText('Collection date'), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save correction'));
    });
    expect(backend.correctObservation).toHaveBeenCalledWith(row.id, { collected_on: null });
  });
  it('keeps the form open and shows why when a correction is refused', async () => {
    const { backend } = open([proposed()]);
    const { ArchiveRequestError } = await import('../services/archiveApi');
    backend.correctObservation = vi.fn(async () => {
      throw new ArchiveRequestError('The date must be between 1900 and today.', 'invalid_value');
    });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Extracted values' }))
        .getAllByRole('button', { name: 'Edit' })
        .at(-1)!,
    );
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '1' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save correction'));
    });
    expect(screen.getByRole('alert').textContent).toContain('between 1900 and today');
  });
  it('shows what was first read after a correction', () => {
    const { container } = open([
      proposed({
        edited: true,
        value_text: '119',
        original: { reported_name: 'LDL Cholesterol', value_text: '118', unit: 'mg/dL', collected_on: '2020-06-15' },
      }),
    ]);
    expect(container.textContent).toContain(
      `First read as LDL Cholesterol 118 mg/dL, collected ${fShort('2020-06-15')}. Kept in the history.`,
    );
  });
  describe('review groups', () => {
    const clean = (over: Partial<LabObservation> = {}) =>
      proposed({ group_eligible: true, review_group: '2020-06-15|cbc|0', review_group_label: 'Complete blood count', version: 7, source_page: 2, source_line: 9, collected_on: '2020-06-15', ...over });
    const ids = ['a', 'b', 'c'].map((c) => c.repeat(32));
    const threeClean = () => [clean({ id: ids[0], reported_name: 'WBC', value_text: '6.2', unit: 'x10E3/uL', reference_text: '3.4-10.8' }), clean({ id: ids[1], reported_name: 'Hemoglobin', value_text: '13.9', unit: 'g/dL', flag: 'Low', version: 8 })];

    const tickAll = async () => fireEvent.click(await screen.findByRole('checkbox', { name: /^All 2 match the original/ }));
    const approve = () => screen.getByRole('button', { name: /^Approve 2 results/ }) as HTMLButtonElement;

    it('keeps the approve button off until every row is ticked', async () => {
      const { backend } = open(threeClean());
      await screen.findByRole('checkbox', { name: /^All 2 match the original/ });
      await waitFor(() => expect((screen.getByRole('checkbox', { name: /^All 2 match/ }) as HTMLInputElement).disabled).toBe(false));
      expect(approve().disabled).toBe(true);
      fireEvent.click(screen.getByRole('checkbox', { name: 'WBC matches the original' }));
      expect(approve().disabled).toBe(true);
      fireEvent.click(approve());
      expect(backend.approveGroup).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Hemoglobin matches the original' }));
      expect(approve().disabled).toBe(false);
      fireEvent.click(screen.getByRole('checkbox', { name: 'WBC matches the original' }));
      expect(approve().disabled).toBe(true);
    });
    it('ticks every row from the top, and unticks them again', async () => {
      open(threeClean());
      await waitFor(() => expect((screen.getByRole('checkbox', { name: /^All 2 match/ }) as HTMLInputElement).disabled).toBe(false));
      await tickAll();
      expect((screen.getByRole('checkbox', { name: 'WBC matches the original' }) as HTMLInputElement).checked).toBe(true);
      expect(approve().disabled).toBe(false);
      await tickAll();
      expect((screen.getByRole('checkbox', { name: 'WBC matches the original' }) as HTMLInputElement).checked).toBe(false);
      expect(approve().disabled).toBe(true);
    });
    it('will not tick from the top a row whose line could not be shown', async () => {
      const { openPdf } = await import('../services/pdfViewer');
      const found = { left: 0.1, top: 0.2, right: 0.9, bottom: 0.22, valueLeft: 0.5 };
      vi.mocked(openPdf).mockResolvedValueOnce({ pages: 2, ratio: () => 1.3, render: () => ({ done: Promise.resolve(), cancel: () => {} }), close: () => {}, findRow: async (_page, source) => (source.startsWith('WBC') ? found : null) });
      open([clean({ id: ids[0], reported_name: 'WBC', source_text: 'WBC 6.2' }), clean({ id: ids[1], reported_name: 'Hemoglobin', source_text: 'Hemoglobin 13.9' })]);
      fireEvent.click(await screen.findByRole('checkbox', { name: 'All 1 shown match the original' }));
      expect(screen.getByText(/could not be cut from page 2/)).toBeTruthy();
      expect((screen.getByRole('checkbox', { name: 'Hemoglobin matches the original' }) as HTMLInputElement).checked).toBe(false);
      expect(approve().disabled).toBe(true);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Hemoglobin matches the original' }));
      expect(approve().disabled).toBe(false);
    });
    it('has no shortcut that approves anything without a table', () => {
      const { container } = open([proposed()]);
      expect(container.textContent).not.toContain('high-confidence');
      expect(container.textContent).not.toContain('Accept all');
    });
    it('shows every column beside the original, and names exactly what will be approved', () => {
      const { container } = open(threeClean());
      const table = screen.getByRole('region', { name: 'Complete blood count' });
      for (const text of ['WBC', '6.2', 'x10E3/uL', '3.4-10.8', 'Hemoglobin', 'Low', fShort('2020-06-15'), 'p.2 l.9']) expect(table.textContent).toContain(text);
      expect(container.querySelector('[aria-label^="Original file"]')).not.toBeNull();
      expect(screen.getByRole('button', { name: `Approve 2 results collected ${fLong('2020-06-15')}` })).toBeTruthy();
    });
    it('lists rows in the order printed, to read straight down against the original', () => {
      open([clean({ id: ids[0], reported_name: 'Later', source_page: 2, source_line: 3 }), clean({ id: ids[1], reported_name: 'First', source_page: 1, source_line: 9 }), clean({ id: ids[2], reported_name: 'Middle', source_page: 2, source_line: 1 })]);
      const text = screen.getByRole('region', { name: 'Complete blood count' }).textContent ?? '';
      expect(text.indexOf('First')).toBeLessThan(text.indexOf('Middle'));
      expect(text.indexOf('Middle')).toBeLessThan(text.indexOf('Later'));
    });
    it('approves nothing until the button is pressed, then sends the exact rows and versions', async () => {
      const { backend } = open(threeClean());
      expect(backend.approveGroup).not.toHaveBeenCalled();
      await tickAll();
      expect(backend.approveGroup).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Approve 2 results/ }));
      });
      expect(backend.approveGroup).toHaveBeenCalledWith({ document_id: 'd'.repeat(32), group: '2020-06-15|cbc|0', collected_on: '2020-06-15', items: [{ id: ids[0], version: 7 }, { id: ids[1], version: 8 }] });
    });
    it('keeps results that need attention out of the table, and says why', () => {
      const doubtful = proposed({ id: ids[2], reported_name: 'Fictional Marker', group_eligible: false, group_reasons: ['No reference range is recorded.'], issues: [], confidence: 'medium' });
      const { container } = open([...threeClean(), doubtful]);
      expect(screen.getByRole('region', { name: 'Complete blood count' }).textContent).not.toContain('Fictional Marker');
      expect(screen.getByRole('button', { name: /^Approve 2 results/ })).toBeTruthy();
      expect(container.textContent).toContain('Review individually');
      expect(container.textContent).toContain('No reference range is recorded.');
    });
    it('shows no approve button when nothing is eligible', () => {
      open([proposed({ group_eligible: false, group_reasons: ['No unit is recorded.'] })]);
      expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    });
    it('keeps categories and dates in separate tables with separate buttons', () => {
      open([...threeClean(), clean({ id: ids[2], reported_name: 'Glucose', review_group: '2020-06-15|cmp|0', review_group_label: 'Metabolic panel' })]);
      expect(screen.getByRole('button', { name: /^Approve 2 results/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Approve 1 result collected/ })).toBeTruthy();
    });
    it('still offers each result alone from the table', async () => {
      const { backend } = open(threeClean());
      const table = screen.getByRole('region', { name: 'Complete blood count' });
      await act(async () => {
        fireEvent.click(within(table).getAllByRole('button', { name: 'Accept' })[0]);
      });
      expect(backend.setObservationStatus).toHaveBeenCalledWith(ids[0], 'verify');
      await act(async () => {
        fireEvent.click(within(table).getAllByRole('button', { name: 'Reject' })[1]);
      });
      expect(backend.setObservationStatus).toHaveBeenCalledWith(ids[1], 'reject');
    });
    it('corrects a result in place', async () => {
      const { backend } = open(threeClean());
      const table = screen.getByRole('region', { name: 'Complete blood count' });
      fireEvent.click(within(table).getAllByRole('button', { name: 'Edit' })[0]);
      fireEvent.change(screen.getByLabelText('Value'), { target: { value: '6.3' } });
      await act(async () => {
        fireEvent.click(screen.getByText('Save correction'));
      });
      expect(backend.correctObservation).toHaveBeenCalledWith(ids[0], { value_text: '6.3' });
    });
    it('shows why a stale group was refused, and catches up', async () => {
      const { backend } = open(threeClean());
      const { ArchiveRequestError } = await import('../services/archiveApi');
      backend.approveGroup = vi.fn(async () => {
        throw new ArchiveRequestError('This group changed after it was shown, so nothing was approved. Check it again.', 'group_changed');
      });
      const before = (backend.listObservations as Mock).mock.calls.length;
      await tickAll();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Approve 2 results/ }));
      });
      expect(screen.getByRole('alert').textContent).toContain('nothing was approved');
      expect((backend.listObservations as Mock).mock.calls.length).toBeGreaterThan(before);
    });
    it('offers undo for a group approval, and says when it happened', async () => {
      const gid = 'e'.repeat(32);
      const row = obs({ approved_group_id: gid, collected_on: '2020-06-15', verification_status: 'verified', revisions: [{ action: 'verified', values: {}, occurred_at: '2026-10-20T10:00:00Z', review_group_id: gid }] });
      const { backend, container } = open([row]);
      expect(container.textContent).toContain(`1 result collected ${fLong('2020-06-15')} was approved as a group on ${fShort('2026-10-20')}.`);
      expect(container.textContent).toContain('as part of a group');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Undo group approval' }));
      });
      expect(backend.undoGroup).toHaveBeenCalledWith(gid);
    });
    it('shows a result approved alone with no group wording or undo', () => {
      const { container } = open([obs({ verification_status: 'verified', approved_group_id: null })]);
      expect(screen.queryByRole('button', { name: 'Undo group approval' })).toBeNull();
      expect(container.textContent).not.toContain('as part of a group');
    });
  });
  it('adds a measurement by hand to this document, still unverified', async () => {
    const { backend } = open([]);
    expect(screen.getByText(/No measurements were recognized/)).toBeTruthy();
    fireEvent.click(screen.getByText('Add a measurement'));
    fireEvent.change(screen.getByLabelText('Test name'), { target: { value: 'Glucose' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '90' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Add measurement'));
    });
    expect(backend.createObservation).toHaveBeenCalledWith(
      { reported_name: 'Glucose', value_text: '90' },
      'd'.repeat(32),
      false,
    );
  });
  it('lists results in the order the report printed them', () => {
    const { container } = open([
      proposed({ reported_name: 'Second', source_line: 9 }),
      proposed({ reported_name: 'First', source_line: 2 }),
      proposed({ reported_name: 'By hand', source_page: null, source_line: null }),
    ]);
    const names = [...container.querySelectorAll('section[aria-label="Extracted values"] button')]
      .map((b) => b.textContent)
      .filter((t) => ['First', 'Second', 'By hand'].includes(t ?? ''));
    expect(names).toEqual(['First', 'Second', 'By hand']);
  });
  it('needs every result decided before the review can continue', () => {
    open([proposed()]);
    expect((screen.getByText('Continue to confirmation') as HTMLButtonElement).disabled).toBe(true);
  });
  it('flags a result that also appears elsewhere', () => {
    const { container } = open([proposed({ possible_duplicates: ['x'.repeat(32)] })]);
    expect(container.textContent).toContain('also appears elsewhere');
  });
});

describe('manual entry', () => {
  it('saves a result as verified and marked as entered by hand', async () => {
    const { backend } = mount([], { view: 'import' });
    fireEvent.click(screen.getByText('Enter a result'));
    fireEvent.change(screen.getByLabelText('Test name'), { target: { value: 'Glucose' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Collection date'), { target: { value: '2019-05-05' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save result'));
    });
    expect(backend.createObservation).toHaveBeenCalledWith(
      { reported_name: 'Glucose', value_text: '90', collected_on: '2019-05-05' },
      null,
      true,
    );
  });
  it('lists hand-entered results with their history, and lets them be edited', async () => {
    const row = obs({
      document_id: null,
      origin: 'manual',
      edited: true,
      value_text: '95',
      original: { value_text: '90' },
      revisions: [{ action: 'corrected', values: {}, occurred_at: '' }],
    });
    const { backend, container } = mount([row], { view: 'import' });
    expect(container.textContent).toContain('User-entered, shown in charts');
    expect(container.textContent).toContain('Edited 1 time. First entered as 90.');
    const section = within(screen.getByRole('region', { name: 'User-entered results' }));
    fireEvent.click(section.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '96' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save correction'));
    });
    expect(backend.correctObservation).toHaveBeenCalledWith(row.id, { value_text: '96' });
    expect(backend.setObservationStatus).toHaveBeenCalledWith(row.id, 'verify');
  });
  it('is not offered in the demo', async () => {
    const { syntheticArchive } = await import('../data/syntheticArchive');
    window.location.hash = '';
    const store = new AppStore(syntheticArchive, { view: 'import' });
    const { container } = render(
      <StoreContext.Provider value={store}>
        <App />
      </StoreContext.Provider>,
    );
    expect(container.textContent).not.toContain('User-entered results');
  });
});
