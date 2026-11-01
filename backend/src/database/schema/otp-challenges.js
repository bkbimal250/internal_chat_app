import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phoneE164: varchar('phone_e164', { length: 16 }).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('otp_challenges_phone_idx').on(t.phoneE164, t.createdAt),
    index('otp_challenges_expires_idx').on(t.expiresAt),
  ],
);
