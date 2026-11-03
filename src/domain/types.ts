// Domain model for the archive. These shapes are what a future backend must return.

/** Calendar date as YYYY-MM-DD. Compared as a string throughout. */
export type ISODate = string;

export type LabCode = 'H' | 'N';
/** As the laboratory printed it, shortened only for H and L. Never worked out from a range. */
export type Flag = string;
export type SnapshotMode = 'known' | 'now';

export interface LabResult {
  /** Index of the laboratory draw this result came from. */
  i: number;
  date: ISODate;
  /** When the result entered the record. "As known then" filters on this. */
  documented: ISODate;
  /** Key into Archive.labs. */
  lab: string;
  value: number;
  lo: number | null;
  hi: number | null;
  unit: string;
  dp: number;
  flag: Flag;
  /** Source document this value was extracted from. Empty when entered by hand with no document. */
  documentId: string;
  /** Exactly as printed, when it comes from a real report: "14.20", not 14.2. */
  displayValue?: string;
  referenceText?: string | null;
  reportedName?: string;
  observationId?: string;
  /** A person typed this in. It never came from a laboratory report, whatever it is linked to. */
  userEntered?: boolean;
  /** The date printed on the report. Null when none was printed. Absent in the demo, which uses `documented`. */
  reportedOn?: ISODate | null;
}

/** A verified result that cannot be drawn: it has no collection date, or no exact number. */
export interface UnplottedResult {
  key: string;
  id: string;
  name: string;
  value: string;
  unit: string;
  date: ISODate | null;
  reason: string;
  documentId: string | null;
  userEntered: boolean;
}

export interface ObservationRevision {
  action: string;
  values: Record<string, unknown>;
  occurred_at: string;
}

/** One laboratory result as the archive stores it, with every date kept apart. */
export interface LabObservation {
  id: string;
  document_id: string | null;
  origin: 'extracted' | 'manual';
  extraction_status: string;
  verification_status: 'proposed' | 'verified' | 'rejected';
  confidence: 'high' | 'medium' | 'low' | null;
  reported_name: string;
  test_code: string | null;
  test_name: string | null;
  test_short: string | null;
  category: string;
  compare_group: string | null;
  value_text: string;
  value_number: number | null;
  unit: string | null;
  display_unit: string | null;
  normalized_value: number | null;
  normalized_unit: string | null;
  reference_text: string | null;
  reference_low: number | null;
  reference_high: number | null;
  flag: string | null;
  lab_name: string | null;
  collected_on: ISODate | null;
  reported_on: ISODate | null;
  documented_on: ISODate | null;
  imported_at: string;
  source_page: number | null;
  source_line: number | null;
  source_text: string | null;
  issues: string[];
  edited: boolean;
  original: Record<string, unknown>;
  possible_duplicates: string[];
  revisions: ObservationRevision[];
}

export interface MethodChange {
  date: ISODate;
  label: string;
  text: string;
}

export interface Marker {
  key: string;
  cat: string;
  name: string;
  short: string;
  unit: string;
  units?: Partial<Record<LabCode, string>>;
  dp: number;
  dps?: Record<string, number>;
  cmp?: string;
  ref: Partial<Record<LabCode, [number | null, number | null]>>;
  vals: (number | null)[];
  method?: MethodChange;
  panel: string;
  results: LabResult[];
  /** Verified results of this test that cannot be drawn. */
  unplotted?: UnplottedResult[];
}

export interface MarkerCategory {
  key: string;
  name: string;
  short: string;
}

export interface Medication {
  name: string;
  dose: string;
  doses?: [ISODate, string][];
  start: ISODate;
  end: ISODate | null;
  source: string;
}

export interface Diagnosis {
  name: string;
  onset: ISODate;
  documented: ISODate;
  resolved: ISODate | null;
  source: string;
  note?: string;
}

export type EventType = 'visit' | 'lab' | 'imaging' | 'procedure' | 'report' | 'diagnosis' | 'medication';

