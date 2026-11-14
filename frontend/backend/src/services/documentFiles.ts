import { randomUUID } from 'crypto';
import path from 'path';
import { inflateRawSync } from 'zlib';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';

const officeExtensions = new Set(['.docx', '.xlsx', '.pptx']);

const mimeByExtension: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
};

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZipEntries(bytes: Buffer, expectedNames: Set<string>): Map<string, Buffer> {
  const found = new Map<string, Buffer>();
  const searchStart = Math.max(0, bytes.length - 65_557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0 || bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) return found;

  const entryCount = bytes.readUInt16LE(endOffset + 10);
  let offset = bytes.readUInt32LE(endOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) return new Map();
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) return new Map();
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (expectedNames.has(name)) {
      const method = bytes.readUInt16LE(offset + 10);
      const expectedCrc = bytes.readUInt32LE(offset + 16);
      const compressedSize = bytes.readUInt32LE(offset + 20);
      const uncompressedSize = bytes.readUInt32LE(offset + 24);
      const localOffset = bytes.readUInt32LE(offset + 42);
      if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) return new Map();
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const localName = bytes.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      if (localName !== name || dataOffset + compressedSize > bytes.length || uncompressedSize > env.DMS_MAX_FILE_SIZE_BYTES) return new Map();
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      try {
        const content = method === 0
          ? Buffer.from(compressed)
          : method === 8
            ? inflateRawSync(compressed, { maxOutputLength: env.DMS_MAX_FILE_SIZE_BYTES })
            : null;
        if (!content || content.length !== uncompressedSize || crc32(content) !== expectedCrc) return new Map();
        found.set(name, content);
      } catch {
        return new Map();
      }
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

function isPlainUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  } catch {
    return false;
  }
}

export function sanitizeOriginalFilename(value: string): string {
  const normalized = value.replace(/\\/g, '/').split('/').pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || '';
  if (!normalized || normalized === '.' || normalized === '..' || normalized.length > 255) {
    throw Object.assign(new Error('Ungültiger Dateiname.'), { statusCode: 400 });
  }
  return normalized;
}

export function detectDocumentContent(bytes: Buffer, filename: string): { contentType: string; extension: string } {
  const extension = path.extname(filename).toLowerCase();
  const contentType = mimeByExtension[extension];
  if (!contentType || bytes.length === 0) {
    throw Object.assign(new Error('Dateityp nicht freigegeben oder Datei leer.'), { statusCode: 415 });
  }

  let valid = false;
  switch (extension) {
    case '.pdf':
      valid = bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
      break;
    case '.jpg':
    case '.jpeg':
      valid = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      break;
    case '.png':
      valid = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      break;
    case '.gif':
      valid = ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
      break;
    case '.webp':
      valid = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      break;
    case '.bmp':
      valid = bytes.length >= 14 && bytes.toString('ascii', 0, 2) === 'BM';
      break;
    case '.txt':
    case '.csv':
      valid = isPlainUtf8Text(bytes);
      break;
    case '.docx':
      {
        const entries = readZipEntries(bytes, new Set(['[Content_Types].xml', 'word/document.xml']));
        const contentTypes = entries.get('[Content_Types].xml')?.toString('utf8') ?? '';
        const documentXml = entries.get('word/document.xml')?.toString('utf8') ?? '';
        valid = contentTypes.includes('wordprocessingml.document.main+xml') && /<w:document(?:\s|>)/.test(documentXml);
      }
      break;
    case '.xlsx':
      {
        const entries = readZipEntries(bytes, new Set(['[Content_Types].xml', 'xl/workbook.xml']));
        const contentTypes = entries.get('[Content_Types].xml')?.toString('utf8') ?? '';
        const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8') ?? '';
        valid = contentTypes.includes('spreadsheetml.sheet.main+xml') && /<workbook(?:\s|>)/.test(workbookXml);
      }
      break;
    case '.pptx':
      {
        const entries = readZipEntries(bytes, new Set(['[Content_Types].xml', 'ppt/presentation.xml']));
        const contentTypes = entries.get('[Content_Types].xml')?.toString('utf8') ?? '';
        const presentationXml = entries.get('ppt/presentation.xml')?.toString('utf8') ?? '';
        valid = contentTypes.includes('presentationml.presentation.main+xml') && /<p:presentation(?:\s|>)/.test(presentationXml);
      }
      break;
  }

  if (!valid) {
    throw Object.assign(new Error('Dateiinhalte stimmen nicht mit dem freigegebenen Dateityp überein.'), { statusCode: 415 });
  }
  return { contentType, extension };
}

function assertStorageKey(storageKey: string): void {
  if (!/^(?:quarantine\/)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storageKey)) {
    throw new Error('Ungültiger interner DMS-Speicherschlüssel.');
  }
}

export interface DocumentObjectStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class S3DocumentObjectStore implements DocumentObjectStore {
  private readonly client = new S3Client({
    endpoint: env.DMS_S3_ENDPOINT,
    region: env.DMS_S3_REGION,
    forcePathStyle: env.DMS_S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.DMS_S3_ACCESS_KEY,
      secretAccessKey: env.DMS_S3_SECRET_KEY
    }
  });

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: env.DMS_S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: contentType
    }));
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: env.DMS_S3_BUCKET, Key: key }));
    if (!response.Body) throw new Error('DMS object store returned an empty body.');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      const buffer = Buffer.from(chunk);
      length += buffer.length;
      if (length > env.DMS_MAX_FILE_SIZE_BYTES) throw new Error('Stored DMS object exceeds the configured size limit.');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, length);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: env.DMS_S3_BUCKET, Key: key }));
  }
}

export class InMemoryDocumentObjectStore implements DocumentObjectStore {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(bytes));
  }

  async get(key: string): Promise<Buffer> {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error('DMS object not found.');
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

let objectStore: DocumentObjectStore = env.NODE_ENV === 'test'
  ? new InMemoryDocumentObjectStore()
  : new S3DocumentObjectStore();

export function setDocumentObjectStore(store: DocumentObjectStore): void {
  objectStore = store;
}

export async function persistDocumentBlob(bytes: Buffer, contentType: string): Promise<string> {
  const key = `quarantine/${randomUUID()}`;
  assertStorageKey(key);
  await objectStore.put(key, bytes, contentType);
  return key;
}

export async function readDocumentBlob(storageKey: string): Promise<Buffer> {
  assertStorageKey(storageKey);
  return objectStore.get(storageKey);
}

export async function removeDocumentBlob(storageKey: string): Promise<void> {
  assertStorageKey(storageKey);
  await objectStore.delete(storageKey);
}

export function maxDocumentUploadBytes(): number {
  return env.DMS_MAX_FILE_SIZE_BYTES;
}
