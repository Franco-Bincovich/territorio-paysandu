import { inflateRawSync } from 'node:zlib';
import { HttpError } from '../security';

const invalid = () => new HttpError(422, 'EXPEDIENTES_INVALID_DOCX', 'El documento Word no es compatible o está dañado.');
const crcTable = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
// Strict, bounded ZIP reader: Office packages only, no encryption, ZIP64 or active content.
export function validateDocx(bytes: Buffer): void {
  try {
    if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, 'EXPEDIENTES_TOO_LARGE', 'El documento supera el tamaño permitido.');
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
    }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw invalid();
    const count = bytes.readUInt16LE(end + 10);
    if (!count || count > 2048 || bytes.readUInt16LE(end + 8) !== count) throw invalid();
    let cursor = bytes.readUInt32LE(end + 16), total = 0;
    if (cursor + bytes.readUInt32LE(end + 12) !== end) throw invalid();
    const names = new Set<string>();
    for (let i = 0; i < count; i++) {
      if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
      const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
      const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
      const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      const lower = name.toLowerCase();
      if (flags & 1 || ![0, 8].includes(method) || !name || names.has(lower) || name.includes('..') || /[\\\x00]/.test(name) || name.startsWith('/') || /vba|activex|embeddings|oleobject/.test(lower)) throw invalid();
      names.add(lower); total += size;
      if (size > 32 * 1024 * 1024 || total > 64 * 1024 * 1024) throw invalid();
      const local = bytes.readUInt32LE(cursor + 42);
      if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method) throw invalid();
      const localNameLength = bytes.readUInt16LE(local + 26);
      if (bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) throw invalid();
      const start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
      if (start + compressed > bytes.readUInt32LE(end + 16)) throw invalid();
      const packed = bytes.subarray(start, start + compressed);
      const data = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, size) });
      if (data.length !== size || crc32(data) !== bytes.readUInt32LE(cursor + 16)) throw invalid();
      if (lower.endsWith('.xml') || lower.endsWith('.rels')) {
        const xml = data.toString('utf8');
        if (data.includes(0) || xml.includes('\ufffd') || /encoding\s*=\s*["'](?!UTF-8["'])/i.test(xml)) throw invalid();
        if (lower.endsWith('.rels') && xml.includes('&')) throw invalid();
        if (/<!DOCTYPE|<!ENTITY|macroEnabled|TargetMode\s*=\s*["']External["']|<\s*(?:\w+:)?(?:altChunk|object)\b|\b(?:INCLUDETEXT|INCLUDEPICTURE|DDEAUTO|DATABASE)\b/i.test(xml)) throw invalid();
      }
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== end || !names.has('[content_types].xml') || !names.has('word/document.xml') || !names.has('_rels/.rels')) throw invalid();
  } catch (error) { if (error instanceof HttpError) throw error; throw invalid(); }
}
