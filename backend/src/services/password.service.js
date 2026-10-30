import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

export const hashPassword = (password) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
export const verifyPassword = (hash, password) => argon2.verify(hash, password);
export const temporaryPassword = () => randomBytes(24).toString('base64url');
// One real hash per process avoids cheap account-existence timing differences.
let dummyHash;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(32).toString('hex')));
