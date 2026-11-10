import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  archiveFileName,
  displayFileName,
  stampInZone,
  uniqueDisplayNames,
  zipEntryName,
} from '../services/michat-filename.js';
import { streamZipArchive } from '../services/zip-archive.js';
import { MAX_ZIP_BYTES } from '../services/upload-plan.js';
import { unzipEntries } from './helpers/unzip-entries.js';

const STAMP = new Date('2026-11-10T12:12:14.000Z');

test('MiChat display names use IST stamps and hide original filenames', () => {
  const stamp = stampInZone(STAMP);
  assert.equal(stamp.date, '2026-11-10');
  assert.equal(stamp.time, '5.42.14 PM');
  assert.equal(
    displayFileName({
      kind: 'image',
      originalName: 'secret-payroll.png',
      mimeType: 'image/png',
      createdAt: STAMP,
    }),
    'MiChat Image 2026-11-10 at 5.42.14 PM.png',
  );
  assert.equal(
    displayFileName({
      kind: 'video',
      originalName: 'clip.mp4',
      mimeType: 'video/mp4',
      createdAt: STAMP,
    }),
    'MiChat Video 2026-11-10 at 5.42.14 PM.mp4',
  );
  assert.equal(
    displayFileName({
      kind: 'audio',
      originalName: 'voice.m4a',
      mimeType: 'audio/mp4',
      createdAt: STAMP,
    }),
    'MiChat Audio 2026-11-10 at 5.42.14 PM.m4a',
  );
  assert.equal(
    displayFileName({
      kind: 'file',
      originalName: 'contract.pdf',
      mimeType: 'application/pdf',
      createdAt: STAMP,
    }),
    'MiChat Document 2026-11-10 at 5.42.14 PM.pdf',
  );
  assert.equal(archiveFileName(STAMP), 'MiChat Files 2026-11-10 at 5.42.14 PM.zip');
});

test('same-second batches get unique ZIP-safe names', () => {
  const rows = Array.from({ length: 50 }, (_, index) => ({
    id: `11111111-1111-1111-1111-${String(index).padStart(12, '0')}`,
    kind: 'image',
    originalName: 'photo.png',
    mimeType: 'image/png',
    createdAt: STAMP,
  }));
  const names = uniqueDisplayNames(rows);
  assert.equal(names[0], 'MiChat Image 2026-11-10 at 5.42.14 PM.png');
  assert.equal(names[1], 'MiChat Image 2026-11-10 at 5.42.14 PM (2).png');
  assert.equal(new Set(names).size, 50);
  assert.equal(
    names.some((name) => name.includes('photo.png') || name.includes('..') || name.includes('/')),
    false,
  );
});

test('ZIP entries cannot traverse directories', () => {
  assert.equal(zipEntryName('../Windows/system.ini'), 'Windows_system.ini');
  assert.equal(zipEntryName('..\\secret.txt'), 'secret.txt');
  assert.equal(zipEntryName('/etc/passwd'), 'etc_passwd');
});

test('streaming ZIP contains generated names and original bytes without buffering sources', async () => {
  const chunks = [];
  const output = new PassThrough();
  output.on('data', (chunk) => chunks.push(chunk));
  const files = [
    {
      storageKey: 'att/opaque-a',
      entryName: 'MiChat Image 2026-11-10 at 5.42.14 PM.jpg',
      sizeBytes: 33 * 1024 * 1024,
    },
    {
      storageKey: 'att/opaque-b',
      entryName: '../secret.txt',
      sizeBytes: 33 * 1024 * 1024,
    },
  ];
  await streamZipArchive(output, files, async (key) =>
    Buffer.from(key === 'att/opaque-a' ? 'AAAA' : 'BBBB'),
  );
  const buffer = Buffer.concat(chunks);
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const text = buffer.toString('binary');
  assert.equal(text.includes('MiChat Image'), true);
  assert.equal(text.includes('secret.txt'), true);
  assert.equal(text.includes('../secret.txt'), false);
  assert.equal(text.includes('att/opaque'), false);
  assert.equal(text.includes('AAAA'), true);
  assert.equal(text.includes('BBBB'), true);
  const extracted = unzipEntries(buffer);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].name, 'MiChat Image 2026-11-10 at 5.42.14 PM.jpg');
  assert.equal(extracted[0].data.toString(), 'AAAA');
  assert.equal(extracted[1].name, 'secret.txt');
  assert.equal(extracted[1].data.toString(), 'BBBB');
  assert.ok(MAX_ZIP_BYTES > 1024 * 1024 * 1024);
});

test('ZIP generation streams entries without concatenating sources first', async () => {
  const opened = [];
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (chunk) => chunks.push(chunk));
  const files = Array.from({ length: 8 }, (_, index) => ({
    storageKey: `att/stream-${index}`,
    entryName: `MiChat Document 2026-11-10 at 5.42.14 PM (${index + 1}).txt`,
    sizeBytes: 4,
  }));
  await streamZipArchive(output, files, async (key) => {
    opened.push(key);
    return Buffer.from(key);
  });
  assert.equal(opened.length, 8);
  assert.ok(chunks.length >= 1);
  const extracted = unzipEntries(Buffer.concat(chunks));
  assert.equal(extracted.length, 8);
  assert.equal(extracted[3].data.toString(), 'att/stream-3');
  assert.ok(MAX_ZIP_BYTES >= 10 * 1024 * 1024 * 1024);
});
