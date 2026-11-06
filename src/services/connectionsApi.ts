// Provider connections. Only a real archive has them: the demo archive has no service to connect.
import { getJson, post } from './localArchiveApi';

export interface SyncRun {
  id: number;
  status: 'running' | 'completed' | 'partial' | 'failed' | 'interrupted' | 'held' | 'stopped';
  started_at: string;
  finished_at: string | null;
  counts: Record<string, number>;
  problems: string[];
}

export interface Connection {
  status: 'connected' | 'awaiting_confirmation' | 'needs_sign_in' | 'disconnected';
  patient_fhir_id: string | null;
  patient_name: string | null;
  patient_birth_date: string | null;
  identity_status: string | null;
  identity_reason: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  record_versions: Record<string, number>;
  runs: SyncRun[];
}

export interface ProviderEntry {
  key: string;
  name: string;
  place: string;
  organization_id: string | null;
  fhir_base: string;
  state: 'available' | 'planned';
  note: string | null;
  registered: boolean;
  /** Fictional and real records never share an archive, so the sandbox connects only from a sandbox archive. */
  allowed_here: boolean;
  connection: Connection | null;
}

type Listing = { providers: ProviderEntry[]; redirect_uri: string; provider_file_problem?: string | null };

export const listConnections = () => getJson<Listing>('/api/connections');
export const startConnect = async (key: string) => (await post<{ authorize_url: string }>(`/api/connections/${key}/authorize`)).authorize_url;
export const confirmIdentity = (key: string, patientFhirId: string) =>
  post<Listing>(`/api/connections/${key}/confirm-identity`, { patient_fhir_id: patientFhirId });
export const synchronize = (key: string) => post<Listing & { run_id: number }>(`/api/connections/${key}/sync`);
export const disconnect = (key: string) => post<Listing & { revoked: boolean }>(`/api/connections/${key}/disconnect`);
export const deleteImported = (key: string) =>
  post<Listing & { deleted: { records: number; results: number } }>(`/api/connections/${key}/delete-imported`);

/** Results read from providers that nobody has reviewed yet. */
