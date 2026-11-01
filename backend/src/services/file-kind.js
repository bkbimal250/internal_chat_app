import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../utils/app-error.js';
import { INSPECT_PREFIX_BYTES, INSPECT_TAIL_BYTES, TWO_GIB } from './upload-plan.js';

const IMAGE_MAX = 25 * 1024 * 1024;
const AUDIO_MAX = 100 * 1024 * 1024;
const TEXT_MAX = 8 * 1024 * 1024;

export const ALLOWED_TYPES = {
  'image/jpeg': { kind: 'image', maxBytes: IMAGE_MAX },
  'image/png': { kind: 'image', maxBytes: IMAGE_MAX },
  'image/webp': { kind: 'image', maxBytes: IMAGE_MAX },
  'image/gif': { kind: 'image', maxBytes: IMAGE_MAX },
  'video/mp4': { kind: 'video', maxBytes: TWO_GIB },
  'video/webm': { kind: 'video', maxBytes: TWO_GIB },
  'video/quicktime': { kind: 'video', maxBytes: TWO_GIB },
  'audio/mpeg': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/mp3': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/mp4': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/x-m4a': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/m4a': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/aac': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/ogg': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/opus': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/wav': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/x-wav': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/webm': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/3gpp': { kind: 'audio', maxBytes: AUDIO_MAX },
  'audio/amr': { kind: 'audio', maxBytes: AUDIO_MAX },
  'video/3gpp': { kind: 'video', maxBytes: TWO_GIB },
  'video/3gpp2': { kind: 'video', maxBytes: TWO_GIB },
  'application/pdf': { kind: 'file', maxBytes: TWO_GIB },
  'application/zip': { kind: 'file', maxBytes: TWO_GIB },
  'application/x-zip-compressed': { kind: 'file', maxBytes: TWO_GIB },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'file',
    maxBytes: TWO_GIB,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'file',
    maxBytes: TWO_GIB,
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    kind: 'file',
    maxBytes: TWO_GIB,
  },
  'text/plain': { kind: 'file', maxBytes: TEXT_MAX },
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
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt/',
};

const ZIP_MIMES = new Set(['application/zip', 'application/x-zip-compressed']);

const MIME_FAMILY = {
  'audio/mpeg': ['audio/mpeg', 'audio/mp3'],
  'audio/mp3': ['audio/mpeg', 'audio/mp3'],
  'audio/mp4': ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
  'audio/x-m4a': ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
  'audio/m4a': ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
  'audio/aac': ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
  'audio/ogg': ['audio/ogg', 'audio/opus', 'application/ogg'],
  'audio/opus': ['audio/ogg', 'audio/opus'],
  'audio/wav': ['audio/wav', 'audio/x-wav', 'audio/vnd.wave'],
  'audio/x-wav': ['audio/wav', 'audio/x-wav', 'audio/vnd.wave'],
  'audio/webm': ['audio/webm', 'video/webm'],
  'audio/3gpp': ['audio/3gpp', 'audio/amr', 'video/3gpp'],
  'audio/amr': ['audio/amr', 'audio/3gpp'],
  'video/3gpp': ['video/3gpp', 'video/3gpp2'],
  'video/3gpp2': ['video/3gpp', 'video/3gpp2'],
  'video/mp4': ['video/mp4', 'video/quicktime'],
  'video/quicktime': ['video/quicktime', 'video/mp4'],
};

function mimeMatches(declared, detected) {
  if (!detected) return false;
  if (declared === detected) return true;
  return Boolean(MIME_FAMILY[declared]?.includes(detected));
}

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

function containsAscii(buffer, value) {
  return buffer.includes(Buffer.from(value));
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
  if (ZIP_MIMES.has(declaredMime)) {
    if (detectedMime !== 'application/zip' && detectedMime !== declaredMime) {
      throw new AppError('File content does not match the declared type', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    return { mimeType: declaredMime, kind: 'file' };
  }
  if (OFFICE_ZIP[declaredMime]) {
    const zipLike = detectedMime === 'application/zip' || detectedMime === declaredMime;
    if (!zipLike || !containsAscii(buffer, OFFICE_ZIP[declaredMime])) {
      throw new AppError('File content does not match the declared type', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    return { mimeType: declaredMime, kind: 'file' };
  }
  if (!mimeMatches(declaredMime, detectedMime)) {
    throw new AppError('File content does not match the declared type', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  return { mimeType: declaredMime, kind: ALLOWED_TYPES[declaredMime].kind };
}

export async function inspectUploadedObject(storage, key, declaredMime, sizeBytes) {
  const prefixEnd = Math.min(sizeBytes, INSPECT_PREFIX_BYTES) - 1;
  const prefix = await storage.getObjectRange(key, 0, prefixEnd);
  if (OFFICE_ZIP[declaredMime] && !containsAscii(prefix, OFFICE_ZIP[declaredMime])) {
    const tailLen = Math.min(sizeBytes, INSPECT_TAIL_BYTES);
    const tail = await storage.getObjectRange(key, sizeBytes - tailLen, sizeBytes - 1);
    return inspectContent(Buffer.concat([prefix, tail]), declaredMime);
  }
  return inspectContent(prefix, declaredMime);
}