/** How the source file for a record reached the archive. */
export interface DocumentProvenance {
  format: string;
  via: string;
  imported: string;
  status: string;
  ext: string;
}

export interface HealthEvent {
  id: string;
  type: EventType;
  date: ISODate;
  documented: ISODate;
  title: string;
  source: string;
  end?: ISODate;
  surgery?: boolean;
  draw?: number;
  med?: Medication;
  dx?: Diagnosis;
  /** Clinician or empty string when the source does not state one. */
  clinician: string;
  provenance: DocumentProvenance;
  /** Source document this event was recorded from. */
  documentId: string;
}

export type DocumentCategory = 'lab' | 'imaging' | 'note' | 'pathology' | 'procedure' | 'other';
export type DocumentStatus = 'uploaded' | 'parsed' | 'reviewed' | 'unsupported';

export interface ArchiveDocument {
  id: string;
  cat: DocumentCategory;
  title: string;
  /** Overrides the formatted date when a document spans a period. */
  dateLabel?: string;
  date: ISODate;
  documented: ISODate;
  source: string;
  who: string;
  draw?: number;
  ev?: string;
  ext: string;
  file: string;
  format: string;
  via: string;
  imported: string;
  status: DocumentStatus;
  pages: number;
  n: number;
  rows?: number;
  size: string;
  note?: string;
  /** Id of the document this file duplicates. */
  dup?: string;
  hash: string;
  search: string;
  /** The document's own date is unknown; `date` holds the import date. */
  dateUnknown?: boolean;
  /** Where the original file can be fetched. Only real documents have one. */
  contentUrl?: string;
  /** What was read from a real file, and what a person has decided. Absent in the demo. */
  review?: DocumentReview;
}

export type MetadataFieldKey = 'document_type' | 'service_date' | 'provider' | 'report_title';
export type ExtractionStatus =
  'pending' | 'running' | 'extracted' | 'partial' | 'image_only' | 'encrypted' | 'no_text' | 'failed' | 'too_complex';

export interface MetadataProposal {
  id: number;
  value: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  page: number;
  snippet: string;
  method: string;
}

export interface MetadataFieldState {
  state: 'missing' | 'proposed' | 'confirmed' | 'corrected' | 'not_stated';
  /** Only ever what a person decided. An inferred value stays under `proposal`. */
  value: string | null;
  decidedAt: string | null;
  proposal: MetadataProposal | null;
}

export interface DocumentReview {
  extraction: ExtractionStatus;
  review: 'not_started' | 'in_progress' | 'completed';
  verification: 'unverified' | 'partially_verified' | 'verified';
  pageCount: number | null;
  pagesRead: number;
  pagesWithText: number;
  truncated: boolean;
  fields: Record<MetadataFieldKey, MetadataFieldState>;
  possibleDuplicates: string[];
  observations: LabObservation[];
  identity?: IdentityCheck;
}

/** A suggestion for a person to check. Never a verification, and never a reason to refuse a document. */
export interface IdentityCheck {
  status: 'not_configured' | 'undetermined' | 'possible_match' | 'possible_mismatch';
  reason: string;
  names_found: string[];
  birth_dates_found: string[];
}

export interface IdentityDetails {
  full_name: string;
  date_of_birth: string | null;
  previous_names: string[];
  configured: boolean;
}

export type ImportCategory =
  | 'waiting' | 'reading' | 'read' | 'partial' | 'duplicate' | 'scanned' | 'encrypted' | 'no_text' | 'unsupported' | 'failed';

export interface ImportBatchSummary {
  id: string;
  label: string;
  created_at: string;
  counts: Partial<Record<ImportCategory, number>>;
  total: number;
  identity_mismatches: number;
  identity_undetermined: number;
}

export interface ImportReportItem {
  id: number;
  path: string;
  byte_size: number;
  state: 'pending' | 'stored' | 'duplicate' | 'unsupported' | 'rejected' | 'interrupted';
  message: string | null;
  attempts: number;
  document_id: string | null;
  document_filename: string | null;
  extraction_status: ExtractionStatus | null;
  review_status: DocumentReview['review'] | null;
  verification_status: DocumentReview['verification'] | null;
  pages_with_text: number;
  page_count: number | null;
  identity: IdentityCheck | null;
}

