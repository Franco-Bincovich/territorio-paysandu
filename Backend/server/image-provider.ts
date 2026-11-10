import { SftpImages } from './sftp-images/provider';
import { HttpError } from './security';
import type { ParcelImageRef } from './sftp-images/config';
export interface InstitutionalImages {
  placeholders(padCod:string): ReturnType<SftpImages['placeholders']>;
  catalogue(ref:ParcelImageRef): ReturnType<SftpImages['catalogue']>;
  download(kind:string,ref:ParcelImageRef,signal?:AbortSignal): Promise<Response>;
}
// Runtime configuration is process-owned; never selected by query parameters.
const environment = { ...process.env };
export function configuredInstitutionalImages(): InstitutionalImages | undefined {
  const mode = environment.IMAGE_PROVIDER;
  if (mode === 'filesystem' || mode === 'sftp') return new SftpImages();
  if (!mode || mode === 'catalogue' || mode === 'supabase') return undefined;
  throw new HttpError(503, 'IMAGE_CONFIG', 'El proveedor de imágenes no está configurado.');
}
