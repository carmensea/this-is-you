// The seam between the app and its data. Screens read only the Archive an implementation returns.
import type { Archive, ArchiveDocument } from '../domain/types';

export interface ArchiveApi {
  loadArchive(): Promise<Archive>;
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
}
