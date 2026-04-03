export interface LoadedFile {
  filename: string;
  file_type: string;
  raw_text: string;
  metadata: Record<string, unknown>;
  structured_data: Record<string, unknown>;
  extraction_quality: number;
}

export interface BusinessCardExtract {
  name?: string | null;
  title?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  wechat?: string | null;
  address?: string | null;
  raw_text?: string | null;
}

export interface FileLoaderTextRequest {
  filename: string;
  content_base64?: string;
  text?: string;
}
