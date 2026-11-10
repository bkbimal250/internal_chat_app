import { PassThrough, Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { zipEntryName } from './michat-filename.js';

function asReadable(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body) || typeof body === 'string') return body;
  if (body instanceof Readable) return body;
  if (typeof body.pipe === 'function') return body;
  return Readable.from(body);
}

const STORE_THRESHOLD = 32 * 1024 * 1024;

export async function streamZipArchive(output, files, getObjectStream) {
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const done = new Promise((resolve, reject) => {
    const fail = (error) => reject(error);
    archive.once('error', fail);
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') fail(error);
    });
    output.once('error', fail);
    output.once('finish', resolve);
  });
  archive.pipe(output);
  try {
    for (const file of files) {
      const name = zipEntryName(file.entryName || file.displayName);
      const body = asReadable(await getObjectStream(file.storageKey));
      archive.append(body, {
        name,
        store: Number(file.sizeBytes) > STORE_THRESHOLD,
      });
    }
    await archive.finalize();
    await done;
  } catch (error) {
    try {
      archive.abort();
    } catch {
      /* already closed */
    }
    if (!output.destroyed) output.destroy(error);
    throw error;
  }
}

export function zipOutputStream() {
  return new PassThrough();
}
