import { Type as T } from '@sinclair/typebox';
import {
  Address,
  DisplayName,
  IdParams,
  PageQuery,
  Password,
  Phone,
  User,
  apiSchema,
  object,
  pageOf,
} from '../auth/auth.schema.js';
export { IdParams };
export const AdminUserQuery = object({
  page: T.Optional(T.Integer({ minimum: 1, maximum: 100000, default: 1 })),
  limit: T.Optional(T.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: T.Optional(T.String({ maxLength: 100 })),
  status: T.Optional(T.Union([T.Literal('active'), T.Literal('suspended')])),
  role: T.Optional(T.Union([T.Literal('admin'), T.Literal('user')])),
});
export const CreateUserBody = object({
  employeeCode: T.Optional(T.String({ minLength: 1, maxLength: 64 })),
  username: T.String({ minLength: 3, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }),
  displayName: DisplayName,
  fullName: T.Optional(DisplayName),
  email: T.Optional(T.String({ format: 'email', maxLength: 254 })),
  phone: T.Optional(Phone),
  address: T.Optional(Address),
  role: T.Optional(T.Union([T.Literal('admin'), T.Literal('user')])),
  password: T.Optional(Password),
});
export const UpdateUserBody = object(
  {
    employeeCode: T.Optional(T.Union([T.String({ minLength: 1, maxLength: 64 }), T.Null()])),
    displayName: T.Optional(DisplayName),
    fullName: T.Optional(DisplayName),
    email: T.Optional(T.Union([T.String({ format: 'email', maxLength: 254 }), T.Null()])),
    phone: T.Optional(T.Union([Phone, T.Null()])),
    address: T.Optional(T.Union([Address, T.Null()])),
    role: T.Optional(T.Union([T.Literal('admin'), T.Literal('user')])),
  },
  { minProperties: 1 },
);
export const ResetPasswordBody = object({
  password: T.Optional(Password),
});
export const PhotoInitBody = object({
  mimeType: T.Union([T.Literal('image/jpeg'), T.Literal('image/png'), T.Literal('image/webp')]),
});
export const PhotoCompleteBody = object({
  key: T.String({ minLength: 16, maxLength: 128 }),
  mimeType: T.Union([T.Literal('image/jpeg'), T.Literal('image/png'), T.Literal('image/webp')]),
});
export const PhotoInitResponse = object({
  uploadUrl: T.String(),
  key: T.String(),
  expiresIn: T.Integer(),
  headers: T.Record(T.String(), T.String()),
});
export const CreatedUser = object({ user: User, temporaryPassword: Password });
export const Audit = object({
  id: T.String({ format: 'uuid' }),
  action: T.String(),
  targetType: T.String(),
  targetId: T.Union([T.String({ format: 'uuid' }), T.Null()]),
  actorUserId: T.Union([T.String({ format: 'uuid' }), T.Null()]),
  actorSessionId: T.Union([T.String({ format: 'uuid' }), T.Null()]),
  ipAddress: T.Union([T.String(), T.Null()]),
  metadata: T.Record(T.String(), T.Unknown()),
  createdAt: T.String(),
});
export { apiSchema, User, pageOf, PageQuery };
