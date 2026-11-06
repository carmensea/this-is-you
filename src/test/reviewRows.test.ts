import { describe, expect, it } from 'vitest';
import { isTypingTarget, nextPending, rowKind, splitIssues } from '../domain/reviewRows';

describe('a result in review', () => {
  it('tells numbers, limits, ranges, words and missing values apart', () => {
    expect(['118', '0.86', '<0.5', '>59', '0-2', '3 - 5', 'Few', 'None seen', '1+', '', '  '].map(rowKind)).toEqual([
      'number', 'number', 'limit', 'limit', 'range', 'range', 'word', 'word', 'word', 'missing', 'missing',
    ]);
  });
  it('keeps notes about a result’s form out of its problems', () => {
    const issues = [
      'This result is a word rather than a number, so it will not be graphed.',
      'This test name is not in the known list. Check it is really a result.',
      'No unit was printed on this line. None was assumed.',
      'Two different units were printed for this result: mg/dL and mmol/L.',
    ];
    expect(splitIssues(issues, 'word')).toEqual({ problems: [issues[3]], notes: issues.slice(0, 3) });
  });
  it('treats a missing unit as a problem only for a number of a known test', () => {
    expect(splitIssues(['No unit was printed on this line. None was assumed.'], 'number').problems).toHaveLength(1);
    expect(splitIssues(['No unit was printed on this line. None was assumed.'], 'number', false).problems).toHaveLength(0);
  });
  it('says a missing value once, by its kind', () => {
    const issues = ['No value could be read for this test. Enter it from the original.', 'No collection date was found. It stays unknown until you enter it.'];
    expect(splitIssues(issues, 'missing')).toEqual({ problems: [issues[1]], notes: [] });
  });
  it('finds the next undecided result, wrapping round, and never the one just decided', () => {
    const rows = [{ key: 'a', pending: true }, { key: 'b', pending: false }, { key: 'c', pending: true }];
    expect(nextPending(rows, 'a')).toBe('c');
    expect(nextPending(rows, 'c')).toBe('a');
    expect(nextPending(rows, null)).toBe('a');
    expect(nextPending([{ key: 'a', pending: true }], 'a')).toBeNull();
  });
  it('treats inputs, forms and correction areas as typing, and list buttons as not', () => {
    document.body.innerHTML = '<input id="i"><div data-editing><button id="save">Save</button></div><div role="list"><button id="row">Row</button></div>';
    expect(isTypingTarget(document.getElementById('i'))).toBe(true);
    expect(isTypingTarget(document.getElementById('save'))).toBe(true);
    expect(isTypingTarget(document.getElementById('row'))).toBe(false);
  });
});
