import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { otpChallenges, users } from '../../database/schema/index.js';
import { normalizePhone } from '../../services/phone.js';
import { smsService } from '../../services/sms.service.js';
import { AppError } from '../../utils/app-error.js';
import { invalidCredentials, usableUser } from '../auth/auth.repository.js';

function otpHash(secret, phoneE164, code) {
  return createHmac('sha256', secret).update(`${phoneE164}:${code}`).digest('hex');
}

function hashesEqual(left, right) {
  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function dummyCompare(secret) {
  hashesEqual(otpHash(secret, '+10000000000', '000000'), otpHash(secret, '+19999999999', '111111'));
}

export function otpService(app, config) {
  const db = app.database.db;
  const sms = smsService(config, app.log);
  const generic = () => ({
    accepted: true,
    retryAfterSeconds: config.otpResendSeconds,
    expiresInSeconds: config.otpTtlSeconds,
  });

  const eligibleUser = async (phoneE164) => {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.phoneE164, phoneE164), isNull(users.deletedAt)));
    if (!usableUser(user) || !user.phoneVerifiedAt) return null;
    return user;
  };

  return {
    async request(input) {
      const phoneE164 = normalizePhone(input.phone);
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const [{ count }] = await db
        .select({ count: sql`count(*)::int` })
        .from(otpChallenges)
        .where(and(eq(otpChallenges.phoneE164, phoneE164), gt(otpChallenges.createdAt, since)));
      if (count >= config.otpMaxPerHour) {
        throw new AppError('Too many verification requests', 429, 'RATE_LIMITED');
      }
      const [latest] = await db
        .select()
        .from(otpChallenges)
        .where(and(eq(otpChallenges.phoneE164, phoneE164), isNull(otpChallenges.consumedAt)))
        .orderBy(desc(otpChallenges.createdAt))
        .limit(1);
      if (
        latest &&
        Date.now() - new Date(latest.lastSentAt).getTime() < config.otpResendSeconds * 1000
      ) {
        return generic();
      }
      const user = await eligibleUser(phoneE164);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const [challenge] = await db
        .insert(otpChallenges)
        .values({
          phoneE164,
          codeHash: otpHash(config.jwtSecret, phoneE164, code),
          expiresAt: new Date(Date.now() + config.otpTtlSeconds * 1000),
          lastSentAt: new Date(),
        })
        .returning({ id: otpChallenges.id });
      if (!user) {
        dummyCompare(config.jwtSecret);
        return generic();
      }
      try {
        await sms.sendOtp(phoneE164, code);
        if (config.nodeEnv === 'test' && app.otpInbox) {
          app.otpInbox.set(phoneE164, { challengeId: challenge.id, expiresAt: Date.now() + config.otpTtlSeconds * 1000 });
          app.otpInbox.set(`code:${phoneE164}`, code);
        }
      } catch {
        await db.delete(otpChallenges).where(eq(otpChallenges.id, challenge.id));
        app.log.warn({ code: 'OTP_DISPATCH_FAILED' }, 'OTP SMS dispatch failed');
      }
      return generic();
    },

    async verify(input) {
      const phoneE164 = normalizePhone(input.phone);
      const code = String(input.code ?? '');
      if (!/^\d{6}$/.test(code)) throw invalidCredentials();
      const verified = await db.transaction(async (tx) => {
        const [challenge] = await tx
          .select()
          .from(otpChallenges)
          .where(and(eq(otpChallenges.phoneE164, phoneE164), isNull(otpChallenges.consumedAt)))
          .orderBy(desc(otpChallenges.createdAt))
          .limit(1)
          .for('update');
        if (!challenge) {
          dummyCompare(config.jwtSecret);
          return false;
        }
        if (challenge.expiresAt <= new Date()) {
          await tx
            .update(otpChallenges)
            .set({ consumedAt: new Date() })
            .where(eq(otpChallenges.id, challenge.id));
          return false;
        }
        const attempts = challenge.attempts + 1;
        await tx
          .update(otpChallenges)
          .set({ attempts })
          .where(eq(otpChallenges.id, challenge.id));
        if (attempts > config.otpMaxAttempts) {
          await tx
            .update(otpChallenges)
            .set({ consumedAt: new Date() })
            .where(eq(otpChallenges.id, challenge.id));
          return false;
        }
        const expected = otpHash(config.jwtSecret, phoneE164, code);
        if (!hashesEqual(challenge.codeHash, expected)) return false;
        await tx
          .update(otpChallenges)
          .set({ consumedAt: new Date() })
          .where(eq(otpChallenges.id, challenge.id));
        return true;
      });
      if (!verified) throw invalidCredentials();
      const user = await eligibleUser(phoneE164);
      if (!user) throw invalidCredentials();
      if (config.nodeEnv === 'test' && app.otpInbox) {
        app.otpInbox.delete(phoneE164);
        app.otpInbox.delete(`code:${phoneE164}`);
      }
      return user;
    },
  };
}
