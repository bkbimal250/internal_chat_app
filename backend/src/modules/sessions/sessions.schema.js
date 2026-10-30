import { Type as T } from '@sinclair/typebox';
import { IdParams, apiSchema, object } from '../auth/auth.schema.js';
export const Session = object({
  id: T.String({ format: 'uuid' }),
  deviceId: T.String({ format: 'uuid' }),
  deviceName: T.String(),
  platform: T.Union([T.Literal('web'), T.Literal('android'), T.Literal('ios')]),
  createdAt: T.String(),
  lastUsedAt: T.String(),
  expiresAt: T.String(),
  current: T.Boolean(),
});
export { IdParams, apiSchema };
