// Talks to the local FastAPI service, and only to it. All requests are same-origin.
import { fShort } from '../domain/dates';
import { fmtSize } from '../domain/format';
import { buildClinicalRecords } from './observationRecords';
import type {
  Archive,
  ArchiveDocument,
  DocumentCategory,
  DocumentReview,
  DocumentStatus,
  ExtractionStatus,
  MetadataFieldKey,
  MetadataFieldState,
  MetadataProposal,
  LabObservation,
  IdentityCheck,
  ImportBatchSummary,
  ImportReportItem,
} from '../domain/types';
import {
  ArchiveReadError,
  ArchiveRequestError,
  type ArchiveApi,
  type DocumentsBackend,
  type FieldDecision,
  type ItemUpload,
  type ListedItem,
  type ReportQuery,
} from './archiveApi';

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
  identity?: IdentityCheck;
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

// Building a formatter is slow enough to show on a page load, so every document shares one.
let sharedTimeFormat: Intl.DateTimeFormat | undefined;
const timeFormat = () => (sharedTimeFormat ??= new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' }));

/** Shapes a stored file for the screens. Only decisions a person made count as facts about it. */
export function toArchiveDocument(dto: DocumentDto): ArchiveDocument {
  const imported = new Date(dto.imported_at);
  const importDate = localDate(imported);
  const time = timeFormat().format(imported);
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
    dto.identity && dto.identity.status !== 'not_configured' ? dto.identity.reason : undefined,
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
      observations: [],
      identity: dto.identity,
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
    chartStart: +today.slice(0, 4),
    chartEnd: +today.slice(0, 4) + 1,
    firstYear: +today.slice(0, 4),
    lastYear: +today.slice(0, 4),
    drawDocumented: [],
    drawDocuments: [],
    unplotted: [],
    observations: [],
    testNames: [],
  };
}

// A read can fail for a moment: a dropped connection, or a service that is just starting. Reads change nothing,
// so trying again is safe, and a few short tries cover those moments. After that, the person decides.
export const READ_RETRY_DELAYS_MS = [250, 750, 1500];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A session can end at any moment: it timed out, or was ended from elsewhere. The app decides what to show.
let onSignedOut = () => {};
export const whenSignedOut = (handler: () => void) => {
  onSignedOut = handler;
};

async function getJson<T>(url: string, delays = READ_RETRY_DELAYS_MS): Promise<T> {
  let failure = new ArchiveReadError('unreachable');
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      // Only this service sends this header, so a proxy's error page is not mistaken for its answer.
      const fromService = response.headers.get('x-content-type-options') === 'nosniff';
      if (response.ok && fromService) return (await response.json()) as T;
      if (fromService && response.status === 401) onSignedOut();
      failure = new ArchiveReadError(!fromService ? 'unreachable' : response.status === 401 ? 'signed_out' : 'error');
      if (fromService && response.status < 500) throw failure;
    } catch (problem) {
      if (problem === failure) throw problem;
      failure = new ArchiveReadError(problem instanceof SyntaxError ? 'error' : 'unreachable');
    }
    if (attempt >= delays.length) throw failure;
    await wait(delays[attempt]);
  }
}

export const listObservations = async () =>
  (await getJson<{ observations: LabObservation[] }>('/api/observations')).observations;

export const listDocuments = async () =>
  (await getJson<{ documents: DocumentDto[] }>('/api/documents')).documents.map(toArchiveDocument);

async function post<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { [CLIENT_HEADER]: '1', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ArchiveRequestError('The archive service could not be reached. Nothing was saved.', 'unreachable');
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401 && data?.code === 'signed_out') onSignedOut();
  if (!response.ok) throw new ArchiveRequestError(data?.message ?? 'This could not be saved.', data?.code ?? 'error');
  return data as T;
}

const send = async (url: string, body?: unknown) => toArchiveDocument(await post<DocumentDto>(url, body));

/** Sends one file as a stream: the browser reads it from disk as it goes, so it is never all in memory. */
async function uploadBatchItem(batchId: string, itemId: number, file: File): Promise<ItemUpload> {
  try {
    const response = await fetch(`/api/import-batches/${batchId}/items/${itemId}/file`, {
      method: 'POST',
      headers: { [CLIENT_HEADER]: '1', 'Content-Type': 'application/pdf' },
      body: file,
    });
    if (response.status === 401) onSignedOut();
    if (!response.ok) return { kind: 'unreachable' };
    return { kind: 'answered', item: (await response.json()) as ImportReportItem };
  } catch {
    return { kind: 'unreachable' };
  }
}

