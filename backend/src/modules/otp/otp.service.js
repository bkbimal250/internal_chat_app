import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
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

function accepted(config) {
  return {
    accepted: true,
    retryAfterSeconds: config.otpResendSeconds,
    expiresInSeconds: config.otpTtlSeconds,
  };
}

export function otpService(app, config) {
  const db = app.database.db;
  const sms = smsService(config, app.log);

  const eligibleUser = async (phoneE164) => {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.phoneE164, phoneE164), isNull(users.deletedAt)));
    if (!usableUser(user) || !user.phoneVerifiedAt) return null;
    return user;
  };

  const recentCount = async (phoneE164) => {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [{ count }] = await db
      .select({ count: sql`count(*)::int` })
      .from(otpChallenges)
      .where(and(eq(otpChallenges.phoneE164, phoneE164), gt(otpChallenges.createdAt, since)));
    return count;
  };

  const latestOpen = async ({ phoneE164, purpose, userId, tx = db, lock = false }) => {
    const filters = [
      eq(otpChallenges.phoneE164, phoneE164),
      eq(otpChallenges.purpose, purpose),
      isNull(otpChallenges.consumedAt),
    ];
    if (userId) filters.push(eq(otpChallenges.userId, userId));
    let query = tx
      .select()
      .from(otpChallenges)
      .where(and(...filters))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (lock) query = query.for('update');
    const [latest] = await query;
    return latest;
  };

  const inCooldown = (challenge) =>
    Boolean(
      challenge &&
        Date.now() - new Date(challenge.lastSentAt).getTime() < config.otpResendSeconds * 1000,
    );

  const createChallenge = async ({ phoneE164, purpose, userId, code }) => {
    const [challenge] = await db
      .insert(otpChallenges)
      .values({
        phoneE164,
        purpose,
        userId: userId ?? null,
        codeHash: otpHash(config.jwtSecret, phoneE164, code),
        expiresAt: new Date(Date.now() + config.otpTtlSeconds * 1000),
        lastSentAt: new Date(),
      })
      .returning({ id: otpChallenges.id });
    return challenge;
  };

  const rememberTestCode = (purpose, phoneE164, challenge, code) => {
    if (config.nodeEnv !== 'test' || !app.otpInbox) return;
    const key = purpose === 'enroll' ? `code:enroll:${phoneE164}` : `code:${phoneE164}`;
    app.otpInbox.set(phoneE164, {
      challengeId: challenge.id,
      expiresAt: Date.now() + config.otpTtlSeconds * 1000,
      purpose,
    });
    app.otpInbox.set(key, code);
  };

  const forgetTestCode = (purpose, phoneE164) => {
    if (config.nodeEnv !== 'test' || !app.otpInbox) return;
    app.otpInbox.delete(phoneE164);
    app.otpInbox.delete(purpose === 'enroll' ? `code:enroll:${phoneE164}` : `code:${phoneE164}`);
  };

  const consumeChallenge = async (tx, challenge, code, phoneE164) => {
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
    await tx.update(otpChallenges).set({ attempts }).where(eq(otpChallenges.id, challenge.id));
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
  };

  const dispatchSms = async ({ phoneE164, code, challenge, purpose }) => {
    app.log.info({ event: 'OTP_REQUEST_ACCEPTED', purpose }, 'OTP request accepted');
    try {
      await sms.sendOtp(phoneE164, code);
      rememberTestCode(purpose, phoneE164, challenge, code);
    } catch {
      await db.delete(otpChallenges).where(eq(otpChallenges.id, challenge.id));
      app.log.warn({ event: 'OTP_DISPATCH_FAILED', purpose }, 'OTP SMS dispatch failed');
      return false;
    }
    return true;
  };

  const assertUniquePhone = async (tx, phoneE164, userId) => {
    const [holder] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.phoneE164, phoneE164), isNull(users.deletedAt), ne(users.id, userId)),
      )
      .for('update');
    if (holder) {
      throw new AppError('This mobile number is already registered', 409, 'PHONE_IN_USE');
    }
  };

  return {
    async request(input) {
      const phoneE164 = normalizePhone(input.phone);
      if ((await recentCount(phoneE164)) >= config.otpMaxPerHour) {
        throw new AppError('Too many verification requests', 429, 'RATE_LIMITED');
      }
      const user = await eligibleUser(phoneE164);
      const latest = user
        ? await latestOpen({ phoneE164, purpose: 'login' })
        : (
            await db
              .select()
              .from(otpChallenges)
              .where(and(eq(otpChallenges.phoneE164, phoneE164), eq(otpChallenges.purpose, 'login')))
              .orderBy(desc(otpChallenges.createdAt))
              .limit(1)
          )[0];
      if (inCooldown(latest)) return accepted(config);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      if (!user) {
        dummyCompare(config.jwtSecret);
        await db.insert(otpChallenges).values({
          phoneE164,
          purpose: 'login',
          codeHash: otpHash(config.jwtSecret, phoneE164, code),
          expiresAt: new Date(Date.now() + config.otpTtlSeconds * 1000),
          lastSentAt: new Date(),
          consumedAt: new Date(),
        });
        app.log.info({ event: 'OTP_REQUEST_ACCEPTED', purpose: 'login' }, 'OTP request accepted');
        return accepted(config);
      }
      const challenge = await createChallenge({ phoneE164, purpose: 'login', code });
      await dispatchSms({ phoneE164, code, challenge, purpose: 'login' });
      return accepted(config);
    },

    async verify(input) {
      const phoneE164 = normalizePhone(input.phone);
      const code = String(input.code ?? '');
      if (!/^\d{6}$/.test(code)) throw invalidCredentials();
      const verified = await db.transaction(async (tx) => {
        const challenge = await latestOpen({ phoneE164, purpose: 'login', tx, lock: true });
        return consumeChallenge(tx, challenge, code, phoneE164);
      });
      if (!verified) throw invalidCredentials();
      const user = await eligibleUser(phoneE164);
      if (!user) throw invalidCredentials();
      forgetTestCode('login', phoneE164);
      return user;
    },

    async enrollRequest(userId, phone) {
      const phoneE164 = normalizePhone(phone);
      const [holder] = await db
        .select({ id: users.id, phoneVerifiedAt: users.phoneVerifiedAt })
        .from(users)
        .where(and(eq(users.phoneE164, phoneE164), isNull(users.deletedAt)));
      if (holder && holder.id !== userId) {
        throw new AppError('This mobile number is already registered', 409, 'PHONE_IN_USE');
      }
      if (holder?.id === userId && holder.phoneVerifiedAt) {
        return { ...accepted(config), retryAfterSeconds: 0 };
      }
      if ((await recentCount(phoneE164)) >= config.otpMaxPerHour) {
        throw new AppError('Too many verification requests', 429, 'RATE_LIMITED');
      }
      const latest = await latestOpen({ phoneE164, purpose: 'enroll', userId });
      if (inCooldown(latest)) return accepted(config);
      if (!sms.enabled && config.nodeEnv !== 'test') {
        app.log.warn({ event: 'SMS_UNCONFIGURED' }, 'SMS provider credentials are missing');
        throw new AppError('Unable to send a verification code right now', 503, 'SMS_UNAVAILABLE');
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const challenge = await createChallenge({
        phoneE164,
        purpose: 'enroll',
        userId,
        code,
      });
      const delivered = await dispatchSms({ phoneE164, code, challenge, purpose: 'enroll' });
      if (!delivered && config.nodeEnv !== 'test') {
        throw new AppError('Unable to send a verification code right now', 503, 'SMS_UNAVAILABLE');
      }
      return accepted(config);
    },

    async enrollVerify(userId, phone, rawCode) {
      const phoneE164 = normalizePhone(phone);
      const code = String(rawCode ?? '');
      if (!/^\d{6}$/.test(code)) {
        throw new AppError('Enter the 6-digit verification code', 400, 'VALIDATION_ERROR');
      }
      const user = await db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for('update');
        if (!target) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        if (target.phoneE164 === phoneE164 && target.phoneVerifiedAt) return target;
        await assertUniquePhone(tx, phoneE164, userId);
        const challenge = await latestOpen({
          phoneE164,
          purpose: 'enroll',
          userId,
          tx,
          lock: true,
        });
        const verified = await consumeChallenge(tx, challenge, code, phoneE164);
        if (!verified) throw new AppError('Invalid or expired verification code', 401, 'INVALID_OTP');
        const [updated] = await tx
          .update(users)
          .set({
            phoneE164,
            phoneVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId))
          .returning();
        return updated;
      });
      forgetTestCode('enroll', phoneE164);
      return user;
    },
  };
}
