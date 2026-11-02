// The seam between the app and its data source. Screens read only the Archive this returns.
// A FastAPI client implements the same interface; swap it in main.tsx.
import { syntheticArchive } from '../data/syntheticArchive';
import type { Archive } from '../domain/types';

export interface ArchiveApi {
  loadArchive(): Promise<Archive>;
}

export const mockArchiveApi: ArchiveApi = {
  loadArchive: async () => syntheticArchive,
};
