export const TWO_GIB = 2 * 1024 * 1024 * 1024;
export const SINGLE_PUT_MAX_BYTES = 8 * 1024 * 1024;
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
export const INSPECT_PREFIX_BYTES = 512 * 1024;
export const INSPECT_TAIL_BYTES = 256 * 1024;
export const PART_URL_BATCH = 40;
export const MULTIPART_CONCURRENCY = 3;

export function planUpload(sizeBytes, strategy) {
  const size = Number(sizeBytes);
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('sizeBytes must be a positive integer');
  }
  const forceMultipart = strategy === 'multipart';
  const multipart = forceMultipart || size > SINGLE_PUT_MAX_BYTES;
  const partSize = MULTIPART_PART_SIZE;
  const partCount = Math.ceil(size / partSize);
  return {
    mode: multipart ? 'multipart' : 'single',
    partSize,
    partCount,
  };
}

export function assertPartNumbers(partNumbers, partCount) {
  if (!Array.isArray(partNumbers) || partNumbers.length === 0 || partNumbers.length > PART_URL_BATCH) {
    return null;
  }
  const unique = new Set();
  for (const value of partNumbers) {
    if (!Number.isInteger(value) || value < 1 || value > partCount || unique.has(value)) return null;
    unique.add(value);
  }
  return [...unique];
}

export function normalizeParts(parts, partCount) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const byNumber = new Map();
  for (const part of parts) {
    const partNumber = Number(part?.partNumber);
    const etag = String(part?.etag ?? '').trim();
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount) return null;
    if (!etag || etag.length > 200) return null;
    byNumber.set(partNumber, { partNumber, etag });
  }
  if (byNumber.size !== partCount) return null;
  return [...byNumber.values()].sort((a, b) => a.partNumber - b.partNumber);
}
