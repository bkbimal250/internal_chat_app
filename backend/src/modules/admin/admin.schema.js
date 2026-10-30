import { Type as T } from '@sinclair/typebox';
import {
  DisplayName,
  IdParams,
  PageQuery,
  Password,
  User,
  apiSchema,
  object,
  pageOf,
} from '../auth/auth.schema.js';
export { IdParams, PageQuery };
export const CreateUserBody = object({
  employeeCode: T.Optional(T.String({ minLength: 1, maxLength: 64 })),
  username: T.String({ minLength: 3, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }),
  displayName: DisplayName,
  email: T.Optional(T.String({ format: 'email', maxLength: 254 })),
  role: T.Optional(T.Union([T.Literal('admin'), T.Literal('user')])),
});
export const UpdateUserBody = object(
  {
    employeeCode: T.Optional(T.Union([T.String({ minLength: 1, maxLength: 64 }), T.Null()])),
    displayName: T.Optional(DisplayName),
    email: T.Optional(T.Union([T.String({ format: 'email', maxLength: 254 }), T.Null()])),
  },
  { minProperties: 1 },
);
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
export { apiSchema, User, pageOf };
