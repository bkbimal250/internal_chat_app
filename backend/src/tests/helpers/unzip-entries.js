import zlib from 'node:zlib';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

export function unzipEntries(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || bytes.readUInt32LE(eocd) !== EOCD_SIGNATURE) {
    throw new Error('ZIP end of central directory not found');
  }
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('ZIP central directory is corrupt');
    }
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const uncompressed = bytes.readUInt32LE(offset + 24);
    const nameLen = bytes.readUInt16LE(offset + 28);
    const extraLen = bytes.readUInt16LE(offset + 30);
    const commentLen = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;
    if (bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`ZIP local header missing for ${name}`);
    }
    const localNameLen = bytes.readUInt16LE(localOffset + 26);
    const localExtraLen = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressedData = bytes.subarray(dataStart, dataStart + compressed);
    let data;
    if (method === 0) data = compressedData;
    else if (method === 8) data = zlib.inflateRawSync(compressedData);
    else throw new Error(`Unsupported ZIP method ${method}`);
    if (data.length !== uncompressed) {
      throw new Error(`ZIP size mismatch for ${name}`);
    }
    entries.push({ name, data: Buffer.from(data) });
  }
  return entries;
}
