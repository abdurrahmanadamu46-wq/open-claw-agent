import api from '../api';
import type { BusinessCardExtract, FileLoaderTextRequest, LoadedFile } from '@/types/file-loader';

export async function parseBusinessFile(payload: FileLoaderTextRequest) {
  const { data } = await api.post('/api/v1/files/parse', payload);
  return data as {
    ok: boolean;
    file: LoadedFile;
  };
}

export async function extractBusinessCard(payload: FileLoaderTextRequest) {
  const { data } = await api.post('/api/v1/files/extract-business-card', payload);
  return data as {
    ok: boolean;
    file: LoadedFile;
    card: BusinessCardExtract;
  };
}
