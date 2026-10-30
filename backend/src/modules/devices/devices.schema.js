import { Type as T } from '@sinclair/typebox';
import { apiSchema, object } from '../auth/auth.schema.js';
export const Device = object({
  id: T.String({ format: 'uuid' }),
  deviceName: T.String(),
  platform: T.Union([T.Literal('web'), T.Literal('android'), T.Literal('ios')]),
  lastSeenAt: T.String(),
  createdAt: T.String(),
});
export { apiSchema };
