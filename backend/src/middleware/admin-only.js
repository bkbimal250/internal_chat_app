import { AppError } from '../utils/app-error.js';
export async function adminOnly(request) {
  if (request.auth?.user.role !== 'admin')
    throw new AppError('Administrator permission required', 403, 'FORBIDDEN');
}
