/** How a proposed measurement reads in review: its kind, and which of its doubts are real problems. */

export type RowKind = 'number' | 'limit' | 'range' | 'word' | 'missing';

const NUMBER = /^\d+(?:[.,]\d+)?$/;
const LIMIT = /^(<=?|>=?|≤|≥)\s*\d/;
const RANGE = /^\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?$/;

export function rowKind(value: string): RowKind {
  const v = value.trim();
  if (!v) return 'missing';
  if (NUMBER.test(v)) return 'number';
  if (LIMIT.test(v)) return 'limit';
  if (RANGE.test(v)) return 'range';
  return 'word';
}

export const KIND_TAG: Record<RowKind, string> = {
  number: '',
  limit: 'Limit result',
  range: 'Range result',
  word: 'Word result',
  missing: 'No value read',
};

// What the reader says about a result's form, not about whether it was read correctly. Shown only in its details.
const INFORMATIONAL = [
  'This result is a word rather than a number',
  'This result is printed as a range rather than one number',
  'This value is reported as a limit rather than an exact number',
  'This test name is not in the known list',
];
// A missing unit matters for a number of a known test, which has one. Words, and tests like pH or specific gravity, have none.
const NO_UNIT = 'No unit was printed on this line';

export function splitIssues(issues: string[], kind: RowKind, knownTest = true): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  for (const issue of issues) {
    const informational =
      INFORMATIONAL.some((start) => issue.startsWith(start)) || (issue.startsWith(NO_UNIT) && (kind !== 'number' || !knownTest));
    // "No value could be read" is said by the kind itself.
    if (kind === 'missing' && issue.startsWith('No value could be read')) continue;
    (informational ? notes : problems).push(issue);
  }
  return { problems, notes };
}

/** The next undecided key after `from`, wrapping round, or null when none is left. */
export function nextPending<T extends { key: string; pending: boolean }>(rows: T[], from: string | null): string | null {
  const start = Math.max(-1, rows.findIndex((r) => r.key === from));
  for (let i = 1; i <= rows.length; i++) {
    const r = rows[(start + i) % rows.length];
    if (r.pending && r.key !== from) return r.key;
  }
  return null;
}

/** Keys that decide a result must never fire while a person is typing or using another control. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  // [data-editing] marks a correction form, so its own buttons (Save, Cancel) never act on the list.
  return !!target.closest('input, textarea, select, [contenteditable], dialog, form, [data-editing]');
}
