// Talks to the local FastAPI service, and only to it. All requests are same-origin.
import { fShort } from '../domain/dates';
import { fmtSize } from '../domain/format';
import type { Archive, ArchiveDocument, DocumentCategory, DocumentStatus } from '../domain/types';
import type { ArchiveApi, DocumentsBackend, UploadResult } from './archiveApi';

const CLIENT_HEADER = 'X-This-Is-You-Client';

export interface DocumentDto {
  id: string;
  original_filename: string;
  imported_at: string;
  document_type: string;
  processing_status: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  content_url: string;
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const CATEGORIES: DocumentCategory[] = ['lab', 'imaging', 'note', 'pathology', 'procedure', 'other'];

/** Shapes a stored file for the Documents screen, claiming nothing the archive does not know. */
export function toArchiveDocument(dto: DocumentDto): ArchiveDocument {
  const imported = new Date(dto.imported_at);
  const date = localDate(imported);
  const time = imported.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const cat = CATEGORIES.find((c) => c === dto.document_type) ?? 'other';
  return {
    id: dto.id,
    cat,
    title: dto.original_filename,
    // Nothing reads the file, so its own date is unknown. The import date stands in for sorting.
    date,
    documented: date,
    dateUnknown: true,
    source: 'Uploaded file',
    who: '',
    ext: 'pdf',
    file: dto.original_filename,
    format: 'PDF',
    via: 'Direct upload',
    imported: `${fShort(date)}, ${time}`,
    status: dto.processing_status as DocumentStatus,
    pages: 0,
    n: 0,
    size: fmtSize(dto.byte_size),
    note: "The date shown is the import date. This document's own date has not been recorded.",
    hash: dto.sha256,
    search: [dto.original_filename, date, fShort(date), dto.sha256].join(' ').toLowerCase(),
    contentUrl: dto.content_url,
  };
}

export function emptyPersonalArchive(today: string): Archive {
  return {
    kind: 'personal',
    patientName: 'Your documents',
    start: '2009-01-01',
    today,
    born: '',
    labs: { H: '', N: '' },
    whoBySource: {},
    draws: [],
    categories: [],
    markers: [],
    overviewMarkers: [],
    events: [],
    medications: [],
    diagnoses: [],
    treatments: [],
    documents: [],
    documentsById: {},
    lowConfidence: {},
    weight: [],
    clinicWeightCount: 0,
    gaps: [],
    scaleGap: [today, today],
    scaleSpans: [],
    recentImports: [],
    knownLimits: [],
    sampleBatch: [],
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json() as Promise<T>;
}

export const listDocuments = async () =>
  (await getJson<{ documents: DocumentDto[] }>('/api/documents')).documents.map(toArchiveDocument);

function upload(file: File, onProgress: (fraction: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const failed = () =>
      resolve({ kind: 'failed', message: 'The upload did not finish. Nothing was stored. Try again.' });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents');
    xhr.setRequestHeader('Content-Type', 'application/pdf');
    xhr.setRequestHeader(CLIENT_HEADER, '1');
    // Sent as a header and encoded, because filenames can hold any character.
    xhr.setRequestHeader('X-Original-Filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = failed;
    xhr.onabort = failed;
    xhr.onload = () => {
      let body: { duplicate?: boolean; document?: DocumentDto; message?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // A proxy error page rather than our service. Handled below.
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.document) {
        const document = toArchiveDocument(body.document);
        resolve(body.duplicate ? { kind: 'duplicate', document } : { kind: 'stored', document });
      } else if (body?.message) {
        resolve({ kind: 'rejected', message: body.message });
      } else {
        failed();
      }
    };
    xhr.send(file);
  });
}

export async function connectLocalArchive(): Promise<{ api: ArchiveApi; backend: DocumentsBackend }> {
  const status = await getJson<{ max_upload_bytes: number }>('/api/status');
  const backend: DocumentsBackend = { maxUploadBytes: status.max_upload_bytes, listDocuments, upload };
  const api: ArchiveApi = {
    loadArchive: async () => withDocuments(emptyPersonalArchive(localDate(new Date())), await listDocuments()),
  };
  return { api, backend };
}

export function withDocuments(archive: Archive, documents: ArchiveDocument[]): Archive {
  return { ...archive, documents, documentsById: Object.fromEntries(documents.map((d) => [d.id, d])) };
}

export const todayLocal = () => localDate(new Date());
