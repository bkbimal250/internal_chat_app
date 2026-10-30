import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../utils/app-error.js';

export const ALLOWED_TYPES = {
  'image/jpeg': { kind: 'image', maxBytes: 10 * 1024 * 1024 },
  'image/png': { kind: 'image', maxBytes: 10 * 1024 * 1024 },
  'image/webp': { kind: 'image', maxBytes: 10 * 1024 * 1024 },
  'image/gif': { kind: 'image', maxBytes: 10 * 1024 * 1024 },
  'video/mp4': { kind: 'video', maxBytes: 50 * 1024 * 1024 },
  'video/webm': { kind: 'video', maxBytes: 50 * 1024 * 1024 },
  'audio/mpeg': { kind: 'audio', maxBytes: 20 * 1024 * 1024 },
  'audio/mp4': { kind: 'audio', maxBytes: 20 * 1024 * 1024 },
  'audio/ogg': { kind: 'audio', maxBytes: 20 * 1024 * 1024 },
  'audio/wav': { kind: 'audio', maxBytes: 20 * 1024 * 1024 },
  'audio/webm': { kind: 'audio', maxBytes: 20 * 1024 * 1024 },
  'application/pdf': { kind: 'file', maxBytes: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'file',
    maxBytes: 25 * 1024 * 1024,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'file',
    maxBytes: 25 * 1024 * 1024,
  },
  'text/plain': { kind: 'file', maxBytes: 2 * 1024 * 1024 },
};

const EXECUTABLE_PREFIXES = [
  Buffer.from([0x4d, 0x5a]),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
  Buffer.from('#!'),
];

const OFFICE_ZIP = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xl/',
};

export function sanitizeFileName(name) {
  const base = String(name ?? 'file')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[<>:"|?*]/g, '_')
    .split('')
    .map((ch) => (ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .replace(/^\.+/, '_')
    .trim()
    .slice(0, 255);
  return base || 'file';
}

export function assertDeclaredType(mimeType, sizeBytes) {
  const spec = ALLOWED_TYPES[mimeType];
  if (!spec) throw new AppError('File type is not allowed', 415, 'UNSUPPORTED_MEDIA_TYPE');
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > spec.maxBytes) {
    throw new AppError('File is too large', 413, 'PAYLOAD_TOO_LARGE');
  }
  return spec;
}

function startsWith(buffer, prefix) {
  return buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix);
}

export function looksExecutable(buffer) {
  return EXECUTABLE_PREFIXES.some((prefix) => startsWith(buffer, prefix));
}

function printableText(buffer) {
  let suspicious = 0;
  for (const byte of buffer.subarray(0, Math.min(buffer.length, 4096))) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) suspicious += 1;
  }
  return suspicious < 8;
}

export async function inspectContent(buffer, declaredMime) {
  if (!buffer?.length) throw new AppError('Uploaded object is empty', 400, 'INVALID_UPLOAD');
  if (looksExecutable(buffer)) {
    throw new AppError('Executable files are not allowed', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const detected = await fileTypeFromBuffer(buffer);
  const detectedMime = detected?.mime;
  if (declaredMime === 'text/plain') {
    if (detectedMime && detectedMime !== 'text/plain') {
      throw new AppError('File content does not match the declared type', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    if (!printableText(buffer)) {
      throw new AppError('File content does not match the declared type', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    return { mimeType: 'text/plain', kind: 'file' };
  }
  if (OFFICE_ZIP[declaredMime]) {
    const zipLike = detectedMime === 'application/zip' || detectedMime === declaredMime;
    if (!zipLike || !buffer.includes(Buffer.from(OFFICE_ZIP[declaredMime]))) {
      throw new AppError('File content does not match the declared type', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    return { mimeType: declaredMime, kind: 'file' };
  }
  if (!detectedMime || detectedMime !== declaredMime) {
    throw new AppError('File content does not match the declared type', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  return { mimeType: declaredMime, kind: ALLOWED_TYPES[declaredMime].kind };
}
