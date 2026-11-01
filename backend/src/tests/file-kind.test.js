import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDeclaredType, inspectContent, looksExecutable, sanitizeFileName } from '../services/file-kind.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

test('sanitizeFileName strips paths and reserved characters', () => {
  assert.equal(sanitizeFileName('..\\windows\\photo.png'), 'photo.png');
  assert.equal(sanitizeFileName('a<>:"|?*.pdf'), 'a_______.pdf');
  assert.equal(sanitizeFileName(''), 'file');
});

test('assertDeclaredType rejects unknown and oversized files', () => {
  assert.equal(assertDeclaredType('image/png', 100).kind, 'image');
  assert.equal(assertDeclaredType('video/mp4', 2 * 1024 * 1024 * 1024).kind, 'video');
  assert.equal(assertDeclaredType('application/zip', 1024).kind, 'file');
  assert.equal(assertDeclaredType('audio/x-m4a', 2048).kind, 'audio');
  assert.equal(assertDeclaredType('audio/aac', 2048).kind, 'audio');
  assert.equal(assertDeclaredType('video/3gpp', 2048).kind, 'video');
  assert.throws(() => assertDeclaredType('application/x-msdownload', 10), /not allowed/);
  assert.throws(() => assertDeclaredType('image/png', 26 * 1024 * 1024), /too large/);
});

test('inspectContent trusts magic bytes over extensions', async () => {
  const png = await inspectContent(PNG, 'image/png');
  assert.equal(png.mimeType, 'image/png');
  await assert.rejects(() => inspectContent(PNG, 'application/pdf'), /does not match/);
  await assert.rejects(() => inspectContent(Buffer.from('MZ exe'), 'text/plain'), /Executable/);
  const text = await inspectContent(Buffer.from('hello colleagues'), 'text/plain');
  assert.equal(text.kind, 'file');
});

test('looksExecutable detects PE and shebang payloads', () => {
  assert.equal(looksExecutable(Buffer.from('MZthis-is-not-an-image')), true);
  assert.equal(looksExecutable(Buffer.from('#!/usr/bin/env python\n')), true);
  assert.equal(looksExecutable(PNG), false);
});
