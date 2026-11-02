// Domain model for the archive. These shapes are what a future backend must return.

/** Calendar date as YYYY-MM-DD. Compared as a string throughout. */
export type ISODate = string;

export type LabCode = 'H' | 'N';
export type Flag = '' | 'H' | 'L';
export type SnapshotMode = 'known' | 'now';

export interface LabResult {
  /** Index of the laboratory draw this result came from. */
  i: number;
  date: ISODate;
  /** When the result entered the record. "As known then" filters on this. */
  documented: ISODate;
  lab: LabCode;
  value: number;
  lo: number | null;
  hi: number | null;
  unit: string;
  dp: number;
  flag: Flag;
  /** Source document this value was extracted from. */
  documentId: string;
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

export type ImportOutcome = 'duplicate' | 'parsed' | 'failed' | 'unsupported' | 'possible' | 'local';

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
}

/** Everything the screens read. One call loads it; see services/archiveApi.ts. */
export interface Archive {
  patientName: string;
  start: ISODate;
  today: ISODate;
  born: ISODate;
  labs: Record<LabCode, string>;
  /** Clinician responsible for records from each source. */
  whoBySource: Record<string, string>;
  draws: [ISODate, LabCode][];
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
}