const reportUrl = (batchId: string, { category, identity, limit }: ReportQuery) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (category) query.set('category', category);
  if (identity) query.set('identity', identity);
  return `/api/import-batches/${batchId}/items?${query}`;
};

/** Resolves to why it was refused, or null once signed in. */
export async function signIn(passphrase: string): Promise<string | null> {
  try {
    await post('/api/auth/login', { passphrase });
    return null;
  } catch (problem) {
    return problem instanceof ArchiveRequestError && problem.code !== 'unreachable' ? problem.message : 'The archive service did not answer. Check that it is running.';
  }
}

export async function connectLocalArchive(): Promise<{ api: ArchiveApi; backend: DocumentsBackend }> {
  const status = await getJson<{ max_upload_bytes: number; passphrase_set?: boolean }>('/api/status');
  if (status.passphrase_set === false) throw new ArchiveReadError('setup_required');
  const backend: DocumentsBackend = {
    maxUploadBytes: status.max_upload_bytes,
    listDocuments,
    decide: (id, field, decision: FieldDecision) => send(`/api/documents/${id}/metadata/${field}`, decision),
    setReview: (id, complete) => send(`/api/documents/${id}/review`, { complete }),
    readAgain: (id) => send(`/api/documents/${id}/extract`),
    listObservations,
    correctObservation: (id, fields) => post<LabObservation>(`/api/observations/${id}/correct`, { fields }),
    setObservationStatus: (id, action) => post<LabObservation>(`/api/observations/${id}/${action}`),
    approveGroup: (approval) => post('/api/observations/approve-group', approval),
    undoGroup: (groupId) => post(`/api/observations/group-approvals/${groupId}/undo`),
    createObservation: (fields, documentId, verify) =>
      post<LabObservation>('/api/observations', { fields, document_id: documentId, verify }),
    createBatch: async (label) => (await post<{ id: string }>('/api/import-batches', { label })).id,
    addBatchItems: async (batchId, files) =>
      (await post<{ items: ListedItem[] }>(`/api/import-batches/${batchId}/items`, { items: files })).items,
    uploadBatchItem,
    listBatches: async () => (await getJson<{ batches: ImportBatchSummary[] }>('/api/import-batches', [])).batches,
    listBatchItems: (batchId, query) => getJson(reportUrl(batchId, query), []),
    retryReading: (batchId, itemId) =>
      post(`/api/import-batches/${batchId}/retry-reading${itemId === undefined ? '' : `?item=${itemId}`}`),
    removeBatch: (batchId) => post(`/api/import-batches/${batchId}`, undefined, 'DELETE'),
    getArchiveHealth: () => getJson('/api/backups/archive-health'),
    signOut: (everywhere) => post(everywhere ? '/api/auth/logout-everywhere' : '/api/auth/logout'),
    getIdentity: () => getJson('/api/identity'),
    saveIdentity: (details) => post('/api/identity', details, 'PUT'),
    listBackups: () => getJson('/api/backups', []),
    startBackup: () => post('/api/backups'),
    checkBackup: (name, passphrase) => post(`/api/backups/${name}/check`, { passphrase: passphrase ?? null }),
  };
  const api: ArchiveApi = {
    loadArchive: async () => {
      const [documents, observations, tests] = await Promise.all([
        listDocuments(),
        listObservations(),
        getJson<{ name: string }[]>('/api/lab-tests'),
      ]);
      const base = { ...emptyPersonalArchive(localDate(new Date())), testNames: tests.map((t) => t.name) };
      return buildPersonalArchive(base, documents, observations, base.today);
    },
  };
  return { api, backend };
}

export function withDocuments(archive: Archive, documents: ArchiveDocument[]): Archive {
  return { ...archive, documents, documentsById: Object.fromEntries(documents.map((d) => [d.id, d])) };
}

export const todayLocal = () => localDate(new Date());

const importDay = (iso: string) => localDate(new Date(iso));

/** One archive built from documents and results, with each result attached to its document. */
export function buildPersonalArchive(
  base: Archive,
  documents: ArchiveDocument[],
  observations: LabObservation[],
  today: string,
): Archive {
  const byDocument = new Map<string, LabObservation[]>();
  for (const o of observations) {
    if (!o.document_id) continue;
    const rows = byDocument.get(o.document_id);
    if (rows) rows.push(o);
    else byDocument.set(o.document_id, [o]);
  }
  const withResults = documents.map((d) =>
    d.review ? { ...d, review: { ...d.review, observations: byDocument.get(d.id) ?? [] } } : d,
  );
  return {
    ...withDocuments(base, withResults),
    ...buildClinicalRecords(observations, withResults, today, importDay),
    observations,
    today,
  };
}