export interface BackupEntry {
  name: string;
  state: 'complete' | 'incomplete' | 'damaged' | 'encrypted';
  created_at: string | null;
  documents: number | null;
  bytes: number | null;
  last_check: { checked_at: string; ok: boolean; problems: string[] } | null;
}

export interface ArchiveHealth {
  recovered: number;
  set_aside: number;
  missing: number;
  reader_isolation: 'sandboxed' | 'basic' | 'unavailable';
}

export interface BackupListing {
  location: string;
  same_drive: boolean;
  key_configured: boolean;
  backups: BackupEntry[];
  running: { kind: 'backup' | 'check'; name?: string; done: number; total: number } | null;
  last_result: { kind: 'backup' | 'check'; name: string | null; ok: boolean; problems: string[] } | null;
}

export interface WeightReading {
  date: ISODate;
  v: number;
  src: 'clinic' | 'scale';
}

export interface TreatmentPeriod {
  name: string;
  dose: string;
  doses?: [ISODate, string][];
  start: ISODate;
  end: ISODate | null;
}

export interface ImportRecord {
  title: string;
  meta: string;
  stage: 1 | 2 | 3;
  note: string;
}

export type LowConfidenceNote = { read?: string; unit?: string; reason: string };
/** Keyed by marker key, with `_date` for a doubtful document date. */
export type LowConfidenceSet = { _date?: string } & { [markerKey: string]: LowConfidenceNote | string | undefined };

export type ImportOutcome =
  | 'duplicate'
  | 'parsed'
  | 'failed'
  | 'unsupported'
  | 'possible'
  | 'local'
  // Real uploads
  | 'uploading'
  | 'stored'
  | 'rejected'
  | 'interrupted';

export interface ImportFile {
  name: string;
  size: string;
  kind: string;
  outcome: ImportOutcome;
  result: string;
}

export interface ImportJob extends ImportFile {
  id: string;
  pct: number;
  done: boolean;
  /** The stored document, once a real upload has one. */
  documentId?: string;
}

/** Everything the screens read. One call loads it; see services/archiveApi.ts. */
export interface Archive {
  /** Fictional demonstration data, or this person's own stored files. Never both. */
  kind: 'demo' | 'personal';
  patientName: string;
  start: ISODate;
  today: ISODate;
  born: ISODate;
  /** First and last years on every chart's axis, and the years a person can jump between. */
  chartStart: number;
  chartEnd: number;
  firstYear: number;
  lastYear: number;
  labs: Record<string, string>;
  /** Clinician responsible for records from each source. */
  whoBySource: Record<string, string>;
  draws: [ISODate, string][];
  /** When each draw's results entered the record. */
  drawDocumented: ISODate[];
  /** The source document of each draw. Null when entered by hand. */
  drawDocuments: (string | null)[];
  categories: MarkerCategory[];
  markers: Marker[];
  overviewMarkers: Marker[];
  events: HealthEvent[];
  medications: Medication[];
  diagnoses: Diagnosis[];
  treatments: TreatmentPeriod[];
  documents: ArchiveDocument[];
  documentsById: Record<string, ArchiveDocument>;
  lowConfidence: Record<string, LowConfidenceSet>;
  weight: WeightReading[];
  clinicWeightCount: number;
  /** Periods with no records of any kind. */
  gaps: [ISODate, ISODate][];
  /** Periods with no scale readings. */
  scaleGap: [ISODate, ISODate];
  scaleSpans: [ISODate, ISODate][];
  recentImports: ImportRecord[];
  knownLimits: { title: string; detail: string }[];
  sampleBatch: ImportFile[];
  /** Verified results that cannot be drawn. */
  unplotted: UnplottedResult[];
  /** Every laboratory observation, whatever its status. Only a real archive has these. */
  observations: LabObservation[];
  /** Names of known tests, offered when entering a result. */
  testNames: string[];
}
