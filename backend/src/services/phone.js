import { AppError } from '../utils/app-error.js';

export function normalizePhone(input) {
  const raw = String(input ?? '').trim();
  const compact = raw.replace(/[^\d+]/g, '');
  const e164 = compact.startsWith('+') ? compact : `+${compact.replace(/^\+/, '')}`;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) {
    throw new AppError('Enter a valid phone number', 400, 'VALIDATION_ERROR');
  }
  return e164;
}

export function maskPhone(e164) {
  if (!e164) return null;
  return `${e164.slice(0, 3)}••••${e164.slice(-2)}`;
}
