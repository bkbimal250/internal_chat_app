import { and, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  attachments,
  conversationMembers,
  conversations,
  messageHides,
  messageReactions,
  messages,
  notifications,
  retentionExports,
  retentionHolds,
  retentionJobs,
  retentionPolicies,
  retentionReminders,
} from '../../database/schema/index.js';
import { audit } from '../auth/auth.repository.js';
import { AppError } from '../../utils/app-error.js';
import {
  assertRetentionDays,
  expiresAtForNewMessage,
  nextExpiresAtOnPolicyChange,
  publicPolicy,
  REMINDER_WINDOWS,
} from '../../services/retention-policy.js';
import { conversationService } from '../conversations/conversations.service.js';
import { getNotificationPrefs } from '../notify/prefs.js';
import { createStorageKey } from '../../services/object-storage.service.js';

const POLICY_ID = 'default';
const BATCH = 80;
const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function conversationTitle(row, userId) {
  if (row.type === 'group') return row.title || 'Group';
  return row.title || 'Chat';
}

export function retentionService(app, config) {
  const db = app.database.db;
  const storage = app.storage;
  const conversationsService = conversationService(app);

  async function policy() {
    const [row] = await db.select().from(retentionPolicies).where(eq(retentionPolicies.id, POLICY_ID));
    if (row) return row;
    const [created] = await db
      .insert(retentionPolicies)
      .values({ id: POLICY_ID })
      .onConflictDoNothing()
      .returning();
    return created ?? (await db.select().from(retentionPolicies).where(eq(retentionPolicies.id, POLICY_ID)))[0];
  }

  async function heldConversationIds() {
    const rows = await db
      .select({ conversationId: retentionHolds.conversationId })
      .from(retentionHolds)
      .where(isNull(retentionHolds.releasedAt));
    return new Set(rows.map((row) => row.conversationId));
  }

  async function notifyMembers(conversationId, payload) {
    const members = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
    const created = [];
    for (const member of members) {
      const [row] = await db
        .insert(notifications)
        .values({
          userId: member.userId,
          conversationId,
          ...payload,
        })
        .returning();
      created.push(row);
      await Promise.resolve(app.broadcaster.user(member.userId, 'notification.created', row)).catch(() => {});
      const prefs = await getNotificationPrefs(db, member.userId);
      if (!prefs.retentionReminders) continue;
      await app.push
        ?.sendToUser(member.userId, {
          title: row.title,
          body: row.body,
          data: {
            type: row.type,
            notificationId: row.id,
            conversationId: conversationId || '',
          },
          android: {
            channelId: 'company_chat_retention',
            tag: conversationId || row.id,
            sound: prefs.sound,
            vibrate: prefs.vibration,
          },
          apns: {
            threadId: conversationId || 'retention',
            category: 'RETENTION',
            sound: prefs.sound,
          },
        })
        .catch(() => {});
    }
    return created;
  }

  async function recordJob(kind, fn) {
    const [job] = await db
      .insert(retentionJobs)
      .values({ kind, status: 'running', startedAt: new Date(), attempt: 1 })
      .returning();
    try {
      const stats = await fn();
      await db
        .update(retentionJobs)
        .set({ status: 'succeeded', finishedAt: new Date(), stats })
        .where(eq(retentionJobs.id, job.id));
      return { ...job, status: 'succeeded', stats };
    } catch (error) {
      await db
        .update(retentionJobs)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          lastError: String(error.message || error).slice(0, 500),
        })
        .where(eq(retentionJobs.id, job.id));
      throw error;
    }
  }

  return {
    policy,
    publicPolicy: async () => publicPolicy(await policy()),
    expiresAtForCreate(createdAt = new Date()) {
      return this.policy().then((row) => expiresAtForNewMessage(createdAt, row.retentionDays));
    },
    async preview() {
      const settings = await policy();
      const now = new Date();
      const horizon = new Date(now.getTime() + 7 * 86400000);
      const [due] = await db
        .select({
          messages: sql`count(*)::int`,
          attachments: sql`count(${attachments.id})::int`,
          bytes: sql`coalesce(sum(${attachments.sizeBytes}), 0)::bigint`,
          oldest: sql`min(${messages.createdAt})`,
        })
        .from(messages)
        .leftJoin(attachments, eq(attachments.messageId, messages.id))
        .where(and(isNull(messages.expiredAt), lte(messages.expiresAt, now)));
      const [upcoming] = await db
        .select({ upcoming7: sql`count(*)::int` })
        .from(messages)
        .where(and(isNull(messages.expiredAt), gt(messages.expiresAt, now), lte(messages.expiresAt, horizon)));
      return {
        policy: publicPolicy(settings),
        eligibleMessages: Number(due.messages ?? 0),
        eligibleAttachments: Number(due.attachments ?? 0),
        eligibleBytes: Number(due.bytes ?? 0),
        oldestMessageAt: due.oldest,
        upcomingIn7Days: Number(upcoming.upcoming7 ?? 0),
        cleanupEnabled: settings.cleanupEnabled,
        mode: settings.cleanupEnabled ? 'active' : 'preview',
      };
    },
    async updatePolicy(userId, input, context) {
      const current = await policy();
      let nextDays = current.retentionDays;
      if (input.retentionDays != null) {
        try {
          nextDays = assertRetentionDays(input.retentionDays);
        } catch {
          throw new AppError('Retention must be 30, 90, or 180 days', 400, 'VALIDATION_ERROR');
        }
      }
      const patch = {
        retentionDays: nextDays,
        remindersEnabled: input.remindersEnabled ?? current.remindersEnabled,
        existingGraceDays: input.existingGraceDays ?? current.existingGraceDays,
        legalHold: input.legalHold ?? current.legalHold,
        updatedAt: new Date(),
      };
      if (nextDays !== current.retentionDays) {
        const now = new Date();
        const open = await db
          .select({ id: messages.id, createdAt: messages.createdAt, expiresAt: messages.expiresAt })
          .from(messages)
          .where(and(isNull(messages.expiredAt), isNull(messages.purgedAt)));
        for (const row of open) {
          const next = nextExpiresAtOnPolicyChange(row.expiresAt || row.createdAt, row.createdAt, now, nextDays);
          await db.update(messages).set({ expiresAt: next }).where(eq(messages.id, row.id));
        }
      }
      const [updated] = await db
        .update(retentionPolicies)
        .set(patch)
        .where(eq(retentionPolicies.id, POLICY_ID))
        .returning();
      await audit(db, context, 'admin.retention_updated', 'retention', null, {
        fields: Object.keys(input),
        retentionDays: nextDays,
      });
      return publicPolicy(updated);
    },
    async activateCleanup(userId, context) {
      const [updated] = await db
        .update(retentionPolicies)
        .set({
          cleanupEnabled: true,
          cleanupApprovedAt: new Date(),
          cleanupApprovedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(retentionPolicies.id, POLICY_ID))
        .returning();
      await audit(db, context, 'admin.retention_activated', 'retention', null, { cleanupEnabled: true });
      return publicPolicy(updated);
    },
    async pauseCleanup(context) {
      const [updated] = await db
        .update(retentionPolicies)
        .set({ cleanupEnabled: false, updatedAt: new Date() })
        .where(eq(retentionPolicies.id, POLICY_ID))
        .returning();
      await audit(db, context, 'admin.retention_paused', 'retention', null, { cleanupEnabled: false });
      return publicPolicy(updated);
    },
    async conversationRetention(conversationId, userId) {
      await conversationsService.assertMember(conversationId, userId);
      const settings = await policy();
      const [row] = await db
        .select({
          nextExpiresAt: sql`min(expires_at) filter (where expired_at is null)`,
          remaining: sql`count(*) filter (where expired_at is null)::int`,
        })
        .from(messages)
        .where(eq(messages.conversationId, conversationId));
      return {
        ...publicPolicy(settings),
        conversationId,
        nextExpiresAt: row?.nextExpiresAt ?? null,
        remainingMessages: Number(row?.remaining ?? 0),
      };
    },
    async listNotifications(userId) {
      return db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(50);
    },
    async markRead(id, userId) {
      const [row] = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .returning();
      if (!row) throw new AppError('Notification not found', 404, 'NOT_FOUND');
      return row;
    },
    async jobs() {
      return db.select().from(retentionJobs).orderBy(desc(retentionJobs.createdAt)).limit(30);
    },
    async placeHold(conversationId, userId, reason, context) {
      const [row] = await db
        .insert(retentionHolds)
        .values({ conversationId, createdBy: userId, reason: String(reason || 'legal hold').slice(0, 255) })
        .returning();
      await audit(db, context, 'admin.retention_hold', 'conversation', conversationId, { reason: row.reason });
      return row;
    },
    async releaseHold(id, context) {
      const [row] = await db
        .update(retentionHolds)
        .set({ releasedAt: new Date() })
        .where(and(eq(retentionHolds.id, id), isNull(retentionHolds.releasedAt)))
        .returning();
      if (!row) throw new AppError('Hold not found', 404, 'NOT_FOUND');
      await audit(db, context, 'admin.retention_hold_released', 'conversation', row.conversationId, {});
      return row;
    },
    async requestExport(conversationId, userId, context) {
      await conversationsService.assertMember(conversationId, userId);
      const [{ pending }] = await db
        .select({ pending: sql`count(*)::int` })
        .from(retentionExports)
        .where(
          and(
            eq(retentionExports.userId, userId),
            inArray(retentionExports.status, ['pending', 'running']),
          ),
        );
      if (pending >= 2) throw new AppError('An export is already in progress', 429, 'QUOTA_EXCEEDED');
      const [row] = await db
        .insert(retentionExports)
        .values({
          userId,
          conversationId,
          status: 'pending',
          expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
        })
        .returning();
      await audit(db, context, 'retention.export_requested', 'conversation', conversationId, { exportId: row.id });
      return row;
    },
    async exportStatus(id, userId) {
      const [row] = await db.select().from(retentionExports).where(eq(retentionExports.id, id));
      if (!row || row.userId !== userId) throw new AppError('Export not found', 404, 'NOT_FOUND');
      if (row.status !== 'ready' || !row.storageKey) return row;
      const url = await storage.presignDownload(row.storageKey, {
        mimeType: 'application/json',
        fileName: `chat-export-${row.conversationId}.json`,
        inline: false,
        expiresIn: config.s3DownloadTtlSeconds,
      });
      return { ...row, downloadUrl: url };
    },
    async sendReminders() {
      const settings = await policy();
      if (!settings.remindersEnabled) return { sent: 0 };
      return recordJob('remind', async () => {
        const now = new Date();
        let sent = 0;
        for (const window of REMINDER_WINDOWS) {
          const start = new Date(now.getTime() + (window.daysBefore - 1) * 86400000);
          const end = new Date(now.getTime() + window.daysBefore * 86400000);
          const groups = await db
            .select({
              conversationId: messages.conversationId,
              count: sql`count(*)::int`,
              expiresAt: sql`min(${messages.expiresAt})`,
              title: conversations.title,
              type: conversations.type,
            })
            .from(messages)
            .innerJoin(conversations, eq(conversations.id, messages.conversationId))
            .where(
              and(
                isNull(messages.expiredAt),
                gt(messages.expiresAt, now),
                lte(messages.expiresAt, end),
                gt(messages.expiresAt, start),
              ),
            )
            .groupBy(messages.conversationId, conversations.title, conversations.type);
          for (const group of groups) {
            const expiresOn = dayKey(group.expiresAt);
            try {
              await db.insert(retentionReminders).values({
                conversationId: group.conversationId,
                windowKey: window.key,
                expiresOn,
                messageCount: Number(group.count),
              });
            } catch {
              continue;
            }
            const date = new Date(group.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' });
            await notifyMembers(group.conversationId, {
              type: `retention.reminder.${window.key}`,
              title: `Chat history expires in ${window.daysBefore} day${window.daysBefore === 1 ? '' : 's'}`,
              body: `${conversationTitle(group)} — ${group.count} messages/files expire on ${date} and cannot be recovered in the app.`,
              expiresAt: group.expiresAt ? new Date(group.expiresAt) : null,
              metadata: { count: Number(group.count), window: window.key },
            });
            sent += 1;
          }
        }
        return { sent };
      });
    },
    async expireDue({ force = false } = {}) {
      const settings = await policy();
      if (!force && !settings.cleanupEnabled) {
        return recordJob('preview', async () => {
          const preview = await this.preview();
          return {
            mode: 'preview',
            eligibleMessages: preview.eligibleMessages,
            eligibleBytes: preview.eligibleBytes,
          };
        });
      }
      if (settings.legalHold) return { skipped: 'legal_hold' };
      return recordJob('expire', async () => {
        const held = await heldConversationIds();
        const now = new Date();
        const due = await db
          .select()
          .from(messages)
          .where(and(isNull(messages.expiredAt), lte(messages.expiresAt, now)))
          .limit(BATCH)
          .for('update', { skipLocked: true });
        const usable = due.filter((row) => !held.has(row.conversationId));
        const byConversation = new Map();
        for (const row of usable) {
          const list = byConversation.get(row.conversationId) ?? [];
          list.push(row);
          byConversation.set(row.conversationId, list);
        }
        let expired = 0;
        for (const [conversationId, rows] of byConversation) {
          for (const row of rows) {
            const [c] = await db
              .update(conversations)
              .set({ lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`, updatedAt: new Date() })
              .where(eq(conversations.id, conversationId))
              .returning({ lastChangeSeq: conversations.lastChangeSeq });
            const [updated] = await db
              .update(messages)
              .set({
                expiredAt: now,
                deletedAt: row.deletedAt ?? now,
                content: '',
                changeSeq: c.lastChangeSeq,
              })
              .where(eq(messages.id, row.id))
              .returning();
            expired += 1;
            app.broadcaster.conversation(conversationId, 'message.expired', {
              ...updated,
              expired: true,
            }).catch(() => {});
          }
          await notifyMembers(conversationId, {
            type: 'retention.expired',
            title: 'Older messages were removed',
            body: `${rows.length} message${rows.length === 1 ? '' : 's'} older than ${settings.retentionDays} days were deleted and cannot be recovered.`,
            metadata: { count: rows.length },
          });
        }
        return { expired };
      });
    },
    async purgeExpired() {
      const settings = await policy();
      if (!settings.cleanupEnabled) return { skipped: 'preview' };
      return recordJob('purge', async () => {
        const rows = await db
          .select()
          .from(messages)
          .where(and(sql`${messages.expiredAt} is not null`, isNull(messages.purgedAt)))
          .limit(BATCH)
          .for('update', { skipLocked: true });
        let purged = 0;
        let objects = 0;
        let bytes = 0;
        for (const row of rows) {
          const files = await db.select().from(attachments).where(eq(attachments.messageId, row.id));
          for (const file of files) {
            const [{ refs }] = await db
              .select({ refs: sql`count(*)::int` })
              .from(attachments)
              .where(
                and(
                  eq(attachments.storageKey, file.storageKey),
                  sql`${attachments.messageId} is distinct from ${row.id}`,
                ),
              );
            if (Number(refs) === 0) {
              await storage.remove(file.storageKey).catch(() => {});
              await storage.remove(`${file.storageKey}.thumb`).catch(() => {});
              objects += 1;
              bytes += Number(file.sizeBytes || 0);
            }
            await db.delete(attachments).where(eq(attachments.id, file.id));
          }
          await db.delete(messageReactions).where(eq(messageReactions.messageId, row.id));
          await db.delete(messageHides).where(eq(messageHides.messageId, row.id));
          await db.update(messages).set({ purgedAt: new Date(), content: '' }).where(eq(messages.id, row.id));
          purged += 1;
        }
        return { purged, objects, bytes };
      });
    },
    async fulfillExports() {
      const pending = await db
        .select()
        .from(retentionExports)
        .where(eq(retentionExports.status, 'pending'))
        .limit(5);
      for (const job of pending) {
        await db.update(retentionExports).set({ status: 'running' }).where(eq(retentionExports.id, job.id));
        try {
          const rows = await db
            .select({
              id: messages.id,
              createdAt: messages.createdAt,
              senderId: messages.senderId,
              messageType: messages.messageType,
              content: messages.content,
              expiresAt: messages.expiresAt,
            })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, job.conversationId),
                isNull(messages.expiredAt),
                isNull(messages.deletedAt),
              ),
            )
            .orderBy(messages.createdAt);
          const files = await db
            .select()
            .from(attachments)
            .where(
              and(
                eq(attachments.conversationId, job.conversationId),
                eq(attachments.status, 'available'),
              ),
            );
          const payload = Buffer.from(
            JSON.stringify({
              exportedAt: new Date().toISOString(),
              conversationId: job.conversationId,
              messages: rows,
              attachments: files.map((file) => ({
                id: file.id,
                originalName: file.originalName,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                kind: file.kind,
              })),
            }),
          );
          const key = `exp/${createStorageKey().slice(4)}`;
          await storage.putObject(key, payload, 'application/json');
          await db
            .update(retentionExports)
            .set({
              status: 'ready',
              storageKey: key,
              sizeBytes: payload.length,
              expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
            })
            .where(eq(retentionExports.id, job.id));
        } catch (error) {
          await db
            .update(retentionExports)
            .set({ status: 'failed', error: String(error.message || error).slice(0, 255) })
            .where(eq(retentionExports.id, job.id));
        }
      }
      const stale = await db
        .select()
        .from(retentionExports)
        .where(and(eq(retentionExports.status, 'ready'), lte(retentionExports.expiresAt, new Date())));
      for (const row of stale) {
        await storage.remove(row.storageKey).catch(() => {});
        await db.update(retentionExports).set({ status: 'expired', storageKey: null }).where(eq(retentionExports.id, row.id));
      }
      return { processed: pending.length, expired: stale.length };
    },
    async cycle() {
      const reminders = await this.sendReminders().catch((error) => ({ error: error.message }));
      const expire = await this.expireDue().catch((error) => ({ error: error.message }));
      const purge = await this.purgeExpired().catch((error) => ({ error: error.message }));
      const exports = await this.fulfillExports().catch((error) => ({ error: error.message }));
      return { reminders, expire, purge, exports };
    },
  };
}
