import { Type as T } from '@sinclair/typebox';
import {
  Address,
  DisplayName,
  IdParams,
  PageQuery,
  Phone,
  User,
  apiSchema,
  object,
  pageOf,
} from '../auth/auth.schema.js';
export const UpdateMe = object(
  {
    displayName: T.Optional(DisplayName),
    fullName: T.Optional(DisplayName),
    email: T.Optional(T.Union([T.String({ format: 'email', maxLength: 254 }), T.Null()])),
    phone: T.Optional(T.Union([Phone, T.Null()])),
    address: T.Optional(T.Union([Address, T.Null()])),
  },
  { minProperties: 1 },
);
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
export const PhotoUrlResponse = object({
  url: T.Union([T.String(), T.Null()]),
});
export const PhoneOtpBody = object({
  phone: Phone,
});
export const PhoneVerifyBody = object({
  phone: Phone,
  code: T.String({ minLength: 6, maxLength: 6, pattern: '^\\d{6}$' }),
});
export { OtpRequestResponse } from '../auth/auth.schema.js';
export const DirectoryUser = object({
  id: T.String({ format: 'uuid' }),
  employeeCode: T.Union([T.String(), T.Null()]),
  username: T.String(),
  displayName: T.String(),
  fullName: T.String(),
  hasProfilePhoto: T.Boolean(),
  photoVersion: T.Union([T.String(), T.Null()]),
  phoneE164: T.Union([T.String(), T.Null()]),
  createdAt: T.String(),
});
export { IdParams, PageQuery, User, apiSchema, pageOf };
