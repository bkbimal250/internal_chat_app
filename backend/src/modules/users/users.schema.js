import { Type as T } from '@sinclair/typebox';
import {
  DisplayName,
  IdParams,
  PageQuery,
  User,
  apiSchema,
  object,
  pageOf,
} from '../auth/auth.schema.js';
export const UpdateMe = object({ displayName: DisplayName });
export const DirectoryUser = object({
  id: T.String({ format: 'uuid' }),
  employeeCode: T.Union([T.String(), T.Null()]),
  username: T.String(),
  displayName: T.String(),
  createdAt: T.String(),
});
export { IdParams, PageQuery, User, apiSchema, pageOf };
