import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, open } from 'node:fs/promises';
import { HttpError } from '../security';
import { fail, types, validateDocument, hasDocumentSignature, type Expediente, type ExpedientesStorage } from './contracts';

/** Flat opaque keys deliberately avoid intermediate-directory replacement races.
 * Root and all ancestors must be canonical and controlled by the trusted publisher.
 * Production mount MUST be read-only; external publication must use atomic replacement. */
export class FilesystemExpedientesStorage implements ExpedientesStorage {
  constructor(private root: string, private maxBytes = 20 * 1024 * 1024) {
    if (!path.isAbsolute(root) || path.normalize(root) !== root || root === path.parse(root).root ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20 * 1024 * 1024) throw fail('EXPEDIENTES_CONFIG');
  }
  async read(document: Expediente, signal: AbortSignal): Promise<Uint8Array> {
    validateDocument(document);
    const key = document.storageKey;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(key) || key.includes('..') ||
      !(types[document.documentType] as readonly string[]).slice(1).includes(path.extname(key).toLowerCase())) throw fail('EXPEDIENTES_FILE_TYPE', 415);
    if (document.size > this.maxBytes) throw fail('EXPEDIENTES_SIZE', 413);
    const checkAbort = () => { if (signal.aborted) throw fail('EXPEDIENTES_CANCELLED', 499); };
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      checkAbort();
      const rootStat = await lstat(this.root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(this.root) !== this.root) throw fail('EXPEDIENTES_STORAGE');
      const file = path.join(this.root, key), before = await lstat(file);
      if (!before.isFile() || before.isSymbolicLink() || await realpath(file) !== file) throw fail('EXPEDIENTES_STORAGE');
      if (before.size !== document.size || before.size > this.maxBytes) throw fail('EXPEDIENTES_SIZE', 413);
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const initial = await handle.stat();
      if (!initial.isFile() || initial.dev !== before.dev || initial.ino !== before.ino || initial.size !== before.size) throw fail('EXPEDIENTES_STORAGE');
      const bytes = Buffer.alloc(initial.size); let position = 0;
      while (position < bytes.length) {
        checkAbort();
        const read = await handle.read(bytes, position, Math.min(65536, bytes.length-position), position);
        if (!read.bytesRead) throw fail('EXPEDIENTES_STORAGE');
        position += read.bytesRead;
      }
      checkAbort();
      const extra = await handle.read(Buffer.alloc(1), 0, 1, position), after = await handle.stat();
      if (extra.bytesRead || after.size !== initial.size || after.mtimeMs !== initial.mtimeMs || after.ctimeMs !== initial.ctimeMs) throw fail('EXPEDIENTES_STORAGE');
      if (!hasDocumentSignature(document,bytes)) throw fail('EXPEDIENTES_FILE_TYPE', 415);
      return bytes;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw fail('EXPEDIENTE_NOT_FOUND',404);
      throw fail('EXPEDIENTES_STORAGE');
    } finally { await handle?.close(); }
  }
}
