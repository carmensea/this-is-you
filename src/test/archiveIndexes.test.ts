import { describe, expect, it } from 'vitest';
import type { ArchiveDocument, LabObservation } from '../domain/types';
import { buildClinicalRecords } from '../services/observationRecords';
import { buildPersonalArchive, emptyPersonalArchive, toArchiveDocument, type DocumentDto } from '../services/localArchiveApi';

const TODAY = '2026-11-02';
const local = (iso: string) => iso.slice(0, 10);

// Deterministic fictional rows, varied enough to hit shared draws, missing documents and repeats.
function rows(count: number): LabObservation[] {
  const tests = [
    ['hgb', 'cbc'],
    ['glu', 'cmp'],
    ['ldl', 'lipid'],
    ['tsh', 'thyroid'],
    [null, 'other'],
  ] as const;
  return Array.from({ length: count }, (_, n) => {
    const [code, category] = tests[(n * 7) % tests.length];
    return {
      id: `o${String(n).padStart(4, '0')}`,
      document_id: n % 4 === 0 ? null : `d${n % 6}`,
      origin: n % 4 === 0 ? 'manual' : 'extracted',
      verification_status: n % 11 === 0 ? 'proposed' : 'verified',
      test_code: code,
      test_name: code,
      test_short: code,
      reported_name: code ?? `Fictional ${n % 3}`,
      category,
      compare_group: null,
      value_text: String(n % 90),
      value_number: n % 13 === 0 ? null : n % 90,
      unit: 'mg/dL',
      display_unit: 'mg/dL',
      reference_text: null,
      reference_low: null,
      reference_high: null,
      flag: null,
      lab_name: 'Fictional Laboratory',
      collected_on: n % 17 === 0 ? null : `20${String(10 + (n % 9)).padStart(2, '0')}-0${1 + (n % 5)}-1${n % 3}`,
      reported_on: null,
      documented_on: null,
      imported_at: '2026-01-02T03:04:05Z',
    } as unknown as LabObservation;
  });
}

const document = (id: string): DocumentDto =>
  ({
    id,
    original_filename: `${id}.pdf`,
    imported_at: '2026-01-02T15:04:05Z',
    media_type: 'application/pdf',
    byte_size: 10,
    sha256: id,
    content_url: `/api/documents/${id}/content`,
    extraction_status: 'extracted',
    review_status: 'not_started',
    verification_status: 'unverified',
    page_count: 1,
    pages_read: 1,
    pages_with_text: 1,
    truncated: false,
    metadata: Object.fromEntries(
      ['document_type', 'report_title', 'service_date', 'provider'].map((k) => [k, { state: 'missing', value: null, decided_at: null, proposal: null }]),
    ),
    possible_duplicates: [],
  }) as unknown as DocumentDto;

describe('archive lookups match the plain definitions', () => {
  it('names exactly the categories each draw holds', () => {
    const clinical = buildClinicalRecords(rows(600), [] as ArchiveDocument[], TODAY, local);
    expect(clinical.events.length).toBeGreaterThan(10);
    clinical.events.forEach((event, i) => {
      const expected = clinical.categories
        .filter((c) => clinical.markers.some((m) => m.cat === c.key && m.results.some((r) => r.i === i)))
        .map((c) => c.short);
      expect(event.title.split(': ')[1]).toBe(expected.join(', '));
    });
  });

  it('attaches each document its own results, in order', () => {
    const observations = rows(300);
    const ids = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'nothing-here'];
    const archive = buildPersonalArchive(emptyPersonalArchive(TODAY), ids.map(document).map(toArchiveDocument), observations, TODAY);
    for (const d of archive.documents) {
      expect(d.review!.observations).toEqual(observations.filter((o) => o.document_id === d.id));
    }
  });

  it('writes an import time exactly as the browser would', () => {
    const iso = '2026-01-02T15:04:05Z';
    const shown = toArchiveDocument(document('d0')).imported;
    expect(shown.endsWith(new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))).toBe(true);
  });
});
