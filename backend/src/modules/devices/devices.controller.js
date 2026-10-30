import { devicesService } from './devices.service.js';
export const devicesController = (app) => ({
  list: (req) => devicesService(app).list(req.auth.userId),
});
