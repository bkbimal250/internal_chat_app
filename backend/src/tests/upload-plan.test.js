import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MULTIPART_PART_SIZE,
  SINGLE_PUT_MAX_BYTES,
  TWO_GIB,
  assertPartNumbers,
  normalizeParts,
  planUpload,
} from '../services/upload-plan.js';

test('planUpload keeps small files on a single PUT', () => {
  const plan = planUpload(1024);
  assert.equal(plan.mode, 'single');
  assert.equal(plan.partCount, 1);
});

test('planUpload switches to multipart above the single-PUT threshold', () => {
  const plan = planUpload(SINGLE_PUT_MAX_BYTES + 1);
  assert.equal(plan.mode, 'multipart');
  assert.equal(plan.partSize, MULTIPART_PART_SIZE);
  assert.equal(plan.partCount, 2);
});

test('planUpload can force multipart for tests and 2 GiB files', () => {
  assert.equal(planUpload(70, 'multipart').mode, 'multipart');
  const large = planUpload(TWO_GIB);
  assert.equal(large.mode, 'multipart');
  assert.equal(large.partCount, TWO_GIB / MULTIPART_PART_SIZE);
});

test('assertPartNumbers and normalizeParts reject gaps and extra etags', () => {
  assert.deepEqual(assertPartNumbers([1, 2], 2), [1, 2]);
  assert.equal(assertPartNumbers([1, 1], 2), null);
  assert.equal(assertPartNumbers([3], 2), null);
  assert.deepEqual(normalizeParts([{ partNumber: 1, etag: '"a"' }], 1), [{ partNumber: 1, etag: '"a"' }]);
  assert.equal(normalizeParts([{ partNumber: 1, etag: '"a"' }], 2), null);
});
