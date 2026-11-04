import { describe, expect, it } from 'vitest';
import { locateRow, toTextLines, type TextLine } from '../domain/locateRow';

const line = (text: string, top: number): TextLine => ({ text, top, bottom: top + 0.02, left: 0.1, right: 0.9 });

describe('finding a source line on a page', () => {
  it('finds a row printed on one line, whatever the spacing', () => {
    const lines = [line('Component Your Value', 0.1), line('WBC  6.2 x10E3/uL 3.4-10.8', 0.2), line('Hemoglobin 13.9 g/dL', 0.3)];
    expect(locateRow(lines, 'WBC 6.2 x10E3/uL 3.4 - 10.8')).toEqual({ top: 0.2, bottom: 0.22, left: 0.1, right: 0.9, valueLeft: null });
  });

  it('covers every line of a row gathered from separate cells', () => {
    const lines = [line('WBC', 0.2), line('6.2 x10E3/uL', 0.22), line('3.4 - 10.8', 0.24), line('Hemoglobin', 0.3)];
    expect(locateRow(lines, 'WBC | 6.2 x10E3/uL | 3.4 - 10.8')).toMatchObject({ top: 0.2, bottom: 0.26 });
  });

  it('finds a row whose columns came out in another order', () => {
    expect(locateRow([line('WBC 3.4-10.8 6.2 x10E3/uL', 0.2)], 'WBC 6.2 x10E3/uL 3.4-10.8')).toMatchObject({ top: 0.2 });
  });

  it('takes the exact line when a shorter one sits inside a longer one', () => {
    const lines = [line('Absolute WBC 6.2', 0.2), line('WBC 6.2', 0.3)];
    expect(locateRow(lines, 'WBC 6.2')).toMatchObject({ top: 0.3 });
  });

  it('refuses a row that could be in two places', () => {
    expect(locateRow([line('WBC 6.2', 0.2), line('WBC 6.2', 0.5)], 'WBC 6.2')).toBeNull();
  });

  it('refuses a row that is not on the page, or nothing at all', () => {
    expect(locateRow([line('WBC 6.2', 0.2)], 'Hemoglobin 13.9')).toBeNull();
    expect(locateRow([line('WBC 6.2', 0.2)], '')).toBeNull();
  });

  it('refuses cells too far apart to be one row', () => {
    const lines = [line('WBC', 0.1), line('a', 0.2), line('b', 0.3), line('c', 0.4), line('d', 0.5), line('6.2', 0.6)];
    expect(locateRow(lines, 'WBC | 6.2')).toBeNull();
  });
});

describe('finding where the value starts', () => {
  const columns = [
    { text: 'WBC 6.2 3.4-10.8', x: 50, baseline: 100, width: 0, height: 10 },
  ];
  it('uses the exact place when the value is its own piece of text', () => {
    const lines = toTextLines([{ text: 'WBC', x: 50, baseline: 100, width: 30, height: 10 }, { text: '6.2H', x: 300, baseline: 100, width: 20, height: 10 }, { text: '3.4-10.8', x: 400, baseline: 100, width: 40, height: 10 }], 500, 1000);
    expect(locateRow(lines, 'WBC 6.2H 3.4-10.8', '6.2')?.valueLeft).toBeCloseTo(0.6);
  });
  it('estimates it inside a longer piece of text', () => {
    const lines = toTextLines([{ ...columns[0], width: 160 }], 500, 1000);
    expect(locateRow(lines, 'WBC 6.2 3.4-10.8', '6.2')?.valueLeft).toBeCloseTo(0.1 + 0.32 * (4 / 16));
  });
  it('does not mistake a range or a longer number for the value', () => {
    const lines = toTextLines([{ text: 'WBC 16.2 6.2-10.8', x: 50, baseline: 100, width: 170, height: 10 }], 500, 1000);
    expect(locateRow(lines, 'WBC 16.2 6.2-10.8', '6.2')?.valueLeft).toBeNull();
  });
});

describe('rebuilding printed lines', () => {
  it('joins pieces on one baseline left to right, and keeps others apart', () => {
    const pieces = [
      { text: '6.2', x: 200, baseline: 100, width: 20, height: 10 },
      { text: 'WBC', x: 50, baseline: 100.5, width: 30, height: 10 },
      { text: 'Hemoglobin', x: 50, baseline: 120, width: 60, height: 10 },
    ];
    const lines = toTextLines(pieces, 500, 1000);
    expect(lines.map((l) => l.text)).toEqual(['WBC 6.2', 'Hemoglobin']);
    expect(lines[0]).toMatchObject({ left: 0.1, right: 0.44 });
    expect(lines[0].top).toBeCloseTo(0.092, 2);
  });
});
