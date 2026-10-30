import { Type as T } from '@sinclair/typebox';

export const object = (properties, options = {}) =>
  T.Object(properties, { additionalProperties: false, ...options });
export const Id = T.String({ format: 'uuid' });
export const Password = T.String({ minLength: 12, maxLength: 128 });
export const Username = T.String({
  minLength: 3,
  maxLength: 64,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
});
export const DisplayName = T.String({ minLength: 1, maxLength: 120, pattern: '\\S' });
export const NullableText = T.Union([T.String(), T.Null()]);
export const User = object({
  id: Id,
  employeeCode: NullableText,
  username: T.String(),
  displayName: T.String(),
  email: NullableText,
  role: T.Union([T.Literal('admin'), T.Literal('user')]),
  status: T.Union([T.Literal('active'), T.Literal('suspended')]),
  mustChangePassword: T.Boolean(),
  createdAt: T.String(),
  updatedAt: T.String(),
});
export const ErrorResponse = object({
  error: object({
    code: T.String(),
    message: T.String(),
    requestId: T.String(),
    details: T.Optional(T.Array(object({ path: T.String(), rule: T.String() }))),
  }),
});
export const Ok = object({ success: T.Literal(true) });
export const IdParams = object({ id: Id });
export const PageQuery = object({
  page: T.Optional(T.Integer({ minimum: 1, maximum: 100000, default: 1 })),
  limit: T.Optional(T.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: T.Optional(T.String({ maxLength: 100 })),
});
export const pageOf = (item) =>
  object({ data: T.Array(item), page: T.Integer(), limit: T.Integer(), total: T.Integer() });
export function apiSchema(tag, summary, response, extra = {}, authenticated = true, status = 200) {
  return {
    tags: [tag],
    summary,
    security: authenticated ? [{ bearerAuth: [] }] : [],
    response: {
      [status]: response,
      400: ErrorResponse,
      401: ErrorResponse,
      403: ErrorResponse,
      404: ErrorResponse,
      409: ErrorResponse,
      429: ErrorResponse,
      500: ErrorResponse,
    },
    ...extra,
  };
}
export const LoginBody = object({
  username: Username,
  password: T.String({ minLength: 1, maxLength: 128 }),
  clientType: T.Union([T.Literal('web'), T.Literal('native')]),
  platform: T.Union([T.Literal('web'), T.Literal('android'), T.Literal('ios')]),
  deviceName: DisplayName,
  deviceId: T.Optional(Id),
});
export const RefreshBody = object({
  clientType: T.Union([T.Literal('web'), T.Literal('native')]),
  refreshToken: T.Optional(T.String({ minLength: 64, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' })),
});
export const ChangePasswordBody = object({
  currentPassword: T.String({ minLength: 1, maxLength: 128 }),
  newPassword: Password,
});
export const Tokens = object({
  accessToken: T.String(),
  tokenType: T.Literal('Bearer'),
  expiresIn: T.Literal(900),
  refreshToken: T.Optional(T.String()),
  csrfToken: T.Optional(T.String()),
  sessionId: Id,
  deviceId: Id,
  refreshExpiresAt: T.String(),
  user: User,
});
