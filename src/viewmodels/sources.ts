import { plural } from '../domain/format';
import type { LabObservation } from '../domain/types';
import type { AppStore } from '../state/store';
import { resultLines, type ResultInput } from './review';

const STATUS: Record<LabObservation['verification_status'], string> = { proposed: 'pending', verified: 'confirmed', rejected: 'excluded', superseded: 'excluded' };

/** Results read from connected providers, decided one at a time exactly as a document's are, with the same history. */
export function providerResultsVM(store: AppStore) {
  // Newest collection first, then by name, so a row stays where it is when it is decided.
  const fromProviders = store.archive.observations
    .filter((o) => o.origin === 'fhir')
    .sort((a, b) => (b.collected_on ?? '').localeCompare(a.collected_on ?? '') || a.reported_name.localeCompare(b.reported_name) || a.id.localeCompare(b.id));
  const inputs: ResultInput[] = fromProviders.map((o) => {
    const reading = { value: o.value_text, unit: o.unit ?? '', ref: o.reference_text ?? '', flag: o.flag ?? '' };
    return {
      key: o.id,
      measure: o.reported_name,
      ...reading,
      conf: o.issues.length ? 'low' : 'high',
      reason: o.issues.join(' '),
      status: STATUS[o.verification_status],
      edited: o.edited,
      orig: reading,
    };
  });
  const { lines, keys } = resultLines(store, inputs, fromProviders, '');
  const left = lines.filter((l) => l.isPending).length;
  return {
    lines,
    keys,
    testNames: store.archive.testNames,
    summary: lines.length
      ? `${plural(left, 'result')} to decide, of ${lines.length} read from connected sources. None is used in charts until you accept it.`
      : 'Nothing has been read from connected sources yet.',
  };
}
