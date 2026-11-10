import type { ReadOnlySftp } from './sftp-images/reader';
/** Common read-only contract. SFTP remains unchanged at its transport boundary. */
export type ImageFileReader = Pick<ReadOnlySftp, 'lstat' | 'directory' | 'file' | 'download' | 'filenames' | 'directoryCount'>;
export interface ImageReader {
  read<T>(run: (reader: ImageFileReader, maxBytes: number) => Promise<T>, operation?: string, signal?: AbortSignal): Promise<T>;
  close(): void;
}
