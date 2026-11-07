// The seam between the app and its data. Screens read only the Archive an implementation returns.
import type {
  Archive,
  ArchiveDocument,
  ArchiveHealth,
  BackupListing,
  IdentityDetails,
  ImportBatchSummary,
  ImportCategory,
  ImportReportItem,
  LabObservation,
  MetadataFieldKey,
} from '../domain/types';

export interface ArchiveApi {
  loadArchive(): Promise<Archive>;
}

export type ObservationFieldValues = Record<string, string | null | undefined>;

export type FieldDecision =
  { action: 'confirmed'; proposal_id: number } | { action: 'corrected'; value: string } | { action: 'not_stated' };

/** A request the service refused, with its message for the person. */
export class ArchiveRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Why a read failed: the service could not be reached, or it answered with an error. An empty archive is neither. */
export class ArchiveReadError extends Error {
  constructor(readonly kind: 'unreachable' | 'error' | 'signed_out' | 'setup_required') {
    super(kind);
  }
}

export type ItemUpload =
  /** The service decided, and the report row says what it decided. */
  | { kind: 'answered'; item: ImportReportItem }
  /** The file never reached a decision. Nothing was stored, and sending it again is safe. */
  | { kind: 'unreachable' };

export interface ListedFile {
  path: string;
  size: number;
  modified: number;
}
export type ListedItem = { id: number; path: string; state: ImportReportItem['state'] };
export type ReportQuery = { category: ImportCategory | null; identity: string | null; limit: number };

/** The operations only a real archive has. The demo archive has no backend at all. */
export interface GroupApproval {
  document_id: string;
  group: string;
  collected_on: string | null;
  items: { id: string; version: number }[];
}

export interface DocumentsBackend {
  maxUploadBytes: number;
  listDocuments(): Promise<ArchiveDocument[]>;
  decide(id: string, field: MetadataFieldKey, decision: FieldDecision): Promise<ArchiveDocument>;
  setReview(id: string, complete: boolean): Promise<ArchiveDocument>;
  readAgain(id: string): Promise<ArchiveDocument>;
  listObservations(): Promise<LabObservation[]>;
  correctObservation(id: string, fields: ObservationFieldValues): Promise<LabObservation>;
  setObservationStatus(id: string, action: 'verify' | 'reject' | 'reopen'): Promise<LabObservation>;
  /** Approves exactly these rows at these versions, or nothing. */
  approveGroup(approval: GroupApproval): Promise<unknown>;
  /** Accept all: exactly these rows at these versions, every one or none. */
  acceptMany(items: GroupApproval['items']): Promise<unknown>;
  undoGroup(groupId: string): Promise<unknown>;
  createObservation(
    fields: ObservationFieldValues,
    documentId: string | null,
    verify: boolean,
  ): Promise<LabObservation>;
  createBatch(label: string): Promise<string>;
  addBatchItems(batchId: string, files: ListedFile[]): Promise<ListedItem[]>;
  uploadBatchItem(batchId: string, itemId: number, file: File): Promise<ItemUpload>;
  listBatches(): Promise<ImportBatchSummary[]>;
  listBatchItems(batchId: string, query: ReportQuery): Promise<{ items: ImportReportItem[]; total: number }>;
  retryReading(batchId: string, itemId?: number): Promise<unknown>;
  removeBatch(batchId: string): Promise<unknown>;
  deleteDocument(documentId: string): Promise<unknown>;
  getIdentity(): Promise<IdentityDetails>;
  saveIdentity(details: Omit<IdentityDetails, 'configured'>): Promise<IdentityDetails>;
  listBackups(): Promise<BackupListing>;
  getArchiveHealth(): Promise<ArchiveHealth>;
  signOut(everywhere: boolean): Promise<unknown>;
  startBackup(): Promise<unknown>;
  checkBackup(name: string, passphrase?: string): Promise<unknown>;
}
