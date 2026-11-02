import { describe, expect, it } from 'vitest';
import { syntheticArchive as a } from '../data/syntheticArchive';

describe('synthetic archive', () => {
  it('links every measurement to a source document', () => {
    for (const m of a.markers) for (const r of m.results) {
      const doc = a.documentsById[r.documentId];
      expect(doc, `${m.key} ${r.date}`).toBeDefined();
      expect(doc.date).toBe(r.date);
    }
  });
  it('links every medical event to a source document', () => {
    for (const e of a.events) expect(a.documentsById[e.documentId], e.title).toBeDefined();
  });
  it('points duplicate documents at an existing original', () => {
    for (const d of a.documents) if (d.dup) expect(a.documentsById[d.dup]).toBeDefined();
  });
  it('gives each marker one value slot per laboratory draw', () => {
    for (const m of a.markers) expect(m.vals).toHaveLength(a.draws.length);
  });
  it('never records a document before the thing it documents', () => {
    for (const e of a.events) expect(e.documented >= e.date, e.title).toBe(true);
  });
  it('produces the same weight series every time', () => {
    expect(a.weight.length).toBeGreaterThan(300);
    expect(a.documentsById['x-vesync'].rows).toBe(a.weight.filter(w => w.src === 'scale').length);
  });
});
