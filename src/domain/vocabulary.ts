import { C } from '../theme';
import type { DocumentCategory, DocumentStatus, EventType, HealthEvent, ImportOutcome } from './types';

export const TYPE_LABEL: Record<EventType, string> = {
  visit: 'Visit',
  lab: 'Laboratory',
  imaging: 'Imaging',
  procedure: 'Procedure',
  report: 'Pathology',
  diagnosis: 'Diagnosis',
  medication: 'Medication',
};

/** Filter groups on the history screen. Pathology reports count as procedures. */
export type HistoryGroup = Exclude<EventType, 'report'>;
export const HCATS: [HistoryGroup, string][] = [
  ['diagnosis', 'Diagnoses and conditions'],
  ['procedure', 'Procedures, surgery, pathology'],
  ['imaging', 'Imaging studies'],
  ['visit', 'Visits'],
  ['medication', 'Medications'],
  ['lab', 'Laboratory draws'],
];
export const grpOf = (e: HealthEvent): HistoryGroup => (e.type === 'report' ? 'procedure' : e.type);

const NB = '0px solid transparent';
export const GLYPH: Record<EventType, { w: number; h: number; r: string; bg: string; bd: string; rot: number }> = {
  visit: { w: 8, h: 8, r: '50%', bg: C.ink, bd: NB, rot: 0 },
  lab: { w: 8, h: 8, r: '0', bg: C.ink, bd: NB, rot: 0 },
  imaging: { w: 8, h: 8, r: '0', bg: C.ink, bd: NB, rot: 45 },
  procedure: { w: 3, h: 13, r: '0', bg: C.ink, bd: NB, rot: 0 },
  report: { w: 3, h: 13, r: '0', bg: C.ink2, bd: NB, rot: 0 },
  diagnosis: { w: 10, h: 10, r: '50%', bg: 'transparent', bd: '1.6px solid ' + C.ink, rot: 0 },
  medication: { w: 14, h: 4, r: '0', bg: C.green, bd: NB, rot: 0 },
};

export const evNote = (e: HealthEvent) =>
  ({
    lab:
      e.provenance.format === 'User-entered'
        ? 'User-entered. Not read from a laboratory report.'
        : 'Results are shown exactly as printed on the laboratory report, including the reference ranges and flags the laboratory assigned.',
    visit:
      'The clinical note for this visit is kept in the original document. The archive records that the visit took place and links to the note.',
    imaging:
      'Findings and impression are kept as written in the original report. The archive does not summarize or interpret imaging reports.',
    procedure: e.surgery
      ? 'The operative note is kept in the original document.'
      : 'The procedure note is kept in the original document.',
    report: 'The pathology diagnosis appears as written in the original report.',
    diagnosis: e.dx && e.dx.note ? e.dx.note + '.' : 'Recorded in the problem list of the source document.',
    medication: e.med ? 'Dose as recorded: ' + e.med.dose + '.' : '',
  })[e.type] || '';

export const DCATS: [DocumentCategory, string][] = [
  ['lab', 'Laboratory reports'],
  ['imaging', 'Imaging reports'],
  ['note', 'Clinical notes'],
  ['pathology', 'Pathology reports'],
  ['procedure', 'Procedure records'],
  ['other', 'Other documents'],
];
export const DCATL: Record<DocumentCategory, string> = {
  lab: 'Laboratory report',
  imaging: 'Imaging report',
  note: 'Clinical note',
  pathology: 'Pathology report',
  procedure: 'Procedure record',
  other: 'Other document',
};
export const STATUS: Record<DocumentStatus, { label: string; desc: string; n: number; color: string }> = {
  uploaded: { label: 'Uploaded', desc: 'Original stored. Nothing extracted yet.', n: 1, color: '#55524B' },
  parsed: {
    label: 'Parsed',
    desc: 'Values extracted, not yet confirmed against the original.',
    n: 2,
    color: '#8A5A1F',
  },
  reviewed: { label: 'Reviewed', desc: 'Extracted values confirmed against the original.', n: 3, color: '#3D6A52' },
  unsupported: {
    label: 'Unsupported',
    desc: 'Original stored. This format cannot be read yet.',
    n: 1,
    color: '#8A3F1F',
  },
};
export const OUTCOME: Record<ImportOutcome, { label: string; color: string; read: boolean; ext: boolean }> = {
  duplicate: { label: 'Duplicate, set aside', color: '#55524B', read: true, ext: false },
  parsed: { label: 'Parsed, ready for review', color: '#8A5A1F', read: true, ext: true },
  failed: { label: 'Parsing failed, original stored', color: '#8A3F1F', read: true, ext: false },
  unsupported: { label: 'Unsupported, original stored', color: '#8A3F1F', read: false, ext: false },
  possible: { label: 'Possible duplicate', color: '#8A5A1F', read: true, ext: true },
  local: { label: 'Listed only (prototype)', color: '#55524B', read: false, ext: false },
  uploading: { label: 'In progress', color: '#4F4C45', read: false, ext: false },
  stored: { label: 'Stored, not read', color: '#3D6A52', read: false, ext: false },
  rejected: { label: 'Not accepted, nothing stored', color: '#8A3F1F', read: false, ext: false },
  interrupted: { label: 'Upload failed, nothing stored', color: '#8A3F1F', read: false, ext: false },
};
