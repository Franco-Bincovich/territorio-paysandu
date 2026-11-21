import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, open, opendir } from 'node:fs/promises';
import type { ImageReader } from '../image-reader';
import { HttpError } from '../security';
import { parseExpedienteName } from '../../../shared/expedientes';

export const MAX_DOCX_BYTES = 20 * 1024 * 1024;
export const docError = (code: string, status = 503) => new HttpError(status, code,
  code === 'EXPEDIENTES_AMBIGUOUS' ? 'Hay expedientes duplicados o ambiguos. Se requiere revisar el catálogo.' :
  code === 'EXPEDIENTES_DIRECTORY_UNAVAILABLE' ? 'La carpeta de expedientes todavía no está disponible.' :
  status === 400 ? 'Revisá la localidad, el padrón y el número de caso.' :
  status === 404 ? 'Documento no disponible.' : status === 413 ? 'El documento supera el tamaño permitido.' :
  status === 415 ? 'El archivo no es un documento Word compatible.' :
  status === 429 ? 'El servicio de expedientes está ocupado. Reintentá en unos instantes.' :
  'Los expedientes no están disponibles temporalmente.');
export interface InstitutionalStorage {
  names(signal: AbortSignal): Promise<string[]>;
  size(name: string, signal: AbortSignal): Promise<number>;
  read(name: string, signal: AbortSignal): Promise<Buffer>;
  sizes?(names: string[], signal: AbortSignal): Promise<number[]>;
}
function cancelled(signal: AbortSignal) { if (signal.aborted) throw docError('EXPEDIENTES_CANCELLED', 499); }
function validName(name: string) { if (!parseExpedienteName(name)) throw docError('VALIDATION', 400); }
function sanitize(error: unknown, directory = false): never {
  if (error instanceof HttpError && !error.code.startsWith('IMAGE_')) throw error;
  const code = (error as { code?: string })?.code;
  if (['ENOENT', 'ENOTDIR', 'IMAGE_NOT_FOUND', 'IMAGE_CONFIG'].includes(code ?? ''))
    throw docError(directory ? 'EXPEDIENTES_DIRECTORY_UNAVAILABLE' : 'EXPEDIENTE_NOT_FOUND', directory ? 503 : 404);
  if (code === 'IMAGE_TOO_LARGE') throw docError('EXPEDIENTES_SIZE', 413);
  throw docError('EXPEDIENTES_STORAGE');
}
/** Separate from the PNG-only image reader. No filesystem write operations. */
export class InstitutionalFilesystemStorage implements InstitutionalStorage {
  constructor(private root: string) {
    if (!path.isAbsolute(root) || path.normalize(root) !== root || root === path.parse(root).root || root.includes('\0')) throw docError('EXPEDIENTES_CONFIG');
  }
  private async directory(signal: AbortSignal) {
    cancelled(signal);
    try {
      const stat = await lstat(this.root);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(this.root) !== this.root) throw docError('EXPEDIENTES_STORAGE');
      return this.root;
    } catch (error) { return sanitize(error, true); }
  }
  async names(signal: AbortSignal) {
    await this.directory(signal);
    try {
      const directory = await opendir(this.root), names: string[] = []; let scanned = 0, bytes = 0;
      for await (const entry of directory) {
        cancelled(signal);
        if (++scanned > 100000 || (bytes += Buffer.byteLength(entry.name)) > 16 * 1024 * 1024) throw docError('EXPEDIENTES_INDEX_LIMIT');
        // Include matching unsafe entries so a download fails closed, never follows links.
        if (parseExpedienteName(entry.name)) names.push(entry.name);
      }
      return names;
    } catch (error) { return sanitize(error, true); }
  }
  private async checked(name: string, signal: AbortSignal) {
    validName(name); await this.directory(signal);
    const file = path.join(this.root, name), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(file) !== file) throw docError('EXPEDIENTES_STORAGE');
    if (stat.size < 1) throw docError('EXPEDIENTES_FILE_TYPE', 415);
    if (stat.size > MAX_DOCX_BYTES) throw docError('EXPEDIENTES_SIZE', 413);
    cancelled(signal); return { file, stat };
  }
  async size(name: string, signal: AbortSignal) {
    try { return (await this.checked(name, signal)).stat.size; } catch (error) { return sanitize(error); }
  }
  async read(name: string, signal: AbortSignal): Promise<Buffer> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const checked = await this.checked(name, signal);
      handle = await open(checked.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const initial = await handle.stat();
      if (!initial.isFile() || initial.dev !== checked.stat.dev || initial.ino !== checked.stat.ino || initial.size !== checked.stat.size || initial.mtimeMs !== checked.stat.mtimeMs) throw docError('EXPEDIENTES_STORAGE');
      const bytes = Buffer.alloc(initial.size); let offset = 0;
      while (offset < bytes.length) {
        cancelled(signal); const read = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
        if (!read.bytesRead) throw docError('EXPEDIENTES_STORAGE'); offset += read.bytesRead;
      }
      const extra = await handle.read(Buffer.alloc(1), 0, 1, offset), after = await handle.stat();
      if (extra.bytesRead || after.size !== initial.size || after.mtimeMs !== initial.mtimeMs || after.ctimeMs !== initial.ctimeMs) throw docError('EXPEDIENTES_STORAGE');
      // Detect replacement/unlink of the published name during the read as well
      // as mutation of the open inode. Never return a stale detached document.
      const published = await this.checked(name, signal);
      if (published.stat.dev !== initial.dev || published.stat.ino !== initial.ino || published.stat.size !== initial.size || published.stat.mtimeMs !== initial.mtimeMs) throw docError('EXPEDIENTES_STORAGE');
      cancelled(signal); return bytes;
    } catch (error) { return sanitize(error); } finally { await handle?.close(); }
  }
}
/** Uses the existing SFTP reader, account, host-key checks and connection budget.
 * DOCX names are checked here; image-specific name/signature rules remain intact. */
