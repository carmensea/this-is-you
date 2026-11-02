// Talks to the local FastAPI service, and only to it. All requests are same-origin.
import { fShort } from '../domain/dates';
import { fmtSize } from '../domain/format';
import type { Archive, ArchiveDocument, DocumentCategory, DocumentReview, DocumentStatus, ExtractionStatus, MetadataFieldKey, MetadataFieldState, MetadataProposal } from '../domain/types';
import { ArchiveRequestError, type ArchiveApi, type DocumentsBackend, type FieldDecision, type UploadResult } from './archiveApi';

const CLIENT_HEADER = 'X-This-Is-You-Client';

interface FieldDto {
  state: MetadataFieldState['state'];
  value: string | null;
  decided_at: string | null;
  proposal: MetadataProposal | null;
}

export interface DocumentDto {
  id: string;
  original_filename: string;
  imported_at: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  content_url: string;
  extraction_status: ExtractionStatus;
  review_status: DocumentReview['review'];
  verification_status: DocumentReview['verification'];
  page_count: number | null;
  pages_read: number;
  pages_with_text: number;
  truncated: boolean;
  metadata: Record<MetadataFieldKey, FieldDto>;
  possible_duplicates: string[];
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const CATEGORIES: DocumentCategory[] = ['lab', 'imaging', 'note', 'pathology', 'procedure', 'other'];

const UNREADABLE: ExtractionStatus[] = ['image_only', 'encrypted', 'no_text'];

const EXTRACTION_NOTE: Partial<Record<ExtractionStatus, string>> = {
  pending: 'Waiting to be read on this computer.',
  running: 'Being read on this computer.',
  image_only:
    'Image-only PDF: it has no readable text, and scanned pages cannot be read in this version. Enter the details by hand.',
  encrypted: 'This PDF is password protected, so it was not read. Enter the details by hand.',
  no_text: 'No readable text was found in this PDF. Enter the details by hand.',
  failed: 'This file could not be read. It may be damaged. The original is stored unchanged.',
  too_complex:
    'Reading stopped at the safety limits on time or memory. The original is stored unchanged. Enter the details by hand.',
};

/** Shapes a stored file for the screens. Only decisions a person made count as facts about it. */
export function toArchiveDocument(dto: DocumentDto): ArchiveDocument {
  const imported = new Date(dto.imported_at);
  const importDate = localDate(imported);
  const time = imported.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fields = Object.fromEntries(
    Object.entries(dto.metadata).map(([key, f]) => [
      key,
      { state: f.state, value: f.value, decidedAt: f.decided_at, proposal: f.proposal },
    ]),
  ) as DocumentReview['fields'];
  const decided = (key: MetadataFieldKey) => fields[key].value ?? null;
  const verifiedDate = decided('service_date');
  const notes = [
    EXTRACTION_NOTE[dto.extraction_status],
    dto.extraction_status === 'partial'
      ? `Only part of this file was read: ${dto.pages_with_text} of ${dto.page_count ?? dto.pages_read} pages had readable text${dto.truncated ? ', and it was past the reading limit' : ''}.`
      : undefined,
    dto.possible_duplicates.length
      ? 'Possible duplicate: another file in the archive has the same text. Both are kept.'
      : undefined,
    verifiedDate ? undefined : "The date shown is the import date. This document's own date has not been verified.",
  ].filter(Boolean);
  const status: DocumentStatus =
    dto.review_status === 'completed'
      ? 'reviewed'
      : UNREADABLE.includes(dto.extraction_status)
        ? 'unsupported'
        : dto.extraction_status === 'extracted' || dto.extraction_status === 'partial'
          ? 'parsed'
          : 'uploaded';
  return {
    id: dto.id,
    cat: CATEGORIES.find((c) => c === decided('document_type')) ?? 'other',
    title: decided('report_title') ?? dto.original_filename,
    // "As understood now" uses the date it happened, once a person has verified it. "As known then"
    // uses the date it reached the archive.
    date: verifiedDate ?? importDate,
    documented: importDate,
    dateUnknown: !verifiedDate,
    source: decided('provider') ?? 'Uploaded file',
    who: '',
    ext: 'pdf',
    file: dto.original_filename,
    format: 'PDF',
    via: 'Direct upload',
    imported: `${fShort(importDate)}, ${time}`,
    status,
    pages: dto.page_count ?? 0,
    n: 0,
    size: fmtSize(dto.byte_size),
    note: notes.join(' '),
    hash: dto.sha256,
    search: [
      dto.original_filename,
      decided('report_title'),
      decided('provider'),
      verifiedDate,
      importDate,
      fShort(importDate),
      dto.sha256,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    contentUrl: dto.content_url,
    review: {
      extraction: dto.extraction_status,
      review: dto.review_status,
      verification: dto.verification_status,
      pageCount: dto.page_count,
      pagesRead: dto.pages_read,
      pagesWithText: dto.pages_with_text,
      truncated: dto.truncated,
      fields,
      possibleDuplicates: dto.possible_duplicates,
    },
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

async function send(url: string, body?: unknown): Promise<ArchiveDocument> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { [CLIENT_HEADER]: '1', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ArchiveRequestError('The archive service could not be reached. Nothing was saved.', 'unreachable');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ArchiveRequestError(data?.message ?? 'This could not be saved.', data?.code ?? 'error');
  return toArchiveDocument(data as DocumentDto);
}

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
  const backend: DocumentsBackend = {
    maxUploadBytes: status.max_upload_bytes,
    listDocuments,
    upload,
    decide: (id, field, decision: FieldDecision) => send(`/api/documents/${id}/metadata/${field}`, decision),
    setReview: (id, complete) => send(`/api/documents/${id}/review`, { complete }),
    readAgain: (id) => send(`/api/documents/${id}/extract`),
  };
  const api: ArchiveApi = {
    loadArchive: async () => withDocuments(emptyPersonalArchive(localDate(new Date())), await listDocuments()),
  };
  return { api, backend };
}

export function withDocuments(archive: Archive, documents: ArchiveDocument[]): Archive {
  return { ...archive, documents, documentsById: Object.fromEntries(documents.map((d) => [d.id, d])) };
}

export const todayLocal = () => localDate(new Date());
