// Loaded on demand, so the fictional dataset is not even in memory when using a real archive.
import { syntheticArchive } from '../data/syntheticArchive';
import type { ArchiveApi } from './archiveApi';

export const demoArchiveApi: ArchiveApi = {
  loadArchive: async () => syntheticArchive,
};