export class InstitutionalSftpStorage implements InstitutionalStorage {
  constructor(private reader: ImageReader, private root: string) {
    if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(root)) throw docError('EXPEDIENTES_CONFIG');
  }
  private async run<T>(signal: AbortSignal, operation: (r: Parameters<Parameters<ImageReader['read']>[0]>[0]) => Promise<T>, directory = false): Promise<T> {
    try {
      return await this.reader.read(async r => {
        cancelled(signal);
        if (await r.directory(this.root) !== this.root) throw docError('EXPEDIENTES_STORAGE');
        const result = await operation(r);
        if (await r.directory(this.root) !== this.root) throw docError('EXPEDIENTES_STORAGE');
        cancelled(signal); return result;
      }, 'expedientes', signal);
    } catch (error) { return sanitize(error, directory); }
  }
  names(signal: AbortSignal) { return this.run(signal, r => r.filenames(this.root, 100000, 16 * 1024 * 1024), true); }
  size(name: string, signal: AbortSignal) {
    validName(name); return this.run(signal, async r => (await r.file(this.root, name, MAX_DOCX_BYTES)).stat.size);
  }
  sizes(names: string[], signal: AbortSignal) {
    names.forEach(validName);
    return this.run(signal, async r => {
      const result: number[] = []; let next = 0;
      // One existing transport admission, four bounded metadata workers.
      const worker = async () => { while (next < names.length) { cancelled(signal); const index = next++; result[index] = (await r.file(this.root, names[index], MAX_DOCX_BYTES)).stat.size; } };
      const completed = await Promise.allSettled(Array.from({ length: Math.min(4, names.length) }, worker));
      const rejected = completed.find((value): value is PromiseRejectedResult => value.status === 'rejected');
      if (rejected) throw rejected.reason;
      return result;
    });
  }
  read(name: string, signal: AbortSignal) {
    validName(name); return this.run(signal, async r => {
      const before = await r.file(this.root, name, MAX_DOCX_BYTES);
      const bytes = await r.download(this.root, name, MAX_DOCX_BYTES);
      const after = await r.file(this.root, name, MAX_DOCX_BYTES);
      if (before.stat.size !== bytes.length || after.stat.size !== bytes.length || before.stat.mtime !== after.stat.mtime) throw docError('EXPEDIENTES_STORAGE');
      return bytes;
    });
  }
}
