// Words and values for reviewing a real document's details. Kept apart from the demo's review data.
import { fLong } from './dates';
import { DCATL } from './vocabulary';
import type { ArchiveDocument, DocumentCategory, DocumentReview, MetadataFieldKey, MetadataFieldState } from './types';

export const FIELD_ORDER: MetadataFieldKey[] = ['document_type', 'service_date', 'provider', 'report_title'];

export const FIELD_LABEL: Record<MetadataFieldKey, string> = {
  document_type: 'Document type',
  service_date: 'Date of service',
  provider: 'Provider',
  report_title: 'Report title',
};

/** How a stored value reads to a person: a type label, or a date written out. */
export function displayValue(key: MetadataFieldKey, value: string): string {
  if (key === 'document_type') return DCATL[value as DocumentCategory] ?? value;
  if (key === 'service_date') return fLong(value);
  return value;
}

const decided = (f: MetadataFieldState) => f.state === 'confirmed' || f.state === 'corrected';

/** One detail for the Documents screen, always saying whether a person checked it. */
export function describeField(key: MetadataFieldKey, f: MetadataFieldState): string {
  if (f.state === 'not_stated') return 'Not stated in the document';
  if (decided(f) && f.value) {
    const shown = displayValue(key, f.value);
    return f.state === 'corrected'
      ? `${shown}, corrected by you${f.proposal ? ` (read as ${displayValue(key, f.proposal.value)})` : ''}`
      : `${shown}, confirmed by you`;
  }
  if (f.proposal)
    return `Proposed: ${displayValue(key, f.proposal.value)} (${f.proposal.confidence} confidence, not verified)`;
  return 'Not recorded';
}

export const EXTRACTION_LABEL: Record<DocumentReview['extraction'], string> = {
  pending: 'Waiting to be read',
  running: 'Being read',
  extracted: 'Text read',
  partial: 'Partly read',
  image_only: 'Image only, not read',
  encrypted: 'Password protected, not read',
  no_text: 'No readable text',
  failed: 'Could not be read',
  too_complex: 'Stopped at safety limits',
};
export const REVIEW_LABEL: Record<DocumentReview['review'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};
export const VERIFICATION_LABEL: Record<DocumentReview['verification'], string> = {
  unverified: 'Not verified',
  partially_verified: 'Partly verified',
  verified: 'All details verified',
};

export const isReading = (d: ArchiveDocument) =>
  d.review?.extraction === 'pending' || d.review?.extraction === 'running';
export const canReview = (d: ArchiveDocument) => !!d.review && !isReading(d);
export const proposalCount = (r: DocumentReview) => FIELD_ORDER.filter((k) => r.fields[k].proposal).length;

/** The list row's type column. A guess is labeled as one. */
export function typeLabel(d: ArchiveDocument): string {
  const f = d.review?.fields.document_type;
  if (!f) return DCATL[d.cat];
  if (f.value) return DCATL[d.cat];
  return f.proposal ? `Proposed: ${displayValue('document_type', f.proposal.value)}` : 'Not classified';
}
