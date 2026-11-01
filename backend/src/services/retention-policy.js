export const RETENTION_DAYS = Object.freeze([30, 90, 180]);
export const REMINDER_WINDOWS = Object.freeze([
  { key: '30d', daysBefore: 30 },
  { key: '7d', daysBefore: 7 },
  { key: '1d', daysBefore: 1 },
]);
export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_EXISTING_GRACE_DAYS = 90;

export function assertRetentionDays(value) {
  const days = Number(value);
  if (!RETENTION_DAYS.includes(days)) {
    throw new Error('Retention must be 30, 90, or 180 days');
  }
  return days;
}

export function addDays(from, days) {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function expiresAtForNewMessage(createdAt, retentionDays) {
  return addDays(createdAt, retentionDays);
}

export function expiresAtForExistingMessage(createdAt, now, retentionDays, graceDays) {
  const natural = addDays(createdAt, retentionDays);
  const floor = addDays(now, graceDays);
  return natural.getTime() > floor.getTime() ? natural : floor;
}

export function nextExpiresAtOnPolicyChange(currentExpiresAt, createdAt, now, nextDays) {
  const proposed = addDays(createdAt, nextDays);
  if (proposed.getTime() >= currentExpiresAt.getTime()) return proposed;
  return currentExpiresAt.getTime() > now.getTime() ? currentExpiresAt : addDays(now, nextDays);
}

export function reminderDue(expiresAt, now, windowDays) {
  const start = addDays(expiresAt, -windowDays);
  return now.getTime() >= start.getTime() && now.getTime() < expiresAt.getTime();
}

export function publicPolicy(row) {
  return {
    retentionDays: row.retentionDays,
    remindersEnabled: row.remindersEnabled,
    cleanupEnabled: row.cleanupEnabled,
    cleanupApprovedAt: row.cleanupApprovedAt,
    existingGraceDays: row.existingGraceDays,
    legalHold: row.legalHold,
    updatedAt: row.updatedAt,
  };
}
