import apiClient from './api';
import { ABSOLUTE_FILE_LIMIT } from '../utils/imageResize';

export type MediaPurpose = 'profile_photo' | 'background' | 'assignment_import';

interface UploadAuthorization {
  upload_url: string;
  fields: Record<string, string>;
  object_key: string;
  max_bytes: number;
  expires_in: number;
}

export interface StoredMedia {
  object_key: string;
  access_url: string;
  media_type: string;
  size: number;
  expires_in: number;
}

async function checksumBase64(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

export async function uploadTemporaryMedia(file: File, purpose: MediaPurpose): Promise<string> {
  if (file.size < 1 || file.size > ABSOLUTE_FILE_LIMIT) throw new Error('Choose a file smaller than 100 MiB.');
  const checksum = await checksumBase64(file);
  const response = await apiClient.post<{ data: UploadAuthorization }>('/media/uploads', {
    purpose,
    file_name: file.name,
    media_type: file.type,
    file_size: file.size,
    sha256_base64: checksum,
  });
  const authorization = response.data.data;
  if (file.size > authorization.max_bytes) throw new Error('The resized file exceeds its upload limit.');

  const form = new FormData();
  Object.entries(authorization.fields).forEach(([key, value]) => form.append(key, value));
  form.append('file', file);
  const upload = await fetch(authorization.upload_url, { method: 'POST', body: form, credentials: 'omit' });
  if (!upload.ok) throw new Error('Amazon S3 rejected the upload. Please retry.');
  return authorization.object_key;
}

export async function uploadBackground(file: File): Promise<StoredMedia> {
  const objectKey = await uploadTemporaryMedia(file, 'background');
  try {
    const response = await apiClient.post<{ data: StoredMedia }>('/media/complete', {
      purpose: 'background',
      object_key: objectKey,
    });
    return response.data.data;
  } catch (error) {
    void apiClient.delete('/media', { data: { purpose: 'background', object_key: objectKey, temporary: true } });
    throw error;
  }
}

export async function resolveBackground(objectKey: string): Promise<StoredMedia> {
  const response = await apiClient.post<{ data: StoredMedia }>('/media/resolve', { object_key: objectKey });
  return response.data.data;
}

export async function deleteBackground(objectKey: string) {
  await apiClient.delete('/media', { data: { purpose: 'background', object_key: objectKey } });
}


export async function discardTemporaryMedia(objectKey: string, purpose: MediaPurpose) {
  await apiClient.delete('/media', { data: { purpose, object_key: objectKey, temporary: true } });
}
