import { devicesService } from './devices.service.js';

export const devicesController = (app) => ({
  list: (req) => devicesService(app).list(req.auth.userId),
  registerPush: (req) => devicesService(app).registerPushToken(req.auth.userId, req.auth.session, req.body.token),
});
