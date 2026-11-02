// The seam between the app and its data. Screens read only the Archive an implementation returns.
import type { Archive, ArchiveDocument, MetadataFieldKey } from '../domain/types';

export interface ArchiveApi {
  loadArchive(): Promise<Archive>;
}

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

export type UploadResult =
  | { kind: 'stored'; document: ArchiveDocument }
  | { kind: 'duplicate'; document: ArchiveDocument }
  /** The service refused the file. Nothing was stored. */
  | { kind: 'rejected'; message: string }
  /** The upload did not finish. Nothing was stored. */
  | { kind: 'failed'; message: string };

/** The operations only a real archive has. The demo archive has no backend at all. */
export interface DocumentsBackend {
  maxUploadBytes: number;
  listDocuments(): Promise<ArchiveDocument[]>;
  upload(file: File, onProgress: (fraction: number) => void): Promise<UploadResult>;
  decide(id: string, field: MetadataFieldKey, decision: FieldDecision): Promise<ArchiveDocument>;
  setReview(id: string, complete: boolean): Promise<ArchiveDocument>;
  readAgain(id: string): Promise<ArchiveDocument>;
}
