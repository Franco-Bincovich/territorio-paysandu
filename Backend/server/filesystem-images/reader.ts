import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, open, opendir, type FileHandle } from 'node:fs/promises';
import { HttpError } from '../security';
import { ImageAdmission, ImageAdmissionError, imageInteger } from '../image-admission';
import type { ImageReader, ImageFileReader } from '../image-reader';
import { imageError } from '../sftp-images/config';

function failure(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') throw imageError('IMAGE_NOT_FOUND', 404);
  if (['EACCES', 'EPERM', 'ELOOP'].includes(code ?? '')) throw imageError('IMAGE_ACCESS_DENIED', 403);
  if ((error as Error)?.name === 'AbortError') throw new ImageAdmissionError('IMAGE_CANCELLED', 499);
  throw imageError('IMAGE_READ', 503);
}
export function filesystemEnvironment(env: NodeJS.ProcessEnv) {
  const result = { ...env };
  for (const [kind, key] of [['SURVEY', 'actuales'], ['HISTORICAL', 'historicas']] as const) {
    const value = env[`FILESYSTEM_IMAGES_${kind}_DIRECTORY`] ?? `/data/imagenes/${key}`;
    if (!path.isAbsolute(value) || value.includes('\0') || path.normalize(value) !== value || value.endsWith('/') || value === path.parse(value).root || value.includes('\\')) throw imageError('IMAGE_CONFIG');
    result[`SFTP_IMAGES_${kind}_DIRECTORY`] = value;
  }
  result.SFTP_IMAGES_MAX_BYTES = String(imageInteger(env, 'FILESYSTEM_IMAGES_MAX_BYTES', 10485760, 1024, 20971520));
  return result;
}
class Files implements ImageFileReader {
  constructor(private roots: Set<string>, private signal: AbortSignal) {}
  private abort() { if (this.signal.aborted) throw this.signal.reason ?? new ImageAdmissionError('IMAGE_CANCELLED', 499); }
  async directory(directory: string) {
    this.abort();
    if (!this.roots.has(directory)) throw imageError('IMAGE_ACCESS_DENIED', 403);
    // Require every parent to be canonical: O_NOFOLLOW alone only protects the leaf.
    const stat = await lstat(directory).catch(error => {
      if (['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw imageError('IMAGE_CONFIG');
      return failure(error);
    });
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory).catch(failure) !== directory) throw imageError('IMAGE_ACCESS_DENIED', 403);
    return directory;
  }
  private name(directory: string, filename: string) {
    if (!this.roots.has(directory) || filename.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9 _.-]*\.png$/i.test(filename) || filename.includes('..')) throw imageError('IMAGE_ACCESS_DENIED', 403);
    return path.join(directory, filename);
  }
  async lstat(file: string): Promise<any> {
    const directory = path.dirname(file); this.name(directory, path.basename(file));
    await this.directory(directory); return lstat(file).catch(failure);
  }
  async file(directory: string, filename: string, maxBytes: number): Promise<any> {
    await this.directory(directory); const file = this.name(directory, filename), stat = await lstat(file).catch(failure);
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(file).catch(failure) !== file) throw imageError('IMAGE_ACCESS_DENIED', 403);
    if (!stat.size) throw imageError('IMAGE_INVALID', 415);
    if (stat.size > maxBytes) throw imageError('IMAGE_TOO_LARGE', 413);
    this.abort(); return { file, canonical: file, stat: { ...stat, size: stat.size, mtime: stat.mtimeMs } };
  }
  async download(directory: string, filename: string, maxBytes: number) {
    const checked = await this.file(directory, filename, maxBytes); this.abort(); let handle: FileHandle | undefined;
    try {
      handle = await open(checked.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.dev !== checked.stat.dev || stat.ino !== checked.stat.ino) throw imageError('IMAGE_ACCESS_DENIED', 403);
      if (stat.size !== checked.stat.size || stat.mtimeMs !== checked.stat.mtime || stat.size > maxBytes) throw imageError('IMAGE_INVALID', 415);
      // Fixed allocation and EOF probe prevent growth from causing unbounded reads.
      const bytes = Buffer.alloc(stat.size); let offset = 0;
      while (offset < bytes.length) { this.abort(); const read = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset); if (!read.bytesRead) throw imageError('IMAGE_INVALID', 415); offset += read.bytesRead; }
      this.abort(); const extra = await handle.read(Buffer.alloc(1), 0, 1, offset), end = await handle.stat();
      if (extra.bytesRead || end.size !== stat.size || end.mtimeMs !== stat.mtimeMs || end.ctimeMs !== stat.ctimeMs) throw imageError('IMAGE_INVALID', 415);
      return bytes;
    } catch (error) { return failure(error); } finally { await handle?.close(); }
  }
  async filenames(directory: string, maxEntries = 100000, maxNameBytes = 16 * 1024 * 1024) {
    await this.directory(directory); const names: string[] = []; let bytes = 0;
    let scanned = 0;
    try { const dir = await opendir(directory); for await (const entry of dir) {
      this.abort(); if (++scanned > maxEntries) throw imageError('IMAGE_INDEX_LIMIT'); if (!entry.isFile() || entry.isSymbolicLink()) continue;
      bytes += Buffer.byteLength(entry.name); if (names.length >= maxEntries || bytes > maxNameBytes) throw imageError('IMAGE_INDEX_LIMIT'); names.push(entry.name);
    } return names; } catch (error) { return failure(error); }
  }
  async directoryCount(directory: string) { return (await this.filenames(directory)).length; }
}
export class FilesystemReader implements ImageReader {
  private gate: ImageAdmission;
  private controllers = new Set<AbortController>();
  private roots: Set<string>;
  private maxBytes: number;
  private timeoutMs: number;
  constructor(private env: NodeJS.ProcessEnv) {
    const mapped = filesystemEnvironment(env);
    this.roots = new Set([mapped.SFTP_IMAGES_SURVEY_DIRECTORY!, mapped.SFTP_IMAGES_HISTORICAL_DIRECTORY!]);
    this.maxBytes = Number(mapped.SFTP_IMAGES_MAX_BYTES);
    this.timeoutMs = imageInteger(env, 'FILESYSTEM_IMAGES_TIMEOUT_MS', 10000, 500, 15000);
    this.gate = new ImageAdmission(imageInteger(env, 'FILESYSTEM_IMAGES_CONCURRENCY', 4, 1, 6), imageInteger(env, 'IMAGES_QUEUE_LIMIT', 40, 0, 100), imageInteger(env, 'IMAGES_QUEUE_TIMEOUT_MS', 10000, 100, 15000));
  }
  async read<T>(run: (reader: ImageFileReader, maxBytes: number) => Promise<T>, _operation = 'read', signal?: AbortSignal): Promise<T> {
    const release = await this.gate.acquire(signal), controller = new AbortController(); this.controllers.add(controller);
    const cancel = () => controller.abort(new ImageAdmissionError('IMAGE_CANCELLED', 499)); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(imageError('IMAGE_TIMEOUT')), this.timeoutMs);
    try { return await run(new Files(this.roots, controller.signal), this.maxBytes); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.controllers.delete(controller); release(); }
  }
  close() { this.gate.close(); for (const controller of this.controllers) controller.abort(imageError('IMAGE_CONNECTION')); }
}
