import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['admin', 'user']);
export const userStatus = pgEnum('user_status', ['active', 'suspended']);
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeCode: varchar('employee_code', { length: 64 }),
    username: varchar('username', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('user'),
    status: userStatus('status').notNull().default('active'),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_username_lower_unique').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_lower_unique')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    uniqueIndex('users_employee_code_unique')
      .on(t.employeeCode)
      .where(sql`${t.employeeCode} is not null`),
    index('users_status_created_idx').on(t.status, t.createdAt),
  ],
);
